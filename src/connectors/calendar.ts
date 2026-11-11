/**
 * Google Calendar connector (SM-10, blueprint §7.8, §11.1). Least privilege: the owner's calendars are read only as
 * free/busy; our bookings are mirrored into a calendar the app itself created. Google Calendar is never the booking
 * authority: busy time becomes `external_busy` claims, mirror writes go through the outbox, and edits the owner makes
 * to mirrored events become staff tasks, never automatic changes to a client's booking (D-12).
 */
import type { Tx } from '../db.ts';
import { audit, sha256, uuid } from '../db.ts';
import { enqueue } from '../messaging/channels.ts';
import { schedule } from '../jobs.ts';
import { ToolError } from '../tools/errors.ts';

export const ALLOWED_SCOPES = [
  'https://www.googleapis.com/auth/calendar.app.created',
  'https://www.googleapis.com/auth/calendar.events.freebusy',
];

/** The subset of the Google Calendar API v3 we use, with Google's response shapes. Errors carry `status`. */
export type CalendarApi = {
  freeBusy(req: { timeMin: string; timeMax: string; items: Array<{ id: string }> }): Promise<{ calendars: Record<string, { busy: Array<{ start: string; end: string }>; errors?: unknown[] }> }>;
  insertEvent(calendarId: string, ev: { id: string; summary: string; start: { dateTime: string }; end: { dateTime: string } }): Promise<{ id: string; etag: string }>;
  patchEvent(calendarId: string, eventId: string, patch: Record<string, unknown>): Promise<{ id: string; etag: string }>;
  listEvents(calendarId: string, opts: { syncToken?: string }): Promise<{ items: Array<{ id: string; etag: string; status: string; start?: { dateTime: string }; end?: { dateTime: string } }>; nextSyncToken: string }>;
};
export class ApiError extends Error { status: number; constructor(status: number, msg: string) { super(msg); this.status = status; } }

/** Google event ids: base32hex characters (a–v, 0–9), 5–1024 long. Deterministic per appointment → retries cannot duplicate. */
export const eventIdFor = (appointmentId: string) => 'rcpt' + appointmentId.replace(/-/g, '').toLowerCase().replace(/[w-z]/g, c => String.fromCharCode(c.charCodeAt(0) - 22));

export async function connect(tx: Tx, tenantId: string, a: { resourceId: string; busyCalendarIds: string[]; mirrorCalendarId: string; grantedScopes: string[]; now: Date }) {
  const extra = a.grantedScopes.filter(s => !ALLOWED_SCOPES.includes(s));
  if (extra.length) throw new ToolError('VALIDATION_FAILED', `scopes wider than needed: ${extra.join(', ')}`); // TH-09
  const id = uuid();
  await tx.query(`insert into calendar_connections (tenant_id, id, provider, resource_id, busy_calendar_ids, mirror_calendar_id, scopes, status)
    values ($1,$2,'google',$3,$4,$5,$6,'connected')`, [tenantId, id, a.resourceId, a.busyCalendarIds, a.mirrorCalendarId, a.grantedScopes]);
  await audit(tx, tenantId, { machine: 'SM-10', entity: id, to: 'connected', event: 'connected', actor: 'owner', detail: { scopes: a.grantedScopes }, at: a.now });
  return id;
}

async function pause(tx: Tx, tenantId: string, conn: any, now: Date, why: string) {
  if (conn.status === 'paused_writes') return;
  await tx.query(`update calendar_connections set status = 'paused_writes', version = version + 1 where id = $1`, [conn.id]);
  const owner = (await tx.query(`select channel, value from owner_identities order by priority limit 1`)).rows[0];
  if (owner) await enqueue(tx, tenantId, { kind: owner.channel, key: `calendar:${conn.id}:paused:${now.getTime()}`, to: owner.value, exempt: true, now,
    sender: owner.channel === 'line' ? 'LINE:O2-Receptionist' : (await tx.query(`select sender from senders where tenant_id = $1 and channel = 'sms'`, [tenantId])).rows[0].sender,
    body: 'ปฏิทิน Google หลุดการเชื่อมต่อ — AI จะรับเป็นคำขอจองแทนการจอง จนกว่าจะเชื่อมต่อใหม่ / Your Google Calendar disconnected: the AI takes booking requests, not bookings, until you reconnect' });
  await audit(tx, tenantId, { machine: 'SM-10', entity: conn.id, from: conn.status, to: 'paused_writes', event: why, actor: 'provider:google', at: now });
}

