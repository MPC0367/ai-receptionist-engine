import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { A, IDS, NUM, Call, CALLER, closeDb, drain, fresh, sandbox, sha, withTenant } from './helpers.ts';
import { ALLOWED_SCOPES, connect, eventIdFor, pullMirrorChanges, syncBusy } from '../src/connectors/calendar.ts';
import { useCalendarApi } from '../src/handlers.ts';
import { FakeGoogleCalendar } from '../sim/fake-google.ts';

after(closeDb);
afterEach(() => useCalendarApi(null));
const NOK_CAL = 'nok.personal@example.invalid', MIRROR = 'rcpt-bookings@group.calendar.google.invalid';
const fri = (hhmm: string) => new Date(`2026-11-13T${hhmm}:00+07:00`).toISOString();

async function setup(clock: { now(): Date }) {
  const g = new FakeGoogleCalendar();
  useCalendarApi(g);
  await withTenant(A, tx => connect(tx, A, { resourceId: IDS.A.nok, busyCalendarIds: [NOK_CAL], mirrorCalendarId: MIRROR, grantedScopes: ALLOWED_SCOPES, now: clock.now() }));
  return g;
}
const tasks = (kind: string) => withTenant(A, async tx => (await tx.query(`select * from staff_tasks where kind = $1`, [kind])).rows);

test('TH-09 a connection with wider scopes than needed is refused', async () => {
  const clock = await fresh();
  await assert.rejects(withTenant(A, tx => connect(tx, A, { resourceId: IDS.A.nok, busyCalendarIds: [NOK_CAL], mirrorCalendarId: MIRROR,
    grantedScopes: [...ALLOWED_SCOPES, 'https://www.googleapis.com/auth/calendar'], now: clock.now() })), /scopes wider than needed/);
});

test("the owner's own busy time is never offered; an event over an existing booking becomes a staff task, the booking stays", async () => {
  const clock = await fresh();
  const g = await setup(clock);
  g.busy.set(NOK_CAL, [{ start: fri('15:00'), end: fri('16:00') }]);
  await withTenant(A, tx => syncBusy(tx, A, g, clock.now()));
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const s = await call.tool('search_availability', { variant_ref: 'นวดไทย 60', date_phrase: 'พรุ่งนี้บ่ายสาม', staff_ref: 'นก' }) as any;
  assert.equal(s.data.status, 'unavailable_with_alternatives');
  const b = await call.book({ service: 'นวดไทย 60', when: 'พรุ่งนี้หนึ่งทุ่ม', name: 'อันนา', staff: 'นก' });
  assert.equal(b.stage, 'create');
  g.busy.set(NOK_CAL, [{ start: fri('15:00'), end: fri('16:00') }, { start: fri('18:30'), end: fri('20:00') }]);
  const r = await withTenant(A, tx => syncBusy(tx, A, g, clock.now()));
  assert.match(Object.values(r)[0], /synced_with_1_conflicts/);
  assert.equal((await tasks('calendar_conflict')).length, 1);
  assert.equal(await withTenant(A, async tx => (await tx.query(`select count(*)::int n from appointments where status = 'booked'`)).rows[0].n), 1);
});

test('AT-43 mirror writes: a lost response is retried without a duplicate; a move patches; a cancel marks the event cancelled', async () => {
  const clock = await fresh();
  const g = await setup(clock);
  await withTenant(A, tx => syncBusy(tx, A, g, clock.now()));
  g.failNext('insertEvent', 503, true); // the write lands, the response is lost
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const b = await call.book({ service: 'นวดไทย 60', when: '20 พ.ย. 69 บ่ายสาม', name: 'อันนา', staff: 'นก' });
  const id = (b.result as any).data.booking_ref;
  await drain(clock.now());
  assert.equal(g.events.get(MIRROR)?.size, 1);
  clock.advance(61_000); await drain(clock.now());
  assert.equal(g.events.get(MIRROR)?.size, 1, 'still one event after the retry');
  assert.deepEqual(g.calls.filter(c => c !== 'freeBusy'), ['insertEvent', 'insertEvent', 'patchEvent']);
  const ev = g.events.get(MIRROR)!.get(eventIdFor(id))!;
  assert.equal(ev.start.dateTime, new Date('2026-11-20T15:00:00+07:00').toISOString());
  assert.match(eventIdFor(id), /^[a-v0-9]{5,1024}$/, 'a valid Google event id');
  const mine = ((await call.tool('get_bookings_for_caller', {})) as any).data.bookings[0];
  const s = await call.tool('search_availability', { variant_ref: 'นวดไทย 60', date_phrase: '20 พ.ย. 69 บ่ายสี่โมง', staff_ref: 'นก', for_booking_ref: id }) as any;
  const h = await call.tool('hold_slot', { slot_token: s.data.options[0].slot_token, for_booking_ref: id }) as any;
  await call.tool('reschedule_booking', { booking_ref: id, hold_ref: h.data.hold_ref },
    { expected_version: mine.version, spoken_confirmation_sha256: sha(h.data.rendered_confirmation.th + '\n' + h.data.rendered_confirmation.en), spoken_turn: 70, confirm_turn: 71 });
  await drain(clock.now());
  assert.equal(ev.start.dateTime, new Date('2026-11-20T16:00:00+07:00').toISOString());
  const ask = await call.tool('cancel_booking', { booking_ref: id, confirmed: false }, { expected_version: 2 }) as any;
  await call.tool('cancel_booking', { booking_ref: id, confirmed: true },
    { expected_version: 2, spoken_confirmation_sha256: sha(ask.data.rendered_confirmation.th + '\n' + ask.data.rendered_confirmation.en), spoken_turn: 80, confirm_turn: 81 });
  await drain(clock.now());
  assert.equal(ev.status, 'cancelled');
});

