/** Job handlers: outbox dispatch (sandbox transport), pending-question timers, knowledge-candidate expiry. */
import type { Tx } from './db.ts';
import { runDue, schedule, type Handler } from './jobs.ts';
import { isOptedOut, sandboxSend } from './messaging/channels.ts';
import { onKcExpire, onSendResult, onTimer } from './escalation/pq.ts';

const MAX_SEND_ATTEMPTS = 4;
const SEND_BACKOFF_MS = [60_000, 300_000, 1_200_000];

const outbox: Handler = async (tx: Tx, job, now) => {
  const ob = (await tx.query(`select * from outbox_events where id = $1 for update`, [job.ref])).rows[0];
  if (!ob || ob.status !== 'pending') return;
  const meta = ob.payload.meta ?? {};
  if (ob.kind === 'sms' && !ob.payload.exempt && (await isOptedOut(tx, ob.payload.sender, ob.payload.to, 'sms'))) {
    await tx.query(`update outbox_events set status = 'dead', last_error = 'opted_out' where id = $1`, [ob.id]);
    await onSendResult(tx, job.tenant_id, meta, false, true, null, now);
    return;
  }
  const r = await sandboxSend(tx, job.tenant_id, ob, now);
  if (r.ok) {
    await tx.query(`update outbox_events set status = 'done', attempts = attempts + 1, provider_message_id = $2, delivery_status = 'delivered' where id = $1`, [ob.id, r.providerMessageId]);
    await onSendResult(tx, job.tenant_id, meta, true, false, r.providerMessageId, now);
    return;
  }
  const attempts = ob.attempts + 1;
  if (r.permanent || attempts >= MAX_SEND_ATTEMPTS) {
    await tx.query(`update outbox_events set status = 'dead', attempts = $2, last_error = $3 where id = $1`, [ob.id, attempts, r.error]);
    await onSendResult(tx, job.tenant_id, meta, false, true, null, now);
  } else {
    const at = new Date(now.getTime() + SEND_BACKOFF_MS[attempts - 1]);
    await tx.query(`update outbox_events set attempts = $2, last_error = $3, next_attempt_at = $4 where id = $1`, [ob.id, attempts, r.error, at]);
    await schedule(tx, job.tenant_id, 'outbox', ob.id, at, `outbox:${ob.id}:${attempts}`);
  }
};

const pqTimer = (kind: string): Handler => (tx, job, now) => onTimer(tx, job.tenant_id, kind, job.ref, now);

export const HANDLERS: Record<string, Handler> = {
  outbox,
  pq_reminder: pqTimer('pq_reminder'),
  pq_expire: pqTimer('pq_expire'),
  pq_late_close: pqTimer('pq_late_close'),
  pq_owner_retry: pqTimer('pq_owner_retry'),
  pq_relay: pqTimer('pq_relay'),
  kc_expire: (tx, job, now) => onKcExpire(tx, job.tenant_id, job.ref, now),
};

/** Run jobs until nothing more is due at `now` (sends can enqueue further sends). */
export async function drain(now: Date) {
  for (let i = 0; i < 20; i++) if ((await runDue(now, HANDLERS)) === 0) return;
}