/**
 * Busy-time sync. Returns `unavailable` when the calendar cannot be read (then no time may be offered for that
 * staff member — we cannot be sure they are free).
 */
export async function syncBusy(tx: Tx, tenantId: string, api: CalendarApi, now: Date, horizonDays = 62) {
  const conns = (await tx.query(`select * from calendar_connections`)).rows;
  const out: Record<string, string> = {};
  for (const conn of conns) {
    let fb;
    try {
      fb = await api.freeBusy({ timeMin: now.toISOString(), timeMax: new Date(now.getTime() + horizonDays * 86_400_000).toISOString(), items: conn.busy_calendar_ids.map((id: string) => ({ id })) });
    } catch (e: any) {
      if (e.status === 401 || e.status === 403) await pause(tx, tenantId, conn, now, 'auth_revoked');
      out[conn.id] = 'unavailable';
      continue;
    }
    await tx.query(`update slot_claims set status = 'released' where resource_id = $1 and kind = 'external_busy' and status = 'active'`, [conn.resource_id]);
    let conflicts = 0;
    for (const cal of Object.values(fb.calendars)) for (const b of cal.busy) {
      const span = `[${b.start},${b.end})`;
      try {
        await tx.query('savepoint busy');
        await tx.query(`insert into slot_claims (tenant_id, id, resource_id, kind, span, status) values ($1,$2,$3,'external_busy',$4,'active')`, [tenantId, uuid(), conn.resource_id, span]);
        await tx.query('release savepoint busy');
      } catch (e: any) {
        await tx.query('rollback to savepoint busy');
        if (e.code !== '23P01') throw e;
        // The owner's own event overlaps a booking or hold we already have: keep the booking, tell staff (§11.4 row 2).
        conflicts++;
        const over = (await tx.query(`select appointment_id from slot_claims where resource_id = $1 and status = 'active' and kind in ('booking','hold') and span && $2::tstzrange`,
          [conn.resource_id, span])).rows.map(r => r.appointment_id);
        await tx.query(`insert into staff_tasks (tenant_id, id, kind, ref, detail, created_at) values ($1,$2,'calendar_conflict',$3,$4,$5)`,
          [tenantId, uuid(), String(over[0] ?? ''), JSON.stringify({ busy: b, appointments: over }), now]);
      }
    }
    await tx.query(`update calendar_connections set last_busy_sync_at = $2, status = 'connected' where id = $1`, [conn.id, now]);
    out[conn.id] = conflicts ? `synced_with_${conflicts}_conflicts` : 'synced';
  }
  return out;
}

/** Availability may only be offered when every busy source is connected and fresh (≤ 30 min). */
export async function calendarReady(tx: Tx, staffId: string, now: Date) {
  const c = (await tx.query(`select status, last_busy_sync_at from calendar_connections where resource_id = $1`, [staffId])).rows[0];
  if (!c) return true;
  return c.status === 'connected' && c.last_busy_sync_at && now.getTime() - (c.last_busy_sync_at as Date).getTime() <= 30 * 60_000;
}

