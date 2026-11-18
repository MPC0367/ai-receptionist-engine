## 4. Product truth and unknowns

### 4.1 Invariants (non-negotiable, each enforced in code and tested)

| Id | Invariant | Enforced by | Test (§17) |
|---|---|---|---|
| INV-01 | The model never receives database or calendar credentials or write access. | Voice runtime holds only a per-call capability token for the Tool Gateway; DB credentials exist only in the core API; network policy blocks the runtime from the DB | AT-30 |
| INV-02 | Caller speech and text are untrusted input, including tool arguments the model produced from them. | Tool Gateway validates every argument against schema + business rules + current state; tenant/conversation come from the token, never from arguments | AT-28, AT-29 |
| INV-03 | Every write passes: authentication, tenant scope, schema validation, business-rule validation, current-state recheck, idempotency key, expected version, audit log. | Write-tool envelope (§9.1) is mandatory; missing field → `VALIDATION_FAILED` | AT-01…AT-06 |
| INV-04 | No booking or search result is spoken as fact unless it came from the current tenant's authoritative data in this conversation. | Numeric-grounding check (§10.0); offers only from `search_availability` result tokens | AT-03, AT-27 |
| INV-05 | New booking, reschedule and cancellation each require an explicit confirmation of a code-built sentence. | `confirmed_at` + `confirmation_turn_id` required by T-06/T-08/T-09; the turn must follow the rendered confirmation | AT-02, AT-11, AT-13 |
| INV-06 | The system admits uncertainty and escalates rather than improvising. | SM-7 → SM-8; drafted answers without a fact are discarded | AT-16 |
| INV-07 | An unknown question never leaves the caller silently waiting: live handoff when appropriate, or a truthful asynchronous expectation and a confirmed reply channel. | SM-8 UQ2–UQ6, 120 s cap; no state waits on the owner | AT-16…AT-25 |
| INV-08 | Owner replies are untrusted until authenticated, matched to an open pending question, and validated; they become reusable knowledge only after a separate approval. | §5.8.5, KC machine | AT-20, AT-21, AT-24 |
| INV-09 | A transfer-start event is not proof a human answered. | Only DTMF 1 in screening = `bridged` (SM-9) | AT-15 |
| INV-10 | Duplicate or replayed webhooks never create duplicate bookings, messages or charges. | `webhook_receipts` unique key; idempotency keys on every write and send; usage unique key | AT-05, AT-06, AT-38 |
| INV-11 | Service messaging, promotional consent, recording consent/disclosure and channel rules are separate state machines. | `consents.purpose` + SM-11 per purpose; recording per call (SM-2) | AT-31…AT-34 |
| INV-12 | Demo and synthetic data stay labelled and are never presented as a real customer outcome. | `is_synthetic` column on tenants, conversations, bookings; dashboards and exports badge them; metrics exclude them | AT-40 |
| INV-13 | No medical, legal, financial, emergency, payment-card, government-ID or child-data workflow is added silently. | Category allow-list in SM-1; UQ1 tiers E/P; a new workflow needs an owner decision record (D-xx) | AT-26 |
| INV-14 | Cross-tenant isolation failures must be zero. | Tenant id in every key + RLS + tenant filter before retrieval | AT-29, AT-36 |

### 4.2 What we know, what we infer, what we don't

| Topic | Status | What our design does regardless |
|---|---|---|
| Kirx's model choice, TTS voice, average call length, concurrency tier, vendor rates | [UNK] | We measure our own (§14, §15). |
| Whether Kirx holds slots or only rechecks | [UNK] | We hold (§11.4) where the authority supports it, and recheck inside the write. |
| Which booking systems Kirx supports in production beyond Square/"similar" | [UNK] | MVP: internal ledger + Google Calendar busy-time; one external platform in Phase 3 (D-08). |
| How Kirx authenticates owner answers and approves them for reuse | [UNK] | §5.8.5 and KC machine. |
| How Kirx provisions iMessage and what non-Apple owners get | [UNK] | US: SMS is the baseline owner channel; iMessage optional after D-05. TH: LINE. |
| Kirx uptime, response time, support and recovery objectives | [UNK] | We publish our own only after Gate C measurement. |
| Whether providers keep recordings after Kirx deletes its copy | [UNK] | SM-13 `provider_purge`; choose providers with deletion APIs / zero retention (§7). |
| How deletion propagates across processors | [UNK] | SM-12 with per-provider evidence. |
| Number of real businesses, calls, bookings | [UNK] | Not used anywhere in our plan. |
| Whether marketing-listed health categories are blocked at Kirx onboarding | [UNK] | We block at SM-1. |
| What happens to client data on Kirx cancellation or connector failure | [UNK] | SM-1 `offboarding` export; SM-10 `paused_writes`. |
| Whether Kirx and Bowers share code | [UNK] | Irrelevant to our design; not claimed. |
| The live demo writes to a visible calendar | [OBS, not exercised] | Our demo does the same with labelled synthetic data. |
| Telnyx → Vapi → Deepgram → Anthropic → tools → TTS flow | [INF] | Our architecture is provider-neutral at the boundary (§6). |

### 4.3 Unknowns about our own product that only the pilot can answer

U-01 Real call-duration distribution per vertical and country. U-02 Share of calls that are bookings vs questions vs
other. U-03 Thai speech-recognition accuracy on names, phone numbers, Thai clock-time expressions in salon calls.
U-04 Owner reply latency to pending questions (median, p90). U-05 Caller acceptance of AI disclosure (hang-up rate
in the first 10 s). U-06 Share of callers who consent to a text follow-up. U-07 Spam/robocall share of inbound
calls. U-08 Whether owners will keep the preview-before-send step (§5.8.2) or find it a burden. Each has a metric in
§15 and is an exit criterion input at Gate C (§16).
