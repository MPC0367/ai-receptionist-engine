import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { A, NUM, Call, CALLER, closeDb, drain, fresh, ownerLine, quick, sandbox, withTenant, withSystem } from './helpers.ts';
import { openPrivacyRequest, runRetention, verifyAndErase } from '../src/privacy.ts';

after(closeDb);
const DAY = 86_400_000;
const recordOn = () => withTenant(A, tx => tx.query(`update policies set body = body || '{"recording": true}'`));
const one = async (sql: string, p: unknown[] = []) => withTenant(A, async tx => Number((await tx.query(sql, p)).rows[0].n));
const sys = async (sql: string, p: unknown[] = []) => withSystem(async tx => Number((await tx.query(sql, p)).rows[0].n));

async function fullCall(clock: { now(): Date; advance(ms: number): void }, when = 'พรุ่งนี้บ่ายสาม') {
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  await call.book({ service: 'นวดไทย 60', when, name: 'อันนา', textConfirmation: true });
  const u = await call.unknownQuestion({ question: 'มีที่จอดรถไหม', summary: 'ร้านมีที่จอดรถให้ลูกค้าไหม', choice: 'text', callerName: 'อันนา' });
  clock.advance(3 * 60_000);
  await call.end();
  await drain(clock.now());
  const n = (await sandbox(A)).find(m => m.body.includes(u.pq!.pq_handle))!;
  await ownerLine(clock.now(), NUM.A.ownerLine, { text: 'มีที่จอดฟรีค่ะ', quotedMessageId: n.provider_message_id });
  await drain(clock.now());
  await ownerLine(clock.now(), NUM.A.ownerLine, { postback: await quick(A, 'ส่ง') });
  await drain(clock.now());
  return { call, u };
}

test('AT-33 a caller who objects: recording stops at that moment and no recording is kept; Thai greeting omits recording when off', async () => {
  const clock = await fresh();
  const off = (await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() })).call;
  assert.ok(!off.turns[0].text.includes('บันทึกเสียง'), 'recording is off by default in Thailand (D-09): no recording sentence');
  await recordOn();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  assert.ok(call.turns[0].text.includes('บันทึกเสียง'));
  clock.advance(20_000);
  await call.objectToRecording();
  clock.advance(60_000);
  await call.end();
  const conv = await withTenant(A, async tx => (await tx.query(`select recording_on, recording_stopped_offset_ms from conversations where id = $1`, [call.conversationId])).rows[0]);
  assert.deepEqual(conv, { recording_on: false, recording_stopped_offset_ms: 20_000 });
  assert.equal(await one(`select count(*) n from recording_refs where conversation_id = $1`, [call.conversationId]), 0);
  assert.ok(call.turns.some(t => t.text === 'ได้ค่ะ ปิดการบันทึกเสียงแล้วค่ะ'));
});

test('AT-41 retention: recordings (and the provider copy) go after 30 days, content after 90; a legal hold is respected', async () => {
  const clock = await fresh();
  await recordOn();
  const kept = await fullCall(clock);
  const gone = (await Call.start({ dialed: NUM.A.dialed, ani: '+66899990001', now: () => clock.now() })).call;
  gone.hear('สวัสดีค่ะ'); clock.advance(60_000); await gone.end();
  await withTenant(A, tx => tx.query(`insert into legal_holds (tenant_id, id, conversation_id, reason, created_by, created_at) values ($1, gen_random_uuid(), $2, 'dispute (fictional)', 'staff', $3)`,
    [A, kept.call.conversationId, clock.now()]));
  assert.equal(await sys(`select count(*) n from sandbox_provider_store`), 2);
  clock.advance(31 * DAY);
  const r1 = await withTenant(A, tx => runRetention(tx, A, clock.now()));
  assert.equal(r1.recordings, 1);
  assert.equal(r1.provider_copies, 1);
  assert.equal(r1.held_skipped, 1);
  assert.equal(await sys(`select count(*) n from sandbox_provider_store`), 1, 'only the held call keeps its copy');
  const ev = await withTenant(A, async tx => (await tx.query(`select purge_evidence from recording_refs where conversation_id = $1`, [gone.conversationId])).rows[0].purge_evidence);
  assert.equal(ev.provider_copy_deleted, 1);
  assert.ok(r1.provider_logs > 0, 'provider message logs older than 30 days');
  clock.advance(60 * DAY);
  const r2 = await withTenant(A, tx => runRetention(tx, A, clock.now()));
  assert.ok(r2.transcript_turns > 0);
  assert.equal(await one(`select count(*) n from transcript_turns where conversation_id = $1`, [gone.conversationId]), 0);
  assert.ok(await one(`select count(*) n from transcript_turns where conversation_id = $1`, [kept.call.conversationId]) > 0, 'held');
  assert.equal(await one(`select count(*) n from pending_questions where question_text <> '[deleted]'`), 1, 'the held call keeps its question');
  const r3 = await withTenant(A, tx => runRetention(tx, A, clock.now()));
  assert.equal(r3.recordings + r3.transcript_turns + r3.pq_anonymised, 0, 'idempotent');
});

