/**
 * Pending owner questions (PQ) and knowledge candidates (KC) — blueprint §5.8.2–§5.8.7.
 * The caller is never waiting on any of this: the call ended or moved on at UQ6.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Tx } from '../db.ts';
import { audit, idHash, sha256, uuid } from '../db.ts';
import { cancelJobs, schedule } from '../jobs.ts';
import { enqueue, hasConsent, isOptedOut, makeLink, optOutFooter } from '../messaging/channels.ts';
import { localParts, pad } from '../time/zone.ts';
import { renderDateTime } from '../time/resolve.ts';
import { ToolError } from '../tools/errors.ts';
import { FAIL_TEXT, ownerCommand, validateOwnerReply } from './validate.ts';
import { keywordsOf } from '../knowledge.ts';

export const OWNER_LINE_SENDER = 'LINE:O2-Receptionist';
const POSTBACK_SECRET = process.env.RCPT_POSTBACK_SECRET ?? randomBytes(32).toString('hex');
export const PQ_TTL_MS = 24 * 3600_000;
export const LATE_MS = 48 * 3600_000;
const REMINDERS_MS = [2 * 3600_000, 6 * 3600_000];
const MAX_OPEN_PER_TARGET_24H = 3, MAX_PER_TENANT_HOUR = 20;
const OPEN = ['queued', 'owner_notifying', 'owner_unreachable', 'awaiting_owner', 'reply_needs_edit', 'owner_confirming'];

const ALLOWED: Record<string, string[]> = {
  queued: ['owner_notifying', 'expired'],
  owner_notifying: ['awaiting_owner', 'owner_notifying', 'owner_unreachable', 'expired', 'owner_declined', 'reply_needs_edit', 'owner_confirming'],
  owner_unreachable: ['owner_notifying', 'expired', 'reply_needs_edit', 'owner_confirming', 'owner_declined'],
  awaiting_owner: ['reply_needs_edit', 'owner_confirming', 'owner_declined', 'expired'],
  reply_needs_edit: ['reply_needs_edit', 'owner_confirming', 'owner_declined', 'owner_reply_rejected'],
  owner_confirming: ['relaying', 'awaiting_owner', 'owner_confirming', 'owner_declined', 'expired', 'reply_needs_edit'],
  relaying: ['delivered', 'caller_unreachable', 'relaying', 'awaiting_target'],
  awaiting_target: ['relaying', 'caller_unreachable'],
  expired: ['late_confirming'],
  late_confirming: ['relaying', 'expired', 'late_confirming'],
  owner_reply_rejected: [], owner_declined: [], delivered: [], caller_unreachable: [],
};
const TERMINAL: Record<string, string> = {
  delivered: 'delivered', caller_unreachable: 'caller_unreachable', owner_declined: 'owner_declined',
  owner_reply_rejected: 'owner_reply_rejected', expired: 'owner_timeout',
};

type PQ = Record<string, any>;
type Loc = { id: string; name: string; time_zone: string; public_phone: string; public_contact: Record<string, any> };

async function loc(tx: Tx): Promise<Loc> { return (await tx.query('select * from locations limit 1')).rows[0]; }
async function smsSender(tx: Tx, tenantId: string) {
  const r = await tx.query(`select sender, two_way from senders where tenant_id = $1 and channel = 'sms'`, [tenantId]);
  if (!r.rowCount) throw new ToolError('CONSENT_REQUIRED', 'no registered SMS sender', 'cannot_text_number');
  return r.rows[0] as { sender: string; two_way: boolean };
}
export async function loadPq(tx: Tx, id: string): Promise<PQ> {
  const r = await tx.query('select * from pending_questions where id = $1 for update', [id]);
  if (!r.rowCount) throw new ToolError('NOT_FOUND', 'pending question');
  return r.rows[0];
}

async function move(tx: Tx, tenantId: string, pq: PQ, to: string, event: string, actor: string, now: Date, extra: Record<string, unknown> = {}) {
  if (!ALLOWED[pq.status]?.includes(to)) throw new ToolError('VALIDATION_FAILED', `PQ ${pq.status} → ${to} not allowed`);
  let terminal: string | null = TERMINAL[to] ?? null;
  if (to === 'delivered' && pq.outcome_reason === 'late') terminal = 'delivered_late';
  const sets = Object.keys(extra).map((k, i) => `${k} = $${i + 5}`).join(', ');
  const r = await tx.query(
    `update pending_questions set status = $2, terminal_outcome = $3, version = version + 1${sets ? ', ' + sets : ''}
     where id = $1 and version = $4 returning *`,
    [pq.id, to, terminal, pq.version, ...Object.values(extra)]);
  if (!r.rowCount) throw new ToolError('VERSION_MISMATCH', 'pending question changed');
  await audit(tx, tenantId, { machine: 'PQ', entity: pq.id, from: pq.status, to, event, actor, correlation: pq.conversation_id, at: now,
    detail: terminal ? { terminal_outcome: terminal } : undefined });
  Object.assign(pq, r.rows[0]);
  return pq;
}

// ---- Signed postbacks ------------------------------------------------------------------------------------
export function postback(tenantId: string, pqId: string, action: string, extra = ''): string {
  const body = `t=${tenantId}&p=${pqId}&a=${action}${extra ? '&' + extra : ''}`;
  return `${body}&s=${createHmac('sha256', POSTBACK_SECRET).update(body).digest('base64url').slice(0, 22)}`;
}
export function readPostback(data: string): Record<string, string> | null {
  const i = data.lastIndexOf('&s=');
  if (i < 0) return null;
  const body = data.slice(0, i), sig = Buffer.from(data.slice(i + 3));
  const want = Buffer.from(createHmac('sha256', POSTBACK_SECRET).update(body).digest('base64url').slice(0, 22));
  if (sig.length !== want.length || !timingSafeEqual(sig, want)) return null;
  return Object.fromEntries(body.split('&').map(kv => kv.split('=') as [string, string]));
}

const shortQ = (q: string) => (q.length > 60 ? q.slice(0, 57) + '…' : q);
const localStr = (d: Date, tz: string, lang: 'th' | 'en') => { const p = localParts(d.getTime(), tz); return renderDateTime(p, p, lang); };

// ---- UQ6: create --------------------------------------------------------------------------------------------
export async function createPendingQuestion(tx: Tx, tenantId: string, a: {
  conversationId: string; questionText: string; summarySource: 'model' | 'caller_words'; tier: 'N' | 'S'; category: string;
  callerName?: string; target: string; ani: string | null; consentId: string; lang: 'th' | 'en'; contextLine?: string;
  linkedVariantId?: string; now: Date;
}) {
  const recentTarget = await tx.query(`select count(*)::int n from pending_questions where target_hash = $1 and created_at > $2`,
    [idHash(a.target), new Date(a.now.getTime() - 86_400_000)]);
  const recentTenant = await tx.query(`select count(*)::int n from pending_questions where created_at > $1`, [new Date(a.now.getTime() - 3_600_000)]);
  if (recentTarget.rows[0].n >= MAX_OPEN_PER_TARGET_24H || recentTenant.rows[0].n >= MAX_PER_TENANT_HOUR) {
    throw new ToolError('RATE_LIMITED', 'pending question limit');
  }
  const id = uuid();
  let handle = '';
  for (;;) {
    handle = 'Q-' + randomBytes(3).toString('hex').toUpperCase().replace(/[01]/g, 'K').slice(0, 4);
    if (!(await tx.query('select 1 from pending_questions where handle = $1', [handle])).rowCount) break;
  }
  const verification = a.ani && a.target === a.ani ? 'ani_match' : 'sms_confirm';
  const expires = new Date(a.now.getTime() + PQ_TTL_MS), late = new Date(expires.getTime() + LATE_MS);
  await tx.query(
    `insert into pending_questions (tenant_id, id, handle, conversation_id, question_text, question_sha256, summary_source, tier, category,
       caller_name, target, target_hash, target_last4, target_verification, target_confirmed_at, consent_id, status, reply_token_hash,
       expires_at, late_until, lang, linked_variant_id, context_line, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'queued',$17,$18,$19,$20,$21,$22,$23)`,
    [tenantId, id, handle, a.conversationId, a.questionText, sha256(a.questionText), a.summarySource, a.tier, a.category,
     a.callerName ?? null, a.target, idHash(a.target), a.target.slice(-4), verification, verification === 'ani_match' ? a.now : null,
     a.consentId, sha256(randomBytes(16)), expires, late, a.lang, a.linkedVariantId ?? null, a.contextLine ?? null, a.now]);
  await audit(tx, tenantId, { machine: 'PQ', entity: id, to: 'queued', event: 'created', actor: 'ai_runtime', correlation: a.conversationId, at: a.now });
  const pq = await loadPq(tx, id);
  await notifyOwner(tx, tenantId, pq, a.now);
  if (verification === 'sms_confirm') await sendTargetConfirmation(tx, tenantId, pq, a.now);
  for (const [i, ms] of REMINDERS_MS.entries()) await schedule(tx, tenantId, 'pq_reminder', id, new Date(a.now.getTime() + ms), `pq_reminder:${id}:${i}`);
  await schedule(tx, tenantId, 'pq_expire', id, expires, `pq_expire:${id}`);
  await schedule(tx, tenantId, 'pq_late_close', id, late, `pq_late_close:${id}`);
  const l = await loc(tx);
  const window = l.public_contact?.owner_reply_window?.[a.lang];
  const speak = a.lang === 'th'
    ? `ส่งคำถามของคุณให้ทีมงานแล้วค่ะ เมื่อทีมงานตอบ เราจะส่งข้อความคำตอบไปที่เบอร์ที่ลงท้ายด้วย ${a.target.slice(-2)} ${window ? `โดยปกติทีมงานตอบภายใน ${window}` : 'ดิฉันไม่สามารถรับปากได้ว่าจะได้คำตอบเมื่อไรนะคะ'} มีอะไรให้ช่วยอีกไหมคะ`
    : `I've sent your question to the team. When they reply, we'll text the answer to the number ending in ${a.target.slice(-2)}. ${window ? `They usually reply within ${window}.` : "I can't promise exactly when."} Is there anything else I can help with?`;
  return { pq_handle: handle, pq_id: id, expires_at_local: localStr(expires, l.time_zone, a.lang), target_last_digits: a.target.slice(-2),
    target_verification: verification, speakable_expectation: speak };
}

async function sendTargetConfirmation(tx: Tx, tenantId: string, pq: PQ, now: Date) {
  const s = await smsSender(tx, tenantId), l = await loc(tx);
  let tail: string;
  if (s.two_way) tail = pq.lang === 'th' ? 'ตอบ YES เพื่อรับคำตอบ' : 'Reply YES to receive it.';
  else tail = (pq.lang === 'th' ? 'หากเป็นคุณ กดยืนยัน: ' : 'If this was you, confirm: ') + (await makeLink(tx, tenantId, 'confirm_target', pq.id, new Date(pq.late_until))).url;
  const body = pq.lang === 'th'
    ? `${l.name}: มีผู้ขอให้ส่งคำตอบคำถามมาที่เบอร์นี้ ${tail} (ไม่ได้ขอ? ไม่ต้องทำอะไร)`
    : `${l.name}: someone asked us to text an answer to this number. ${tail} (Didn't ask? Ignore this.)`;
  await enqueue(tx, tenantId, { kind: 'sms', key: `pq:${pq.id}:confirm_target`, to: pq.target, sender: s.sender, body, now, runAt: quietHoursWait(now, l.time_zone) ?? undefined,
    meta: { pq_id: pq.id, purpose: 'pq_confirm_target' } });
}

// ---- PQ2: notify the owner (minimum necessary, §5.8.4) ----------------------------------------------------
async function ownerIdentities(tx: Tx) {
  return (await tx.query(`select * from owner_identities order by priority, id`)).rows as Array<{ id: string; channel: 'line' | 'sms'; value: string; label: string }>;
}

export async function notifyOwner(tx: Tx, tenantId: string, pq: PQ, now: Date) {
  const ids = await ownerIdentities(tx);
  const who = ids[pq.owner_attempt];
  if (!who) {
    if (pq.status !== 'owner_unreachable') await move(tx, tenantId, pq, 'owner_unreachable', 'all_owner_channels_failed', 'system', now);
    await schedule(tx, tenantId, 'pq_owner_retry', pq.id, new Date(now.getTime() + 15 * 60_000), `pq_owner_retry:${pq.id}:${now.getTime()}`);
    return;
  }
  await move(tx, tenantId, pq, 'owner_notifying', 'notify', 'system', now);
  const l = await loc(tx);
  const name = pq.caller_name ?? 'ไม่ระบุชื่อ / no name given';
  const sens = pq.tier === 'S' ? '\n⚠︎ เรื่องส่วนตัวของลูกค้า — ไม่ส่งรายละเอียด แนะนำให้โทรกลับ / personal circumstance — details withheld; call back recommended' : '';
  const question = pq.tier === 'S' ? '(personal circumstance)' : `“${pq.question_text}”`;
  let body = `คำถามจากลูกค้า ${pq.handle} · Caller question\nร้าน: ${l.name}\nลูกค้า: ${name} (…${pq.target_last4})\nคำถาม: ${question}` +
    (pq.context_line ? `\nAI แจ้งลูกค้าแล้ว: ${pq.context_line}` : '') + sens +
    `\nตอบได้ถึง / Answer by: ${localStr(new Date(pq.expires_at), l.time_zone, 'th')}`;
  if (who.channel === 'line') {
    body += '\nตอบ: กดค้าง (quote) ข้อความนี้แล้วพิมพ์คำตอบ / Reply by quoting this message';
    await enqueue(tx, tenantId, { kind: 'line', key: `pq:${pq.id}:notify:${pq.notify_round}:${who.id}:${pq.owner_attempt}`, to: who.value, sender: OWNER_LINE_SENDER, body, now,
      quickReplies: [{ label: 'ฉันจะติดต่อเอง', data: postback(tenantId, pq.id, 'will_contact') }, { label: 'ตอบไม่ได้', data: postback(tenantId, pq.id, 'decline') }],
      meta: { pq_id: pq.id, purpose: 'pq_notify', identity_id: who.id } });
  } else {
    const s = await smsSender(tx, tenantId);
    const how = s.two_way ? `Reply with the answer, or text DECLINE ${pq.handle} / CALL ${pq.handle}`
      : `ตอบที่ / Answer at: ${(await makeLink(tx, tenantId, 'owner_reply', pq.id, new Date(pq.late_until))).url}`;
    await enqueue(tx, tenantId, { kind: 'sms', key: `pq:${pq.id}:notify:${pq.notify_round}:${who.id}:${pq.owner_attempt}`, to: who.value, sender: s.sender, body: `${body}\n${how}`, now, exempt: true,
      meta: { pq_id: pq.id, purpose: 'pq_notify', identity_id: who.id } });
  }
}

async function ownerMessage(tx: Tx, tenantId: string, pq: PQ, key: string, body: string, now: Date, quickReplies?: unknown[], purpose = 'pq_owner_info') {
  const ids = await ownerIdentities(tx);
  const who = ids[Math.min(pq.owner_attempt, ids.length - 1)];
  if (!who) return;
  const sender = who.channel === 'line' ? OWNER_LINE_SENDER : (await smsSender(tx, tenantId)).sender;
  await enqueue(tx, tenantId, { kind: who.channel, key: `pq:${pq.id}:${key}`, to: who.value, sender, body, now, quickReplies, exempt: true, meta: { pq_id: pq.id, purpose } });
}

// ---- Outbox results feed the machine ----------------------------------------------------------------------
export async function onSendResult(tx: Tx, tenantId: string, meta: Record<string, any>, ok: boolean, permanent: boolean, providerMessageId: string | null, now: Date, reason?: string) {
  if (!meta.pq_id) return;
  const pq = await loadPq(tx, meta.pq_id);
  if (meta.purpose === 'pq_notify') {
    if (ok && pq.status === 'owner_notifying') await move(tx, tenantId, pq, 'awaiting_owner', 'owner_notified', 'provider', now, { notify_message_id: providerMessageId });
    else if (!ok && permanent && pq.status === 'owner_notifying') {
      await tx.query('update pending_questions set owner_attempt = owner_attempt + 1 where id = $1', [pq.id]);
      pq.owner_attempt += 1;
      await notifyOwner(tx, tenantId, pq, now);
    }
  } else if (meta.purpose === 'pq_answer' && pq.status === 'relaying') {
    if (ok) {
      await move(tx, tenantId, pq, 'delivered', 'delivered', 'provider', now);
      const l = await loc(tx);
      const lp = localParts(now.getTime(), l.time_zone);
      await ownerMessage(tx, tenantId, pq, 'receipt', `ส่งคำตอบ ${pq.handle} ถึงลูกค้า (…${pq.target_last4}) แล้ว เวลา ${pad(lp.h)}:${pad(lp.mi)} / Delivered`, now, [
        { label: 'ไม่ใช่ฉันส่ง / That wasn\'t me', data: postback(tenantId, pq.id, 'not_me') }]);
      await offerKnowledge(tx, tenantId, pq, now);
    } else if (permanent && reason === 'opted_out') {
      await move(tx, tenantId, pq, 'caller_unreachable', 'opted_out', 'caller', now, { outcome_reason: 'opted_out' });
      await ownerMessage(tx, tenantId, pq, 'unreachable', `ส่งคำตอบ ${pq.handle} ไม่ได้: ลูกค้ายกเลิกรับข้อความ / Caller opted out of texts`, now);
    } else if (permanent) {
      await move(tx, tenantId, pq, 'caller_unreachable', 'delivery_failed', 'provider', now, { outcome_reason: 'undeliverable' });
      await ownerMessage(tx, tenantId, pq, 'undeliverable', `ส่งคำตอบ ${pq.handle} ไม่ถึงลูกค้า (…${pq.target_last4}) — โทรกลับได้จากแดชบอร์ด / Couldn't deliver; call back from the dashboard`, now);
    }
  }
}

/** A STOP (keyword or link) closes any answer still on its way to that number. */
export async function onCallerOptOut(tx: Tx, tenantId: string, target: string, now: Date) {
  const rows = (await tx.query(`select id from pending_questions where target_hash = $1 and status in ('relaying','awaiting_target')`, [idHash(target)])).rows;
  for (const r of rows) {
    const pq = await loadPq(tx, r.id);
    await move(tx, tenantId, pq, 'caller_unreachable', 'opted_out', 'caller', now, { outcome_reason: 'opted_out' });
    await ownerMessage(tx, tenantId, pq, 'unreachable', `ส่งคำตอบ ${pq.handle} ไม่ได้: ลูกค้ายกเลิกรับข้อความ / Caller opted out of texts`, now);
  }
}

