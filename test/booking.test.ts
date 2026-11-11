import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { A, C, IDS, NUM, Call, CALLER, closeDb, drain, fresh, sandbox, sha, withTenant } from './helpers.ts';
import { callTool } from '../src/tools/gateway.ts';
import { faults } from '../src/messaging/channels.ts';

after(closeDb);

const count = (t: string, sql: string, p: unknown[] = []) => withTenant(t, async tx => Number((await tx.query(sql, p)).rows[0].n));

test('AT-01 book an available service: exactly one appointment, confirmation spoken verbatim, notices queued', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const r = await call.book({ service: 'นวดไทย 60', when: 'พรุ่งนี้บ่ายสาม', name: 'อันนา', textConfirmation: true });
  assert.equal(r.stage, 'create');
  assert.ok(r.result.ok);
  assert.equal(await count(A, `select count(*) n from appointments where status = 'booked'`), 1);
  assert.equal(await count(A, `select count(*) n from slot_claims where status = 'active' and kind = 'booking'`), 1);
  const spoken = call.turns.find(t => t.text.startsWith('ขอทวนนะคะ'))!.text;
  assert.match(spoken, /นวดไทย 60 นาที กับคุณนก วันศุกร์ที่ 13 พฤศจิกายน 2569 เวลา 15:00 น\. \(บ่ายสามโมง\) ราคา 500 บาท ในชื่อคุณอันนา/);
  await drain(clock.now());
  const sent = await sandbox(A);
  assert.equal(sent.filter(m => m.channel === 'line').length, 1, 'owner notice');
  assert.equal(sent.filter(m => m.recipient === CALLER).length, 1, 'client confirmation (caller said yes to a text)');
  assert.match(sent.find(m => m.recipient === CALLER).body, /ยกเลิกรับข้อความ: https:\/\/r\.example\.invalid\/o\//, 'one-way Thai sender → opt-out link');
});

test('AT-02 no write without the confirmation sentence first; AT-03 invented slot token rejected', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const early = await call.book({ service: 'นวดไทย 60', when: 'พรุ่งนี้บ่ายสาม', name: 'อันนา', earlyYes: true });
  assert.equal(early.result.ok, false);
  assert.equal(!early.result.ok && early.result.error.code, 'VALIDATION_FAILED');
  assert.equal(await count(A, `select count(*) n from appointments`), 0);
  const fake = await call.tool('hold_slot', { slot_token: 'eyJ0IjoiMSJ9.forged' });
  assert.equal(!fake.ok && fake.error.code, 'VALIDATION_FAILED');
  const wrongSentence = await call.tool('create_booking', { hold_ref: (early as any).hold.data.hold_ref, client_name: 'x' },
    { spoken_confirmation_sha256: sha('something else'), spoken_turn: 1, confirm_turn: 2 });
  assert.equal(!wrongSentence.ok && wrongSentence.error.code, 'VALIDATION_FAILED');
});

