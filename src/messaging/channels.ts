/**
 * Messaging gateway (Gate A): signature checks for LINE and a generic SMS stand-in, STOP/START/HELP parsing,
 * outbox with sandbox transport (nothing leaves this machine), consent and opt-out rules (SM-11).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Tx } from '../db.ts';
import { audit, idHash, sha256, uuid } from '../db.ts';
import { schedule } from '../jobs.ts';

// ---- Signatures -----------------------------------------------------------------------------------------
export function lineSignature(rawBody: string, channelSecret: string): string {
  return createHmac('sha256', channelSecret).update(rawBody).digest('base64');
}
export function verifyLine(rawBody: string, header: string | undefined, channelSecret: string): boolean {
  if (!header) return false;
  const want = Buffer.from(lineSignature(rawBody, channelSecret)), got = Buffer.from(header);
  return want.length === got.length && timingSafeEqual(want, got);
}
/** Generic SMS stand-in: HMAC-SHA256 hex over `${timestamp}.${body}`, ±300 s (real adapters: Twilio HMAC-SHA1, Telnyx Ed25519). */
export function smsSignature(rawBody: string, ts: number, secret: string) {
  return createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
}
export function verifySms(rawBody: string, ts: number, header: string | undefined, secret: string, now: Date): boolean {
  if (!header || Math.abs(now.getTime() / 1000 - ts) > 300) return false;
  const want = Buffer.from(smsSignature(rawBody, ts, secret)), got = Buffer.from(header);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Insert-or-ignore receipt: returns false for a replay. */
export async function firstReceipt(tx: Tx, provider: string, key: string, tenantId: string | null, signatureOk: boolean) {
  const r = await tx.query(
    `insert into webhook_receipts (provider, receipt_key, tenant_id, signature_ok) values ($1,$2,$3,$4) on conflict do nothing`,
    [provider, key, tenantId, signatureOk]);
  return r.rowCount === 1;
}

// ---- Keywords --------------------------------------------------------------------------------------------
const STOP = ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit', 'revoke', 'optout', 'opt out', 'opt-out', 'ยกเลิก', 'หยุด', 'เลิกรับ'];
const START = ['start', 'unstop', 'เริ่ม'];
const HELP = ['help', 'info', 'ช่วยเหลือ'];
const PLAIN_OPT_OUT = /(don'?t|do not|stop) (text|message|contact)|leave me alone|ไม่ต้องส่ง|อย่าส่ง/i;
export function keyword(text: string): 'stop' | 'start' | 'help' | 'plain_opt_out' | null {
  const t = text.trim().toLowerCase().replace(/[.!]+$/, '');
  if (STOP.includes(t)) return 'stop';
  if (START.includes(t)) return 'start';
  if (HELP.includes(t)) return 'help';
  if (PLAIN_OPT_OUT.test(t)) return 'plain_opt_out';
  return null;
}

// ---- Consent ---------------------------------------------------------------------------------------------
export async function isOptedOut(tx: Tx, sender: string, target: string, channel: string) {
  const r = await tx.query(`select state from opt_outs where sender_id = $1 and target_hash = $2 and channel = $3`, [sender, idHash(target), channel]);
  return r.rows[0]?.state === 'stopped';
}

export async function recordConsent(tx: Tx, tenantId: string, c: {
  sender: string; target: string; channel: string; purpose: 'service_followup' | 'transactional'; scopeRef: string;
  evidence: Record<string, unknown>; now: Date; expiresAt?: Date;
}) {
  const id = uuid();
  await tx.query(
    `insert into consents (tenant_id, id, sender_id, target_hash, channel, purpose, scope_ref, state, evidence, granted_at, expires_at)
     values ($1,$2,$3,$4,$5,$6,$7,'granted',$8,$9,$10)`,
    [tenantId, id, c.sender, idHash(c.target), c.channel, c.purpose, c.scopeRef, JSON.stringify(c.evidence), c.now, c.expiresAt ?? null]);
  await audit(tx, tenantId, { machine: 'SM-11', entity: id, to: 'granted', event: 'consent', actor: 'caller', detail: { purpose: c.purpose, scope: c.scopeRef }, at: c.now });
  return id;
}

export async function hasConsent(tx: Tx, c: { sender: string; target: string; channel: string; purpose: string; scopeRef: string; now: Date }) {
  const r = await tx.query(
    `select 1 from consents where sender_id = $1 and target_hash = $2 and channel = $3 and purpose = $4 and scope_ref = $5
       and state = 'granted' and (expires_at is null or expires_at > $6)`,
    [c.sender, idHash(c.target), c.channel, c.purpose, c.scopeRef, c.now]);
  return (r.rowCount ?? 0) > 0;
}

/** STOP / START from the handset (or an opt-out link). The model can never call this. */
export async function applyOptKeyword(tx: Tx, tenantId: string, a: {
  sender: string; target: string; channel: string; kw: 'stop' | 'start'; sourceMessageId: string; now: Date; twoWay: boolean; lang: 'th' | 'en';
}) {
  await tx.query(
    `insert into opt_outs (tenant_id, sender_id, target_hash, channel, state, last_keyword, at, source_message_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (tenant_id, sender_id, target_hash, channel) do update set state = excluded.state, last_keyword = excluded.last_keyword,
       at = excluded.at, source_message_id = excluded.source_message_id`,
    [tenantId, a.sender, idHash(a.target), a.channel, a.kw === 'stop' ? 'stopped' : 'restarted', a.kw, a.now, a.sourceMessageId]);
  if (a.kw === 'stop') {
    await tx.query(`update consents set state = 'revoked', version = version + 1 where sender_id = $1 and target_hash = $2 and channel = $3 and state = 'granted'`,
      [a.sender, idHash(a.target), a.channel]);
    await tx.query(`update outbox_events set status = 'dead', last_error = 'opted_out'
                    where status = 'pending' and payload->>'to' = $1 and payload->>'sender' = $2 and kind = 'sms'`, [a.target, a.sender]);
  }
  const body = a.kw === 'stop'
    ? (a.lang === 'th' ? 'คุณจะไม่ได้รับข้อความจากเราอีก' + (a.twoWay ? ' ส่ง START เพื่อรับอีกครั้ง' : '') : `You're unsubscribed and won't get more texts from us.${a.twoWay ? ' Reply START to resubscribe.' : ''}`)
    : (a.lang === 'th' ? 'เปิดรับข้อความอีกครั้งแล้ว' : "You're resubscribed.");
  await enqueue(tx, tenantId, { kind: 'sms', key: `optconfirm:${a.sourceMessageId}`, to: a.target, sender: a.sender, body, exempt: true, now: a.now });
  await audit(tx, tenantId, { machine: 'SM-11', entity: idHash(a.target).toString('hex').slice(0, 16), to: a.kw === 'stop' ? 'revoked' : 'granted', event: a.kw, actor: 'caller', at: a.now });
}

// ---- One-time links --------------------------------------------------------------------------------------
export const LINK_BASE = 'https://r.example.invalid'; // placeholder: the real domain must be registered (NBTC) before use
export async function makeLink(tx: Tx, tenantId: string, kind: 'confirm_target' | 'opt_out' | 'owner_reply', ref: string, expiresAt: Date) {
  const token = randomBytes(16).toString('base64url');
  await tx.query(`insert into link_tokens (token_hash, tenant_id, kind, ref, expires_at) values ($1,$2,$3,$4,$5)`,
    [sha256(token), tenantId, kind, ref, expiresAt]);
  return { token, url: `${LINK_BASE}/${kind === 'opt_out' ? 'o' : kind === 'confirm_target' ? 'c' : 'r'}/${token}` };
}

/** Opt-out instructions for caller texts: STOP on a two-way sender, a one-time link on a one-way Thai sender name. */
export async function optOutFooter(tx: Tx, tenantId: string, target: string, lang: 'th' | 'en', twoWay: boolean, now: Date) {
  if (twoWay) return lang === 'th' ? ' ส่ง STOP เพื่อยกเลิกรับข้อความ' : ' Reply STOP to opt out.';
  const link = await makeLink(tx, tenantId, 'opt_out', target, new Date(now.getTime() + 90 * 86_400_000));
  return (lang === 'th' ? ' ยกเลิกรับข้อความ: ' : ' Opt out: ') + link.url;
}

// ---- Outbox -----------------------------------------------------------------------------------------------
export type Outbound = { kind: 'sms' | 'line'; key: string; to: string; sender: string; body: string; quickReplies?: unknown[];
  exempt?: boolean; now: Date; meta?: Record<string, unknown>; runAt?: Date };

export async function enqueue(tx: Tx, tenantId: string, m: Outbound) {
  const id = uuid();
  const r = await tx.query(
    `insert into outbox_events (tenant_id, id, kind, idempotency_key, payload, status, next_attempt_at)
     values ($1,$2,$3,$4,$5,'pending',$6) on conflict (tenant_id, idempotency_key) do nothing returning id`,
    [tenantId, id, m.kind, m.key, JSON.stringify({ to: m.to, sender: m.sender, body: m.body, quick_replies: m.quickReplies ?? null,
      exempt: !!m.exempt, meta: m.meta ?? {} }), m.runAt ?? m.now]);
  if (r.rowCount) await schedule(tx, tenantId, 'outbox', id, m.runAt ?? m.now, `outbox:${id}:0`);
  return r.rowCount ? id : null;
}

/** Sandbox transport. Faults let tests make a recipient fail transiently or permanently. */
export const faults = new Map<string, { kind: 'transient' | 'permanent'; times: number }>();
export async function sandboxSend(tx: Tx, tenantId: string, ob: { kind: string; payload: any; idempotency_key: string }, now: Date) {
  const f = faults.get(ob.payload.to);
  if (f && f.times > 0) {
    f.times--;
    return { ok: false as const, permanent: f.kind === 'permanent', error: `sandbox ${f.kind} failure` };
  }
  const existing = await tx.query(`select provider_message_id from sandbox_messages where idempotency_key = $1`, [ob.idempotency_key]);
  if (existing.rowCount) return { ok: true as const, providerMessageId: existing.rows[0].provider_message_id as string };
  const pid = `sbx-${uuid()}`;
  await tx.query(
    `insert into sandbox_messages (tenant_id, channel, sender, recipient, body, quick_replies, provider_message_id, idempotency_key, status, at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,'delivered',$9)`,
    [tenantId, ob.kind, ob.payload.sender, ob.payload.to, ob.payload.body, ob.payload.quick_replies ? JSON.stringify(ob.payload.quick_replies) : null,
     pid, ob.idempotency_key, now]);
  return { ok: true as const, providerMessageId: pid };
}