// ---- PQ3/PQ4: owner replies ---------------------------------------------------------------------------------
export type OwnerEvent = { channel: 'line' | 'sms' | 'web'; identityId: string; providerMessageId: string; text?: string; quotedMessageId?: string;
  postback?: Record<string, string>; pqId?: string; allowFallback?: boolean };

/** "Q-7K3F: answer…" names the question explicitly (how an SMS owner answers when several are open). */
function handlePrefix(text: string | undefined): { handle: string; rest: string } | null {
  const m = (text ?? '').match(/^\s*(Q-[A-Z0-9]{4})\b[\s:\-–]*([\s\S]*)$/i);
  return m && m[2].trim() && !ownerCommand(text ?? '') ? { handle: m[1].toUpperCase(), rest: m[2].trim() } : null;
}

async function findPqForOwnerText(tx: Tx, ev: OwnerEvent, now: Date): Promise<PQ | 'ambiguous' | 'not_here' | null> {
  if (ev.pqId) return loadPq(tx, ev.pqId);
  // An explicit reference that does not resolve in this tenant is never redirected to another question.
  if (ev.quotedMessageId) {
    const r = await tx.query(`select payload->'meta'->>'pq_id' pq from outbox_events where provider_message_id = $1`, [ev.quotedMessageId]);
    return r.rowCount && r.rows[0].pq ? loadPq(tx, r.rows[0].pq) : 'not_here';
  }
  const handle = (ev.text ? ownerCommand(ev.text)?.handle : undefined) ?? handlePrefix(ev.text)?.handle;
  if (handle) {
    const r = await tx.query('select id from pending_questions where handle = $1', [handle]);
    return r.rowCount ? loadPq(tx, r.rows[0].id) : 'not_here';
  }
  if (ev.allowFallback === false) return 'ambiguous';
  const open = await tx.query(`select id from pending_questions where status = any($1) order by created_at`, [[...OPEN, 'expired', 'late_confirming']]);
  const live = [];
  for (const row of open.rows) {
    const p = await loadPq(tx, row.id);
    if (p.status !== 'expired' || p.late_until > now) live.push(p);
  }
  if (live.length === 1) return live[0];
  return live.length ? 'ambiguous' : null;
}

