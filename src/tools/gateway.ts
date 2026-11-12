/**
 * Tool Gateway (blueprint §9). The voice runtime calls tools with (call token, model args, runtime meta).
 * The envelope — tenant, conversation, caller id, config version — comes only from the signed token.
 */
import type { Tx } from '../db.ts';
import { audit, idHash, sha256, uuid, withTenant } from '../db.ts';
import { ToolError } from './errors.ts';
import { validate, type Schema } from './schema.ts';
import { verifyCallToken, type CallClaims } from './token.ts';
import * as B from '../booking/engine.ts';
import { resolveWhen } from '../time/resolve.ts';
import { addDays, isoWeekday, localParts } from '../time/zone.ts';
import { businessFacts } from '../knowledge.ts';
import { enqueue, isOptedOut, optOutFooter, recordConsent } from '../messaging/channels.ts';
import { createPendingQuestion, OWNER_LINE_SENDER } from '../escalation/pq.ts';
import { calendarReady } from '../connectors/calendar.ts';
import { safetyGate, cleanSummary } from '../escalation/safety.ts';

/** Runtime-supplied facts the model never controls (turn order, spoken text hashes, versions it read earlier). */
export type Meta = {
  spoken_confirmation_sha256?: string; spoken_turn?: number; confirm_turn?: number; expected_version?: number;
  /** The caller's turn that said yes to a confirmation text (runtime evidence, never the model's flag alone). */
  text_consent_turn?: number;
  utterance_turn_ref?: string; recording_offset_ms?: number;
  transfer_sim?: { eligible: boolean; answered: boolean; dtmf: string | null; machine?: boolean };
};

const S = (properties: Schema['properties'], required: string[] = []): Schema => ({ type: 'object', properties, required });
const SCHEMAS: Record<string, Schema> = {
  get_business_facts: S({ question: { type: 'string', maxLength: 300 }, topic_hint: { type: 'string', enum: ['hours', 'location', 'parking', 'services', 'prices', 'policies', 'staff', 'payment_methods', 'other'] } }, ['question']),
  get_client_context: S({}),
  search_availability: S({ variant_ref: { type: 'string', maxLength: 80 }, date_phrase: { type: 'string', maxLength: 80 }, staff_ref: { type: 'string', maxLength: 80 },
    max_options: { type: 'integer', minimum: 1, maximum: 3 }, for_booking_ref: { type: 'string', maxLength: 64 } }, ['variant_ref', 'date_phrase']),
  hold_slot: S({ slot_token: { type: 'string', maxLength: 1000 }, client_name: { type: 'string', maxLength: 80 }, for_booking_ref: { type: 'string', maxLength: 64 } }, ['slot_token']),
  release_hold: S({ hold_ref: { type: 'string', maxLength: 64 } }, ['hold_ref']),
  create_booking: S({ hold_ref: { type: 'string', maxLength: 64 }, client_name: { type: 'string', maxLength: 80 }, send_confirmation_text: { type: 'boolean' } }, ['hold_ref', 'client_name']),
  get_bookings_for_caller: S({}),
  reschedule_booking: S({ booking_ref: { type: 'string', maxLength: 64 }, hold_ref: { type: 'string', maxLength: 64 }, send_confirmation_text: { type: 'boolean' } }, ['booking_ref', 'hold_ref']),
  cancel_booking: S({ booking_ref: { type: 'string', maxLength: 64 }, confirmed: { type: 'boolean' }, send_confirmation_text: { type: 'boolean' } }, ['booking_ref', 'confirmed']),
  record_consent: S({ purpose: { type: 'string', enum: ['service_followup'] }, target: { type: 'string', enum: ['ani', 'other_number'] },
    number: { type: 'string', maxLength: 20 }, question_text: { type: 'string', maxLength: 300 } }, ['purpose', 'target', 'question_text']),
  request_owner_answer: S({ question_text: { type: 'string', maxLength: 300 }, summary_source: { type: 'string', enum: ['model', 'caller_words'] },
    reply_target: { type: 'object', properties: { kind: { type: 'string', enum: ['ani', 'other_number'] }, number: { type: 'string', maxLength: 20 } }, required: ['kind'] },
    caller_preferred_name: { type: 'string', maxLength: 60 }, context_line: { type: 'string', maxLength: 160 }, variant_ref: { type: 'string', maxLength: 80 } },
    ['question_text', 'summary_source', 'reply_target']),
  // Runtime-only, never offered to the model: the confirmation text the caller said yes to when the runtime offered it.
  send_booking_text: S({ booking_ref: { type: 'string', maxLength: 64 } }, ['booking_ref']),
  log_booking_request: S({ variant_ref: { type: 'string', maxLength: 80 }, date_phrase: { type: 'string', maxLength: 80 }, client_name: { type: 'string', maxLength: 80 } }, ['variant_ref', 'date_phrase']),
  request_human_transfer: S({ reason: { type: 'string', enum: ['caller_asked', 'unknown_question', 'sensitive', 'frustration', 'tool_failure'] }, topic: { type: 'string', maxLength: 80 } }, ['reason', 'topic']),
};
export const TOOLS = Object.keys(SCHEMAS);

