/** Regression tests for the independent review of 11 Nov 2026 (findings R1–R14). */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { createHash } from 'node:crypto';
import { A, B, C, NUM, Call, CALLER, closeDb, drain, fresh, inboundSms, ownerLine, pqRow, quick, sandbox, sha, withTenant } from './helpers.ts';
import { faults } from '../src/messaging/channels.ts';
import { linkHit } from '../src/inbound.ts';
import { validateOwnerReply } from '../src/escalation/validate.ts';

after(closeDb);
const idHash = (v: string) => createHash('sha256').update('rcpt-id:' + v.replace(/[\s-]/g, '')).digest();
async function asSuper(sql: string, params: unknown[]) {
  const c = new pg.Client({ host: '127.0.0.1', port: 54421, user: 'rcpt', database: 'rcpt_test' });
  await c.connect();
  try { await c.query(sql, params); } finally { await c.end(); }
}
const question = async (clock: { now(): Date }, dialed: string, ani: string, summary: string, lang: 'th' | 'en' = 'th') => {
  const { call } = await Call.start({ dialed, ani, lang, now: () => clock.now() });
  return (await call.unknownQuestion({ question: summary, summary, choice: 'text' })).pq!;
};

test('R1 an owner of two businesses: a quoted answer and SEND reach only the quoted business; plain text matches nothing', async () => {
  const clock = await fresh();
  await withTenant(B, tx => tx.query(`insert into owner_identities (tenant_id, id, label, channel, value, value_hash, priority, verified_at)
    values ($1, gen_random_uuid(), 'same owner', 'line', $2, $3, 2, $4)`, [B, NUM.A.ownerLine, idHash(NUM.A.ownerLine), clock.now()]));
  await asSuper(`insert into owner_routes values ('line', $1, $2)`, [idHash(NUM.A.ownerLine), B]);
  const qa = await question(clock, NUM.A.dialed, CALLER, 'ร้านมีที่จอดรถไหม');
  const qb = await question(clock, NUM.B.dialed, '+66899990000', 'ร้านเปิดวันหยุดนักขัตฤกษ์ไหม');
  await drain(clock.now());
  const plain = await ownerLine(clock.now(), NUM.A.ownerLine, { text: 'มีค่ะ' });
  assert.deepEqual(plain.results, [{ handled: false, reason: 'ambiguous' }]);
  assert.equal((await pqRow(A, qa.pq_handle)).status, 'awaiting_owner');
  assert.equal((await pqRow(B, qb.pq_handle)).status, 'awaiting_owner');
  const notifyA = (await sandbox(A)).find(m => m.body.includes(qa.pq_handle))!;
  await ownerLine(clock.now(), NUM.A.ownerLine, { text: 'มีที่จอดฟรีค่ะ', quotedMessageId: notifyA.provider_message_id });
  assert.equal((await pqRow(A, qa.pq_handle)).status, 'owner_confirming');
  assert.equal((await pqRow(B, qb.pq_handle)).status, 'awaiting_owner', "tenant B's question is untouched");
  await ownerLine(clock.now(), NUM.A.ownerLine, { text: `SEND ${qa.pq_handle}` });
  await drain(clock.now());
  assert.equal((await pqRow(A, qa.pq_handle)).terminal_outcome, 'delivered');
  assert.equal((await pqRow(B, qb.pq_handle)).status, 'awaiting_owner');
  assert.equal((await sandbox(B)).filter(m => m.recipient === '+66899990000' && m.body.includes('มีที่จอดฟรี')).length, 0);
});