/** Outbox handler body for a mirror write (create, move or cancel). Idempotent by deterministic event id. */
export async function mirror(tx: Tx, tenantId: string, api: CalendarApi, appointmentId: string, now: Date) {
  const conn = (await tx.query(`select * from calendar_connections where resource_id = (select resource_id from slot_claims where appointment_id = $1 order by created_at desc limit 1)`, [appointmentId])).rows[0];
  if (!conn?.mirror_calendar_id) return 'no_mirror';
  if (conn.status === 'paused_writes') throw new ApiError(401, 'connection paused');
  const ap = (await tx.query(`select a.*, v.name from appointments a join service_variants v on v.id = a.variant_id where a.id = $1`, [appointmentId])).rows[0];
  const evId = eventIdFor(appointmentId);
  const body = { id: evId, summary: `${ap.name} (จองผ่าน AI)`, start: { dateTime: (ap.starts_at as Date).toISOString() }, end: { dateTime: (ap.ends_at as Date).toISOString() } };
  const map = (await tx.query(`select * from external_mappings where connector = 'google' and local_kind = 'appointment' and local_id = $1`, [appointmentId])).rows[0];
  let res: { id: string; etag: string };
  try {
    if (!map) res = await api.insertEvent(conn.mirror_calendar_id, body);
    else res = await api.patchEvent(conn.mirror_calendar_id, evId, ap.status === 'cancelled' ? { status: 'cancelled' } : { start: body.start, end: body.end });
  } catch (e: any) {
    if (e.status === 409 && !map) res = await api.patchEvent(conn.mirror_calendar_id, evId, { start: body.start, end: body.end }); // our earlier insert landed
    else { if (e.status === 401 || e.status === 403) await pause(tx, tenantId, conn, now, 'auth_revoked'); throw e; }
  }
  await tx.query(`insert into external_mappings (tenant_id, connector, local_kind, local_id, external_id, external_etag, last_synced_at)
    values ($1,'google','appointment',$2,$3,$4,$5) on conflict (tenant_id, connector, local_kind, local_id) do update set external_etag = excluded.external_etag, last_synced_at = excluded.last_synced_at`,
    [tenantId, appointmentId, res.id, res.etag, now]);
  return map ? 'patched' : 'inserted';
}

/** Changes in the mirror calendar since the last sync token. Owner edits to our events become staff tasks. 410 → full resync. */
export async function pullMirrorChanges(tx: Tx, tenantId: string, api: CalendarApi, now: Date) {
  const conn = (await tx.query(`select * from calendar_connections where mirror_calendar_id is not null limit 1`)).rows[0];
  if (!conn) return { changes: 0 };
  let page, full = false;
  try {
    page = await api.listEvents(conn.mirror_calendar_id, conn.sync_token ? { syncToken: conn.sync_token } : {});
  } catch (e: any) {
    if (e.status !== 410) throw e;
    full = true;
    page = await api.listEvents(conn.mirror_calendar_id, {});
  }
  let tasks = 0;
  for (const it of page.items) {
    const map = (await tx.query(`select local_id, external_etag from external_mappings where connector = 'google' and external_id = $1`, [it.id])).rows[0];
    if (!map || map.external_etag === it.etag) continue;
    const ap = (await tx.query(`select starts_at, ends_at, status from appointments where id = $1`, [map.local_id])).rows[0];
    const moved = it.status !== 'cancelled' && it.start && new Date(it.start.dateTime).getTime() !== (ap.starts_at as Date).getTime();
    if (it.status === 'cancelled' || moved) {
      tasks++;
      await tx.query(`insert into staff_tasks (tenant_id, id, kind, ref, detail, created_at) values ($1,$2,'confirm_calendar_edit',$3,$4,$5)`,
        [tenantId, uuid(), map.local_id, JSON.stringify({ calendar: it, booking: ap }), now]);
    }
  }
  await tx.query(`update calendar_connections set sync_token = $2 where id = $1`, [conn.id, page.nextSyncToken]);
  return { changes: page.items.length, staff_tasks: tasks, full_resync: full };
}

/** Watch-channel notification: the token we set when creating the channel must match (stored hashed). */
export async function verifyWatch(tx: Tx, channelId: string, token: string) {
  const c = (await tx.query(`select watch_token_hash from calendar_connections where watch_channel_id = $1`, [channelId])).rows[0];
  return !!c && Buffer.compare(sha256(token), c.watch_token_hash) === 0;
}

export async function scheduleMirror(tx: Tx, tenantId: string, appointmentId: string, version: number, now: Date) {
  await schedule(tx, tenantId, 'calendar_mirror', appointmentId, now, `calendar_mirror:${appointmentId}:v${version}`);
}
