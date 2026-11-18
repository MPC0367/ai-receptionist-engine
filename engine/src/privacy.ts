/**
 * SM-12 privacy deletion and SM-13 retention (blueprint §8.3, §5). Gate A stand-ins: `sandbox_objects` is object
 * storage for recordings, `sandbox_provider_store` is a voice provider's own copy, `sandbox_messages` a messaging
 * provider's log. Every purge records evidence; nothing on a legal hold is touched.
 */
import { randomInt } from 'node:crypto';
import type { Tx } from './db.ts';
import { audit, idHash, sha256, uuid } from './db.ts';
import { enqueue } from './messaging/channels.ts';

export const RETENTION = { recordingDays: 30, contentDays: 90, opsDays: 30 };
const DAY = 86_400_000;
const DELETED = '[deleted]';

/** End of call: keep the transcript (R-content) and, if recording was on, a recording (R-recording). */
export async function persistCallArtifacts(tx: Tx, tenantId: string, a: {
  conversationId: string; turns: Array<{ seq: number; who: 'ai' | 'caller'; text: string }>; recordingOn: boolean; durationMs: number; now: Date;
}) {
  for (const t of a.turns) {
    await tx.query(`insert into transcript_turns (tenant_id, conversation_id, seq, who, text, at) values ($1,$2,$3,$4,$5,$6) on conflict do nothing`,
      [tenantId, a.conversationId, t.seq, t.who, t.text, a.now]);
  }
  if (!a.recordingOn) return;
  const key = `recordings/${tenantId}/${a.conversationId}.opus`;
  const providerRef = `prov-${a.conversationId}`;
  await tx.query(`insert into sandbox_objects (key, tenant_id, bytes, created_at) values ($1,$2,$3,$4) on conflict do nothing`, [key, tenantId, Math.round(a.durationMs * 2), a.now]);
  await tx.query(`insert into sandbox_provider_store (provider, ref, tenant_id, created_at) values ('voice_runtime',$1,$2,$3) on conflict do nothing`, [providerRef, tenantId, a.now]);
  await tx.query(`insert into recording_refs (tenant_id, id, conversation_id, object_key, provider, provider_ref, duration_ms, created_at) values ($1,$2,$3,$4,'voice_runtime',$5,$6,$7)`,
    [tenantId, uuid(), a.conversationId, key, providerRef, a.durationMs, a.now]);
}

async function heldConversations(tx: Tx): Promise<Set<string>> {
  const r = await tx.query(`select conversation_id from legal_holds where released_at is null and conversation_id is not null
    union select c.id from legal_holds h join appointments ap on ap.client_id = h.client_id join conversations c on c.id = ap.created_by_conversation
    where h.released_at is null and h.client_id is not null`);
  return new Set(r.rows.map(x => x.conversation_id ?? x.id));
}

async function purgeRecording(tx: Tx, rec: any, now: Date) {
  const obj = await tx.query(`delete from sandbox_objects where key = $1`, [rec.object_key]);
  const prov = await tx.query(`delete from sandbox_provider_store where provider = $1 and ref = $2`, [rec.provider, rec.provider_ref]);
  const evidence = { object_deleted: obj.rowCount, provider_copy_deleted: prov.rowCount, at: now.toISOString() };
  await tx.query(`update recording_refs set deleted_at = $2, purge_evidence = $3 where id = $1`, [rec.id, now, JSON.stringify(evidence)]);
  return evidence;
}

