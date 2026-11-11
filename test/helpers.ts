process.env.RCPT_DB = 'rcpt_test';
import { createHash } from 'node:crypto';
import { closeDb, Clock, withSystem, withTenant } from '../src/db.ts';
import { faults, lineSignature, smsSignature } from '../src/messaging/channels.ts';
import { drain } from '../src/handlers.ts';
import { lineWebhook, smsWebhook, LINE_CHANNEL_SECRET, SMS_WEBHOOK_SECRET } from '../src/inbound.ts';
import { seed, A, B, C, IDS, NUM } from '../sim/seed.ts';
import { Call } from '../sim/session.ts';

export { A, B, C, IDS, NUM, Call, closeDb, drain, withTenant, withSystem };
export const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Thursday 12 Nov 2026, 10:00 in Bangkok. */
export const START = '2026-11-12T03:00:00Z';
export async function fresh(iso = START) {
  await seed('rcpt_test');
  faults.clear();
  return new Clock(iso);
}

export async function sandbox(tenantId: string) {
  return withSystem(async tx => (await tx.query(`select * from sandbox_messages where tenant_id = $1 order by id`, [tenantId])).rows);
}
export async function pqRow(tenantId: string, handle: string) {
  return withTenant(tenantId, async tx => (await tx.query('select * from pending_questions where handle = $1', [handle])).rows[0]);
}

let ev = 0;
export async function ownerLine(now: Date, userId: string, e: { text?: string; quotedMessageId?: string; postback?: string; badSig?: boolean }) {
  ev++;
  const body = JSON.stringify({ events: [{ webhookEventId: `evt-${ev}-${now.getTime()}`, type: e.postback ? 'postback' : 'message', source: { type: 'user', userId },
    ...(e.postback ? { postback: { data: e.postback } } : { message: { id: `m-${ev}-${now.getTime()}`, type: 'text', text: e.text, quotedMessageId: e.quotedMessageId } }) }] });
  return lineWebhook(body, e.badSig ? 'bad' : lineSignature(body, LINE_CHANNEL_SECRET), now);
}
export async function inboundSms(now: Date, m: { from: string; to: string; body: string; id?: string; badSig?: boolean }) {
  ev++;
  const body = JSON.stringify({ message_id: m.id ?? `sms-${ev}-${now.getTime()}`, from: m.from, to: m.to, body: m.body });
  const ts = Math.floor(now.getTime() / 1000);
  return smsWebhook(body, ts, m.badSig ? 'bad' : smsSignature(body, ts, SMS_WEBHOOK_SECRET), now);
}
/** The postback attached to a quick-reply label in the latest sandbox LINE message for a tenant. */
export async function quick(tenantId: string, labelPrefix: string) {
  const msgs = (await sandbox(tenantId)).filter(m => m.quick_replies);
  for (const m of msgs.reverse()) {
    const q = (m.quick_replies as Array<{ label: string; data: string }>).find(x => x.label.startsWith(labelPrefix));
    if (q) return q.data;
  }
  throw new Error(`no quick reply ${labelPrefix}`);
}
export const CALLER = '+66812345678';
