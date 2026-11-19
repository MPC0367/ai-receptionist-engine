/**
 * Booking authority (internal mode, blueprint §11). Availability is computed by code; holds and bookings are
 * claims that the database refuses to overlap (exclusion constraint `no_double_booking`).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Tx } from '../db.ts';
import { audit, idHash, sha256, uuid } from '../db.ts';
import { addDays, isoWeekday, localParts, localToUtc, minutes, type LocalDate, type LocalTime } from '../time/zone.ts';
import { renderDateTime, type Window } from '../time/resolve.ts';
import { ToolError } from '../tools/errors.ts';
import { scheduleMirror } from '../connectors/calendar.ts';

const SLOT_SECRET = process.env.RCPT_SLOT_SECRET ?? uuid() + uuid();
export const HOLD_TTL_MS = 180_000;
export const HOLD_EXTENDED_TTL_MS = 300_000;
const TOKEN_TTL_MS = 600_000;

export type Variant = { id: string; name: string; name_en: string | null; duration_min: number; buffer_before_min: number; buffer_after_min: number;
  price_minor: string | null; currency: string | null; price_is_authoritative: boolean; aliases: string[] };
export type Policy = { lead_min: number; horizon_days: number; slot_step_min: number; change_window_h: number;
  cancel_text: { th: string; en: string } | null; max_bookings_per_number_24h: number };

export async function location(tx: Tx) {
  const r = await tx.query('select id, name, time_zone, public_phone, public_contact from locations limit 1');
  if (!r.rowCount) throw new ToolError('NOT_FOUND', 'no location');
  return r.rows[0] as { id: string; name: string; time_zone: string; public_phone: string; public_contact: Record<string, string> };
}
export async function policy(tx: Tx): Promise<{ version: number; body: Policy }> {
  const r = await tx.query('select version, body from policies order by version desc limit 1');
  return r.rows[0];
}
export async function variant(tx: Tx, id: string): Promise<Variant> {
  const r = await tx.query('select * from service_variants where id = $1', [id]);
  if (!r.rowCount) throw new ToolError('NOT_FOUND', 'variant');
  return r.rows[0];
}

/** Opening windows (local) for the location or a staff member on a date: intersection of location and staff rules. */
export async function hoursOn(tx: Tx, d: LocalDate, staffId?: string): Promise<Window[]> {
  const wd = isoWeekday(d);
  const r = await tx.query(
    `select resource_id, opens::text, closes::text from business_hours where weekday = $1 and (resource_id is null or resource_id = $2)`,
    [wd, staffId ?? null]);
  const toT = (s: string) => ({ h: +s.slice(0, 2), mi: +s.slice(3, 5) });
  const loc = r.rows.filter(x => !x.resource_id).map(x => ({ from: toT(x.opens), to: toT(x.closes) }));
  if (!staffId) return loc;
  // Staff with no hours of their own follow the location; staff with any rows work only those rows.
  const own = await tx.query(`select 1 from business_hours where resource_id = $1 limit 1`, [staffId]);
  if (!own.rowCount) return loc;
  const staff = r.rows.filter(x => x.resource_id).map(x => ({ from: toT(x.opens), to: toT(x.closes) }));
  const out: Window[] = [];
  for (const a of loc) for (const b of staff) {
    const from = Math.max(minutes(a.from), minutes(b.from)), to = Math.min(minutes(a.to), minutes(b.to));
    if (to > from) out.push({ from: { h: Math.floor(from / 60), mi: from % 60 }, to: { h: Math.floor(to / 60), mi: to % 60 } });
  }
  return out;
}

