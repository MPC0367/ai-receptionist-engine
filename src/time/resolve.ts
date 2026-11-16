/**
 * Deterministic resolution of spoken date/time phrases (blueprint §11.2). The model passes the caller's words;
 * code decides the date and time in the location's zone relative to the call's start. Ambiguity is returned as a
 * clarification, never guessed. Thai: six-hour clock, Buddhist Era years, Thai digits. English: am/pm.
 */
import { addDays, isoWeekday, localParts, cmpDate, pad, type LocalDate, type LocalTime } from './zone.ts';

export type Window = { from: LocalTime; to: LocalTime };
export type Clarify = 'which_weekday' | 'am_or_pm' | 'thai_clock_period' | 'no_date' | 'date_in_past' | 'outside_hours';
export type Resolved =
  | { status: 'ok'; date: LocalDate; time?: LocalTime; window?: Window }
  | { status: 'needs_clarification'; reason: Clarify; options?: Array<{ date: LocalDate; time?: LocalTime }> };

export type ResolveCtx = {
  nowUtcMs: number;
  tz: string;
  /** Opening windows on a date (local). Used only to settle am/pm or Thai period ambiguity. */
  hoursOn?: (d: LocalDate) => Window[];
};

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
const normalise = (s: string) =>
  s.toLowerCase().replace(/[๐-๙]/g, c => String(THAI_DIGITS.indexOf(c))).replace(/\s+/g, ' ').trim();

const TH_NUM: Record<string, number> = {
  'สิบสอง': 12, 'สิบเอ็ด': 11, 'สิบ': 10, 'เก้า': 9, 'แปด': 8, 'เจ็ด': 7, 'หก': 6, 'ห้า': 5, 'สี่': 4, 'สาม': 3, 'สอง': 2, 'หนึ่ง': 1,
};
const EN_NUM: Record<string, number> = {
  twelve: 12, eleven: 11, ten: 10, nine: 9, eight: 8, seven: 7, six: 6, five: 5, four: 4, three: 3, two: 2, one: 1,
};
const TH_NUM_RE = Object.keys(TH_NUM).join('|');
const num = (s: string | undefined): number | undefined =>
  s === undefined ? undefined : /^\d+$/.test(s) ? Number(s) : TH_NUM[s] ?? EN_NUM[s];

const EN_WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const TH_WEEKDAYS = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์', 'อาทิตย์'];
const EN_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const TH_MONTHS_ABBR = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** Buddhist Era → CE. Four-digit years ≥ 2400 are BE; two-digit years in Thai text are BE (69 → 2569). */
export function yearToCe(y: number, thai: boolean): number {
  if (y >= 2400) return y - 543;
  if (y < 100) return thai ? 2500 + y - 543 : 2000 + y;
  return y;
}

function resolveDate(p: string, today: LocalDate): { date?: LocalDate; clarify?: Resolved } {
  const thai = /[฀-๿]/.test(p);
  if (/\b(day after tomorrow)\b|มะรืน/.test(p)) return { date: addDays(today, 2) };
  if (/\btomorrow\b|พรุ่งนี้/.test(p)) return { date: addDays(today, 1) };
  if (/\btoday\b|วันนี้/.test(p)) return { date: today };

  const iso = p.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return { date: { y: yearToCe(+iso[1], false), m: +iso[2], d: +iso[3] } };

  for (let i = 0; i < 12; i++) {
    const names = [EN_MONTHS[i], TH_MONTHS[i], TH_MONTHS_ABBR[i]];
    for (const name of names) {
      const esc = name.replace(/\./g, '\\.');
      const m = p.match(new RegExp(`(\\d{1,2})\\s*${esc}\\s*(\\d{2,4})?`)) ?? p.match(new RegExp(`${esc}\\s*(\\d{1,2})(?:,?\\s*(\\d{4}))?`));
      if (m) {
        let y = m[2] ? yearToCe(+m[2], thai) : today.y;
        let date = { y, m: i + 1, d: +m[1] };
        if (!m[2] && cmpDate(date, today) < 0) date = { ...date, y: y + 1 };
        return { date };
      }
    }
  }

  for (let i = 0; i < 7; i++) {
    const wd = i + 1;
    const en = new RegExp(`\\b(this |next |coming )?${EN_WEEKDAYS[i]}\\b`).exec(p);
    const th = new RegExp(`(วัน)?${TH_WEEKDAYS[i]}(บดี)?\\s*(นี้|หน้า)?`).exec(p);
    if (!en && !th) continue;
    const delta = (wd - isoWeekday(today) + 7) % 7;
    const coming = addDays(today, delta);               // today if today is that weekday
    const following = addDays(coming, 7);
    if (en?.[1]?.trim() === 'next') {
      return { clarify: { status: 'needs_clarification', reason: 'which_weekday', options: [{ date: delta === 0 ? following : coming }, { date: delta === 0 ? addDays(following, 7) : following }] } };
    }
    if (th?.[3] === 'หน้า') {
      const mondayNextWeek = addDays(today, 8 - isoWeekday(today));
      return { date: addDays(mondayNextWeek, wd - 1) };
    }
    return { date: coming };
  }
  return {};
}

