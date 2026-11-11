import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { A, NUM, Call, CALLER, closeDb, drain, fresh, inboundSms, ownerLine, pqRow, quick, sandbox, withTenant } from './helpers.ts';
import { faults } from '../src/messaging/channels.ts';
import { linkHit } from '../src/inbound.ts';

after(closeDb);
const H = 3600_000;

async function askParking(clock: { now(): Date }, o: Partial<Parameters<Call['unknownQuestion']>[0]> = {}, ani: string | null = CALLER) {
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani, now: () => clock.now() });
  const a = await call.ask('มีที่จอดรถไหมคะ');
  const u = await call.unknownQuestion({ question: 'มีที่จอดรถไหมคะ', summary: 'ร้านมีที่จอดรถให้ลูกค้าไหม', choice: 'text', callerName: 'อันนา', ...o });
  return { call, a, u };
}
async function notifyMsg(handle: string) {
  return (await sandbox(A)).find(m => m.channel === 'line' && m.body.includes(handle))!;
}
const callerTexts = async (to = CALLER) => (await sandbox(A)).filter(m => m.recipient === to);

test('AT-16 unknown question: uncertainty line, no guess (a drafted number without a source is discarded)', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const r = await call.ask('มีที่จอดรถไหมคะ', 'มีที่จอดรถ 20 คันค่ะ');
  assert.equal(r.answered, false);
  assert.ok(!call.turns.some(t => t.who === 'ai' && t.text.includes('20')));
  assert.ok(call.turns.some(t => t.text.startsWith('ดิฉันยังไม่มีคำตอบที่ยืนยันได้')));
  const known = await call.ask('จ่ายด้วยบัตรได้ไหม', 'รับบัตรเครดิตค่ะ ลด 50%');
  assert.equal(known.answered, false, 'a grounded fact with an invented number in the draft is still refused');
});

test('AT-17 unknown question → live transfer connected only when a human presses 1; no pending question', async () => {
  const clock = await fresh();
  const { u } = await askParking(clock, { choice: 'live', transferSim: { eligible: true, answered: true, dtmf: '1' } });
  assert.equal(u.outcome, 'transfer_connected');
  assert.equal(await withTenant(A, async tx => Number((await tx.query('select count(*) n from pending_questions')).rows[0].n)), 0);
});

test('AT-15 transfer answered by voicemail (no DTMF) is not a human → falls back to the text path', async () => {
  const clock = await fresh();
  const { u, call } = await askParking(clock, { choice: 'live', transferSim: { eligible: true, answered: true, dtmf: null, machine: true } });
  assert.equal(u.outcome, 'pq_created');
  assert.ok(call.turns.some(t => t.text.includes('ไม่มีใครรับสาย')));
});

test('AT-18 text path: PQ created, owner gets only the minimum, the call continues to a booking, nothing waits', async () => {
  const clock = await fresh();
  const { call, u } = await askParking(clock);
  assert.equal(u.outcome, 'pq_created');
  const b = await call.book({ service: 'นวดไทย 60', when: 'พรุ่งนี้บ่ายสาม', name: 'อันนา' });
  assert.equal(b.stage, 'create', 'the call moved on to another task');
  await drain(clock.now());
  const n = await notifyMsg(u.pq.pq_handle);
  assert.match(n.body, /…5678/);
  assert.ok(!n.body.includes(CALLER), 'masked number only');
  assert.match(n.body, /“ร้านมีที่จอดรถให้ลูกค้าไหม”/);
  assert.ok(!/ใช่ค่ะ|นวดไทย/.test(n.body), 'no transcript, no other bookings');
  assert.equal((await pqRow(A, u.pq.pq_handle)).status, 'awaiting_owner');
});