// Slot tokens -----------------------------------------------------------------------------------------
type SlotPayload = { t: string; v: string; s: string; st: number; en: number; iat: number };
const b64 = (b: Buffer) => b.toString('base64url');
export function signSlot(p: SlotPayload): string {
  const body = b64(Buffer.from(JSON.stringify(p)));
  return `${body}.${b64(createHmac('sha256', SLOT_SECRET).update(body).digest())}`;
}
export function verifySlot(token: string, tenantId: string, now: Date): SlotPayload {
  const [body, mac] = token.split('.');
  if (!body || !mac) throw new ToolError('VALIDATION_FAILED', 'slot token malformed');
  const want = createHmac('sha256', SLOT_SECRET).update(body).digest();
  const got = Buffer.from(mac, 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw new ToolError('VALIDATION_FAILED', 'slot token signature');
  const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as SlotPayload;
  if (p.t !== tenantId) throw new ToolError('VALIDATION_FAILED', 'slot token tenant');
  if (now.getTime() - p.iat > TOKEN_TTL_MS) throw new ToolError('EXPIRED', 'slot token expired');
  return p;
}

/** A booking as it stands, for the confirmation text the caller said yes to after it was made (no client name in it). */
export async function bookingSummary(tx: Tx, appointmentId: string): Promise<{ th: string; en: string }> {
  const ap = (await tx.query(`select a.variant_id, a.starts_at, a.status, (select resource_id from slot_claims s where s.appointment_id = a.id
    and s.kind = 'booking' and s.status = 'active' limit 1) staff_id from appointments a where a.id = $1`, [appointmentId])).rows[0];
  if (!ap || ap.status !== 'booked' || !ap.staff_id) throw new ToolError('NOT_FOUND', 'booking');
  const v = await variant(tx, ap.variant_id), loc = await location(tx);
  const sr = (await tx.query('select display_name, name_en from resources where id = $1', [ap.staff_id])).rows[0];
  const lp = localParts(new Date(ap.starts_at).getTime(), loc.time_zone);
  const a = { variant: v, staff: { th: sr.display_name as string, en: (sr.name_en ?? sr.display_name) as string }, date: { y: lp.y, m: lp.m, d: lp.d }, t: { h: lp.h, mi: lp.mi } };
  return { th: confirmationText('th', a).replace(/^ขอทวนนะคะ: /, 'นัดของคุณ: ').replace(/ ยืนยันจองเลยไหมคะ$/, ''),
    en: confirmationText('en', a).replace(/^To confirm: /, 'Your booking: ').replace(/\. Shall I book it\?$/, '.') };
}

// Availability ------------------------------------------------------------------------------------------
export type SlotOption = { slot_token: string; staff_id: string; staff_name: string; staff_name_en: string; start_utc: string; start_local_th: string; start_local_en: string };

async function busy(tx: Tx, staffIds: string[], from: Date, to: Date, now: Date) {
  const r = await tx.query(
    `select resource_id, lower(span) as s, upper(span) as e from slot_claims
     where resource_id = any($1) and status = 'active' and span && tstzrange($2, $3)
       and not (kind = 'hold' and hold_expires_at < $4)`,
    [staffIds, from, to, now]);
  return r.rows.map(x => ({ id: x.resource_id as string, s: (x.s as Date).getTime(), e: (x.e as Date).getTime() }));
}

export async function qualifiedStaff(tx: Tx, variantId: string, staffId?: string) {
  const r = await tx.query(
    `select r.id, r.display_name, r.name_en from resources r join resource_services rs on rs.resource_id = r.id
     where rs.variant_id = $1 and r.kind = 'staff' and r.active ${staffId ? 'and r.id = $2' : ''} order by r.display_name`,
    staffId ? [variantId, staffId] : [variantId]);
  return r.rows as Array<{ id: string; display_name: string; name_en: string | null }>;
}

/**
 * Candidate starts on a date (local), filtered by hours, lead time, horizon, grid and active claims (with buffers).
 * `exclude` lets a reschedule ignore the booking's own claims.
 */
export async function availableOn(tx: Tx, args: {
  variant: Variant; date: LocalDate; staff: Array<{ id: string; display_name: string; name_en?: string | null }>; window?: Window; exact?: LocalTime;
  now: Date; tz: string; pol: Policy; excludeAppointment?: string;
}): Promise<Array<{ staff_id: string; staff_name: string; staff_name_en?: string; startMs: number; t: LocalTime }>> {
  const { variant: v, date, now, tz, pol } = args;
  const today = localParts(now.getTime(), tz);
  const horizonEnd = addDays({ y: today.y, m: today.m, d: today.d }, pol.horizon_days);
  if (Date.UTC(date.y, date.m - 1, date.d) > Date.UTC(horizonEnd.y, horizonEnd.m - 1, horizonEnd.d)) return [];
  const dayStart = localToUtc({ ...date, h: 0, mi: 0 }, tz);
  const dayEnd = localToUtc({ ...addDays(date, 1), h: 0, mi: 0 }, tz);
  const from = new Date((dayStart.ok ? dayStart.utcMs : 0) - 6 * 3600_000), to = new Date((dayEnd.ok ? dayEnd.utcMs : 0) + 6 * 3600_000);
  let claims = await busy(tx, args.staff.map(s => s.id), from, to, now);
  if (args.excludeAppointment) {
    const own = await tx.query(`select resource_id, lower(span) s from slot_claims where appointment_id = $1 and status = 'active'`, [args.excludeAppointment]);
    const ownKeys = new Set(own.rows.map(x => `${x.resource_id}:${(x.s as Date).getTime()}`));
    claims = claims.filter(c => !ownKeys.has(`${c.id}:${c.s}`));
  }
  const out: Array<{ staff_id: string; staff_name: string; staff_name_en?: string; startMs: number; t: LocalTime }> = [];
  for (const s of args.staff) {
    for (const w of await hoursOn(tx, date, s.id)) {
      for (let m = minutes(w.from); m + v.duration_min <= minutes(w.to); m += pol.slot_step_min) {
        const t = { h: Math.floor(m / 60), mi: m % 60 };
        if (args.exact && minutes(args.exact) !== m) continue;
        if (args.window && (m < minutes(args.window.from) || m >= minutes(args.window.to))) continue;
        const u = localToUtc({ ...date, ...t }, tz);
        if (!u.ok) continue;                                    // DST gap: never offered
        const start = u.utcMs;
        if (start < now.getTime() + pol.lead_min * 60_000) continue;
        const cs = start - v.buffer_before_min * 60_000, ce = start + (v.duration_min + v.buffer_after_min) * 60_000;
        if (claims.some(c => c.id === s.id && c.s < ce && cs < c.e)) continue;
        out.push({ staff_id: s.id, staff_name: s.display_name, staff_name_en: s.name_en ?? s.display_name, startMs: start, t });
      }
    }
  }
  return out.sort((a, b) => a.startMs - b.startMs || a.staff_name.localeCompare(b.staff_name));
}

export function toOption(tenantId: string, v: Variant, o: { staff_id: string; staff_name: string; staff_name_en?: string; startMs: number; t: LocalTime }, date: LocalDate, now: Date): SlotOption {
  const st = o.startMs - v.buffer_before_min * 60_000;
  const en = o.startMs + (v.duration_min + v.buffer_after_min) * 60_000;
  return {
    slot_token: signSlot({ t: tenantId, v: v.id, s: o.staff_id, st, en, iat: now.getTime() }),
    // The English name too, so an English call does not say "นก" (gpt-oss on Groq did, 20 Nov 2026).
    staff_id: o.staff_id, staff_name: o.staff_name, staff_name_en: o.staff_name_en ?? o.staff_name, start_utc: new Date(o.startMs).toISOString(),
    start_local_th: renderDateTime(date, o.t, 'th'), start_local_en: renderDateTime(date, o.t, 'en'),
  };
}

/** Pick ≤ n options spread across staff (first per staff, then fill). */
export function spread<T extends { staff_id: string; startMs: number }>(xs: T[], n: number): T[] {
  const seenTimes = new Set<number>(), out: T[] = [];
  for (const x of xs) if (!seenTimes.has(x.startMs) && out.length < n) { out.push(x); seenTimes.add(x.startMs); }
  return out;
}

// Holds ---------------------------------------------------------------------------------------------------
export function confirmationText(lang: 'th' | 'en', a: { variant: Variant; staff: { th: string; en: string }; date: LocalDate; t: LocalTime; name?: string | null;
  from?: { date: LocalDate; t: LocalTime } }) {
  const when = renderDateTime(a.date, a.t, lang);
  // A move names both times and asks to move, so a caller never hears "book it" for what is a reschedule (found in a
  // model-driven run, 12 Nov 2026: the yes to "ยืนยันจองเลยไหมคะ" read like a second booking).
  if (a.from) {
    const was = renderDateTime(a.from.date, a.from.t, lang);
    if (lang === 'th') return `ขอทวนนะคะ: เลื่อนนัด${a.variant.name} จาก${was} เป็น${when} กับคุณ${a.staff.th} ยืนยันเลื่อนนัดเลยไหมคะ`;
    return `To confirm: moving your ${a.variant.name_en ?? a.variant.name} from ${was} to ${when} with ${a.staff.en}. Shall I move it?`;
  }
  const price = a.variant.price_is_authoritative && a.variant.price_minor
    ? (lang === 'th' ? ` ราคา ${Number(a.variant.price_minor) / 100} บาท` : ` for ${Number(a.variant.price_minor) / 100} baht`) : '';
  if (lang === 'th') return `ขอทวนนะคะ: ${a.variant.name} กับคุณ${a.staff.th} ${when}${price}${a.name ? ` ในชื่อคุณ${a.name.replace(/^คุณ\s*/, '')}` : ''} ยืนยันจองเลยไหมคะ`;
  return `To confirm: ${a.variant.name_en ?? a.variant.name} with ${a.staff.en} on ${when}${price}${a.name ? `, under the name ${a.name}` : ''}. Shall I book it?`;
}

/**
 * Serialise claim changes per staff member. Concurrent inserts of overlapping rows under an exclusion constraint can
 * deadlock (each waits for the other's uncommitted row); the lock removes that, and the constraint stays the guarantee.
 * Always taken before any audit insert (which takes the tenant's audit lock), so the lock order is fixed.
 */
export async function lockResource(tx: Tx, resourceId: string) {
  await tx.query(`select pg_advisory_xact_lock(hashtextextended($1, 7))`, ['claim:' + resourceId]);
}

export async function holdSlot(tx: Tx, tenantId: string, a: { slotToken: string; conversationId: string; clientName?: string; now: Date; replacesAppointment?: string }) {
  const p = verifySlot(a.slotToken, tenantId, a.now);
  const v = await variant(tx, p.v);
  const loc = await location(tx);
  const sr = (await tx.query('select display_name, name_en from resources where id = $1', [p.s])).rows[0];
  if (!sr) throw new ToolError('NOT_FOUND', 'staff');
  const staff = { th: sr.display_name as string, en: (sr.name_en ?? sr.display_name) as string };
  const holdRef = uuid();
  const span = `[${new Date(p.st).toISOString()},${new Date(p.en).toISOString()})`;
  await lockResource(tx, p.s);
  await tx.query(`update slot_claims set status = 'expired' where resource_id = $1 and kind = 'hold' and status = 'active' and hold_expires_at < $2`, [p.s, a.now]);
  try {
    await tx.query('savepoint claim');
    await tx.query(
      `insert into slot_claims (tenant_id, id, resource_id, kind, span, hold_ref, hold_expires_at, status)
       values ($1,$2,$3,'hold',$4,$5,$6,'active')`,
      [tenantId, uuid(), p.s, span, holdRef, new Date(a.now.getTime() + HOLD_TTL_MS)]);
    await tx.query('release savepoint claim');
  } catch (e: any) {
    await tx.query('rollback to savepoint claim');
    if (e.code !== '23P01') throw e;
    // A reschedule may overlap only its own booking (same staff, shifted time): defer the claim to the commit,
    // which releases the old claim and claims the new span in one transaction (rescheduleBooking).
    const others = a.replacesAppointment ? await tx.query(
      `select 1 from slot_claims where resource_id = $1 and status = 'active' and span && $2::tstzrange
         and not (kind = 'hold' and hold_expires_at < $3) and appointment_id is distinct from $4`,
      [p.s, span, a.now, a.replacesAppointment]) : { rowCount: 1 };
    if (others.rowCount) throw new ToolError('CONFLICT', 'slot taken', 'slot_taken');
    // Hold the part of the new span outside the booking's own claim, so nobody else can take it meanwhile (review 13).
    const own = (await tx.query(`select lower(span) s, upper(span) e from slot_claims where appointment_id = $1 and resource_id = $2 and status = 'active'`,
      [a.replacesAppointment, p.s])).rows.map(r => [(r.s as Date).getTime(), (r.e as Date).getTime()] as const);
    let pieces: Array<[number, number]> = [[p.st, p.en]];
    for (const [os, oe] of own) pieces = pieces.flatMap(([ns, ne]) => [...(ns < os ? [[ns, Math.min(ne, os)] as [number, number]] : []), ...(ne > oe ? [[Math.max(ns, oe), ne] as [number, number]] : [])]);
    for (const [ps, pe] of pieces.filter(([x, y]) => y > x)) {
      try {
        await tx.query('savepoint piece');
        await tx.query(`insert into slot_claims (tenant_id, id, resource_id, kind, span, hold_ref, hold_expires_at, status) values ($1,$2,$3,'hold',$4,$5,$6,'active')`,
          [tenantId, uuid(), p.s, `[${new Date(ps).toISOString()},${new Date(pe).toISOString()})`, holdRef, new Date(a.now.getTime() + HOLD_TTL_MS)]);
        await tx.query('release savepoint piece');
      } catch (e2: any) {
        await tx.query('rollback to savepoint piece');
        if (e2.code === '23P01') throw new ToolError('CONFLICT', 'slot taken', 'slot_taken');
        throw e2;
      }
    }
  }
  const start = p.st + v.buffer_before_min * 60_000;
  const lp = localParts(start, loc.time_zone);
  const date = { y: lp.y, m: lp.m, d: lp.d }, t = { h: lp.h, mi: lp.mi };
  let from: { date: LocalDate; t: LocalTime } | undefined;
  if (a.replacesAppointment) {
    const old = (await tx.query(`select starts_at from appointments where id = $1`, [a.replacesAppointment])).rows[0];
    if (old) { const o = localParts(new Date(old.starts_at).getTime(), loc.time_zone); from = { date: { y: o.y, m: o.m, d: o.d }, t: { h: o.h, mi: o.mi } }; }
  }
  const th = confirmationText('th', { variant: v, staff, date, t, name: a.clientName, from });
  const en = confirmationText('en', { variant: v, staff, date, t, name: a.clientName, from });
  await tx.query(
    `insert into holds (tenant_id, hold_ref, conversation_id, variant_id, staff_id, starts_at, ends_at, claim_span, client_name,
       rendered_th, rendered_en, rendered_sha256, expires_at, status, replaces_appointment)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active',$14)`,
    [tenantId, holdRef, a.conversationId, v.id, p.s, new Date(start), new Date(start + v.duration_min * 60_000), span, a.clientName ?? null,
     th, en, sha256(th + '\n' + en), new Date(a.now.getTime() + HOLD_TTL_MS), a.replacesAppointment ?? null]);
  await audit(tx, tenantId, { machine: 'SM-3', entity: holdRef, to: 'holding', event: 'hold_ok', actor: 'ai_runtime', correlation: a.conversationId, at: a.now });
  return { hold_ref: holdRef, expires_at: new Date(a.now.getTime() + HOLD_TTL_MS).toISOString(), rendered_confirmation: { th, en } };
}

export async function releaseHold(tx: Tx, tenantId: string, holdRef: string, now: Date, actor = 'ai_runtime') {
  const r = await tx.query(`update holds set status = 'released' where hold_ref = $1 and status = 'active' returning hold_ref`, [holdRef]);
  await tx.query(`update slot_claims set status = 'released' where hold_ref = $1 and kind = 'hold' and status = 'active'`, [holdRef]);
  if (r.rowCount) await audit(tx, tenantId, { machine: 'SM-3', entity: holdRef, from: 'holding', to: 'released', event: 'release', actor, at: now });
  return { released: true };
}

/** Make sure the hold's claim is still ours and active; if it expired and was swept, try to claim again. */
async function secureHoldClaim(tx: Tx, tenantId: string, hold: any, now: Date) {
  await lockResource(tx, hold.staff_id);
  const c = await tx.query(`select id from slot_claims where hold_ref = $1 and status = 'active' for update`, [hold.hold_ref]);
  if (c.rowCount) return c.rows[0].id as string;
  try {
    await tx.query('savepoint reclaim');
    const id = uuid();
    await tx.query(`insert into slot_claims (tenant_id, id, resource_id, kind, span, hold_ref, hold_expires_at, status)
                    values ($1,$2,$3,'hold',$4,$5,$6,'active')`, [tenantId, id, hold.staff_id, hold.claim_span, hold.hold_ref, now]);
    await tx.query('release savepoint reclaim');
    return id;
  } catch (e: any) {
    await tx.query('rollback to savepoint reclaim');
    if (e.code === '23P01') throw new ToolError('CONFLICT', 'slot no longer available', 'slot_taken');
    throw e;
  }
}

export type Confirmation = { spokenSha256: string; spokenTurn: number; confirmTurn: number; confirmedAt: Date };

async function loadHold(tx: Tx, holdRef: string, conf: Confirmation) {
  const h = (await tx.query(`select * from holds where hold_ref = $1 for update`, [holdRef])).rows[0];
  if (!h) throw new ToolError('NOT_FOUND', 'hold');
  if (h.status !== 'active') throw new ToolError('EXPIRED', 'hold no longer active');
  if (Buffer.from(conf.spokenSha256, 'hex').compare(h.rendered_sha256) !== 0) {
    throw new ToolError('VALIDATION_FAILED', 'spoken confirmation differs from the rendered sentence');
  }
  if (!(conf.confirmTurn > conf.spokenTurn)) throw new ToolError('VALIDATION_FAILED', 'affirmation must follow the confirmation sentence');
  return h;
}

async function upsertClient(tx: Tx, tenantId: string, phone: string | null, name: string) {
  if (phone) {
    const r = await tx.query(`select client_id from client_identities where kind = 'phone' and value_hash = $1`, [idHash(phone)]);
    if (r.rowCount) return r.rows[0].client_id as string;
  }
  const id = uuid();
  await tx.query(`insert into clients (tenant_id, id, preferred_name) values ($1,$2,$3)`, [tenantId, id, name]);
  if (phone) await tx.query(
    `insert into client_identities (tenant_id, id, client_id, kind, value, value_hash, verified_by) values ($1,$2,$3,'phone',$4,$5,'ani')`,
    [tenantId, uuid(), id, phone, idHash(phone)]);
  return id;
}

export async function createBooking(tx: Tx, tenantId: string, a: {
  holdRef: string; clientName: string; phone: string | null; conversationId: string; conf: Confirmation; now: Date;
  configVersion: number; notify: (tx: Tx, kind: 'booked', appointmentId: string, text: { th: string; en: string }, phone: string | null) => Promise<void>;
}) {
  const h = await loadHold(tx, a.holdRef, a.conf);
  if (h.replaces_appointment) throw new ToolError('VALIDATION_FAILED', 'this hold is for a reschedule, not a new booking');
  if (h.client_name && a.clientName !== h.client_name) throw new ToolError('VALIDATION_FAILED', 'name differs from the confirmed sentence');
  const pol = await policy(tx);
  if (a.phone) {
    const recent = await tx.query(
      `select count(*)::int n from appointments ap join client_identities ci on ci.client_id = ap.client_id
       where ci.kind = 'phone' and ci.value_hash = $1 and ap.source = 'ai_voice' and ap.status = 'booked' and ap.confirmed_at > $2`,
      [idHash(a.phone), new Date(a.now.getTime() - 86_400_000)]);
    if (recent.rows[0].n >= pol.body.max_bookings_per_number_24h) throw new ToolError('POLICY_BLOCKED', 'per-number booking limit', 'needs_person');
  }
  const claimId = await secureHoldClaim(tx, tenantId, h, a.now);
  const clientId = await upsertClient(tx, tenantId, a.phone, a.clientName);
  const apptId = uuid();
  const loc = await location(tx);
  await tx.query(
    `insert into appointments (tenant_id, id, location_id, client_id, variant_id, starts_at, ends_at, status, source,
       created_by_conversation, confirmation_turn_id, confirmed_at, policy_version, config_version)
     values ($1,$2,$3,$4,$5,$6,$7,'booked','ai_voice',$8,$9,$10,$11,$12)`,
    [tenantId, apptId, loc.id, clientId, h.variant_id, h.starts_at, h.ends_at, a.conversationId, String(a.conf.confirmTurn),
     a.conf.confirmedAt, pol.version, a.configVersion]);
  await tx.query(`update slot_claims set kind = 'booking', appointment_id = $2, hold_expires_at = null where id = $1`, [claimId, apptId]);
  await tx.query(`update holds set status = 'converted' where hold_ref = $1`, [a.holdRef]);
  await tx.query(`insert into appointment_events (tenant_id, id, appointment_id, kind, after, actor) values ($1,$2,$3,'created',$4,'ai_runtime')`,
    [tenantId, uuid(), apptId, JSON.stringify({ starts_at: h.starts_at, staff: h.staff_id, variant: h.variant_id })]);
  await audit(tx, tenantId, { machine: 'SM-3', entity: apptId, from: 'committing', to: 'booked', event: 'booked', actor: 'ai_runtime', correlation: a.conversationId, at: a.now });
  await mirrorIfConnected(tx, tenantId, h.staff_id, apptId, 1, a.now);
  const summary = { th: h.rendered_th.replace(/^ขอทวนนะคะ: /, 'จองเรียบร้อยแล้วค่ะ: ').replace(/ ยืนยันจองเลยไหมคะ$/, ''), en: h.rendered_en.replace(/^To confirm: /, 'You are booked: ').replace(/ Shall I book it\?$/, '') };
  await a.notify(tx, 'booked', apptId, summary, a.phone);
  return { booking_ref: apptId, version: 1, rendered_summary: summary };
}

async function mirrorIfConnected(tx: Tx, tenantId: string, staffId: string, appointmentId: string, version: number, now: Date) {
  const c = await tx.query(`select 1 from calendar_connections where resource_id = $1 and mirror_calendar_id is not null`, [staffId]);
  if (c.rowCount) await scheduleMirror(tx, tenantId, appointmentId, version, now);
}

export async function bookingsForCaller(tx: Tx, a: { phone: string | null; now: Date; tz: string }) {
  if (!a.phone) return { match: 'unverified' as const, bookings: [] };
  const r = await tx.query(
    `select ap.id, ap.version, ap.starts_at, sv.name from appointments ap
     join client_identities ci on ci.client_id = ap.client_id and ci.kind = 'phone' and ci.value_hash = $1
     join service_variants sv on sv.id = ap.variant_id
     where ap.status = 'booked' and ap.starts_at > $2 order by ap.starts_at limit 3`, [idHash(a.phone), a.now]);
  if (!r.rowCount) return { match: 'none' as const, bookings: [] };
  return {
    match: 'verified' as const,
    bookings: r.rows.map(x => {
      const lp = localParts((x.starts_at as Date).getTime(), a.tz);
      return { booking_ref: x.id, version: Number(x.version), service_name: x.name, day_time_local_th: renderDateTime(lp, lp, 'th'), day_time_local_en: renderDateTime(lp, lp, 'en') };
    }),
  };
}

export async function rescheduleBooking(tx: Tx, tenantId: string, a: {
  bookingRef: string; expectedVersion: number; holdRef: string; conf: Confirmation; now: Date;
  notify: (tx: Tx, kind: 'rescheduled', appointmentId: string, text: { th: string; en: string }, phone: string | null) => Promise<void>; phone: string | null;
}) {
  const ap = (await tx.query(`select * from appointments where id = $1 for update`, [a.bookingRef])).rows[0];
  if (!ap || ap.status !== 'booked') throw new ToolError('NOT_FOUND', 'booking');
  if (Number(ap.version) !== a.expectedVersion) throw new ToolError('VERSION_MISMATCH', 'booking changed');
  const pol = await policy(tx);
  if ((ap.starts_at as Date).getTime() - a.now.getTime() < pol.body.change_window_h * 3600_000) throw new ToolError('POLICY_BLOCKED', 'inside change window', 'not_allowed_by_policy');
  const h = await loadHold(tx, a.holdRef, a.conf);
  if (h.replaces_appointment !== a.bookingRef) throw new ToolError('VALIDATION_FAILED', 'hold was not made for this booking');
  // Release the old claims first, then secure the new one: one transaction, so a conflict rolls everything back.
  await lockResource(tx, h.staff_id);
  await tx.query(`update slot_claims set status = 'released' where (appointment_id = $1 or hold_ref = $2) and status = 'active'`, [a.bookingRef, a.holdRef]);
  try {
    await tx.query('savepoint move');
    await tx.query(`insert into slot_claims (tenant_id, id, resource_id, kind, span, appointment_id, status) values ($1,$2,$3,'booking',$4,$5,'active')`,
      [tenantId, uuid(), h.staff_id, h.claim_span, a.bookingRef]);
    await tx.query('release savepoint move');
  } catch (e: any) {
    await tx.query('rollback to savepoint move');
    if (e.code === '23P01') throw new ToolError('CONFLICT', 'new time no longer available', 'slot_taken');
    throw e;
  }
  const upd = await tx.query(
    `update appointments set starts_at = $2, ends_at = $3, variant_id = $4, version = version + 1 where id = $1 and version = $5 returning version`,
    [a.bookingRef, h.starts_at, h.ends_at, h.variant_id, a.expectedVersion]);
  if (!upd.rowCount) throw new ToolError('VERSION_MISMATCH', 'booking changed');
  await tx.query(`update holds set status = 'converted' where hold_ref = $1`, [a.holdRef]);
  await tx.query(`insert into appointment_events (tenant_id, id, appointment_id, kind, before, after, actor) values ($1,$2,$3,'rescheduled',$4,$5,'ai_runtime')`,
    [tenantId, uuid(), a.bookingRef, JSON.stringify({ starts_at: ap.starts_at }), JSON.stringify({ starts_at: h.starts_at })]);
  await audit(tx, tenantId, { machine: 'SM-5', entity: a.bookingRef, from: 'committing', to: 'rescheduled', event: 'rescheduled', actor: 'ai_runtime', at: a.now });
  await mirrorIfConnected(tx, tenantId, h.staff_id, a.bookingRef, Number(upd.rows[0].version), a.now);
  // The hold reads as a move ("ขอทวนนะคะ: เลื่อนนัด… ยืนยันเลื่อนนัดเลยไหมคะ"); the summary keeps both times, drops the question.
  const text = { th: h.rendered_th.replace(/^ขอทวนนะคะ: (เลื่อนนัด)?/, 'เลื่อนนัดเรียบร้อยแล้วค่ะ: ').replace(/ ยืน(ยันเลื่อนนัด|ยันจอง)เลยไหมคะ$/, ''),
    en: h.rendered_en.replace(/^To confirm: (moving your )?/, 'Moved: your ').replace(/\. Shall I (move|book) it\?$/, '.') };
  await a.notify(tx, 'rescheduled', a.bookingRef, text, a.phone);
  return { booking_ref: a.bookingRef, new_version: Number(upd.rows[0].version), rendered_summary: text };
}

export async function cancelBooking(tx: Tx, tenantId: string, a: {
  bookingRef: string; expectedVersion: number; now: Date; confirmed: boolean; conf?: Confirmation;
  notify: (tx: Tx, kind: 'cancelled', appointmentId: string, text: { th: string; en: string }, phone: string | null) => Promise<void>; phone: string | null;
}) {
  const ap = (await tx.query(`select * from appointments where id = $1 for update`, [a.bookingRef])).rows[0];
  if (!ap || ap.status !== 'booked') throw new ToolError('NOT_FOUND', 'booking');
  if (Number(ap.version) !== a.expectedVersion) throw new ToolError('VERSION_MISMATCH', 'booking changed');
  const pol = await policy(tx);
  const late = (ap.starts_at as Date).getTime() - a.now.getTime() < pol.body.change_window_h * 3600_000;
  const consequence = late && pol.body.cancel_text ? pol.body.cancel_text
    : late ? { th: 'ไม่มีนโยบายการยกเลิกในระบบ ทางร้านจะแจ้งเรื่องค่าธรรมเนียม (ถ้ามี) ให้ทราบค่ะ', en: "I don't have the cancellation policy on record; the team will confirm any fee." }
    : { th: '', en: '' };
  const when = localParts((ap.starts_at as Date).getTime(), (await location(tx)).time_zone);
  const v = await variant(tx, ap.variant_id);
  const sentence = {
    th: `ขอยืนยันการยกเลิก: ${v.name} ${renderDateTime(when, when, 'th')}${consequence.th ? ' ' + consequence.th : ''} ยืนยันยกเลิกไหมคะ`,
    en: `To confirm, you want to cancel ${v.name_en ?? v.name} on ${renderDateTime(when, when, 'en')}.${consequence.en ? ' ' + consequence.en : ''} Shall I cancel it?`,
  };
  if (!a.confirmed) return { needs_confirmation: true, policy_consequence_text: consequence, rendered_confirmation: sentence };
  const c = a.conf;
  if (!c || Buffer.from(c.spokenSha256, 'hex').compare(sha256(sentence.th + '\n' + sentence.en)) !== 0 || !(c.confirmTurn > c.spokenTurn)) {
    throw new ToolError('VALIDATION_FAILED', 'cancellation must follow its spoken confirmation');
  }
  const staffRow = (await tx.query(`select resource_id from slot_claims where appointment_id = $1 and status = 'active' limit 1`, [a.bookingRef])).rows[0];
  await tx.query(`update appointments set status = 'cancelled', version = version + 1 where id = $1`, [a.bookingRef]);
  if (staffRow) await mirrorIfConnected(tx, tenantId, staffRow.resource_id, a.bookingRef, a.expectedVersion + 1, a.now);
  await tx.query(`update slot_claims set status = 'released' where appointment_id = $1 and status = 'active'`, [a.bookingRef]);
  await tx.query(`insert into appointment_events (tenant_id, id, appointment_id, kind, before, actor) values ($1,$2,$3,'cancelled',$4,'ai_runtime')`,
    [tenantId, uuid(), a.bookingRef, JSON.stringify({ status: 'booked' })]);
  await audit(tx, tenantId, { machine: 'SM-6', entity: a.bookingRef, from: 'cancelling', to: 'cancelled', event: 'cancelled', actor: 'ai_runtime', detail: { policy_version: pol.version }, at: a.now });
  await a.notify(tx, 'cancelled', a.bookingRef, { th: 'ยกเลิกนัดเรียบร้อยแล้วค่ะ', en: 'Your booking is cancelled.' }, a.phone);
  return { booking_ref: a.bookingRef, version: a.expectedVersion + 1, policy_consequence_text: consequence };
}