test('AT-39 deletion request: code-verified, erases every plaintext trace across tables and provider stand-ins, keeps what must be kept', async () => {
  const clock = await fresh();
  await recordOn();
  await fullCall(clock);
  clock.advance(2 * DAY); // the booking is now in the past
  const { request_id } = await withTenant(A, tx => openPrivacyRequest(tx, A, { phone: CALLER, now: clock.now(), lang: 'th' }));
  await drain(clock.now());
  const code = (await sandbox(A)).filter(m => m.recipient === CALLER).at(-1)!.body.match(/คือ (\d{6})/)![1];
  const wrong = await withTenant(A, tx => verifyAndErase(tx, A, { requestId: request_id, phone: CALLER, code: code === '000000' ? '111111' : '000000', now: clock.now() }));
  assert.equal(wrong.wrong_code, true);
  const r = await withTenant(A, tx => verifyAndErase(tx, A, { requestId: request_id, phone: CALLER, code, now: clock.now() }));
  assert.equal(r.status, 'completed', JSON.stringify(r));
  assert.equal(r.evidence!.verified_zero_plaintext, true);
  assert.equal(r.evidence!.recordings, 1);
  assert.equal(r.evidence!.provider_copies, 1);
  const anywhere = await withTenant(A, async tx => (await tx.query(`select
      (select count(*) from client_identities where value = $1) + (select count(*) from conversations where ani = $1)
    + (select count(*) from pending_questions where target = $1 or question_text like '%ที่จอดรถ%') + (select count(*) from owner_replies where body like '%จอด%')
    + (select count(*) from outbox_events where payload::text like '%' || $1 || '%') + (select count(*) from transcript_turns) as n`, [CALLER])).rows[0].n);
  assert.equal(Number(anywhere), 0);
  assert.equal(await sys(`select count(*) n from sandbox_messages where recipient = $1`, [CALLER]), 0);
  assert.equal(await sys(`select count(*) n from sandbox_provider_store`), 0);
  assert.ok(await one(`select count(*) n from usage_events`) >= 1, 'billing records stay (no personal data)');
  assert.equal(await one(`select count(*) n from appointments`), 1, 'the past appointment stays, its client anonymised');
  assert.equal(await one(`select count(*) n from clients where preferred_name is not null and preferred_name = 'อันนา'`), 0);
});

test('a deletion request with a future booking goes to staff review; nothing is erased yet', async () => {
  const clock = await fresh();
  await fullCall(clock);
  const { request_id } = await withTenant(A, tx => openPrivacyRequest(tx, A, { phone: CALLER, now: clock.now(), lang: 'th' }));
  await drain(clock.now());
  const code = (await sandbox(A)).filter(m => m.recipient === CALLER).at(-1)!.body.match(/คือ (\d{6})/)![1];
  const r = await withTenant(A, tx => verifyAndErase(tx, A, { requestId: request_id, phone: CALLER, code, now: clock.now() }));
  assert.equal(r.status, 'needs_review');
  assert.equal(await one(`select count(*) n from client_identities where value = $1`, [CALLER]), 1);
});

test('AT-48 a long call: warned once at 13 min, wrapped up and ended at 15 min, billed in its duration band; the token renews', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  await call.book({ service: 'นวดไทย 60', when: 'พรุ่งนี้บ่ายสาม', name: 'อันนา' });
  const states: string[] = [];
  for (let m = 1; m <= 16; m++) {
    clock.advance(60_000);
    const s = await call.checkClock();
    states.push(s);
    if (s === 'ended') break;
    call.hear('เรื่องอื่นอีกค่ะ');
    assert.ok((await call.tool('get_business_facts', { question: 'จ่ายด้วยบัตรได้ไหม' })).ok, `token still valid at minute ${m}`);
  }
  assert.equal(states.filter(s => s === 'warn').length, 1);
  assert.equal(states.at(-1), 'ended');
  assert.equal(states.length, 15);
  assert.match(call.turns.at(-1)!.text, /^การจองของคุณบันทึกไว้แล้วค่ะ ขอบคุณที่โทรมาค่ะ/);
  const u = await withTenant(A, async tx => (await tx.query(`select billable, duration_band from usage_events`)).rows[0]);
  assert.deepEqual(u, { billable: true, duration_band: '8-15' });
  const conv = await withTenant(A, async tx => (await tx.query(`select ended_by from conversations`)).rows[0]);
  assert.equal(conv.ended_by, 'max_duration');
});