export async function handleOwnerEvent(tx: Tx, tenantId: string, ev: OwnerEvent, now: Date) {
  if (ev.postback) return ownerAction(tx, tenantId, ev.postback.p, ev.postback.a, now, ev.postback);
  const found = await findPqForOwnerText(tx, ev, now);
  if (found === null) return { handled: false, reason: 'no_open_question' };
  if (found === 'not_here') return { handled: false, reason: 'not_here' };
  if (found === 'ambiguous') {
    await askToName(tx, tenantId, ev, now);
    return { handled: false, reason: 'ambiguous' };
  }
  const pq = found;
  const prefixed = handlePrefix(ev.text);
  if (prefixed) ev = { ...ev, text: prefixed.rest };
  const cmd = ownerCommand(ev.text ?? '');
  if (cmd?.cmd === 'send') return ownerAction(tx, tenantId, pq.id, pq.status === 'late_confirming' ? 'late_send' : 'send', now, { r: pq.pending_reply_id });
  if (cmd) return ownerAction(tx, tenantId, pq.id, cmd.cmd, now);
  if (!OPEN.includes(pq.status) && !(pq.status === 'expired' && pq.late_until > now)) {
    const msg = ['relaying', 'awaiting_target', 'late_confirming'].includes(pq.status)
      ? `คำตอบ ${pq.handle} กำลังส่งอยู่แล้ว / This answer is already being sent` : `คำถาม ${pq.handle} ปิดแล้ว / This question is already closed`;
    await ownerMessage(tx, tenantId, pq, `closed:${ev.providerMessageId}`, msg, now);
    return { handled: false, reason: 'closed' };
  }
  const l = await loc(tx);
  const others = (await tx.query(`select preferred_name from clients where preferred_name is not null and preferred_name <> coalesce($1,'')`, [pq.caller_name])).rows.map(r => r.preferred_name as string);
  const price = pq.linked_variant_id ? (await tx.query('select price_minor from service_variants where id = $1', [pq.linked_variant_id])).rows[0]?.price_minor : null;
  const check = validateOwnerReply(ev.text ?? '', { allowedDomains: l.public_contact?.domains ?? [], businessPhones: [l.public_phone],
    linkedPriceMinor: price == null ? null : Number(price), otherClientNames: others });
  const replyId = uuid();
  const ins = await tx.query(
    `insert into owner_replies (tenant_id, id, pending_question_id, channel, provider_message_id, owner_identity_id, body, checks, accepted)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict (tenant_id, channel, provider_message_id) do nothing returning id`,
    [tenantId, replyId, pq.id, ev.channel, ev.providerMessageId, ev.identityId, ev.text ?? '', JSON.stringify(check), check.ok]);
  if (!ins.rowCount) return { handled: false, reason: 'duplicate' };
  if (pq.status === 'expired') {
    if (!check.ok) return { handled: false, reason: 'late_invalid' };
    await move(tx, tenantId, pq, 'late_confirming', 'late_reply', `owner:${ev.identityId}`, now, { pending_reply_id: replyId });
    await ownerMessage(tx, tenantId, pq, `late:${replyId}`, `คำถาม ${pq.handle} หมดเวลาแล้ว ลูกค้าได้รับแจ้งให้ติดต่อร้าน ต้องการส่งคำตอบนี้ต่อไหม?\n“${ev.text}”`, now,
      [{ label: 'ส่ง / Send anyway', data: postback(tenantId, pq.id, 'late_send', `r=${replyId}`) }, { label: 'ไม่ส่ง / Don\'t send', data: postback(tenantId, pq.id, 'late_cancel') }]);
    return { handled: true, status: pq.status };
  }
  if (!check.ok) {
    await tx.query('update pending_questions set rejection_count = rejection_count + 1 where id = $1', [pq.id]);
    pq.rejection_count += 1;
    await move(tx, tenantId, pq, 'reply_needs_edit', 'reply_invalid', `owner:${ev.identityId}`, now);
    await ownerMessage(tx, tenantId, pq, `edit:${replyId}`, `ยังส่งไม่ได้ / Not sent: ${check.fails.map(f => FAIL_TEXT[f]?.th ?? f).join(' · ')}\nแก้แล้วตอบกลับอีกครั้ง (quote ข้อความคำถาม)`, now);
    return { handled: true, status: pq.status, fails: check.fails };
  }
  await move(tx, tenantId, pq, 'owner_confirming', 'reply_valid', `owner:${ev.identityId}`, now, { pending_reply_id: replyId });
  const warn = check.confirm.includes('price_conflict')
    ? `\n⚠︎ ราคาไม่ตรงกับรายการราคาของร้าน (${Number(price) / 100} บาท) ส่งต่อไหม? / Price differs from your price list` : '';
  await ownerMessage(tx, tenantId, pq, `preview:${replyId}`, `ตรวจก่อนส่งถึงลูกค้า (…${pq.target_last4}) / Preview:\n“${ev.text}”${warn}\n(SMS: ตอบ SEND ${pq.handle} เพื่อส่ง / reply SEND ${pq.handle} to send)`, now,
    [{ label: warn ? 'ส่งต่อ / Send anyway' : 'ส่ง / Send', data: postback(tenantId, pq.id, 'send', `r=${replyId}`) },
     { label: 'แก้ไข / Edit', data: postback(tenantId, pq.id, 'edit') }, { label: 'ยกเลิก / Cancel', data: postback(tenantId, pq.id, 'cancel') }]);
  return { handled: true, status: pq.status, confirm: check.confirm };
}