/** SM-13: one retention pass for a tenant. Idempotent; returns counts. */
export async function runRetention(tx: Tx, tenantId: string, now: Date) {
  const runId = uuid();
  await tx.query(`insert into retention_runs (tenant_id, id, started_at, status) values ($1,$2,$3,'running')`, [tenantId, runId, now]);
  const held = await heldConversations(tx);
  const counts = { recordings: 0, provider_copies: 0, transcript_turns: 0, tool_calls: 0, pq_anonymised: 0, owner_replies: 0, ani_cleared: 0, provider_logs: 0, held_skipped: 0 };
  const recCut = new Date(now.getTime() - RETENTION.recordingDays * DAY), contentCut = new Date(now.getTime() - RETENTION.contentDays * DAY);

  for (const rec of (await tx.query(`select * from recording_refs where deleted_at is null and created_at < $1`, [recCut])).rows) {
    if (held.has(rec.conversation_id)) { counts.held_skipped++; continue; }
    const e = await purgeRecording(tx, rec, now);
    counts.recordings += e.object_deleted; counts.provider_copies += e.provider_copy_deleted;
  }
  const oldConvs = (await tx.query(`select id from conversations where started_at < $1`, [contentCut])).rows.map(r => r.id as string).filter(id => !held.has(id));
  if (oldConvs.length) {
    counts.transcript_turns = (await tx.query(`delete from transcript_turns where conversation_id = any($1)`, [oldConvs])).rowCount ?? 0;
    counts.tool_calls = (await tx.query(`delete from tool_calls where conversation_id = any($1)`, [oldConvs])).rowCount ?? 0;
    counts.ani_cleared = (await tx.query(`update conversations set ani = null where id = any($1) and ani is not null`, [oldConvs])).rowCount ?? 0;
  }
  const oldPq = (await tx.query(`select id from pending_questions where terminal_outcome is not null and created_at < $1 and question_text <> $2 and not (conversation_id = any($3))`,
    [contentCut, DELETED, [...held]])).rows.map(r => r.id);
  if (oldPq.length) {
    counts.pq_anonymised = (await tx.query(`update pending_questions set question_text = $2, target = $2, caller_name = null, context_line = null where id = any($1)`, [oldPq, DELETED])).rowCount ?? 0;
    counts.owner_replies = (await tx.query(`update owner_replies set body = $2 where pending_question_id = any($1)`, [oldPq, DELETED])).rowCount ?? 0;
  }
  counts.provider_logs = (await tx.query(`delete from sandbox_messages where tenant_id = $1 and at < $2`, [tenantId, new Date(now.getTime() - RETENTION.opsDays * DAY)])).rowCount ?? 0;
  await tx.query(`update retention_runs set finished_at = $2, counts = $3, status = 'done' where id = $1`, [runId, now, JSON.stringify(counts)]);
  await audit(tx, tenantId, { machine: 'SM-13', entity: runId, to: 'verified', event: 'retention_run', actor: 'system', detail: counts, at: now });
  return counts;
}

// ---- SM-12 ---------------------------------------------------------------------------------------------------
/** A request arrives (dashboard, privacy e-mail, a "DELETE MY DATA" text): send a one-time code to that number. */
export async function openPrivacyRequest(tx: Tx, tenantId: string, a: { phone: string; now: Date; lang: 'th' | 'en' }) {
  const id = uuid(), code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await tx.query(
    `insert into privacy_requests (tenant_id, id, subject_hash, subject_last4, status, code_hash, code_expires_at, received_at, deadline_at)
     values ($1,$2,$3,$4,'verifying',$5,$6,$7,$8)`,
    [tenantId, id, idHash(a.phone), a.phone.slice(-4), sha256(id + code), new Date(a.now.getTime() + 15 * 60_000), a.now, new Date(a.now.getTime() + 30 * DAY)]);
  const s = (await tx.query(`select sender from senders where tenant_id = $1 and channel = 'sms'`, [tenantId])).rows[0];
  const name = (await tx.query('select name from locations limit 1')).rows[0].name;
  await enqueue(tx, tenantId, { kind: 'sms', key: `privacy:${id}:code`, to: a.phone, sender: s.sender, exempt: true, now: a.now,
    body: a.lang === 'th' ? `${name}: รหัสยืนยันคำขอลบข้อมูลของคุณคือ ${code} (ใช้ได้ 15 นาที)` : `${name}: your code to confirm the data deletion request is ${code} (valid 15 minutes).`,
    meta: { purpose: 'privacy_code', request_id: id } });
  await audit(tx, tenantId, { machine: 'SM-12', entity: id, to: 'verifying', event: 'received', actor: 'requester', at: a.now });
  return { request_id: id };
}