test('AT-19 owner quotes the question → preview → Send → caller gets the exact words → delivered → separate KC offer', async () => {
  const clock = await fresh();
  const { u, call } = await askParking(clock);
  await call.end();
  await drain(clock.now());
  const n = await notifyMsg(u.pq.pq_handle);
  clock.advance(30 * 60_000);
  const answer = 'จอดได้ฟรีที่ลานหลังร้านหลังหกโมงเย็นค่ะ';
  await ownerLine(clock.now(), NUM.A.ownerLine, { text: answer, quotedMessageId: n.provider_message_id });
  await drain(clock.now());
  assert.equal((await pqRow(A, u.pq.pq_handle)).status, 'owner_confirming', 'preview required before sending');
  assert.equal((await callerTexts()).length, 0);
  await ownerLine(clock.now(), NUM.A.ownerLine, { postback: await quick(A, 'ส่ง') });
  await drain(clock.now());
  const pq = await pqRow(A, u.pq.pq_handle);
  assert.equal(pq.terminal_outcome, 'delivered');
  const t = (await callerTexts())[0];
  assert.ok(t.body.includes(`“${answer}”`), 'owner words byte for byte');
  assert.match(t.body, /จากทีมงานร้าน/);
  const owner = (await sandbox(A)).filter(m => m.channel === 'line').map(m => m.body);
  assert.ok(owner.some(b => b.startsWith(`ส่งคำตอบ ${u.pq.pq_handle} ถึงลูกค้า`)), 'receipt');
  assert.ok(owner.findIndex(b => b.startsWith('บันทึกคำตอบนี้')) > owner.findIndex(b => b.startsWith(`ส่งคำตอบ ${u.pq.pq_handle}`)), 'KC offered after the receipt, separately');
});

test('AT-20 forged owner replies never touch the question', async () => {
  const clock = await fresh();
  const { u } = await askParking(clock);
  await drain(clock.now());
  const n = await notifyMsg(u.pq.pq_handle);
  const bad = await ownerLine(clock.now(), NUM.A.ownerLine, { text: 'ฟรีค่ะ', quotedMessageId: n.provider_message_id, badSig: true });
  assert.equal(bad.status, 401);
  const stranger = await ownerLine(clock.now(), 'U_stranger', { text: 'ฟรีค่ะ', quotedMessageId: n.provider_message_id });
  assert.deepEqual(stranger.results, [{ rejected: 'unenrolled' }]);
  const forgedPb = await ownerLine(clock.now(), NUM.A.ownerLine, { postback: `t=${A}&p=${u.pq.pq_id}&a=decline&s=AAAAAAAAAAAAAAAAAAAAAA` });
  assert.deepEqual(forgedPb.results, [{ rejected: 'postback' }]);
  const smsSpoof = await inboundSms(clock.now(), { from: '+66855555555', to: NUM.A.sender, body: 'DECLINE ' + u.pq.pq_handle });
  assert.equal((smsSpoof as any).forwarded, true, 'treated as a caller text, not an owner command');
  assert.equal((await pqRow(A, u.pq.pq_handle)).status, 'awaiting_owner');
});

test('AT-21 owner reply with a card number → needs edit; expiry with only rejected replies → owner_reply_rejected + truthful text', async () => {
  const clock = await fresh();
  const { u } = await askParking(clock);
  await drain(clock.now());
  const n = await notifyMsg(u.pq.pq_handle);
  await ownerLine(clock.now(), NUM.A.ownerLine, { text: 'โอนมาที่บัตร 4111 1111 1111 1111 ได้เลย', quotedMessageId: n.provider_message_id });
  await drain(clock.now());
  assert.equal((await pqRow(A, u.pq.pq_handle)).status, 'reply_needs_edit');
  assert.ok((await sandbox(A)).some(m => m.body.includes('คำตอบส่งเลขบัตรไม่ได้')));
  clock.advance(24 * H + 60_000);
  await drain(clock.now());
  const pq = await pqRow(A, u.pq.pq_handle);
  assert.equal(pq.terminal_outcome, 'owner_reply_rejected');
  const texts = await callerTexts();
  assert.equal(texts.length, 1);
  assert.match(texts[0].body, /ยังตอบคำถามเรื่อง/);
  assert.ok(!texts.some(t => t.body.includes('4111')));
});