/** Ask the owner to say which question they are answering, on the channel they used. */
export async function askToName(tx: Tx, tenantId: string, ev: { identityId: string; providerMessageId: string }, now: Date) {
  const who = (await tx.query('select channel, value from owner_identities where id = $1', [ev.identityId])).rows[0];
  if (!who) return;
  const line = who.channel === 'line';
  await enqueue(tx, tenantId, { kind: who.channel, key: `owner:ask_quote:${ev.providerMessageId}`, to: who.value, exempt: true, now,
    sender: line ? OWNER_LINE_SENDER : (await smsSender(tx, tenantId)).sender,
    body: line ? 'มีคำถามค้างอยู่หลายข้อ กรุณากด quote ที่ข้อความคำถามที่ต้องการตอบ / Several questions are open: please quote the one you are answering'
      : 'Several questions are open: start your answer with its code, e.g. "Q-7K3F: your answer"' });
}

export async function ownerAction(tx: Tx, tenantId: string, pqId: string, action: string, now: Date, pb: Record<string, string> = {}) {
  if (action.startsWith('kc_')) return knowledgeDecision(tx, tenantId, pqId, action, now);
  const pq = await loadPq(tx, pqId);
  const actor = 'owner';
  switch (action) {
    case 'send':
    case 'late_send': {
      if (!['owner_confirming', 'late_confirming'].includes(pq.status) || pb.r !== pq.pending_reply_id) return { handled: false, reason: 'stale_preview' };
      if (action === 'late_send') {
        await tx.query(`update pending_questions set outcome_reason = 'late' where id = $1`, [pq.id]);
        pq.outcome_reason = 'late';
      }
      await move(tx, tenantId, pq, 'relaying', action, actor, now);
      await relay(tx, tenantId, pq, now);
      return { handled: true, status: pq.status };
    }
    case 'edit':
      if (pq.status !== 'owner_confirming') return { handled: false, reason: 'not_in_preview' };
      await move(tx, tenantId, pq, 'awaiting_owner', 'edit', actor, now, { pending_reply_id: null });
      return { handled: true, status: pq.status };
    case 'cancel':
    case 'decline':
    case 'will_contact': {
      if (!OPEN.includes(pq.status)) return { handled: false, reason: 'closed' };
      const reason = action === 'will_contact' ? 'will_contact' : action === 'cancel' ? 'not_appropriate' : 'cannot_answer';
      await move(tx, tenantId, pq, 'owner_declined', action, actor, now, { decline_reason: reason });
      await cancelJobs(tx, pq.id, ['pq_reminder', 'pq_expire']);
      await callerText(tx, tenantId, pq, reason === 'will_contact' ? 'will_contact' : 'cannot_answer', now);
      return { handled: true, status: pq.status };
    }
    case 'late_cancel':
      if (pq.status !== 'late_confirming') return { handled: false, reason: 'closed' };
      await move(tx, tenantId, pq, 'expired', 'late_cancel', actor, now);
      return { handled: true, status: pq.status };
    case 'not_me':
      await audit(tx, tenantId, { machine: 'PQ', entity: pq.id, event: 'owner_disputes_reply', actor, at: now });
      return { handled: true, incident: true };
    default:
      return { handled: false, reason: 'unknown_action' };
  }
}