test('R2 a reschedule texts the caller only if they said yes', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  await call.book({ service: 'นวดไทย 60', when: '20 พ.ย. 69 บ่ายสาม', name: 'อันนา' });
  const b = ((await call.tool('get_bookings_for_caller', {})) as any).data.bookings[0];
  const s = await call.tool('search_availability', { variant_ref: 'นวดไทย 60', date_phrase: '21 พ.ย. 69 บ่ายสาม', for_booking_ref: b.booking_ref }) as any;
  const h = await call.tool('hold_slot', { slot_token: s.data.options[0].slot_token, for_booking_ref: b.booking_ref }) as any;
  const r = await call.tool('reschedule_booking', { booking_ref: b.booking_ref, hold_ref: h.data.hold_ref },
    { expected_version: 1, spoken_confirmation_sha256: sha(h.data.rendered_confirmation.th + '\n' + h.data.rendered_confirmation.en), spoken_turn: 40, confirm_turn: 41 });
  assert.ok(r.ok);
  await drain(clock.now());
  assert.equal((await sandbox(A)).filter(m => m.recipient === CALLER).length, 0, 'no text without a yes');
  assert.ok((await sandbox(A)).some(m => m.channel === 'line' && m.body.startsWith('เลื่อนนัดโดย AI')), 'the owner is still told');
});

test('R3 a STOP while the answer waits for a retry closes the question as opted_out and tells the owner', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  await call.book({ service: 'นวดไทย 60', when: 'พรุ่งนี้บ่ายสาม', name: 'อันนา', textConfirmation: true });
  const u = await call.unknownQuestion({ question: 'มีที่จอดรถไหม', summary: 'ร้านมีที่จอดรถไหม', choice: 'text' });
  await drain(clock.now());
  const optOut = (await sandbox(A)).find(m => m.recipient === CALLER)!.body.match(/\/o\/([A-Za-z0-9_-]+)/)![1];
  const n = (await sandbox(A)).find(m => m.body.includes(u.pq!.pq_handle))!;
  await ownerLine(clock.now(), NUM.A.ownerLine, { text: 'มีที่จอดฟรีค่ะ', quotedMessageId: n.provider_message_id });
  await drain(clock.now());
  faults.set(CALLER, { kind: 'transient', times: 1 });
  await ownerLine(clock.now(), NUM.A.ownerLine, { postback: await quick(A, 'ส่ง') });
  await drain(clock.now());
  assert.equal((await pqRow(A, u.pq!.pq_handle)).status, 'relaying', 'waiting for a retry');
  await linkHit(optOut, clock.now(), undefined, true);
  const pq = await pqRow(A, u.pq!.pq_handle);
  assert.equal(pq.terminal_outcome, 'caller_unreachable');
  assert.equal(pq.outcome_reason, 'opted_out');
  clock.advance(2 * 60_000); await drain(clock.now());
  assert.ok(!(await sandbox(A)).some(m => m.recipient === CALLER && m.body.includes('มีที่จอดฟรี')));
  assert.ok((await sandbox(A)).some(m => m.body.includes('ลูกค้ายกเลิกรับข้อความ')));
});

test('R4/R5 every owner channel fails → retried every 15 min with a fresh message; a reply meanwhile is accepted, not lost', async () => {
  const clock = await fresh();
  faults.set(NUM.A.ownerLine, { kind: 'permanent', times: 1 });
  faults.set(NUM.A.ownerSms, { kind: 'permanent', times: 1 });
  const q = await question(clock, NUM.A.dialed, CALLER, 'ร้านมีที่จอดรถไหม');
  await drain(clock.now());
  assert.equal((await pqRow(A, q.pq_handle)).status, 'owner_unreachable');
  // R5: the owner answers anyway (e.g. a notification counted as failed was in fact delivered).
  const r = await ownerLine(clock.now(), NUM.A.ownerLine, { text: `${q.pq_handle}: มีที่จอดฟรีค่ะ` });
  assert.equal(r.status, 200);
  assert.equal((await pqRow(A, q.pq_handle)).status, 'owner_confirming');
  await drain(clock.now());
  // R4 on a second question: the retry sends a new notification instead of a silent duplicate key.
  faults.set(NUM.A.ownerLine, { kind: 'permanent', times: 1 });
  faults.set(NUM.A.ownerSms, { kind: 'permanent', times: 1 });
  const q2 = await question(clock, NUM.A.dialed, '+66811110000', 'ร้านมีห้องอาบน้ำไหม');
  await drain(clock.now());
  assert.equal((await pqRow(A, q2.pq_handle)).status, 'owner_unreachable');
  clock.advance(15 * 60_000 + 1000); await drain(clock.now());
  assert.equal((await pqRow(A, q2.pq_handle)).status, 'awaiting_owner');
  assert.equal((await sandbox(A)).filter(m => m.body.includes(`คำถามจากลูกค้า ${q2.pq_handle}`)).length, 1);
});

