/** Postgres job queue: timers and outbox dispatch are rows committed in the same transaction as the change. */
import type { Tx } from './db.ts';
import { withSystem, withTenant } from './db.ts';

export type Job = { id: string; tenant_id: string; kind: string; ref: string; run_at: Date; attempts: number };
export type Handler = (tx: Tx, job: Job, now: Date) => Promise<void>;

export async function schedule(tx: Tx, tenantId: string, kind: string, ref: string, runAt: Date, dedupeKey: string) {
  await tx.query(
    `insert into jobs (tenant_id, kind, ref, run_at, dedupe_key) values ($1,$2,$3,$4,$5) on conflict (dedupe_key) do nothing`,
    [tenantId, kind, ref, runAt, dedupeKey]);
}

export async function cancelJobs(tx: Tx, ref: string, kinds: string[]) {
  await tx.query(`update jobs set status = 'cancelled' where ref = $1 and kind = any($2) and status = 'pending'`, [ref, kinds]);
}

const BACKOFF_MS = [60_000, 300_000, 1_200_000, 3_600_000];
const MAX_ATTEMPTS = 5;

/** Run every job due at `now` (single runner in Gate A). Returns the number processed. */
export async function runDue(now: Date, handlers: Record<string, Handler>, limit = 200): Promise<number> {
  const due: Job[] = await withSystem(async tx =>
    (await tx.query(`select id, tenant_id, kind, ref, run_at, attempts from jobs where status = 'pending' and run_at <= $1
                     order by run_at, id limit $2`, [now, limit])).rows);
  for (const job of due) {
    const h = handlers[job.kind];
    try {
      if (!h) throw new Error(`no handler for ${job.kind}`);
      await withTenant(job.tenant_id, async tx => {
        const still = await tx.query(`select 1 from jobs where id = $1 and status = 'pending' for update`, [job.id]);
        if (!still.rowCount) return;
        await h(tx, job, now);
        await tx.query(`update jobs set status = 'done' where id = $1`, [job.id]);
      });
    } catch (e: any) {
      await withSystem(tx => tx.query(
        `update jobs set attempts = attempts + 1, last_error = $2,
           status = case when attempts + 1 >= $3 then 'failed' else 'pending' end, run_at = $4 where id = $1`,
        [job.id, String(e?.message ?? e).slice(0, 500), MAX_ATTEMPTS, new Date(now.getTime() + BACKOFF_MS[Math.min(job.attempts, 3)])]));
    }
  }
  return due.length;
}
