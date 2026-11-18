/**
 * In-memory stand-in for the Google Calendar API v3 subset we use (freebusy.query, events.insert/patch/list with
 * sync tokens). Shapes follow Google's documentation; behaviours modelled: client-chosen event ids (409 on a
 * duplicate), ETags, sync tokens that can expire (410 Gone), and 401 after the grant is revoked. Faults are injectable.
 */
import { ApiError, type CalendarApi } from '../src/connectors/calendar.ts';

type Ev = { id: string; etag: string; status: string; summary?: string; start: { dateTime: string }; end: { dateTime: string }; rev: number };

export class FakeGoogleCalendar implements CalendarApi {
  busy = new Map<string, Array<{ start: string; end: string }>>();    // calendarId → busy intervals (owner's own events)
  events = new Map<string, Map<string, Ev>>();                         // calendarId → events we mirrored
  revoked = false;
  rev = 0;
  tokens = new Map<string, number>();                                  // syncToken → revision it was issued at
  calls: string[] = [];
  private faults: Array<{ op: string; status: number; afterApply?: boolean }> = [];

  failNext(op: string, status: number, afterApply = false) { this.faults.push({ op, status, afterApply }); }
  expireSyncTokens() { this.tokens.clear(); }
  private fault(op: string) {
    const i = this.faults.findIndex(f => f.op === op);
    return i < 0 ? undefined : this.faults.splice(i, 1)[0];
  }
  private guard(op: string) {
    this.calls.push(op);
    if (this.revoked) throw new ApiError(401, 'invalid_grant');
    const f = this.fault(op);
    if (f && !f.afterApply) throw new ApiError(f.status, `${op} failed`);
    return f;
  }
  private cal(id: string) { if (!this.events.has(id)) this.events.set(id, new Map()); return this.events.get(id)!; }

  async freeBusy(req: { timeMin: string; timeMax: string; items: Array<{ id: string }> }) {
    this.guard('freeBusy');
    const lo = Date.parse(req.timeMin), hi = Date.parse(req.timeMax);
    const calendars: Record<string, { busy: Array<{ start: string; end: string }> }> = {};
    for (const { id } of req.items) calendars[id] = { busy: (this.busy.get(id) ?? []).filter(b => Date.parse(b.end) > lo && Date.parse(b.start) < hi) };
    return { calendars };
  }
  async insertEvent(calendarId: string, ev: { id: string; summary: string; start: { dateTime: string }; end: { dateTime: string } }) {
    const f = this.guard('insertEvent');
    const c = this.cal(calendarId);
    if (c.has(ev.id)) throw new ApiError(409, 'duplicate');
    const e: Ev = { ...ev, status: 'confirmed', etag: `"e${++this.rev}"`, rev: this.rev };
    c.set(ev.id, e);
    if (f?.afterApply) throw new ApiError(f.status, 'response lost after the write landed');
    return { id: e.id, etag: e.etag };
  }
  async patchEvent(calendarId: string, eventId: string, patch: Record<string, unknown>) {
    this.guard('patchEvent');
    const e = this.cal(calendarId).get(eventId);
    if (!e) throw new ApiError(404, 'not found');
    Object.assign(e, patch, { etag: `"e${++this.rev}"`, rev: this.rev });
    return { id: e.id, etag: e.etag };
  }
  /** The owner edits a mirrored event in Google Calendar (not through us). */
  ownerMoves(calendarId: string, eventId: string, start: string, end: string) {
    const e = this.cal(calendarId).get(eventId)!;
    Object.assign(e, { start: { dateTime: start }, end: { dateTime: end }, etag: `"e${++this.rev}"`, rev: this.rev });
  }
  async listEvents(calendarId: string, opts: { syncToken?: string }) {
    this.guard('listEvents');
    let since = 0;
    if (opts.syncToken) {
      if (!this.tokens.has(opts.syncToken)) throw new ApiError(410, 'Sync token is no longer valid, a full sync is required.');
      since = this.tokens.get(opts.syncToken)!;
    }
    const items = [...this.cal(calendarId).values()].filter(e => e.rev > since).map(({ rev, ...e }) => e);
    const token = `st${this.rev}-${Math.random().toString(36).slice(2, 8)}`;
    this.tokens.set(token, this.rev);
    return { items, nextSyncToken: token };
  }
}