/** Thai mobile (+66 6/8/9 …, 9 digits after 0) or US NANP. Premium/short codes rejected. */
export function normalisePhone(raw: string, country: 'TH' | 'US'): string | null {
  const d = raw.replace(/[๐-๙]/g, c => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(c))).replace(/[^\d+]/g, '');
  if (country === 'TH') {
    const local = d.startsWith('+66') ? '0' + d.slice(3) : d.startsWith('66') ? '0' + d.slice(2) : d;
    return /^0[689]\d{8}$/.test(local) ? '+66' + local.slice(1) : null;
  }
  const us = d.replace(/^\+?1/, '');
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(us) ? '+1' + us : null;
}

async function resolveVariant(tx: Tx, ref: string) {
  const r = await tx.query(`select id from service_variants where id::text = $1 or lower(name) = lower($1) or lower($1) = any(select lower(a) from unnest(aliases) a)`, [ref]);
  // Say what was not found and what there is: a bare NOT_FOUND was read as "no free times" (Gemma 4 12B searched for
  // "นวดเท้า 60" — the menu has 45 — and told the caller ten times that nothing was free, 13 Nov 2026).
  if (r.rowCount !== 1) {
    const menu = (await tx.query(`select name from service_variants order by name`)).rows.map(x => x.name);
    if (!r.rowCount) throw new ToolError('NOT_FOUND', 'variant', 'need_more_detail',
      { not_found: 'service', given: ref, menu, note: 'No service has that name. This is not about free times: pick one from the menu with the caller.' });
    throw new ToolError('AMBIGUOUS', 'several variants match', 'need_more_detail', { ambiguous: 'service', given: ref, menu });
  }
  return B.variant(tx, r.rows[0].id);
}

async function smsSenderOf(tx: Tx, tenantId: string) {
  return (await tx.query(`select sender, two_way from senders where tenant_id = $1 and channel = 'sms'`, [tenantId])).rows[0] as { sender: string; two_way: boolean } | undefined;
}

/** Whether this caller can be texted at all: a valid mobile for the country, a sender, no STOP. */
async function canText(tx: Tx, c: CallClaims) {
  const to = c.ani ? normalisePhone(c.ani, c.jurisdiction) : null, s = await smsSenderOf(tx, c.tenant_id);
  return !!(to && s && !(await isOptedOut(tx, s.sender, to, 'sms')));
}

/** Booking notices: owner on LINE; client by SMS only if the caller said yes and has not opted out. */
function notifier(c: CallClaims, now: Date, sendClient: boolean) {
  return async (tx: Tx, kind: string, apptId: string, text: { th: string; en: string }, phone: string | null) => {
    const owner = (await tx.query(`select id, channel, value from owner_identities order by priority limit 1`)).rows[0];
    if (owner) await enqueue(tx, c.tenant_id, { kind: owner.channel, key: `appt:${apptId}:${kind}:owner`, to: owner.value,
      sender: owner.channel === 'line' ? OWNER_LINE_SENDER : (await smsSenderOf(tx, c.tenant_id))!.sender, exempt: true, now,
      body: `${kind === 'booked' ? 'จองใหม่โดย AI' : kind === 'rescheduled' ? 'เลื่อนนัดโดย AI' : 'ยกเลิกนัดโดย AI'}: ${text.th} · ลูกค้า …${(phone ?? '').slice(-4)}`,
      meta: { appointment_id: apptId, purpose: `appt_${kind}` } });
    const s = await smsSenderOf(tx, c.tenant_id);
    if (sendClient && phone && s && !(await isOptedOut(tx, s.sender, phone, 'sms'))) {
      const name = (await tx.query('select name from locations limit 1')).rows[0].name;
      const footer = await optOutFooter(tx, c.tenant_id, phone, c.lang, s.two_way, now);
      await enqueue(tx, c.tenant_id, { kind: 'sms', key: `appt:${apptId}:${kind}:client`, to: phone, sender: s.sender, now, body: `${name}: ${c.lang === 'th' ? text.th : text.en}${footer}`,
        meta: { appointment_id: apptId, purpose: `appt_${kind}_client` } });
    }
  };
}

