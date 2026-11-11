import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveWhen, renderDateTime, yearToCe } from '../src/time/resolve.ts';
import { localToUtc } from '../src/time/zone.ts';

const BKK = 'Asia/Bangkok';
const hours10to20 = () => [{ from: { h: 10, mi: 0 }, to: { h: 20, mi: 0 } }];
const hours8to20 = () => [{ from: { h: 8, mi: 0 }, to: { h: 20, mi: 0 } }];
const thu10 = Date.parse('2026-11-12T03:00:00Z'); // Thu 12 Nov 2026 10:00 Bangkok

test('AT-08 Thai six-hour clock phrases resolve and read back with digits and period word', () => {
  const r = (p: string, h = hours10to20) => resolveWhen(p, { nowUtcMs: thu10, tz: BKK, hoursOn: h });
  assert.deepEqual(r('พรุ่งนี้บ่ายสาม'), { status: 'ok', date: { y: 2026, m: 11, d: 13 }, time: { h: 15, mi: 0 } });
  assert.deepEqual(r('พรุ่งนี้สองทุ่ม'), { status: 'ok', date: { y: 2026, m: 11, d: 13 }, time: { h: 20, mi: 0 } });
  assert.deepEqual(r('พรุ่งนี้ห้าโมงเย็น'), { status: 'ok', date: { y: 2026, m: 11, d: 13 }, time: { h: 17, mi: 0 } });
  assert.deepEqual(r('พรุ่งนี้สามโมงเช้า', hours8to20), { status: 'ok', date: { y: 2026, m: 11, d: 13 }, time: { h: 9, mi: 0 } });
  // Bare "สามโมง": 09:00 is outside 10–20, so only 15:00 fits → resolved, read back unambiguously.
  assert.deepEqual(r('พรุ่งนี้สามโมง'), { status: 'ok', date: { y: 2026, m: 11, d: 13 }, time: { h: 15, mi: 0 } });
  // When both 09:00 and 15:00 are open hours, it must ask.
  const amb = r('พรุ่งนี้สามโมง', hours8to20);
  assert.equal(amb.status, 'needs_clarification');
  assert.equal(amb.status === 'needs_clarification' && amb.reason, 'thai_clock_period');
  assert.equal(renderDateTime({ y: 2026, m: 11, d: 13 }, { h: 15, mi: 0 }, 'th'), 'วันศุกร์ที่ 13 พฤศจิกายน 2569 เวลา 15:00 น. (บ่ายสามโมง)');
  assert.equal(renderDateTime({ y: 2026, m: 11, d: 13 }, { h: 19, mi: 30 }, 'th'), 'วันศุกร์ที่ 13 พฤศจิกายน 2569 เวลา 19:30 น. (หนึ่งทุ่มครึ่ง)');
});

test('Buddhist Era years, Thai digits and Thai month abbreviations', () => {
  assert.equal(yearToCe(2569, true), 2026);
  assert.equal(yearToCe(69, true), 2026);
  assert.equal(yearToCe(26, false), 2026);
  const r = resolveWhen('14 พ.ย. 69 บ่ายสามโมงครึ่ง', { nowUtcMs: thu10, tz: BKK, hoursOn: hours10to20 });
  assert.deepEqual(r, { status: 'ok', date: { y: 2026, m: 11, d: 14 }, time: { h: 15, mi: 30 } });
  const d = resolveWhen('๑๕:๐๐ น. พรุ่งนี้', { nowUtcMs: thu10, tz: BKK, hoursOn: hours10to20 });
  assert.deepEqual(d, { status: 'ok', date: { y: 2026, m: 11, d: 13 }, time: { h: 15, mi: 0 } });
});

test('AT-07 "next Friday" and am/pm ambiguity are clarified, never guessed; late-night "tomorrow" uses the local date', () => {
  const nf = resolveWhen('next friday at 3', { nowUtcMs: thu10, tz: BKK });
  assert.equal(nf.status, 'needs_clarification');
  assert.equal(nf.status === 'needs_clarification' && nf.reason, 'which_weekday');
  const amb = resolveWhen('tomorrow at three', { nowUtcMs: thu10, tz: BKK });
  assert.equal(amb.status === 'needs_clarification' && amb.reason, 'am_or_pm');
  // 23:50 Thursday in Bangkok is 16:50 UTC; "tomorrow" is Friday 13 in Bangkok, whatever the server zone.
  const late = resolveWhen('tomorrow 3pm', { nowUtcMs: Date.parse('2026-11-12T16:50:00Z'), tz: BKK });
  assert.deepEqual(late, { status: 'ok', date: { y: 2026, m: 11, d: 13 }, time: { h: 15, mi: 0 } });
  const past = resolveWhen('1 November', { nowUtcMs: thu10, tz: BKK });
  assert.deepEqual(past, { status: 'ok', date: { y: 2027, m: 11, d: 1 } }); // a past date without a year rolls to next year…
  const pastWithYear = resolveWhen('1 November 2026 3pm', { nowUtcMs: thu10, tz: BKK });
  assert.equal(pastWithYear.status === 'needs_clarification' && pastWithYear.reason, 'date_in_past'); // …with a year it is refused
});

test('AT-09 US daylight saving: nonexistent times are rejected, repeated times take the earlier', () => {
  const gap = localToUtc({ y: 2026, m: 3, d: 8, h: 2, mi: 30 }, 'America/New_York');
  assert.equal(gap.ok, false);
  const rep = localToUtc({ y: 2026, m: 11, d: 1, h: 1, mi: 30 }, 'America/New_York');
  assert.ok(rep.ok && rep.ambiguous);
  assert.equal(rep.ok && new Date(rep.utcMs).toISOString(), '2026-11-01T05:30:00.000Z'); // EDT (UTC−4), the first 01:30
  const bkk = localToUtc({ y: 2026, m: 11, d: 13, h: 15, mi: 0 }, BKK);
  assert.equal(bkk.ok && new Date(bkk.utcMs).toISOString(), '2026-11-13T08:00:00.000Z');
});