/** Verify the code, then scope, execute and verify the erasure. Returns the evidence package. */
export async function verifyAndErase(tx: Tx, tenantId: string, a: { requestId: string; phone: string; code: string; now: Date }) {
  const req = (await tx.query(`select * from privacy_requests where id = $1 for update`, [a.requestId])).rows[0];
  if (!req || req.status !== 'verifying') return { status: req?.status ?? 'not_found' };
  if (req.attempts >= 3 || req.code_expires_at < a.now) {
    await tx.query(`update privacy_requests set status = 'rejected' where id = $1`, [req.id]);
    return { status: 'rejected' };
  }
  if (Buffer.compare(sha256(req.id + a.code), req.code_hash) !== 0 || Buffer.compare(idHash(a.phone), req.subject_hash) !== 0) {
    await tx.query(`update privacy_requests set attempts = attempts + 1 where id = $1`, [req.id]);
    return { status: 'verifying', wrong_code: true };
  }
  const h = idHash(a.phone);
  const clients = (await tx.query(`select client_id from client_identities where value_hash = $1`, [h])).rows.map(r => r.client_id as string);
  const convs = (await tx.query(`select id from conversations where ani_hash = $1`, [h])).rows.map(r => r.id as string);
  const held = await heldConversations(tx);
  const holds = (await tx.query(`select 1 from legal_holds where released_at is null and client_id = any($1)`, [clients])).rowCount ?? 0;
  const future = (await tx.query(`select count(*)::int n from appointments where client_id = any($1) and status = 'booked' and starts_at > $2`, [clients, a.now])).rows[0].n;
  if (holds || convs.some(c => held.has(c)) || future) {
    const evidence = { reason: future ? 'future_bookings' : 'legal_hold', future_bookings: future };
    await tx.query(`update privacy_requests set status = 'needs_review', code_hash = null, evidence = $2 where id = $1`, [req.id, JSON.stringify(evidence)]);
    await audit(tx, tenantId, { machine: 'SM-12', entity: req.id, from: 'verifying', to: 'needs_review', event: 'scoped', actor: 'system', detail: evidence, at: a.now });
    return { status: 'needs_review', evidence };
  }
  const n = async (sql: string, p: unknown[]) => (await tx.query(sql, p)).rowCount ?? 0;
  const ev: Record<string, unknown> = {};
  for (const rec of (await tx.query(`select * from recording_refs where conversation_id = any($1) and deleted_at is null`, [convs])).rows) {
    const e = await purgeRecording(tx, rec, a.now);
    ev.recordings = ((ev.recordings as number) ?? 0) + e.object_deleted;
    ev.provider_copies = ((ev.provider_copies as number) ?? 0) + e.provider_copy_deleted;
  }
  ev.transcript_turns = await n(`delete from transcript_turns where conversation_id = any($1)`, [convs]);
  ev.tool_calls = await n(`delete from tool_calls where conversation_id = any($1)`, [convs]);
  ev.conversations_ani = await n(`update conversations set ani = null where id = any($1)`, [convs]);
  const pqs = (await tx.query(`select id from pending_questions where target_hash = $1`, [h])).rows.map(r => r.id);
  ev.pending_questions = await n(`update pending_questions set question_text = $2, target = $2, caller_name = null, context_line = null where id = any($1)`, [pqs, DELETED]);
  ev.owner_replies = await n(`update owner_replies set body = $2 where pending_question_id = any($1)`, [pqs, DELETED]);
  ev.knowledge_candidates = await n(`delete from knowledge_candidates where pending_question_id = any($1) and status <> 'approved'`, [pqs]);
  ev.client_names = await n(`update clients set preferred_name = null, version = version + 1 where id = any($1)`, [clients]);
  ev.client_identities = await n(`delete from client_identities where value_hash = $1`, [h]);
  ev.outbox = await n(`update outbox_events set payload = jsonb_set(jsonb_set(payload, '{to}', to_jsonb($2::text)), '{body}', to_jsonb($2::text)) where payload->>'to' = $1`, [a.phone, DELETED]);
  ev.provider_message_log = await n(`delete from sandbox_messages where tenant_id = $1 and recipient = $2`, [tenantId, a.phone]);
  ev.staff_tasks = await n(`update staff_tasks set detail = '{"erased": true}' where detail->>'phone' = $1`, [a.phone]);
  ev.links = await n(`update link_tokens set ref = $2, expires_at = $3 where tenant_id = $4 and ref = $1`, [a.phone, DELETED, a.now, tenantId]);
  // Verification: no plaintext of the number left in any table we hold (opt-out and consent rows keep a one-way hash).
  const digits = a.phone.replace(/^\+66/, '0').replace(/\D/g, '');
  const leftover = (await tx.query(`select
      (select count(*) from client_identities where value = $1) + (select count(*) from conversations where ani = $1)
    + (select count(*) from pending_questions where target = $1) + (select count(*) from outbox_events where payload::text like '%' || $1 || '%')
    + (select count(*) from transcript_turns where regexp_replace(text, '\\D', '', 'g') like '%' || $2 || '%')
    + (select count(*) from sandbox_messages where tenant_id = $3 and recipient = $1)
    + (select count(*) from link_tokens where tenant_id = $3 and ref = $1) as n`, [a.phone, digits, tenantId])).rows[0].n;
  ev.verified_zero_plaintext = Number(leftover) === 0;
  ev.kept = ['usage_events (no personal data)', 'opt_outs and consents (one-way hash, R-privacy)', 'appointments (anonymised client, R-booking)'];
  const status = ev.verified_zero_plaintext ? 'completed' : 'needs_review';
  await tx.query(`update privacy_requests set status = $2, completed_at = $3, code_hash = null, evidence = $4 where id = $1`, [req.id, status, a.now, JSON.stringify(ev)]);
  await audit(tx, tenantId, { machine: 'SM-12', entity: req.id, from: 'verifying', to: status, event: 'erased', actor: 'system', detail: ev, at: a.now });
  return { status, evidence: ev };
}