// ---- PQ6: relay to the caller --------------------------------------------------------------------------------
function quietHoursWait(now: Date, tz: string): Date | null {
  const p = localParts(now.getTime(), tz);
  if (p.h >= 8 && p.h < 21) return null;
  const next = p.h >= 21 ? new Date(now.getTime() + ((24 - p.h + 8) * 60 - p.mi) * 60_000) : new Date(now.getTime() + ((8 - p.h) * 60 - p.mi) * 60_000);
  return next;
}

const callerFooter = (tx: Tx, tenantId: string, pq: PQ, lang: 'th' | 'en', twoWay: boolean, now: Date) => optOutFooter(tx, tenantId, pq.target, lang, twoWay, now);

async function callerAllowed(tx: Tx, tenantId: string, pq: PQ, now: Date): Promise<'ok' | 'opted_out' | 'no_consent' | 'unverified'> {
  const s = await smsSender(tx, tenantId);
  if (await isOptedOut(tx, s.sender, pq.target, 'sms')) return 'opted_out';
  if (!(await hasConsent(tx, { sender: s.sender, target: pq.target, channel: 'sms', purpose: 'service_followup', scopeRef: `pending_question:${pq.conversation_id}:${pq.question_sha256.toString('hex').slice(0, 16)}`, now }))) return 'no_consent';
  if (!pq.target_confirmed_at) return 'unverified';
  return 'ok';
}

