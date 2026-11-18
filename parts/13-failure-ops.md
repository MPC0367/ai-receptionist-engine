## 13. Failure and operations matrix

### 13.1 External providers

| Failure | Caller experience | Owner experience | Automated recovery | Retry policy | Dead-letter / incident path | Data consistency rule | Billing rule |
|---|---|---|---|---|---|---|---|
| Carrier down / numbers unreachable | Forwarded calls ring the business's own phone (forwarding set as "no answer → AI" so the base route is the owner's line) | Calls ring as before the product | Carrier health check every 60 s; if assigned numbers fail, status page + owner alert | — | Sev-1 if > 5 min | No conversation rows for calls never received | Nothing billed |
| Voice platform / runtime down | Same as above (forwarding fallback) or busy tone if number is assigned | Alert: "AI answering paused" | Failover to secondary region/runtime if configured; else route to business number | health 30 s | Sev-1 | — | Nothing billed |
| STT degraded (latency/accuracy) | Reprompts, then degraded path (§10.9) | Incident notice if > 10 min | Switch to secondary STT model/provider per config | per turn: 1 failover | Sev-2 | Conversation marked `degraded` | Billable only if rule met **and** not ended by system fault (SM-14) |
| LLM slow/erroring | Filler, then degraded path | Incident notice | Fallback model (same provider) or secondary provider per D-04; no tool writes during failover mid-confirmation (re-confirm) | 1 failover per turn | Sev-2 | Pending confirmation discarded on model switch | As above |
| TTS down | Pre-recorded fallback audio for degraded sentences, then transfer/message | Incident notice | Secondary voice | 1 failover | Sev-2 | — | As above |
| Owner channel (LINE / SMS / iMessage) down | Unaffected during call | Later delivery; secondary contact | Escalation chain; channel fallback LINE → SMS (if owner enrolled SMS) | 30 s, 2 min, 10 min then chain | Dead letter → O2 support calls owner | PQ stays `owner_notifying`/`owner_unreachable` | No extra billing |
| SMS to caller fails | Caller may get no text | Receipt: "couldn't deliver" + call-back | Retry transient; permanent → `caller_unreachable` | 1, 5, 20 min | Staff task | PQ terminal outcome recorded | No extra billing |
| Database primary down | Degraded path; no writes; bookings → request fallback impossible (needs DB) → give business contact | Incident | Failover to replica (managed HA); runtime config from cache | — | Sev-1 | No write acknowledged unless committed | System-fault rule: not billed |
| Workflow engine down | Unaffected in call; timers (hold expiry, PQ reminders) late | Late reminders | Engine HA; on recovery timers fire; hold expiry also enforced lazily in claim path (§8.1) | — | Sev-2 | Lazy expiry makes holds safe without the timer | — |
| Hosting region outage | As voice platform down | Alert | Secondary region (Gate D) | — | Sev-1 | RPO ≤ 5 min (managed PITR) | Not billed |
| Booking connector (external authority) down | "I can't confirm bookings right now… a request, not a booking" | Request tasks in dashboard | Reads from projection allowed for FAQ only, never for availability claims | gateway 1× | Sev-2 after 15 min | No local booking without authority write | Billable per rule (the call was handled) — D-02 may waive |
| Calendar OAuth revoked | If calendar is a busy source only: availability excludes its unknown busy time → **pause booking** (cannot be sure) → request fallback | "Reconnect your calendar" alert | SM-10 `paused_writes` | — | Owner action | Mirror resynced after reconnect | — |
| Billing provider down | — | Invoice delayed | Usage events queued locally, reported later with idempotency | hourly | Finance | Usage events are the record | Never double-reported |

### 13.2 Core workflows

| Failure | Caller experience | Owner experience | Automated recovery | Retry policy | Dead-letter / incident path | Data consistency rule | Billing rule |
|---|---|---|---|---|---|---|---|
| `create_booking` times out client-side but committed | Runtime retries with same key → gets original → confirmation spoken | Normal notice | Idempotency table returns stored response | 2× | — | One appointment | Once |
| Booking committed, confirmation text failed | Spoken confirmation was given; text missing | Delivery failure visible | Outbox retry | outbox schedule | Dead letter → staff | Booking stands | Once |
| Mirror calendar write failed | — | Event missing in Google Calendar until retry | Outbox retry; nightly reconciliation | outbox | Dead letter → staff | Authority wins | — |
| Reschedule saga half-done (external) | Told new time is booked; old being removed | Staff task | Retry cancel 5× | 30 min | Staff | Never neither booking | Once |
| PQ relay after caller STOP | — | Receipt: caller opted out | — | — | — | `caller_unreachable(opted_out)` | Once |
| Owner answer arrives after expiry | Caller already got truthful expiry text | "Send anyway?" | Late path within 48 h | — | — | `expired` → `late_relay` | Once |
| Transfer rings out | AI returns, offers text path | Missed-transfer notice | SM-9 `returning` | — | — | Handoff row with outcome | Once |
| Metering job fails | — | — | Retry; unique key guards | 5× | Finance queue | Usage unique | Exactly once |

### 13.3 Runbooks

**RB-01 Telephony down.** Confirm with carrier status + synthetic call. Owner-facing status banner + message to
affected tenants ("calls go straight to your phone"). If assigned numbers are affected and the carrier offers
failover routing, switch to the tenant's business number. Close when synthetic calls pass 3× in a row. Post-mortem
within 2 business days.

**RB-02 STT/LLM/TTS latency spike.** Dashboard: p95 turn latency by component. If one component > budget for
5 min: switch to configured fallback (STT model, LLM model, TTS voice). Do not change prompts during an incident.
Measure for 15 min; roll back the switch if quality checks (sampled transcripts) fail. Record cost impact.

**RB-03 Booking connector outage.** Verify provider status; set connector `unavailable` (AI uses request fallback);
message affected owners; after recovery run reconciliation for the outage window and work the request tasks with the
owner (no automatic bookings from requests).

**RB-04 Calendar OAuth revoked.** Connector auto-pauses; owner receives reconnect link (authenticated); after
reconnect: full resync, conflicts → staff tasks. If revoked by Google for policy reasons, escalate to O2 admin.

**RB-05 Duplicate booking report.** Pull both appointment ids, their `created_by_conversation`, idempotency keys and
claim rows. If two `active` claims overlap on one resource → constraint bypass = Sev-1 bug. If two bookings for one
client at different times → likely two confirmations; check transcript. Owner decides which to keep; client told by
staff; root cause in post-mortem; billing adjusted if our fault.

**RB-06 Wrong booking report** (wrong service/time/staff). Compare the rendered confirmation (stored hash + turn) with
the booking. If they match → caller confirmed it; staff fixes with the client. If they differ → Sev-1 (confirmation
integrity). Credit the conversation.

**RB-07 Consent complaint** ("I never agreed to texts"). Pull consent evidence (turn, recording offset, text);
immediately opt the number out for that tenant; reply to complainant within 1 business day; legal review if the
evidence is weak; check for systematic cause.

**RB-08 Deletion request.** Run SM-12; deadline per jurisdiction (legal register); evidence package to requester:
what was deleted, what was kept and why (invoices anonymised; opt-out hash kept to honour STOP).

**RB-09 Provider breach notice.** Identify data categories and tenants affected via processor inventory; contain
(rotate keys, disable integration); assess notification duties (PDPA 72 h to PDPC where required; US state laws);
notify tenants (as their processor) with facts only; log decisions.

**RB-10 Invoice dispute.** Pull usage events for the period with outcome codes; check the billing rule version;
credit system-fault or rule-misapplied conversations; never edit usage events — add adjustments.