test('AT-22 owner timeout → truthful text; late answer only with explicit "send anyway" → delivered_late', async () => {
  const clock = await fresh();
  const { u } = await askParking(clock);
  await drain(clock.now());
  const n = await notifyMsg(u.pq.pq_handle);
  clock.advance(2 * H); await drain(clock.now());
  clock.advance(4 * H); await drain(clock.now());
  assert.equal((await pqRow(A, u.pq.pq_handle)).reminders_sent, 2, 'two bounded reminders');
  clock.advance(18 * H + 60_000); await drain(clock.now());
  assert.equal((await pqRow(A, u.pq.pq_handle)).terminal_outcome, 'owner_timeout');
  assert.equal((await callerTexts()).length, 1);
  clock.advance(6 * H);
  await ownerLine(clock.now(), NUM.A.ownerLine, { text: 'มีที่จอดฟรีค่ะ', quotedMessageId: n.provider_message_id });
  await drain(clock.now());
  assert.equal((await pqRow(A, u.pq.pq_handle)).status, 'late_confirming');
  assert.equal((await callerTexts()).length, 1, 'nothing sent before the owner confirms');
  await ownerLine(clock.now(), NUM.A.ownerLine, { postback: await quick(A, 'ส่ง / Send anyway') });
  await drain(clock.now());
  assert.equal((await pqRow(A, u.pq.pq_handle)).terminal_outcome, 'delivered_late');
  assert.equal((await callerTexts()).length, 2);
});

test('AT-23 a different reply number must confirm (Thai: one-time link); never confirmed → caller_unreachable', async () => {
  const clock = await fresh();
  const other = '0898765432';
  const { u } = await askParking(clock, { target: { kind: 'other_number', number: other } });
  assert.equal(u.pq.target_verification, 'sms_confirm');
  await drain(clock.now());
  const confirmMsg = (await callerTexts('+66898765432'))[0];
  assert.match(confirmMsg.body, /กดยืนยัน: https:\/\/r\.example\.invalid\/c\//);
  const n = await notifyMsg(u.pq.pq_handle);
  await ownerLine(clock.now(), NUM.A.ownerLine, { text: 'มีที่จอดฟรีค่ะ', quotedMessageId: n.provider_message_id });
  await drain(clock.now());
  await ownerLine(clock.now(), NUM.A.ownerLine, { postback: await quick(A, 'ส่ง') });
  await drain(clock.now());
  assert.equal((await pqRow(A, u.pq.pq_handle)).status, 'awaiting_target');
  assert.equal((await callerTexts('+66898765432')).length, 1, 'only the confirmation request, no answer');
  clock.advance(73 * H); await drain(clock.now());
  const pq = await pqRow(A, u.pq.pq_handle);
  assert.equal(pq.terminal_outcome, 'caller_unreachable');
  assert.equal(pq.outcome_reason, 'unverified_target');

  // Same flow, but the recipient taps the link → the answer is released.
  const clock2 = await fresh();
  const r2 = await askParking(clock2, { target: { kind: 'other_number', number: other } });
  await drain(clock2.now());
  const token = (await callerTexts('+66898765432'))[0].body.match(/\/c\/([A-Za-z0-9_-]+)/)![1];
  await linkHit(token, clock2.now());
  const n2 = await notifyMsg(r2.u.pq.pq_handle);
  await ownerLine(clock2.now(), NUM.A.ownerLine, { text: 'มีที่จอดฟรีค่ะ', quotedMessageId: n2.provider_message_id });
  await drain(clock2.now());
  await ownerLine(clock2.now(), NUM.A.ownerLine, { postback: await quick(A, 'ส่ง') });
  await drain(clock2.now());
  assert.equal((await pqRow(A, r2.u.pq.pq_handle)).terminal_outcome, 'delivered');
});

test('AT-24 knowledge is saved only by a separate button; free text "ได้" does not approve; then the AI can answer', async () => {
  const clock = await fresh();
  const { u } = await askParking(clock);
  await drain(clock.now());
  const n = await notifyMsg(u.pq.pq_handle);
  await ownerLine(clock.now(), NUM.A.ownerLine, { text: 'มีที่จอดรถฟรีหลังร้านค่ะ', quotedMessageId: n.provider_message_id });
  await drain(clock.now());
  await ownerLine(clock.now(), NUM.A.ownerLine, { postback: await quick(A, 'ส่ง') });
  await drain(clock.now());
  const articles = () => withTenant(A, async tx => Number((await tx.query(`select count(*) n from knowledge_articles where provenance like 'owner_reply:%'`)).rows[0].n));
  await ownerLine(clock.now(), NUM.A.ownerLine, { text: 'ได้' });
  assert.equal(await articles(), 0);
  await ownerLine(clock.now(), NUM.A.ownerLine, { postback: await quick(A, 'บันทึก (โทร+ข้อความ)') });
  assert.equal(await articles(), 1);
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: '+66844444444', now: () => clock.now() });
  const r = await call.ask('ร้านมีที่จอดรถไหม');
  assert.equal(r.answered, true);
  assert.equal(r.facts.facts[0].text, 'มีที่จอดรถฟรีหลังร้านค่ะ');
});