test('R6 opening an opt-out link changes nothing; pressing its button opts out', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  await call.book({ service: 'นวดไทย 60', when: 'พรุ่งนี้บ่ายสาม', name: 'อันนา', textConfirmation: true });
  await drain(clock.now());
  const token = (await sandbox(A)).find(m => m.recipient === CALLER)!.body.match(/\/o\/([A-Za-z0-9_-]+)/)![1];
  assert.deepEqual(await linkHit(token, clock.now()), { status: 200, page: 'opt_out' });
  const optedOut = () => withTenant(A, async tx => (await tx.query(`select count(*)::int n from opt_outs where state = 'stopped'`)).rows[0].n);
  assert.equal(await optedOut(), 0);
  await linkHit(token, clock.now(), undefined, true);
  assert.equal(await optedOut(), 1);
});

test('R7/R11 create_booking refuses a reschedule hold and a name the caller did not confirm', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  await call.book({ service: 'นวดไทย 60', when: '20 พ.ย. 69 บ่ายสาม', name: 'อันนา' });
  const b = ((await call.tool('get_bookings_for_caller', {})) as any).data.bookings[0];
  const s = await call.tool('search_availability', { variant_ref: 'นวดไทย 60', date_phrase: '21 พ.ย. 69 บ่ายสาม', for_booking_ref: b.booking_ref }) as any;
  const h = await call.tool('hold_slot', { slot_token: s.data.options[0].slot_token, for_booking_ref: b.booking_ref, client_name: 'อันนา' }) as any;
  const meta = { spoken_confirmation_sha256: sha(h.data.rendered_confirmation.th + '\n' + h.data.rendered_confirmation.en), spoken_turn: 50, confirm_turn: 51 };
  const wrong = await call.tool('create_booking', { hold_ref: h.data.hold_ref, client_name: 'อันนา' }, meta);
  assert.equal(!wrong.ok && wrong.error.code, 'VALIDATION_FAILED');
  assert.equal(await withTenant(A, async tx => (await tx.query(`select count(*)::int n from appointments`)).rows[0].n), 1);
  const s2 = await call.tool('search_availability', { variant_ref: 'นวดไทย 60', date_phrase: '22 พ.ย. 69 บ่ายสาม' }) as any;
  const h2 = await call.tool('hold_slot', { slot_token: s2.data.options[0].slot_token, client_name: 'อันนา' }) as any;
  const otherName = await call.tool('create_booking', { hold_ref: h2.data.hold_ref, client_name: 'บี' },
    { spoken_confirmation_sha256: sha(h2.data.rendered_confirmation.th + '\n' + h2.data.rendered_confirmation.en), spoken_turn: 60, confirm_turn: 61 });
  assert.equal(!otherName.ok && otherName.error.code, 'VALIDATION_FAILED');
  const stranger = (await Call.start({ dialed: NUM.A.dialed, ani: '+66822220000', now: () => clock.now() })).call;
  const probe = await stranger.tool('search_availability', { variant_ref: 'นวดไทย 60', date_phrase: '21 พ.ย. 69 บ่ายสาม', for_booking_ref: b.booking_ref });
  assert.equal(!probe.ok && probe.error.code, 'NOT_FOUND', "a stranger cannot reschedule-search someone else's booking");
});