export async function relay(tx: Tx, tenantId: string, pq: PQ, now: Date) {
  const allowed = await callerAllowed(tx, tenantId, pq, now);
  if (allowed === 'opted_out' || allowed === 'no_consent') {
    await move(tx, tenantId, pq, 'caller_unreachable', allowed, 'system', now, { outcome_reason: allowed });
    await ownerMessage(tx, tenantId, pq, 'unreachable', `ส่งคำตอบ ${pq.handle} ไม่ได้: ลูกค้ายกเลิกรับข้อความ / Caller opted out of texts`, now);
    return;
  }
  if (allowed === 'unverified') {
    if (pq.status !== 'awaiting_target') await move(tx, tenantId, pq, 'awaiting_target', 'await_target_yes', 'system', now);
    return;
  }
  const l = await loc(tx);
  const wait = quietHoursWait(now, l.time_zone);
  if (wait) { await schedule(tx, tenantId, 'pq_relay', pq.id, wait, `pq_relay:${pq.id}:${wait.getTime()}`); return; }
  const reply = (await tx.query('select body from owner_replies where id = $1', [pq.pending_reply_id])).rows[0];
  const s = await smsSender(tx, tenantId);
  const footer = await callerFooter(tx, tenantId, pq, pq.lang, s.two_way, now);
  const body = pq.lang === 'th'
    ? `${l.name}: คำตอบคำถามของคุณเรื่อง “${shortQ(pq.question_text)}”: “${reply.body}” — จากทีมงานร้าน${footer}`
    : `${l.name}: reply to your question about “${shortQ(pq.question_text)}”: “${reply.body}” — from our team.${footer}`;
  await enqueue(tx, tenantId, { kind: 'sms', key: `pq:${pq.id}:answer:${pq.pending_reply_id}`, to: pq.target, sender: s.sender, body, now, meta: { pq_id: pq.id, purpose: 'pq_answer' } });
}