test('AT-25 owner taps "I\'ll contact them" → owner_declined(will_contact) and a truthful text', async () => {
  const clock = await fresh();
  const { u } = await askParking(clock);
  await drain(clock.now());
  await ownerLine(clock.now(), NUM.A.ownerLine, { postback: await quick(A, 'ฉันจะติดต่อเอง') });
  await drain(clock.now());
  const pq = await pqRow(A, u.pq.pq_handle);
  assert.equal(pq.terminal_outcome, 'owner_declined');
  assert.equal(pq.decline_reason, 'will_contact');
  assert.match((await callerTexts())[0].body, /ทางร้านจะติดต่อคุณโดยตรง/);
});

test('AT-26 emergency → emergency number from the verified table, no pending question; AT-47 card number → refused and masked', async () => {
  const clock = await fresh();
  const { u } = await askParking(clock, { question: 'เพื่อนหมดสติหลังนวด ทำยังไงดี', summary: 'x' });
  assert.equal(u.outcome, 'unsafe_refused');
  assert.equal(u.spokenNumber, '1669');
  const p = await askParking(clock, { question: 'ตัดบัตร 4111 1111 1111 1111 ได้ไหม', summary: 'x' });
  assert.equal(p.u.outcome, 'unsafe_refused');
  assert.equal(p.u.category, 'payment');
  assert.ok(!p.u.masked.includes('4111'));
  assert.equal(await withTenant(A, async tx => Number((await tx.query('select count(*) n from pending_questions')).rows[0].n)), 0);
});

test('AT-49 LINE to the owner fails → SMS fallback with a one-time reply page (Thai SMS is one-way) → delivered', async () => {
  const clock = await fresh();
  faults.set(NUM.A.ownerLine, { kind: 'permanent', times: 1 });
  const { u } = await askParking(clock);
  await drain(clock.now());
  const sms = (await sandbox(A)).find(m => m.recipient === NUM.A.ownerSms)!;
  assert.match(sms.body, /ตอบที่ \/ Answer at: https:\/\/r\.example\.invalid\/r\//);
  const token = sms.body.match(/\/r\/([A-Za-z0-9_-]+)/)![1];
  await linkHit(token, clock.now(), 'มีที่จอดฟรีค่ะ', true);
  await drain(clock.now());
  assert.equal((await pqRow(A, u.pq.pq_handle)).terminal_outcome, 'delivered');
});

test('AT-50 an owner answer in Thai to an English call is sent verbatim (no machine translation)', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, lang: 'en', now: () => clock.now() });
  const u = await call.unknownQuestion({ question: 'Is there parking?', summary: 'Does the spa have parking for clients?', choice: 'text' });
  await drain(clock.now());
  const n = await notifyMsg(u.pq.pq_handle);
  await ownerLine(clock.now(), NUM.A.ownerLine, { text: 'มีที่จอดฟรีค่ะ', quotedMessageId: n.provider_message_id });
  await drain(clock.now());
  await ownerLine(clock.now(), NUM.A.ownerLine, { postback: await quick(A, 'ส่ง') });
  await drain(clock.now());
  const t = (await callerTexts())[0];
  assert.match(t.body, /^ร้านสปาตัวอย่าง: reply to your question about “Does the spa have parking for clients\?”: “มีที่จอดฟรีค่ะ”/);
});

test('AT-51 pending-question rate limit: a 4th question from one number in 24 h is refused truthfully', async () => {
  const clock = await fresh();
  for (let i = 0; i < 3; i++) assert.equal((await askParking(clock, { summary: `คำถามที่ ${i + 1} เรื่องที่จอดรถ` })).u.outcome, 'pq_created');
  const fourth = await askParking(clock, { summary: 'คำถามที่ 4 เรื่องที่จอดรถ' });
  assert.equal(fourth.u.outcome, 'pq_creation_failed');
  assert.equal((fourth.u as any).error.code, 'RATE_LIMITED');
});