test('R8 quiet hours apply to every caller text: an expiry notice due at 22:30 waits until 08:00', async () => {
  const clock = await fresh('2026-11-12T15:30:00Z'); // 22:30 Bangkok
  const q = await question(clock, NUM.A.dialed, CALLER, 'ร้านมีที่จอดรถไหม');
  clock.advance(24 * 3600_000 + 60_000); await drain(clock.now());
  assert.equal((await pqRow(A, q.pq_handle)).terminal_outcome, 'owner_timeout');
  assert.equal((await sandbox(A)).filter(m => m.recipient === CALLER).length, 0);
  clock.advance(10 * 3600_000); await drain(clock.now());
  assert.equal((await sandbox(A)).filter(m => m.recipient === CALLER).length, 1);
});

test('R9 an SMS owner with several open questions is asked by SMS for the code, and "Q-XXXX: answer" works', async () => {
  const clock = await fresh('2026-11-12T15:00:00Z'); // 10:00 New York
  const q1 = await question(clock, NUM.C.dialed, '+12025550123', 'Do you do beard trims?', 'en');
  const q2 = await question(clock, NUM.C.dialed, '+12025550124', 'Is there parking?', 'en');
  await drain(clock.now());
  await inboundSms(clock.now(), { from: NUM.C.ownerSms, to: NUM.C.sender, body: 'Yes we do' });
  await drain(clock.now());
  const ask = (await sandbox(C)).filter(m => m.recipient === NUM.C.ownerSms).at(-1)!;
  assert.equal(ask.channel, 'sms');
  assert.match(ask.body, /start your answer with its code/);
  await inboundSms(clock.now(), { from: NUM.C.ownerSms, to: NUM.C.sender, body: `${q2.pq_handle}: Free parking behind the shop` });
  assert.equal((await pqRow(C, q2.pq_handle)).status, 'owner_confirming');
  assert.equal((await pqRow(C, q1.pq_handle)).status, 'awaiting_owner');
});

test('R10 links on IP addresses, IPv6 and Thai-script domains are refused', () => {
  const ctx = { allowedDomains: ['samplespa.example'], businessPhones: ['020000001'] };
  for (const t of ['http://203.0.113.9/promo', 'https://ร้าน.ไทย/จ่าย', 'ร้าน.ไทย/จ่าย', 'http://[2001:db8::1]/x']) assert.equal(validateOwnerReply(t, ctx).ok, false, t);
  for (const t of ['www.samplespa.example/menu', 'ราคา 1.5 ชั่วโมง 500 บาท', 'มีที่จอดฟรีค่ะ']) assert.equal(validateOwnerReply(t, ctx).ok, true, t);
});

test('R13 a reschedule overlapping its own slot still holds the new part against other callers', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  await call.book({ service: 'นวดไทย 60', when: '20 พ.ย. 69 บ่ายสาม', name: 'อันนา', staff: 'นก' });
  const b = ((await call.tool('get_bookings_for_caller', {})) as any).data.bookings[0];
  const s = await call.tool('search_availability', { variant_ref: 'นวดไทย 60', date_phrase: '20 พ.ย. 69 15:30 น.', staff_ref: 'นก', for_booking_ref: b.booking_ref }) as any;
  assert.ok((await call.tool('hold_slot', { slot_token: s.data.options[0].slot_token, for_booking_ref: b.booking_ref })).ok);
  const other = (await Call.start({ dialed: NUM.A.dialed, ani: '+66833330000', now: () => clock.now() })).call;
  const s2 = await other.tool('search_availability', { variant_ref: 'นวดเท้า', date_phrase: '20 พ.ย. 69 16:30 น.', staff_ref: 'นก' }) as any;
  assert.ok(s2.ok && !s2.data.options.some((o: any) => o.start_local_th.includes('16:30')), '16:15–16:45 (the moved booking\'s new tail) is held');
});

test('R14 a caller id that is not a mobile number cannot be texted', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: '+6620001111', now: () => clock.now() }); // a Bangkok landline
  const u = await call.unknownQuestion({ question: 'ร้านมีที่จอดรถไหม', summary: 'ร้านมีที่จอดรถไหม', choice: 'text' });
  assert.equal(u.outcome, 'caller_declined_followup');
  assert.equal((u as any).error.code, 'VALIDATION_FAILED');
});
