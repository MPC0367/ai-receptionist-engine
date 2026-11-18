/** Time-zone arithmetic with the platform tz database (Intl). No server-zone assumptions anywhere. */

export type LocalDate = { y: number; m: number; d: number };
export type LocalTime = { h: number; mi: number };
export type LocalDateTime = LocalDate & LocalTime;

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

export function assertZone(tz: string) {
  fmt(tz); // throws RangeError for an unknown zone
}

export function localParts(utcMs: number, tz: string): LocalDateTime {
  const p: Record<string, number> = {};
  for (const part of fmt(tz).formatToParts(new Date(utcMs))) if (part.type !== 'literal') p[part.type] = Number(part.value);
  return { y: p.year, m: p.month, d: p.day, h: p.hour, mi: p.minute };
}

export function offsetMs(utcMs: number, tz: string): number {
  const l = localParts(utcMs, tz);
  return Date.UTC(l.y, l.m - 1, l.d, l.h, l.mi) - Math.floor(utcMs / 60000) * 60000;
}

export type ToUtc = { ok: true; utcMs: number; ambiguous: boolean } | { ok: false; reason: 'nonexistent' };

/** Local wall time → UTC. Nonexistent times (spring-forward gap) are rejected; repeated times take the earlier. */
export function localToUtc(t: LocalDateTime, tz: string): ToUtc {
  const naive = Date.UTC(t.y, t.m - 1, t.d, t.h, t.mi);
  const cands = new Set([naive - offsetMs(naive - 43_200_000, tz), naive - offsetMs(naive + 43_200_000, tz)]);
  const valid = [...cands].filter(c => {
    const l = localParts(c, tz);
    return l.y === t.y && l.m === t.m && l.d === t.d && l.h === t.h && l.mi === t.mi;
  }).sort((a, b) => a - b);
  if (!valid.length) return { ok: false, reason: 'nonexistent' };
  return { ok: true, utcMs: valid[0], ambiguous: valid.length > 1 };
}

export function addDays(d: LocalDate, n: number): LocalDate {
  const x = new Date(Date.UTC(d.y, d.m - 1, d.d + n));
  return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() };
}

/** ISO weekday: Monday = 1 … Sunday = 7. */
export function isoWeekday(d: LocalDate): number {
  const w = new Date(Date.UTC(d.y, d.m - 1, d.d)).getUTCDay();
  return w === 0 ? 7 : w;
}

export const sameDate = (a: LocalDate, b: LocalDate) => a.y === b.y && a.m === b.m && a.d === b.d;
export const cmpDate = (a: LocalDate, b: LocalDate) => (a.y - b.y) || (a.m - b.m) || (a.d - b.d);
export const minutes = (t: LocalTime) => t.h * 60 + t.mi;
export const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (d: LocalDate) => `${d.y}-${pad(d.m)}-${pad(d.d)}`;