test('AT-35 calendar access revoked: writes pause, the owner is told, the AI takes a request instead of a booking', async () => {
  const clock = await fresh();
  const g = await setup(clock);
  await withTenant(A, tx => syncBusy(tx, A, g, clock.now()));
  g.revoked = true;
  clock.advance(15 * 60_000);
  const r = await withTenant(A, tx => syncBusy(tx, A, g, clock.now()));
  assert.deepEqual(Object.values(r), ['unavailable']);
  await drain(clock.now());
  assert.ok((await sandbox(A)).some(m => m.body.includes('ปฏิทิน Google หลุดการเชื่อมต่อ')));
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const s = await call.tool('search_availability', { variant_ref: 'นวดไทย 60', date_phrase: 'พรุ่งนี้บ่ายสาม', staff_ref: 'นก' });
  assert.equal(!s.ok && s.error.code, 'CONNECTOR_UNAVAILABLE');
  const anyStaff = await call.tool('search_availability', { variant_ref: 'นวดไทย 60', date_phrase: 'พรุ่งนี้บ่ายสาม' }) as any;
  assert.ok(anyStaff.ok && anyStaff.data.options.every((o: any) => o.staff_name === 'ฝน'), 'only staff with no broken calendar are offered');
  const req = await call.tool('log_booking_request', { variant_ref: 'นวดไทย 90', date_phrase: 'พรุ่งนี้บ่ายสาม', client_name: 'อันนา' }) as any;
  assert.match(req.data.speakable, /นี่ยังไม่ใช่การจอง/);
  assert.equal((await tasks('booking_request')).length, 1);
  assert.equal(await withTenant(A, async tx => (await tx.query(`select count(*)::int n from appointments`)).rows[0].n), 0);
});

test('stale busy data (no sync for 30 min) stops offers for that staff member until the next sync', async () => {
  const clock = await fresh();
  const g = await setup(clock);
  await withTenant(A, tx => syncBusy(tx, A, g, clock.now()));
  clock.advance(31 * 60_000);
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const s = await call.tool('search_availability', { variant_ref: 'นวดไทย 60', date_phrase: 'พรุ่งนี้บ่ายสาม', staff_ref: 'นก' });
  assert.equal(!s.ok && s.error.code, 'CONNECTOR_UNAVAILABLE');
  await withTenant(A, tx => syncBusy(tx, A, g, clock.now()));
  assert.ok((await call.tool('search_availability', { variant_ref: 'นวดไทย 60', date_phrase: 'พรุ่งนี้บ่ายสาม', staff_ref: 'นก' })).ok);
});

test('D-12 an owner moving a mirrored event becomes a staff task (the booking is not moved); an expired sync token forces a full resync', async () => {
  const clock = await fresh();
  const g = await setup(clock);
  await withTenant(A, tx => syncBusy(tx, A, g, clock.now()));
  const { call } = await Call.start({ dialed: NUM.A.dialed, ani: CALLER, now: () => clock.now() });
  const b = await call.book({ service: 'นวดไทย 60', when: '20 พ.ย. 69 บ่ายสาม', name: 'อันนา', staff: 'นก' });
  await drain(clock.now());
  await withTenant(A, tx => pullMirrorChanges(tx, A, g, clock.now()));
  g.ownerMoves(MIRROR, eventIdFor((b.result as any).data.booking_ref), fri('10:00'), fri('11:00'));
  g.expireSyncTokens();
  const r = await withTenant(A, tx => pullMirrorChanges(tx, A, g, clock.now()));
  assert.equal(r.full_resync, true);
  assert.equal(r.staff_tasks, 1);
  const ap = await withTenant(A, async tx => (await tx.query(`select starts_at from appointments`)).rows[0].starts_at);
  assert.equal(ap.toISOString(), new Date('2026-11-20T15:00:00+07:00').toISOString(), 'the booking itself is unchanged');
});