type TimeCands = { cands: LocalTime[]; window?: Window; kind: 'en' | 'th' };

function resolveTime(p: string): TimeCands | undefined {
  const half = /ครึ่ง|half past/.test(p) ? 30 : 0;
  let m: RegExpMatchArray | null;
  // Explicit clock forms: 15:00, 15.00 น., 15 นาฬิกา
  if ((m = p.match(/\b(\d{1,2})[:.](\d{2})\s*(น\.?|นาฬิกา)?\s*(am|pm|a\.m\.|p\.m\.)?/))) {
    let h = +m[1]; const mi = +m[2]; const ap = m[4];
    if (ap) return { cands: [{ h: (h % 12) + (ap.startsWith('p') ? 12 : 0), mi }], kind: 'en' };
    if (h >= 13 || h === 0 || m[3]) return { cands: [{ h, mi }], kind: 'th' };
    return { cands: [{ h, mi }, { h: h + 12, mi }], kind: 'en' };
  }
  if ((m = p.match(/(\d{1,2})\s*นาฬิกา/))) return { cands: [{ h: +m[1], mi: half }], kind: 'th' };
  // English: 3pm, 3 pm, three o'clock, at three
  if ((m = p.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(am|pm|a\.m\.|p\.m\.)/))) {
    const h = num(m[1])!; return { cands: [{ h: (h % 12) + (m[2].startsWith('p') ? 12 : 0), mi: half }], kind: 'en' };
  }
  if (/\bnoon\b|midday/.test(p)) return { cands: [{ h: 12, mi: 0 }], kind: 'en' };
  if ((m = p.match(/\b(?:at |around )?(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,2})(?: o'?clock)\b/)) ||
      (m = p.match(/\bat (one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d{1,2})\b/))) {
    const h = num(m[1])!; return { cands: h === 12 ? [{ h: 12, mi: half }] : [{ h, mi: half }, { h: h + 12, mi: half }], kind: 'en' };
  }
  // Thai six-hour clock
  if (/เที่ยงคืน/.test(p)) return { cands: [{ h: 0, mi: half }], kind: 'th' };
  if (/เที่ยง/.test(p)) return { cands: [{ h: 12, mi: half }], kind: 'th' };
  if ((m = p.match(new RegExp(`บ่าย\\s*(${TH_NUM_RE}|\\d{1,2})?\\s*(โมง)?`)))) {
    const n = num(m[1]) ?? 1; return { cands: [{ h: 12 + n, mi: half }], kind: 'th' };
  }
  if ((m = p.match(new RegExp(`(${TH_NUM_RE}|\\d)\\s*ทุ่ม`)))) return { cands: [{ h: 18 + num(m[1])!, mi: half }], kind: 'th' };
  if ((m = p.match(new RegExp(`ตี\\s*(${TH_NUM_RE}|\\d)`)))) return { cands: [{ h: num(m[1])!, mi: half }], kind: 'th' };
  if ((m = p.match(new RegExp(`(${TH_NUM_RE}|\\d{1,2})\\s*โมง\\s*(เช้า|เย็น)?`)))) {
    const n = num(m[1])!;
    if (m[2] === 'เย็น') return { cands: [{ h: n <= 6 ? n + 12 : n, mi: half }], kind: 'th' };
    if (m[2] === 'เช้า') return { cands: [{ h: n <= 5 ? n + 6 : n, mi: half }], kind: 'th' };
    if (n >= 1 && n <= 5) return { cands: [{ h: n + 6, mi: half }, { h: n + 12, mi: half }], kind: 'th' }; // bare "สามโมง"
    if (n === 6) return { cands: [{ h: 6, mi: half }, { h: 18, mi: half }], kind: 'th' };
    return { cands: [{ h: n, mi: half }], kind: 'th' };
  }
  // Windows
  if (/\bmorning\b|ตอนเช้า|ช่วงเช้า/.test(p)) return { cands: [], window: { from: { h: 9, mi: 0 }, to: { h: 12, mi: 0 } }, kind: 'en' };
  if (/\bafternoon\b|ตอนบ่าย|ช่วงบ่าย/.test(p)) return { cands: [], window: { from: { h: 12, mi: 0 }, to: { h: 17, mi: 0 } }, kind: 'en' };
  if (/\bevening\b|ตอนเย็น|ช่วงเย็น/.test(p)) return { cands: [], window: { from: { h: 17, mi: 0 }, to: { h: 21, mi: 0 } }, kind: 'en' };
  return undefined;
}

const within = (t: LocalTime, ws: Window[]) =>
  ws.some(w => t.h * 60 + t.mi >= w.from.h * 60 + w.from.mi && t.h * 60 + t.mi < w.to.h * 60 + w.to.mi);

export function resolveWhen(phrase: string, ctx: ResolveCtx): Resolved {
  const p = normalise(phrase);
  const now = localParts(ctx.nowUtcMs, ctx.tz);
  const today = { y: now.y, m: now.m, d: now.d };
  const dr = resolveDate(p, today);
  if (dr.clarify) return dr.clarify;
  const tr = resolveTime(p);
  let date = dr.date;
  if (!date) {
    if (!tr) return { status: 'needs_clarification', reason: 'no_date' };
    date = today; // a bare time means today; callers are read back the full date
  }
  if (cmpDate(date, today) < 0) return { status: 'needs_clarification', reason: 'date_in_past' };
  if (!tr) return { status: 'ok', date };
  if (tr.window) return { status: 'ok', date, window: tr.window };
  let cands = tr.cands;
  if (cands.length > 1 && ctx.hoursOn) {
    const open = ctx.hoursOn(date);
    const inHours = cands.filter(c => within(c, open));
    if (inHours.length === 1) cands = inHours;
    else if (inHours.length === 0) return { status: 'needs_clarification', reason: 'outside_hours', options: tr.cands.map(time => ({ date: date!, time })) };
  }
  if (cands.length > 1) {
    return { status: 'needs_clarification', reason: tr.kind === 'th' ? 'thai_clock_period' : 'am_or_pm', options: cands.map(time => ({ date: date!, time })) };
  }
  return { status: 'ok', date, time: cands[0] };
}

/**
 * What a phrase mentions, read the way resolveWhen reads it: a day (with the date it means, when it names one) and a
 * time or a part of the day. Used to notice a model passing only part of the caller's words (gpt-oss-20b passed
 * "ตอนบ่ายสามโมง" for "พรุ่งนี้ตอนบ่ายสาม" and the booking landed today, 16 Nov 2026).
 */
export function mentions(phrase: string, nowUtcMs: number, tz: string): { day: boolean; date?: LocalDate; time: boolean } {
  const p = normalise(phrase);
  const now = localParts(nowUtcMs, tz);
  const dr = resolveDate(p, { y: now.y, m: now.m, d: now.d });
  return { day: !!(dr.date || dr.clarify), date: dr.date, time: !!resolveTime(p) };
}

// Rendering for read-back -------------------------------------------------------------------------
const TH_WD_FULL = ['วันจันทร์', 'วันอังคาร', 'วันพุธ', 'วันพฤหัสบดี', 'วันศุกร์', 'วันเสาร์', 'วันอาทิตย์'];
const EN_WD_FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const TH_COUNT = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า', 'สิบ', 'สิบเอ็ด'];

export function thaiPeriodWord(t: LocalTime): string {
  const h = t.h, half = t.mi === 30 ? 'ครึ่ง' : '';
  let w: string;
  if (h === 0) w = 'เที่ยงคืน';
  else if (h <= 5) w = `ตี${TH_COUNT[h]}`;
  else if (h <= 11) w = `${TH_COUNT[h]}โมงเช้า`;
  else if (h === 12) w = 'เที่ยง';
  else if (h === 13) w = 'บ่ายโมง';
  else if (h <= 15) w = `บ่าย${TH_COUNT[h - 12]}โมง`;
  else if (h <= 18) w = `${TH_COUNT[h - 12]}โมงเย็น`;
  else w = `${TH_COUNT[h - 18]}ทุ่ม`;
  return w + half;
}

export function renderDateTime(d: LocalDate, t: LocalTime | undefined, lang: 'th' | 'en'): string {
  const wd = isoWeekday(d) - 1;
  if (lang === 'th') {
    const date = `${TH_WD_FULL[wd]}ที่ ${d.d} ${TH_MONTHS[d.m - 1]} ${d.y + 543}`;
    return t ? `${date} เวลา ${pad(t.h)}:${pad(t.mi)} น. (${thaiPeriodWord(t)})` : date;
  }
  const date = `${EN_WD_FULL[wd]} ${d.d} ${EN_MONTHS[d.m - 1][0].toUpperCase()}${EN_MONTHS[d.m - 1].slice(1)} ${d.y}`;
  if (!t) return date;
  const h12 = t.h % 12 === 0 ? 12 : t.h % 12;
  return `${date} at ${h12}:${pad(t.mi)} ${t.h < 12 ? 'am' : 'pm'}`;
}