test('AT-04 two callers race for one slot: one hold, one CONFLICT; 20 parallel holds → exactly one', async () => {
  const clock = await fresh();
  const a = (await Call.start({ dialed: NUM.A.dialed, ani: '+66811111111', now: () => clock.now() })).call;
  const b = (await Call.start({ dialed: NUM.A.dialed, ani: '+66822222222', now: () => clock.now() })).call;
  const sa = await a.tool('search_availability', { variant_ref: 'นวดไทย 60', date_phrase: 'พรุ่งนี้บ่ายสาม', staff_ref: 'นก' });
  const sb = await b.tool('search_availability', { variant_ref: 'นวดไทย 60', date_phrase: 'พรุ่งนี้บ่ายสาม', staff_ref: 'นก' });
  assert.ok(sa.ok && sb.ok);
  const [ha, hb] = await Promise.all([a.tool('hold_slot', { slot_token: sa.data.options[0].slot_token }), b.tool('hold_slot', { slot_token: sb.data.options[0].slot_token })]);
  assert.equal([ha, hb].filter(h => h.ok).length, 1);
  assert.equal([ha, hb].filter(h => !h.ok && h.error.code === 'CONFLICT').length, 1);
  const callers = await Promise.all(Array.from({ length: 20 }, (_, i) => Call.start({ dialed: NUM.A.dialed, ani: `+668300000${String(i).padStart(2, '0')}`, now: () => clock.now() })));
  const searches = await Promise.all(callers.map(({ call }) => call.tool('search_availability', { variant_ref: 'นวดไทย 60', date_phrase: 'พรุ่งนี้สองทุ่ม', staff_ref: 'นก' })));
  // 20:00 is closing time: the latest 60-min start is 19:00, so "สองทุ่ม" offers alternatives; all race for the first one.
  const tokens = searches.map(s => (s as any).data.options[0].slot_token);
  const holds = await Promise.all(callers.map(({ call }, i) => call.tool('hold_slot', { slot_token: tokens[i] })));
  assert.equal(holds.filter(h => h.ok).length, 1);
});

test('AT-06 create_booking retried after a lost response returns the original booking', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const r = await call.book({ service: 'นวดไทย 60', when: 'พรุ่งนี้บ่ายสาม', name: 'อันนา' });
  const h = (r as any).hold.data;
  const meta = { spoken_confirmation_sha256: sha(h.rendered_confirmation.th + '\n' + h.rendered_confirmation.en), spoken_turn: 4, confirm_turn: 5 };
  const again = await call.tool('create_booking', { hold_ref: h.hold_ref, client_name: 'อันนา', send_confirmation_text: false }, meta);
  assert.ok(again.ok);
  assert.equal(again.data.booking_ref, (r.result as any).data.booking_ref);
  assert.equal(await count(A, `select count(*) n from appointments`), 1);
});

test('AT-10 duration change after an offer recomputes availability (90 min + buffer)', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const s60 = await call.tool('search_availability', { variant_ref: 'นวดไทย 60', date_phrase: 'พรุ่งนี้หนึ่งทุ่ม', staff_ref: 'นก' });
  assert.equal(s60.ok && s60.data.status, 'exact_available'); // 19:00 + 60 = 20:00 closes exactly
  const s90 = await call.tool('search_availability', { variant_ref: 'นวดไทย 90', date_phrase: 'พรุ่งนี้หนึ่งทุ่ม', staff_ref: 'นก' });
  assert.equal(s90.ok && s90.data.status, 'unavailable_with_alternatives'); // 19:00 + 90 would run past closing
  assert.ok(s90.ok && s90.data.options.every((o: any) => !o.start_local_th.includes('19:00')));
});

test('AT-11 reschedule to an overlapping time with the same staff is atomic; old and new restated', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  await call.book({ service: 'นวดไทย 60', when: '20 พ.ย. 69 บ่ายสาม', name: 'อันนา', staff: 'นก' });
  const mine = await call.tool('get_bookings_for_caller', {});
  assert.equal(mine.ok && mine.data.match, 'verified');
  const b = mine.ok && mine.data.bookings[0];
  const s = await call.tool('search_availability', { variant_ref: 'นวดไทย 60', date_phrase: '20 พ.ย. 69 15:30 น.', staff_ref: 'นก', for_booking_ref: b.booking_ref });
  assert.ok(s.ok && s.data.options.length, 'own booking does not block its own move');
  const h = await call.tool('hold_slot', { slot_token: s.data.options[0].slot_token, for_booking_ref: b.booking_ref });
  assert.ok(h.ok, JSON.stringify(h));
  const meta = { expected_version: b.version, spoken_confirmation_sha256: sha(h.data.rendered_confirmation.th + '\n' + h.data.rendered_confirmation.en), spoken_turn: 20, confirm_turn: 21 };
  const r = await call.tool('reschedule_booking', { booking_ref: b.booking_ref, hold_ref: h.data.hold_ref }, meta);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.data.new_version, 2);
  assert.equal(await count(A, `select count(*) n from slot_claims where status = 'active'`), 1);
  const stale = await call.tool('reschedule_booking', { booking_ref: b.booking_ref, hold_ref: h.data.hold_ref }, { ...meta, expected_version: 1 });
  assert.ok(stale.ok, 'idempotent replay returns the stored result');
});

