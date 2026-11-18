## 11. Booking-integrity design

### 11.1 One authority per tenant

Each tenant has exactly one **authority mode**, part of the published config:

| Mode | Authority | Our database | When |
|---|---|---|---|
| `internal` (MVP) | Our booking ledger (`appointments` + `slot_claims`) | Is the truth | Gates A–C; any business without a booking platform |
| `external:<platform>` (Phase 3) | The business's booking platform (e.g. Square Bookings) | Projection + mappings; never decides availability alone | After D-08 |

Google Calendar in the MVP is a **busy-time source and a mirror**, never the authority: busy events become
`slot_claims(kind='external_busy')`; our bookings are mirrored to it through the outbox. One authority means one
place to look when a booking is disputed.

### 11.2 Time zones, DST, Thai clock and calendar

- Store UTC; every computation uses the location's IANA zone from the tz database (`America/New_York`,
  `Asia/Bangkok`). Never the server's zone, never the caller's assumed zone.
- **Relative dates** ("today", "tomorrow", "this Friday", "next Friday") are resolved by a deterministic parser
  relative to the call's start instant in the location's zone. Rules [REC]: "this Friday" = the coming Friday
  (today if today is Friday and time remains); "next Friday" is **ambiguous** → `needs_clarification:"which_friday"`
  ("Friday the 14th or Friday the 21st?"). Calls after 22:00 that say "tomorrow" are read back with the date.
- **US DST:** slots are generated from local wall-clock opening rules; a wall time that does not exist on a
  spring-forward day is never generated; a wall time that occurs twice on fall-back day is generated once (the first
  occurrence) and read back with the date. Business hours rarely cross 01:00–03:00, but the rule is tested (AT-09).
- **Thailand** has no DST, but has two speech hazards [REC — Thai linguist review, D-14]:
  - *Thai six-hour clock:* "สามโมง"/"สามโมงเช้า" = 09:00; "บ่ายสาม"/"บ่ายสามโมง" = 15:00; "ห้าโมงเย็น" = 17:00;
    "หนึ่งทุ่ม" = 19:00; "สองทุ่ม" = 20:00. A bare "สามโมง" without a period word in an afternoon context is
    ambiguous → `needs_clarification:"thai_clock_period"`. Read-back always uses 24-hour digits **and** the period
    word ("15:00 น. บ่ายสามโมง").
  - *Buddhist Era years:* a spoken or texted year 2569 = 2026 CE. Store CE; render BE in Thai.
- Every confirmation names weekday + date + local time; never only "tomorrow at three".

### 11.3 What availability means (computed by code only)

A candidate start `t` for variant `v` on resources `R` is available iff all hold:

1. `t` lies within the location's business hours and each `r ∈ R`'s hours (local rules + date exceptions).
2. Each staff `r` is qualified: `(r, v) ∈ resource_services`; if `v` needs a room kind, a room of that kind is in `R`.
3. The claim span `[t − buffer_before, t + duration + buffer_after)` overlaps no `active` claim on any `r`
   (bookings, unexpired holds, blocks, external busy).
4. `t ≥ now + lead_time` and `t ≤ now + horizon` (policy), and `t` is on the slot grid (e.g. every 15 min).
5. Staff preference honoured if given; otherwise options spread across qualified staff.

"Qualified for the service but not the requested variant/duration" is caught by (2): qualification is per variant,
not per service.

### 11.4 Holds and the transactional recheck

- Search is read-only and returns signed `slot_token`s (resource ids, span, variant, issued_at; HMAC; 10-min life).
- On the caller's choice, `hold_slot` inserts `slot_claims(kind='hold', hold_expires_at = now()+180 s)` for every
  resource in one transaction. The exclusion constraint `no_double_booking` makes a concurrent second hold or booking
  on an overlapping span fail **in the database**, whatever the application does.
- `create_booking` converts the hold claims to booking claims (`kind='booking'`, `status='active'`, old hold row
  `converted`) and inserts the appointment and outbox rows in the same transaction.

**Exactly what happens if the slot disappears after it is offered but before confirmation:**