async function idempotent(tx: Tx, key: string, tool: string, request: unknown, run: () => Promise<unknown>) {
  const hash = sha256(JSON.stringify(request));
  const ins = await tx.query(`insert into idempotency_keys (tenant_id, key, tool, request_sha256, status)
    values (app_tenant(), $1, $2, $3, 'in_flight') on conflict do nothing returning key`, [key, tool, hash]);
  if (!ins.rowCount) {
    const row = (await tx.query(`select request_sha256, response, status from idempotency_keys where key = $1`, [key])).rows[0];
    if (Buffer.compare(row.request_sha256, hash) !== 0) throw new ToolError('VALIDATION_FAILED', 'idempotency key reused with a different request');
    if (row.status === 'done') return row.response;
    throw new ToolError('RATE_LIMITED', 'same request in flight', 'try_again');
  }
  const out = await run();
  await tx.query(`update idempotency_keys set status = 'done', response = $2 where key = $1`, [key, JSON.stringify(out)]);
  return out;
}

const confirmation = (m: Meta, now: Date): B.Confirmation => {
  if (!m.spoken_confirmation_sha256 || m.spoken_turn === undefined || m.confirm_turn === undefined) {
    throw new ToolError('VALIDATION_FAILED', 'confirmation evidence missing');
  }
  return { spokenSha256: m.spoken_confirmation_sha256, spokenTurn: m.spoken_turn, confirmTurn: m.confirm_turn, confirmedAt: now };
};

export type ToolResult = { ok: true; data: any } | { ok: false; error: { code: string; retryable: boolean; speakable_hint: string } };

