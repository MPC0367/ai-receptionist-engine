## 15. Metrics and dashboards

Every metric excludes `is_synthetic` and `is_test` rows unless a dashboard is explicitly the demo dashboard
(INV-12). Each has an owner and a threshold that matters at a gate (§16).

| Metric | Definition | Gate C target [REC] |
|---|---|---|
| Answered-call rate | AI-answered / calls routed to AI | ≥ 99% |
| Task-completion rate by intent | Intents ending in a successful terminal / intents detected | Booking ≥ 70% of eligible booking calls; FAQ ≥ 80% answered or escalated correctly |
| Booking conversion | Confirmed bookings / calls with booking intent | Measure (U-02) |
| Recovered booking rate | Bookings via SM-4 / calls where first choice unavailable | Measure |
| AI-error corrections | Bookings changed by staff within 48 h due to AI error (RB-06 class) / bookings | ≤ 1% |
| Double-booking / sync-conflict rate | Overlapping active claims (must be 0); sync conflicts per 100 bookings | 0 / ≤ 2 |
| Owner escalation rate | PQs per 100 answered calls | Measure; trend down as KC approvals grow |
| Human-transfer rate and success | Transfers attempted; `bridged` / attempted | Measure; success shown, never assumed |
| Unanswered-question resolution time | PQ created → terminal (median, p90), by outcome | Median ≤ owner window if configured |
| PQ outcome mix | Share of each terminal outcome (§5.8.3) | `delivered` share trending up; `expired` ≤ 20% |
| Turn latency | End-of-speech → first audio p50/p95, split STT/LLM/tool/TTS | p50 ≤ 1.0 s, p95 ≤ 1.8 s (US); measure TH first |
| Disclosure hang-up rate | Hang-ups within 10 s after greeting / answered | Measure (U-05) |
| Message delivery failure and opt-out rate | Failed / sent; STOP / sent, by purpose | Failure ≤ 3%; opt-outs reviewed weekly |
| Direct provider cost | Per answered conversation and per confirmed booking, by duration band (§14) | Within the pricing model's margin floor |
| Gross margin by duration band | (price − direct cost) / price per band | ≥ floor set in D-01 |
| Privacy | Deletion SLA met; retention-job success | 100% |
| Cross-tenant isolation failures | Canary probe hits | **0** (any hit is Sev-1) |

**Dashboards [REC]:** (1) *Owner* (in the owner channel + web): today's AI bookings, open questions, missed
transfers, delivery failures; (2) *Ops*: live calls, latency by component, error rates, dead letters, PQ ageing;
(3) *Quality review*: sampled conversations with outcome, grounding-check rejections, injection attempts (redacted);
(4) *Commercial*: usage, cost per conversation/booking by band, margin, disputes.

## 16. Gated delivery roadmap

The MVP is deliberately narrow [brief]: **one geography, one vertical, one location, one authoritative calendar,
inbound calls, new booking, FAQ, owner notification, no payments, no promotions.** Reschedule/cancel, live transfer
and the full owner-question loop enter at Gate B as simulation-proven features and go live one at a time at Gate C
only if the gate's exit criteria hold. *(The brief asks for the unknown-question branch as a core capability; it is
specified and simulated from Gate A, but its live use waits for owner-channel and texting registration.)*

| | **Gate A — simulation only** | **Gate B — staff/internal pilot** | **Gate C — one-business limited production** | **Gate D — multi-tenant commercial release** |
|---|---|---|---|---|
| Scope | Full conversation engine, all state machines, tools, booking ledger, PQ machine against **simulated** telephony and messaging; text-based and synthetic-audio call simulator | Real calls from O2 staff phones to a test number; real owner channel to O2 staff; one synthetic tenant | One real business (D-13), inbound calls during agreed hours, booking + FAQ + owner notification; transfer and owner-question loop enabled one by one after a week each without Sev-1/2 | Multiple tenants, self-serve onboarding, billing live |
| Allowed data | Synthetic only (`is_synthetic`) | Synthetic tenant; O2 staff phone numbers with their written consent | The business's real services/staff/hours; real callers; minimum necessary | Production data under DPAs |
| Integrations | None external (stand-ins with recorded provider payloads); LLM API with no personal data | Carrier test number, STT/LLM/TTS, LINE test OA or SMS sandbox, Google Calendar test account | Production carrier number (forwarding from the business's line), owner channel, one calendar | + external booking platform (D-08), billing provider |
| Monitoring | Test reports | Traces, latency, cost per call | Full ops dashboard, on-call O2 person during business hours, daily review of every conversation in week 1, sampled after | + SLOs, status page |
| Manual approval | Owner approves Gate A report | Owner + legal sign-off on disclosure/consent wording (D-07) | Business owner's written consent + O2 owner go-ahead; O2 reviewer signs SM-1 `review` | Owner go-ahead after Gate C review; counsel sign-off on Terms/Privacy/DPA |
| Exit criteria | All Gate-A acceptance tests pass (§17); 0 isolation failures; cost model populated with measured tokens/latency from simulated runs | 200+ internal calls; turn latency within target; 0 double bookings; every PQ outcome exercised for real; consent and STOP verified on real handsets | 4 weeks; metrics in §15 at target; owner satisfaction interview; no unresolved Sev-1; unit economics within D-01 floor | — |
| Rollback | n/a | Disable test number | Turn off forwarding-to-AI (owner's phone rings as before) — one switch, tested in week 1 | Per-tenant kill switch; global AI-off routes all to owners |
| Prohibited actions | Real calls, real messages, real customer data, real calendars | Calls/texts to anyone who has not consented in writing; real customer data | Payments, promotions, reminders, outbound calls, other locations, health questions answered by AI, self-serve sign-up, any marketing claim of results | Health/medical verticals, payments without a separate gate, promotional texting without opt-in machine live, any traction claim not from our own measured data |