| When it disappears | Mechanism | What the caller hears | State |
|---|---|---|---|
| Between offer and the caller's choice (another caller or staff took it) | `hold_slot` insert violates the exclusion constraint → `CONFLICT` | [CODE] "That time was just taken." then up to 3 fresh alternatives (SM-4) | SM-3 → SM-4 |
| After the hold, before "yes" (owner adds a personal Google Calendar event) | Holds protect only against our own claims; the external event arrives via sync as `external_busy` and **fails to insert** because the hold occupies the span → recorded as `sync_conflict` | Nothing during the call (the hold stands); the booking proceeds; reconciliation opens a staff task "Your calendar event overlaps a booking made at 14:02" and alerts the owner. The client booking is **never** cancelled automatically | SM-10 `drift` |
| Hold expired (caller took > 180 s; one extension to 300 s was used) | `create_booking` re-attempts the claim; if free → books; if taken → `CONFLICT` | If taken: [CODE] "Sorry, that time is no longer available." + alternatives | SM-4 |
| External authority mode (no holds) | `create_booking` calls the platform with the idempotency key; platform rejects the conflicting time → `CONFLICT` | As row 1 | SM-4 |
| Authority unreachable at commit | `CONNECTOR_UNAVAILABLE` after one gateway retry | [CODE] "I can't confirm bookings right now. I've passed your request to the team; this is not a confirmed booking yet." | `request_fallback` |

### 11.5 Compare-and-swap versions

Every update/cancel carries `expected_version`. `update … where version = $expected returning version` with 0 rows
→ `VERSION_MISMATCH` → the runtime re-reads, re-renders the confirmation and asks once more. Applies to
appointments, configuration publishing, pending questions (owner and timer racing each other), consents.

### 11.6 Reschedule: atomic first, saga only when unavoidable

- **Internal authority:** one transaction: claim the new span (exclusion check), release the old claims, update the
  appointment (CAS), append `appointment_events`, enqueue outbox. No intermediate state is visible.
- **External authority** with update-in-place support: one update call with the platform's version field.
- **External authority without update-in-place:** saga [REC]:
  1. create replacement (idempotency key `resched:{booking}:{new_span}`), state `pending_swap`;
  2. cancel original (idempotency key `resched-cancel:{booking}`), retried 5× over 30 min;
  3. on permanent failure of 2 → keep both, mark original `to_cancel`, staff task + owner alert; the caller has
     already been told only what is true ("Your new time is booked. The team will remove the old one.");
  4. the replacement is never auto-cancelled to "undo"; we never leave the client with neither booking.

### 11.7 Webhook deduplication

All inbound provider callbacks (carrier, voice platform, messaging, calendar, billing): verify signature →
`insert into webhook_receipts … on conflict do nothing` → only the inserting transaction proceeds. The handler is
idempotent anyway (state machine rejects an event invalid for the current state).

### 11.8 Outbox delivery

Domain change and outbox row commit together. A dispatcher claims rows with `for update skip locked`, sends with the
row's idempotency key (provider-side idempotency where offered; otherwise our `message_deliveries` uniqueness),
records the result, retries with exponential backoff and jitter (1 min → 2 h, max 8 attempts), then `dead` →
`dead_letters` + on-call alert. Consequences: a booking can succeed while its confirmation text fails (booking
stands; staff sees the failed delivery — AT-44); a confirmation can never be sent for a booking that did not commit
(AT-45).

### 11.9 Reconciliation after missing webhooks

- Calendar: hourly incremental pass with sync token + nightly full comparison (SM-10).
- External booking platform (Phase 3): hourly list of changed bookings since cursor; nightly full window (−7 to +62
  days) comparison by mapping.
- Messaging: provider status for any delivery not final after 1 h is fetched by API.
- Telephony: calls with no end event after 30 min are closed from the provider's call record.
- Every repair is an audit event; any repair that would change a client-visible booking becomes a staff task.

### 11.10 Booking fraud and abuse controls

Per caller number: max 2 bookings per 24 h per tenant without staff review [REC]; no-show history visible to staff;
cancellations only by verified identity (SM-5/6); bookings made by unverified callers are flagged `unverified_phone`
and confirmation texts double as verification (reply C to confirm in a later phase).