test('AT-52 an answer whose price differs from the price list asks "send anyway?"', async () => {
  const clock = await fresh();
  const { u } = await askParking(clock, { summary: 'นวดไทย 60 นาทีมีส่วนลดไหม', variantRef: 'นวดไทย 60' });
  await drain(clock.now());
  const n = await notifyMsg(u.pq.pq_handle);
  await ownerLine(clock.now(), NUM.A.ownerLine, { text: 'วันธรรมดาเหลือ 450 บาทค่ะ', quotedMessageId: n.provider_message_id });
  await drain(clock.now());
  const preview = (await sandbox(A)).filter(m => m.body.includes('ตรวจก่อนส่ง')).at(-1)!;
  assert.match(preview.body, /ราคาไม่ตรงกับรายการราคาของร้าน \(500 บาท\)/);
  assert.equal((await callerTexts()).length, 0);
});

test('caller STOPs (opt-out link) after the call → the owner answer is not sent; caller_unreachable(opted_out)', async () => {
  const clock = await fresh();
  const { u, call } = await askParking(clock);
  await call.book({ service: 'นวดไทย 60', when: 'พรุ่งนี้บ่ายสาม', name: 'อันนา', textConfirmation: true });
  await drain(clock.now());
  const optOut = (await callerTexts())[0].body.match(/\/o\/([A-Za-z0-9_-]+)/)![1];
  await linkHit(optOut, clock.now());
  await drain(clock.now());
  const n = await notifyMsg(u.pq.pq_handle);
  await ownerLine(clock.now(), NUM.A.ownerLine, { text: 'มีที่จอดฟรีค่ะ', quotedMessageId: n.provider_message_id });
  await drain(clock.now());
  await ownerLine(clock.now(), NUM.A.ownerLine, { postback: await quick(A, 'ส่ง') });
  await drain(clock.now());
  const pq = await pqRow(A, u.pq.pq_handle);
  assert.equal(pq.terminal_outcome, 'caller_unreachable');
  assert.equal(pq.outcome_reason, 'opted_out');
  assert.ok(!(await callerTexts()).some(t => t.body.includes('มีที่จอดฟรีค่ะ')));
});

test('quiet hours: an answer sent at 22:00 is held until 08:00 local', async () => {
  const clock = await fresh('2026-11-12T14:30:00Z'); // 21:30 Bangkok
  const { u } = await askParking(clock);
  await drain(clock.now());
  const n = await notifyMsg(u.pq.pq_handle);
  clock.advance(30 * 60_000);
  await ownerLine(clock.now(), NUM.A.ownerLine, { text: 'มีที่จอดฟรีค่ะ', quotedMessageId: n.provider_message_id });
  await drain(clock.now());
  await ownerLine(clock.now(), NUM.A.ownerLine, { postback: await quick(A, 'ส่ง') });
  await drain(clock.now());
  assert.equal((await callerTexts()).length, 0);
  clock.advance(10 * H); await drain(clock.now()); // 08:00
  assert.equal((await callerTexts()).length, 1);
  assert.equal((await pqRow(A, u.pq.pq_handle)).terminal_outcome, 'delivered');
});

test('AT-32 a prior STOP blocks the text path even if the caller says yes on the call', async () => {
  const clock = await fresh();
  const first = await askParking(clock);
  await first.call.book({ service: 'นวดไทย 60', when: 'พรุ่งนี้บ่ายสาม', name: 'อันนา', textConfirmation: true });
  await drain(clock.now());
  await linkHit((await callerTexts())[0].body.match(/\/o\/([A-Za-z0-9_-]+)/)![1], clock.now());
  const again = await askParking(clock, { summary: 'อีกคำถามหนึ่ง เรื่องห้องน้ำ' });
  assert.equal(again.u.outcome, 'caller_declined_followup');
  assert.equal((again.u as any).error.code, 'CONSENT_REQUIRED');
});

test('the emergency rules run on every caller turn: an emergency in the middle of a booking interrupts it', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const s = await call.tool('search_availability', { variant_ref: 'นวดไทย 60', date_phrase: 'พรุ่งนี้บ่ายสาม' });
  assert.ok(s.ok);
  const e = await call.listen('เดี๋ยวนะ แม่หายใจไม่ออก');
  assert.deepEqual(e, { emergency: true, spokenNumber: '1669' });
  assert.equal(await call.listen('ขอเวลาบ่ายสามค่ะ'), null);
  assert.equal(await withTenant(A, async tx => Number((await tx.query('select count(*) n from pending_questions')).rows[0].n)), 0);
});