async function callerText(tx: Tx, tenantId: string, pq: PQ, kind: 'will_contact' | 'cannot_answer' | 'expired', now: Date) {
  if ((await callerAllowed(tx, tenantId, pq, now)) !== 'ok') return;
  const l = await loc(tx), s = await smsSender(tx, tenantId);
  const footer = await callerFooter(tx, tenantId, pq, pq.lang, s.two_way, now);
  const th = { will_contact: `${l.name}: ทางร้านจะติดต่อคุณโดยตรงเรื่องคำถามของคุณ`, cannot_answer: `${l.name}: ทางร้านตอบคำถามนี้ทางข้อความไม่ได้ กรุณาโทร ${l.public_phone}`,
    expired: `${l.name}: ขออภัย ทีมงานยังตอบคำถามเรื่อง “${shortQ(pq.question_text)}” ไม่ได้ กรุณาโทร ${l.public_phone}` };
  const en = { will_contact: `${l.name} will contact you directly about your question.`, cannot_answer: `${l.name}: we can't answer that by text. Please call us at ${l.public_phone}.`,
    expired: `${l.name}: we weren't able to get you an answer about “${shortQ(pq.question_text)}” yet. Please call us at ${l.public_phone}.` };
  await enqueue(tx, tenantId, { kind: 'sms', key: `pq:${pq.id}:caller:${kind}`, to: pq.target, sender: s.sender, body: (pq.lang === 'th' ? th : en)[kind] + footer, now,
    runAt: quietHoursWait(now, l.time_zone) ?? undefined, meta: { pq_id: pq.id, purpose: `pq_${kind}` } });
}

/** Recipient confirmed a non-ANI reply number (YES on a two-way sender, or the confirmation link). */
export async function confirmTarget(tx: Tx, tenantId: string, pqId: string, now: Date) {
  const pq = await loadPq(tx, pqId);
  if (pq.target_confirmed_at) return { ok: true };
  await tx.query('update pending_questions set target_confirmed_at = $2, version = version + 1 where id = $1', [pq.id, now]);
  pq.target_confirmed_at = now; pq.version = Number(pq.version) + 1;
  await audit(tx, tenantId, { machine: 'PQ', entity: pq.id, event: 'target_confirmed', actor: 'caller', at: now });
  if (pq.status === 'awaiting_target') { await move(tx, tenantId, pq, 'relaying', 'target_confirmed', 'caller', now); await relay(tx, tenantId, pq, now); }
  return { ok: true };
}

// ---- Timers ----------------------------------------------------------------------------------------------------
export async function onTimer(tx: Tx, tenantId: string, kind: string, pqId: string, now: Date) {
  const pq = await loadPq(tx, pqId);
  if (kind === 'pq_reminder' && ['awaiting_owner', 'reply_needs_edit'].includes(pq.status) && pq.reminders_sent < 2) {
    await tx.query('update pending_questions set reminders_sent = reminders_sent + 1 where id = $1', [pq.id]);
    await ownerMessage(tx, tenantId, pq, `reminder:${pq.reminders_sent}`, `เตือน: คำถาม ${pq.handle} ยังไม่ได้ตอบ “${shortQ(pq.question_text)}” / Reminder`, now, undefined, 'pq_reminder');
  } else if (kind === 'pq_owner_retry' && pq.status === 'owner_unreachable') {
    await tx.query('update pending_questions set owner_attempt = 0, notify_round = notify_round + 1 where id = $1', [pq.id]);
    pq.owner_attempt = 0;
    pq.notify_round += 1;
    await notifyOwner(tx, tenantId, pq, now);
  } else if (kind === 'pq_expire' && OPEN.includes(pq.status)) {
    // Only rejected replies arrived → owner_reply_rejected; otherwise owner timeout. Either way the caller is told the truth.
    if (pq.status === 'reply_needs_edit') await move(tx, tenantId, pq, 'owner_reply_rejected', 'expired_with_rejections', 'system', now);
    else await move(tx, tenantId, pq, 'expired', 'expired', 'system', now);
    await callerText(tx, tenantId, pq, 'expired', now);
    await ownerMessage(tx, tenantId, pq, 'expired', `คำถาม ${pq.handle} หมดเวลา ลูกค้าได้รับแจ้งให้ติดต่อร้านแล้ว / Expired; the caller was told to contact you`, now);
  } else if (kind === 'pq_late_close') {
    if (pq.status === 'late_confirming') await move(tx, tenantId, pq, 'expired', 'late_window_closed', 'system', now);
    if (pq.status === 'awaiting_target') await move(tx, tenantId, pq, 'caller_unreachable', 'target_never_confirmed', 'system', now, { outcome_reason: 'unverified_target' });
  } else if (kind === 'pq_relay' && pq.status === 'relaying') {
    await relay(tx, tenantId, pq, now);
  }
}