test('AT-13 cancellation states the policy consequence from the record, never a refund promise', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  await call.book({ service: 'นวดไทย 60', when: 'พรุ่งนี้บ่ายสาม', name: 'อันนา' }); // Fri 15:00 — 29 h away
  clock.advance(10 * 3600_000); // now 20:00 Thu → 19 h before: inside the 24 h window
  const call2 = (await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() })).call; // a new call (tokens last 15 min)
  const b = (await call2.tool('get_bookings_for_caller', {})) as any;
  const ask = await call2.tool('cancel_booking', { booking_ref: b.data.bookings[0].booking_ref, confirmed: false }, { expected_version: 1 });
  assert.ok(ask.ok && ask.data.needs_confirmation);
  assert.equal(ask.data.policy_consequence_text.th, 'ยกเลิกน้อยกว่า 24 ชั่วโมงก่อนนัด ทางร้านขอสงวนสิทธิ์เก็บมัดจำค่ะ');
  assert.ok(!/refund|คืนเงิน/i.test(JSON.stringify(ask.data)));
  const done = await call2.tool('cancel_booking', { booking_ref: b.data.bookings[0].booking_ref, confirmed: true },
    { expected_version: 1, spoken_confirmation_sha256: 'x', spoken_turn: 30, confirm_turn: 31 });
  assert.ok(done.ok);
  assert.equal(await count(A, `select count(*) n from slot_claims where status = 'active'`), 0);
});

test('AT-14 an unverified caller cannot list or change bookings', async () => {
  const clock = await fresh();
  const owner = (await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() })).call;
  await owner.book({ service: 'นวดไทย 60', when: 'พรุ่งนี้บ่ายสาม', name: 'อันนา' });
  const ref = ((await owner.tool('get_bookings_for_caller', {})) as any).data.bookings[0].booking_ref;
  const other = (await Call.start({ dialed: NUM.A.dialed, ani: '+66899999999', now: () => clock.now() })).call;
  const list = await other.tool('get_bookings_for_caller', {});
  assert.equal(list.ok && list.data.match, 'none');
  const cancel = await other.tool('cancel_booking', { booking_ref: ref, confirmed: true }, { expected_version: 1, spoken_confirmation_sha256: 'x', spoken_turn: 1, confirm_turn: 2 });
  assert.equal(!cancel.ok && cancel.error.code, 'NOT_FOUND');
  const hidden = (await Call.start({ dialed: NUM.A.dialed, ani: null, now: () => clock.now() })).call;
  const c2 = await hidden.tool('cancel_booking', { booking_ref: ref, confirmed: true }, { expected_version: 1 });
  assert.equal(!c2.ok && c2.error.code, 'HUMAN_REQUIRED');
});