export async function callTool(token: string, tool: string, args: unknown, meta: Meta, now: Date): Promise<ToolResult> {
  const t0 = performance.now();
  let claims: CallClaims | undefined;
  let result: ToolResult;
  try {
    claims = verifyCallToken(token, now);
    if (!SCHEMAS[tool]) throw new ToolError('VALIDATION_FAILED', `unknown tool ${tool}`);
    validate(args, SCHEMAS[tool]);
    const c = claims, a = args as Record<string, any>;
    // Deadlock (40P01) and serialisation (40001) failures roll the whole transaction back; every write is
    // idempotent, so retrying the tool is safe.
    let data: unknown;
    for (let attempt = 0; ; attempt++) {
      try {
        data = await withTenant(c.tenant_id, async tx => {
          const conv = (await tx.query(`select status from conversations where id = $1`, [c.conversation_id])).rows[0];
          if (!conv || conv.status === 'closed') throw new ToolError('AUTH_EXPIRED', 'conversation closed');
          return dispatch(tx, c, tool, a, meta, now);
        });
        break;
      } catch (e: any) {
        if (attempt < 2 && (e?.code === '40P01' || e?.code === '40001')) continue;
        throw e;
      }
    }
    result = { ok: true, data };
  } catch (e) {
    if (e instanceof ToolError) result = e.toResult();
    else throw e;
  }
  if (claims) {
    const c = claims;
    await withTenant(c.tenant_id, tx => tx.query(
      `insert into tool_calls (tenant_id, id, conversation_id, tool, args_redacted, result_status, error_code, latency_ms, at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [c.tenant_id, uuid(), c.conversation_id, tool, JSON.stringify(redact(args)), result.ok ? 'ok' : 'error', result.ok ? null : result.error.code,
       Math.round(performance.now() - t0), now]));
  }
  return result;
}

const redact = (a: unknown) => JSON.parse(JSON.stringify(a ?? {}, (k, v) => (['number', 'slot_token', 'client_name', 'caller_preferred_name', 'question_text', 'question'].includes(k) ? '[redacted]' : v)));

async function dispatch(tx: Tx, c: CallClaims, tool: string, a: Record<string, any>, m: Meta, now: Date): Promise<unknown> {
  switch (tool) {
    case 'get_business_facts':
      return businessFacts(tx, a.question, now, c.lang);

    case 'get_client_context': {
      if (!c.ani) return { identity_status: 'unknown' };
      const r = await tx.query(`select cl.preferred_name from client_identities ci join clients cl on cl.id = ci.client_id where ci.kind = 'phone' and ci.value_hash = $1`, [idHash(c.ani)]);
      const f = await tx.query(`select 1 from appointments ap join client_identities ci on ci.client_id = ap.client_id where ci.value_hash = $1 and ap.status = 'booked' and ap.starts_at > $2 limit 1`, [idHash(c.ani), now]);
      return { identity_status: r.rowCount ? 'verified_ani' : 'unknown', preferred_name: r.rows[0]?.preferred_name, has_future_bookings: !!f.rowCount, language_preference: c.lang };
    }

    case 'search_availability': {
      const loc = await B.location(tx), pol = (await B.policy(tx)).body, v = await resolveVariant(tx, a.variant_ref);
      const staffRow = a.staff_ref ? (await tx.query(`select id from resources where kind = 'staff' and (id::text = $1 or lower(display_name) = lower($1))`, [a.staff_ref])).rows[0] : undefined;
      if (a.staff_ref && !staffRow) throw new ToolError('NOT_FOUND', 'staff', 'need_more_detail');
      const qualified = await B.qualifiedStaff(tx, v.id, staffRow?.id);
      if (!qualified.length) throw new ToolError('POLICY_BLOCKED', 'no qualified staff', 'not_allowed_by_policy');
      // A staff member whose calendar is disconnected or stale may be busy: never offer them (SM-10, AT-35).
      const staff = [];
      for (const st of qualified) if (await calendarReady(tx, st.id, now)) staff.push(st);
      if (!staff.length) throw new ToolError('CONNECTOR_UNAVAILABLE', 'calendar not available', 'system_trouble');
      const weekly = (await tx.query(`select weekday, opens::text o, closes::text c from business_hours where resource_id is null`)).rows;
      const toT = (x: string) => ({ h: +x.slice(0, 2), mi: +x.slice(3, 5) });
      const hoursOn = (d: { y: number; m: number; d: number }) => weekly.filter(w => w.weekday === isoWeekday(d)).map(w => ({ from: toT(w.o), to: toT(w.c) }));
      const r = resolveWhen(a.date_phrase, { nowUtcMs: now.getTime(), tz: loc.time_zone, hoursOn });
      if (r.status !== 'ok') return { needs_clarification: r.reason, clarification_options: r.options ?? [], options: [] };
      if (a.for_booking_ref) await mustOwnBooking(tx, c, a.for_booking_ref, now);
      const base = { variant: v, staff, now, tz: loc.time_zone, pol, excludeAppointment: a.for_booking_ref };
      const exact = await B.availableOn(tx, { ...base, date: r.date, exact: r.time, window: r.window });
      const chosen = B.spread(exact, a.max_options ?? 3);
      if (chosen.length) return { status: r.time ? 'exact_available' : 'options', options: chosen.map(o => B.toOption(c.tenant_id, v, o, r.date, now)) };
      // SM-4: widen — same day within ±2 h of the asked time (nearest first), then the same time/window on the next 7 days.
      const alts: any[] = [];
      if (r.time) {
        const want = r.time.h * 60 + r.time.mi, dist = (o: any) => Math.abs(o.t.h * 60 + o.t.mi - want);
        alts.push(...(await B.availableOn(tx, { ...base, date: r.date })).filter(o => dist(o) <= 120).sort((x, y) => dist(x) - dist(y)).map(o => ({ ...o, d: r.date })));
      }
      for (let i = 1; alts.length < 3 && i <= 7; i++) {
        const d = addDays(r.date, i);
        alts.push(...(await B.availableOn(tx, { ...base, date: d, window: r.window, exact: r.time })).map(o => ({ ...o, d })));
      }
      const picked = B.spread(alts, 3);
      return { status: picked.length ? 'unavailable_with_alternatives' : 'none_found', options: picked.map((o: any) => B.toOption(c.tenant_id, v, o, o.d, now)) };
    }

    case 'hold_slot':
      if (a.for_booking_ref) await mustOwnBooking(tx, c, a.for_booking_ref, now);
      return idempotent(tx, `hold:${c.conversation_id}:${sha256(a.slot_token).toString('hex').slice(0, 24)}`, tool, a, () =>
        B.holdSlot(tx, c.tenant_id, { slotToken: a.slot_token, conversationId: c.conversation_id, clientName: a.client_name, now, replacesAppointment: a.for_booking_ref }));

    case 'release_hold':
      return B.releaseHold(tx, c.tenant_id, a.hold_ref, now);

    case 'create_booking':
      return idempotent(tx, `book:${c.conversation_id}:${a.hold_ref}`, tool, a, async () => {
        const conf = confirmation(m, now);
        // A text only with the runtime's evidence of the caller's own yes (Gemma 4 12B set the flag unasked, 12 Nov 2026).
        const text = !!a.send_confirmation_text && m.text_consent_turn !== undefined && !!c.ani;
        if (text) {
          const s = await smsSenderOf(tx, c.tenant_id);
          if (s) await recordConsent(tx, c.tenant_id, { sender: s.sender, target: c.ani!, channel: 'sms', purpose: 'transactional', scopeRef: `booking_confirmation:${a.hold_ref}`,
            evidence: { turn: m.text_consent_turn, conversation: c.conversation_id }, now });
        }
        const r = await B.createBooking(tx, c.tenant_id, { holdRef: a.hold_ref, clientName: a.client_name, phone: c.ani, conversationId: c.conversation_id, conf, now,
          configVersion: c.config_version, notify: notifier(c, now, text) as any });
        return { ...r, text_queued: text, can_text: await canText(tx, c) };
      });

    case 'get_bookings_for_caller':
      return B.bookingsForCaller(tx, { phone: c.ani, now, tz: (await B.location(tx)).time_zone });

    case 'reschedule_booking': {
      if (m.expected_version === undefined) throw new ToolError('VALIDATION_FAILED', 'expected_version required');
      await mustOwnBooking(tx, c, a.booking_ref, now);
      return idempotent(tx, `resched:${a.booking_ref}:${a.hold_ref}`, tool, a, async () => {
        const text = await transactionalYes(tx, c, a, m, `reschedule:${a.booking_ref}`, now);
        const r = await B.rescheduleBooking(tx, c.tenant_id, { bookingRef: a.booking_ref, expectedVersion: m.expected_version!, holdRef: a.hold_ref, conf: confirmation(m, now), now,
          notify: notifier(c, now, text) as any, phone: c.ani });
        return { ...r, text_queued: text, can_text: await canText(tx, c) };
      });
    }

    case 'send_booking_text': {
      // The runtime offered a confirmation text after the booking and the caller said yes (text_consent_turn); the
      // model never sees this tool.
      if (m.text_consent_turn === undefined || !c.ani) throw new ToolError('CONSENT_REQUIRED', 'no yes to a text', 'cannot_text_number');
      await mustOwnBooking(tx, c, a.booking_ref, now);
      return idempotent(tx, `booktext:${a.booking_ref}:${c.conversation_id}`, tool, a, async () => {
        const to = normalisePhone(c.ani!, c.jurisdiction), s = await smsSenderOf(tx, c.tenant_id);
        if (!to || !s || await isOptedOut(tx, s.sender, to, 'sms')) throw new ToolError('CONSENT_REQUIRED', 'cannot text this number', 'cannot_text_number');
        await recordConsent(tx, c.tenant_id, { sender: s.sender, target: to, channel: 'sms', purpose: 'transactional', scopeRef: `booking_text:${a.booking_ref}`,
          evidence: { turn: m.text_consent_turn, conversation: c.conversation_id }, now });
        const summary = await B.bookingSummary(tx, a.booking_ref);
        const name = (await tx.query('select name from locations limit 1')).rows[0].name;
        const footer = await optOutFooter(tx, c.tenant_id, to, c.lang, s.two_way, now);
        await enqueue(tx, c.tenant_id, { kind: 'sms', key: `appt:${a.booking_ref}:text:${c.conversation_id}`, to, sender: s.sender, now,
          body: `${name}: ${c.lang === 'th' ? summary.th : summary.en}${footer}`, meta: { appointment_id: a.booking_ref, purpose: 'appt_confirmation_client' } });
        return { queued: true };
      });
    }

    case 'cancel_booking': {
      if (m.expected_version === undefined) throw new ToolError('VALIDATION_FAILED', 'expected_version required');
      await mustOwnBooking(tx, c, a.booking_ref, now);
      const conf = a.confirmed ? confirmation(m, now) : undefined;
      const run = async () => B.cancelBooking(tx, c.tenant_id, { bookingRef: a.booking_ref, expectedVersion: m.expected_version!, now, confirmed: a.confirmed, conf,
        notify: notifier(c, now, a.confirmed ? await transactionalYes(tx, c, a, m, `cancel:${a.booking_ref}`, now) : false) as any, phone: c.ani });
      return a.confirmed ? idempotent(tx, `cancel:${a.booking_ref}:${m.expected_version}`, tool, a, run) : run();
    }

    case 'record_consent': {
      const target = normalisePhone((a.target === 'ani' ? c.ani : a.number) ?? '', c.jurisdiction);
      if (!target) throw new ToolError('VALIDATION_FAILED', 'no valid number', 'cannot_text_number');
      const s = await smsSenderOf(tx, c.tenant_id);
      if (!s) throw new ToolError('CONSENT_REQUIRED', 'no SMS sender registered', 'cannot_text_number');
      if (await isOptedOut(tx, s.sender, target, 'sms')) throw new ToolError('CONSENT_REQUIRED', 'prior STOP', 'cannot_text_number');
      const q = cleanSummary(a.question_text);
      const id = await recordConsent(tx, c.tenant_id, { sender: s.sender, target, channel: 'sms', purpose: 'service_followup',
        scopeRef: `pending_question:${c.conversation_id}:${sha256(q).toString('hex').slice(0, 16)}`,
        evidence: { turn: m.utterance_turn_ref ?? null, recording_offset_ms: m.recording_offset_ms ?? null, conversation: c.conversation_id, policy: 'consent-v1-draft (D-07)' },
        now, expiresAt: new Date(now.getTime() + 24 * 3600_000 + 48 * 3600_000 + 3600_000) });
      return { consent_ref: id, target_last_digits: target.slice(-2) };
    }

    case 'request_owner_answer': {
      const q = cleanSummary(a.question_text);
      const gate = await safetyGate(q);
      if (gate.tier === 'E' || gate.tier === 'P') throw new ToolError('VALIDATION_FAILED', `question tier ${gate.tier}`, 'needs_person');
      const target = normalisePhone((a.reply_target.kind === 'ani' ? c.ani : a.reply_target.number) ?? '', c.jurisdiction);
      if (!target) throw new ToolError('VALIDATION_FAILED', 'no valid number', 'cannot_text_number');
      const consent = (await tx.query(`select id from consents where scope_ref = $1 and target_hash = $2 and state = 'granted' order by granted_at desc limit 1`,
        [`pending_question:${c.conversation_id}:${sha256(q).toString('hex').slice(0, 16)}`, idHash(target)])).rows[0];
      if (!consent) throw new ToolError('CONSENT_REQUIRED', 'no consent for this question', 'cannot_text_number');
      const variantId = a.variant_ref ? (await resolveVariant(tx, a.variant_ref)).id : undefined;
      return idempotent(tx, `pq:${c.conversation_id}:${sha256(q).toString('hex').slice(0, 24)}`, tool, a, () =>
        createPendingQuestion(tx, c.tenant_id, { conversationId: c.conversation_id, questionText: q, summarySource: a.summary_source, tier: gate.tier as 'N' | 'S',
          category: gate.category, callerName: a.caller_preferred_name, target, ani: c.ani ? normalisePhone(c.ani, c.jurisdiction) : null, consentId: consent.id, lang: c.lang, contextLine: a.context_line,
          linkedVariantId: variantId, now }));
    }

    case 'log_booking_request': {
      // SM-3 request_fallback: a request for staff to confirm, never a booking. The caller is told so in [CODE].
      const id = uuid();
      await tx.query(`insert into staff_tasks (tenant_id, id, kind, ref, detail, created_at) values ($1,$2,'booking_request',$3,$4,$5)`,
        [c.tenant_id, id, c.conversation_id, JSON.stringify({ variant: a.variant_ref, when: a.date_phrase, name: a.client_name ?? null, phone: c.ani }), now]);
      const owner = (await tx.query(`select channel, value from owner_identities order by priority limit 1`)).rows[0];
      if (owner) await enqueue(tx, c.tenant_id, { kind: owner.channel, key: `booking_request:${id}`, to: owner.value, exempt: true, now,
        sender: owner.channel === 'line' ? OWNER_LINE_SENDER : (await smsSenderOf(tx, c.tenant_id))!.sender,
        body: `คำขอจอง (ยังไม่ใช่การจอง): ${a.variant_ref} · ${a.date_phrase} · ลูกค้า …${(c.ani ?? '').slice(-4)} — โทรกลับเพื่อยืนยัน / Booking request, not a booking: call back to confirm` });
      return { request_ref: id, speakable: c.lang === 'th' ? 'ตอนนี้ดิฉันยืนยันการจองไม่ได้ค่ะ ส่งคำขอให้ทีมงานแล้ว นี่ยังไม่ใช่การจองนะคะ ทีมงานจะติดต่อกลับเพื่อยืนยันค่ะ'
        : "I can't confirm bookings right now. I've passed your request to the team; this is not a confirmed booking yet. They'll contact you to confirm." };
    }

    case 'request_human_transfer': {
      const sim = m.transfer_sim ?? { eligible: false, answered: false, dtmf: null };
      if (!sim.eligible) throw new ToolError('POLICY_BLOCKED', 'no person available now', 'needs_person');
      // INV-09: only a DTMF "1" in screening proves a human took the call; "answered" alone (voicemail, IVR) does not.
      const outcome = !sim.answered ? 'no_answer' : sim.dtmf === '1' ? 'bridged' : sim.machine ? 'machine' : sim.dtmf === '2' ? 'declined' : 'no_answer';
      await audit(tx, c.tenant_id, { machine: 'SM-9', entity: c.conversation_id, to: outcome === 'bridged' ? 'bridged' : 'returning', event: `transfer_${outcome}`,
        actor: 'provider:sim', detail: { reason: a.reason, dtmf: sim.dtmf }, at: now });
      return { eligible: true, outcome };
    }
  }
  throw new ToolError('VALIDATION_FAILED', 'unhandled tool');
}

/** Record transactional consent when the caller said yes to a text about this change (SM-11); otherwise no text. */
async function transactionalYes(tx: Tx, c: CallClaims, a: Record<string, any>, m: Meta, scope: string, now: Date): Promise<boolean> {
  if (!a.send_confirmation_text || m.text_consent_turn === undefined || !c.ani) return false;
  const s = await smsSenderOf(tx, c.tenant_id);
  if (!s) return false;
  await recordConsent(tx, c.tenant_id, { sender: s.sender, target: c.ani, channel: 'sms', purpose: 'transactional', scopeRef: scope,
    evidence: { turn: m.text_consent_turn, conversation: c.conversation_id }, now });
  return true;
}

/** Changes need a verified caller (ANI matches the booking's client identity). */
async function mustOwnBooking(tx: Tx, c: CallClaims, bookingRef: string, now: Date) {
  if (!c.ani) throw new ToolError('HUMAN_REQUIRED', 'unverified caller', 'needs_person');
  const r = await tx.query(`select 1 from appointments ap join client_identities ci on ci.client_id = ap.client_id
    where ap.id::text = $1 and ci.kind = 'phone' and ci.value_hash = $2`, [bookingRef, idHash(c.ani)]);
  if (!r.rowCount) throw new ToolError('NOT_FOUND', 'booking not found for this caller', 'need_more_detail');
}

export function localNow(now: Date, tz: string) { return localParts(now.getTime(), tz); }