// ---- KC: separate approval before reuse (§5.8.7) -------------------------------------------------------------
const CALLER_SPECIFIC = /your (booking|appointment|visit)|นัดของคุณ|การจองของคุณ|ของคุณ\S+ที่/i;
export async function offerKnowledge(tx: Tx, tenantId: string, pq: PQ, now: Date) {
  if (pq.tier !== 'N') return;
  const reply = (await tx.query('select body from owner_replies where id = $1', [pq.pending_reply_id])).rows[0];
  if (!reply || CALLER_SPECIFIC.test(reply.body) || (pq.caller_name && reply.body.includes(pq.caller_name))) return;
  const id = uuid();
  const ins = await tx.query(
    `insert into knowledge_candidates (tenant_id, id, pending_question_id, question_general, answer_text, status)
     values ($1,$2,$3,$4,$5,'proposed') on conflict (tenant_id, pending_question_id) do nothing returning id`,
    [tenantId, id, pq.id, pq.question_text, reply.body]);
  if (!ins.rowCount) return;
  await schedule(tx, tenantId, 'kc_expire', pq.id, new Date(now.getTime() + 7 * 86_400_000), `kc_expire:${pq.id}`);
  await ownerMessage(tx, tenantId, pq, 'kc_offer', `บันทึกคำตอบนี้ไว้ตอบลูกค้าคนต่อไปไหม? / Save for future callers?\nคำถาม: “${pq.question_text}”\nคำตอบ: “${reply.body}”`, now, [
    { label: 'บันทึก (โทร+ข้อความ)', data: postback(tenantId, pq.id, 'kc_save_all') }, { label: 'เฉพาะข้อความ', data: postback(tenantId, pq.id, 'kc_save_text') },
    { label: 'ไว้ทีหลัง', data: postback(tenantId, pq.id, 'kc_not_now') }, { label: 'ไม่ต้อง', data: postback(tenantId, pq.id, 'kc_never') }], 'kc_offer');
}

async function knowledgeDecision(tx: Tx, tenantId: string, pqId: string, action: string, now: Date) {
  const kc = (await tx.query(`select * from knowledge_candidates where pending_question_id = $1 for update`, [pqId])).rows[0];
  if (!kc || kc.status !== 'proposed') return { handled: false, reason: 'no_candidate' };
  if (action === 'kc_not_now' || action === 'kc_never') {
    await tx.query(`update knowledge_candidates set status = $2, decided_at = $3 where id = $1`, [kc.id, action === 'kc_never' ? 'never' : 'rejected', now]);
    await audit(tx, tenantId, { machine: 'KC', entity: kc.id, from: 'proposed', to: action === 'kc_never' ? 'never' : 'rejected', event: action, actor: 'owner', at: now });
    return { handled: true };
  }
  const audience = action === 'kc_save_all' ? ['speakable', 'messageable'] : ['messageable'];
  const articleId = uuid();
  const keywords = keywordsOf(kc.question_general);
  await tx.query(
    `insert into knowledge_articles (tenant_id, id, version, topic, keywords, question_general, answer_text, audience, provenance, status,
       approved_by, approved_at, effective_from, review_by) values ($1,$2,1,'owner_answer',$3,$4,$5,$6,$7,'published','owner',$8,$8,$9)`,
    [tenantId, articleId, keywords, kc.question_general, kc.answer_text, audience, `owner_reply:${pqId}`, now, new Date(now.getTime() + 90 * 86_400_000)]);
  await tx.query(`update knowledge_candidates set status = 'approved', decided_at = $2, article_id = $3 where id = $1`, [kc.id, now, articleId]);
  await audit(tx, tenantId, { machine: 'KC', entity: kc.id, from: 'proposed', to: 'approved', event: action, actor: 'owner', detail: { article: articleId, audience }, at: now });
  return { handled: true, article_id: articleId };
}

export async function onKcExpire(tx: Tx, tenantId: string, pqId: string, now: Date) {
  const r = await tx.query(`update knowledge_candidates set status = 'expired', decided_at = $2 where pending_question_id = $1 and status = 'proposed' returning id`, [pqId, now]);
  if (r.rowCount) await audit(tx, tenantId, { machine: 'KC', entity: r.rows[0].id, from: 'proposed', to: 'expired', event: 'kc_expire', actor: 'system', at: now });
}