test('AT-44/45 booking stands when its confirmation text fails; a failed booking sends nothing', async () => {
  const clock = await fresh();
  faults.set(CALLER, { kind: 'permanent', times: 1 });
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const ok = await call.book({ service: 'นวดไทย 60', when: 'พรุ่งนี้บ่ายสาม', name: 'อันนา', textConfirmation: true });
  await drain(clock.now());
  assert.ok(ok.result.ok);
  assert.equal(await count(A, `select count(*) n from appointments where status = 'booked'`), 1);
  assert.equal(await count(A, `select count(*) n from outbox_events where status = 'dead'`), 1, 'failed delivery is visible');
  // AT-45: caller X holds a time but is slow; the hold expires and caller Y books it; X's write then fails → nothing sent to X.
  const x = (await Call.start({ dialed: NUM.A.dialed, ani: '+66877777777', now: () => clock.now() })).call;
  const sx = await x.tool('search_availability', { variant_ref: 'นวดไทย 60', date_phrase: 'พรุ่งนี้บ่ายสี่โมง', staff_ref: 'นก' }) as any;
  const hx = await x.tool('hold_slot', { slot_token: sx.data.options[0].slot_token }) as any;
  clock.advance(4 * 60_000);
  const y = (await Call.start({ dialed: NUM.A.dialed, ani: '+66866666666', now: () => clock.now() })).call;
  assert.equal((await y.book({ service: 'นวดไทย 60', when: 'พรุ่งนี้บ่ายสี่โมง', name: 'วาย', staff: 'นก' })).stage, 'create');
  const late = await x.tool('create_booking', { hold_ref: hx.data.hold_ref, client_name: 'เอ็กซ์', send_confirmation_text: true },
    { spoken_confirmation_sha256: sha(hx.data.rendered_confirmation.th + '\n' + hx.data.rendered_confirmation.en), spoken_turn: 9, confirm_turn: 10 });
  assert.equal(!late.ok && late.error.code, 'CONFLICT');
  assert.equal(await count(A, `select count(*) n from outbox_events where payload->>'to' = '+66877777777'`), 0);
  assert.equal(await count(A, `select count(*) n from appointments where status = 'booked'`), 2);
});

test('AT-46 hang-up during a hold releases it; the slot is bookable again', async () => {
  const clock = await fresh();
  const a = (await Call.start({ dialed: NUM.A.dialed, ani: '+66811111111', now: () => clock.now() })).call;
  const s = await a.tool('search_availability', { variant_ref: 'นวดไทย 60', date_phrase: 'พรุ่งนี้บ่ายสาม', staff_ref: 'นก' });
  await a.tool('hold_slot', { slot_token: (s as any).data.options[0].slot_token });
  await a.end('caller');
  const b = (await Call.start({ dialed: NUM.A.dialed, ani: '+66822222222', now: () => clock.now() })).call;
  const r = await b.book({ service: 'นวดไทย 60', when: 'พรุ่งนี้บ่ายสาม', name: 'บี', staff: 'นก' });
  assert.equal(r.stage, 'create');
});

test('per-number booking limit (TH-12): a third booking in 24 h needs a person', async () => {
  const clock = await fresh();
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  assert.ok((await call.book({ service: 'นวดไทย 60', when: 'พรุ่งนี้บ่ายสาม', name: 'อันนา' })).result.ok);
  assert.ok((await call.book({ service: 'นวดไทย 60', when: 'พรุ่งนี้บ่ายสี่โมง', name: 'อันนา' })).result.ok);
  const third = await call.book({ service: 'นวดไทย 60', when: 'พรุ่งนี้บ่ายสองโมง', name: 'อันนา' });
  assert.equal(!third.result.ok && third.result.error.code, 'POLICY_BLOCKED');
});

test('AT-09 (engine) a US tenant never offers a time inside the spring-forward gap', async () => {
  const clock = await fresh('2026-03-07T12:00:00Z');
  const { call } = await Call.start({ dialed: NUM.C.dialed, ani: '+12025550123', lang: 'en', now: () => clock.now() });
  const s = await call.tool('search_availability', { variant_ref: 'haircut', date_phrase: '2026-03-08', max_options: 3 });
  assert.ok(s.ok);
  const all = await withTenant(C, async tx => {
    const B = await import('../src/booking/engine.ts');
    const v = await B.variant(tx, IDS.C.cut);
    return B.availableOn(tx, { variant: v, date: { y: 2026, m: 3, d: 8 }, staff: await B.qualifiedStaff(tx, v.id), now: clock.now(), tz: 'America/New_York', pol: (await B.policy(tx)).body });
  });
  assert.ok(all.length > 0);
  assert.ok(all.every(o => o.t.h !== 2), 'no 02:xx slots on 8 March 2026 in New York');
});
