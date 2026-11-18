## 7. Provider decision matrix

All prices, regions and features below were read on **official vendor pages on 11 November 2026** (source ids
`S-xx` in §19). Latency figures are **vendor claims**, not measurements. Scores are our judgement on a 1–5 scale
(5 = best for this product) and are labelled [REC]. "n/f" = not found on an official page. Kirx's stack is not
assumed to be best; it appears only where an option happens to coincide.

Columns: **Lat** latency · **Rel** reliability · **Cost** · **Ret** data retention · **ZDR** zero-data-retention
option · **Reg** regional availability (US / TH) · **Comp** compliance claims · **Hook** webhook/tool support ·
**Exit** exit cost (5 = easy to leave).

### 7.1 Telephony / carrier

| Option | Facts (official) | Lat | Rel | Cost | Ret | ZDR | Reg | Comp | Hook | Exit |
|---|---|---|---|---|---|---|---|---|---|---|
| Telnyx | US number from $1/mo; US local inbound from $0.0032/min; recording $0.002/min. TH local numbers from $10/mo, business use only, proof of address, ~72 h validation; **TH inbound per-minute n/f** [S-04, S-05] | n/f | 3 | 5 | n/f | n/f | US 5 / TH 3 | SOC 2 II, HIPAA, ISO 27001 (marketing pages) | 4 | 4 |
| Twilio | US local $1.15/mo, inbound $0.0085/min, recording $0.0025/min. **TH mobile number $25.30/mo, inbound $0.0100/min**; TH local numbers need an address in the prefix area + company registry excerpt + representative's Thai ID; status history shows TH inbound outages (Jan 2024, Jul 2025) [S-01–S-03] | n/f | 4 | US 4 / TH 2 | n/f | n/f | US 5 / TH 4 | ISO 27001/17/18, SOC 2 II, BAA | 5 | 4 |
| Plivo | US local $0.50/mo, inbound $0.0055/min; **TH inbound "Not Supported"** [S-06] | n/f | 3 | 5 | 90 d free recordings | n/f | US 5 / TH 0 | SOC 2, HIPAA BAA | 4 | 4 |
| Thai SIP trunk (True Business, SIPPER) | Prices not published; SIPPER offers 02, provincial, mobile and toll-free numbers with NT/True interconnect [S-07, S-08] | n/f | n/f | unknown | n/f | n/f | TH 5 | n/f | SIP only | contract |

**Thailand constraint (legal register L-T15):** operating telephony or issuing numbers is a licensed telecom
business. [REC] The business keeps its own number and forwards (no-answer/busy) to a number **held in the
business's own name** with a licensed operator (Twilio TH mobile or a Thai SIP provider), or O2 partners with a
licensee. O2 does not issue or resell numbers (D-11).

### 7.2 Real-time voice orchestration

| Option | Facts (official) | Lat | Rel | Cost | Ret | ZDR | Reg | Comp | Hook | Exit |
|---|---|---|---|---|---|---|---|---|---|---|
| **LiveKit Agents** (Apache-2.0) / LiveKit Cloud | Cloud: $0.01/min agent session; third-party SIP $0.003–0.004/min; Ship $50/mo incl. 5,000 min; telephony region pinning aus, canada, eu, india, japan, sa, us — **no South-East Asia**; cold transfer via SIP REFER, warm transfer supported; transfer-failure reporting thin [S-13, S-14] | n/f | 4 | 5 | own control (self-host) | ZDR for LiveKit Inference | US 5 / TH 4 (self-host in Bangkok) | SOC 2 II, HIPAA BAA (Scale+) | 5 (own code) | **5** |
| Pipecat (BSD-2) / Pipecat Cloud | $0.01/min agent-1x; regions us-west, us-east, eu-central, **ap-south (Mumbai)** [S-15] | n/f | 3 | 5 | own control | n/f | US 5 / TH 3 | Daily SOC 2 II; HIPAA add-on | 5 | **5** |
| Retell AI | $0.055/min infra + LLM + TTS + $0.015/min telephony (or own SIP free); Thai listed (Deepgram/Azure/Soniox STT; several TTS); **reports transfer outcome** (`transfer_bridged`, `transfer_cancelled`…); no region list [S-11, S-12] | "~600 ms" | 4 | 3 | 1–730 d configurable | ZDR with subprocessors | US 5 / TH 2 (no Asia region stated) | SOC 2 I/II, BAA no fee | 4 | 2 |
| Vapi | $0.05/min hosting + providers at cost; regions US and EU only; **transfer does not confirm the destination answered** [S-09, S-10] | "<500 ms" | 4 | 3 | 14–180 d by plan | ZDR on paid packages | US 5 / TH 1 | SOC 2 II, HIPAA ($2,000/mo), PCI | 4 | 2 |
| Twilio ConversationRelay | $0.07/min + voice minutes; Thai default Deepgram nova-2 + Google th-TH voice [S-16] | n/f | 4 | 2 | 30 d logs | n/f | US 5 / TH 3 | HIPAA-eligible (BAA) | 3 (LLM behind WebSocket) | 3 |
| Speech-to-speech (OpenAI gpt-realtime-2.1; Gemini Live) | OpenAI audio $32 in / $64 out per 1M tokens, Thai not listed for Realtime; Gemini Live audio $3 in / $12 out per 1M, Thai listed, 15-min audio sessions [S-29, S-30] | low (single model) | 3 | 3–4 | provider terms | OpenAI ZDR with approval | — | — | function calling | 2 |

**[REC] Choose LiveKit Agents (D-04)** for both geographies: our screened-transfer design (DTMF 1 = human, INV-09)
needs control of the outbound leg, which managed platforms do not expose in the way we need (Vapi cannot confirm an
answer; Retell reports "bridged", which a voicemail can also produce); it self-hosts in a Bangkok region where no
managed platform has a South-East Asia presence; and its exit cost is the lowest. Use LiveKit Cloud (US region) for
Gates A–C in the US variant; self-host in the Thailand variant. **Gate A spike** must prove: screening whisper +
DTMF capture on an outbound SIP leg, then bridging, with Twilio/Telnyx/Thai SIP trunks. **Proven on 12 Nov 2026 against
SIPp on self-hosted LiveKit** (livekit-server v1.13, livekit/sip v1.23; `engine/spikes/livekit-transfer/RESULTS.md`):
seven cases pass with media proof of who heard whom. `MoveParticipant` is not implemented on self-hosted LiveKit, so
staff is screened in the caller's room with the caller's track muted at the server (needs `room.enable_remote_unmute`).
Still to prove at Gate B: the same on a real trunk (Twilio/Telnyx, then a Thai SIP provider) and real phones.

### 7.3 Speech-to-text (streaming)

| Option | Facts (official) | Lat | Rel | Cost | Ret | ZDR | Reg | Comp | Hook | Exit |
|---|---|---|---|---|---|---|---|---|---|---|
| Deepgram Nova-3 / Flux | Nova-3 $0.0077/min mono, $0.0092 multilingual; Flux $0.0077/0.0078; **Nova-3 lists Thai (streaming per language not stated); Flux no Thai**; training opt-out `mip_opt_out=true` [S-17, S-18] | "sub-300 ms" / Flux "~260 ms" EoT | 4 | 5 | opt-out keeps data only as necessary | via opt-out | US 5 / TH 3 | SOC 2, BAA (Enterprise), PCI | n/a | 4 |
| Azure Speech | S1 $1.00/h ≈ $0.0167/min; **th-TH real-time ✅**; "no data stored at rest" for real-time; Southeast Asia region [S-22] | n/f | 4 | 3 | none at rest | effectively | US 5 / TH 5 | (service-specific not checked) | n/a | 4 |
| AssemblyAI Universal-Streaming | $0.15/h ≈ $0.0025/min; **no Thai** in realtime models [S-19] | "sub-200 ms" | 4 | 5 | ZDR if opted out | yes | US 5 / TH 0 | BAA | n/a | 4 |
| Speechmatics | Real-time $0.45–0.80/h; Thai listed, real-time claimed on its Thai page; endpoints EU/US/AU [S-20] | "350 ms" | 4 | 4 | real-time never stored | yes | US 5 / TH 3 | SOC 2 II, ISO 27001, HIPAA | n/a | 4 |
| Google Chirp 3 | V2 $0.016/min; **Thai Preview, US/EU regions only** [S-21] | n/f | 3 | 3 | logging opt-in | default no logging | US 5 / TH 2 | n/c | n/a | 3 |
| ElevenLabs Scribe realtime | $0.22/h; Thai realtime unconfirmed [S-23] | "~150 ms" | 3 | 5 | ZRM Enterprise | Enterprise | US 5 / TH ? | SOC 2 II, ISO 27001 | n/a | 4 |

[REC] US: Deepgram (Nova-3, or Flux for its turn detection in English). TH: **blind test at Gate A** between Azure
th-TH (in-region, no data at rest) and Deepgram Nova-3 Thai on recorded Thai salon dialogues (names, phone digits,
Thai clock phrases) — U-03, D-14.

### 7.4 Language model

| Option | Facts | Lat | Rel | Cost (per answered minute, our token model §14) | Ret / ZDR | Comp | Hook | Exit |
|---|---|---|---|---|---|---|---|---|
| Claude Haiku 5.5 | $0.10 / $0.50 per 1M (prompts ≤100K); cache reads 0.1× input; refusals have no server-side fallback [S-31] | best of family | 4 | ~$0.0011 EN / ~$0.0020 TH | ZDR by arrangement (Fable/Mythos excluded; Haiku/Sonnet/Opus not listed as excluded — **verify with Anthropic**) | — | tools, strict schemas | 4 |
| Claude Sonnet 5.5 | $2 / $10 per 1M, cache reads $0.10 [S-31] | medium | 4 | ~$0.020 EN / ~$0.038 TH | as above | — | as above | 4 |
| Claude Opus 5.5 | $4 / $20 per 1M, cache reads $0.20; thinking cannot be disabled (effort is the control) [S-31] | slowest | 4 | ~$0.040 EN / ~$0.077 TH | as above | — | as above | 4 |

[REC] The live turn model is an **eval decision at Gate A (D-04b)**: measure task completion, grounding-check
rejections and p95 first-token latency for Haiku 5.5, Sonnet 5.5 (low effort) and Opus 5.5 (low effort) on the
same scripted calls; choose the cheapest that meets the targets. The safety classifier and question summariser may
use a different model than the turn model. The cost differences are small next to speech costs except for Opus.
Data-residency: the Claude API supports an `inference_geo` parameter ("us" geography); a South-East Asia option and
Thai cross-border implications need confirming (D-06).

### 7.5 Text-to-speech

| Option | Facts (official) | Lat | Rel | Cost | Ret | ZDR | Reg | Comp | Hook | Exit |
|---|---|---|---|---|---|---|---|---|---|---|
| Cartesia Sonic 3.6 | ≈$0.039/1K chars (Startup); Thai among 44 languages; ZDR Enterprise [S-24] | "under 90 ms" | 4 | 4 | — | Enterprise | US 5 / TH 4 | SOC 2 II | n/a | 3 |
| ElevenLabs | $0.04/1K (Flash, v3 Conversational, v4 Turbo); **Flash v2.5 no Thai; v3/v4 Thai yes**; ZRM Enterprise [S-23] | "~100 ms" | 4 | 4 | — | Enterprise | US 5 / TH 4 | SOC 2 II, ISO 27001 | n/a | 3 |
| Deepgram Aura-2 | $0.030/1K; **no Thai** [S-25] | "sub-200 ms" | 4 | 5 | opt-out | opt-out | US 5 / TH 0 | as Deepgram | n/a | 4 |
| Azure Neural TTS | $15/1M chars (HD $22/1M); Thai voices Premwadee, Niwat, Achara + HD Krit, Nattapong; "no data is persisted" [S-26] | n/f | 4 | **5** | none | effectively | US 5 / TH 5 | n/c | n/a | 4 |
| Google Cloud TTS | Chirp 3 HD $30/1M; 30 th-TH voices; streaming; asia-southeast1 [S-27] | n/f | 4 | 4 | n/f | n/f | US 5 / TH 5 | n/c | n/a | 3 |
| Botnoi Voice | Thai dialects; REST only, 1,000 chars/request, **no streaming API found** [S-28] | — | 2 | 4 | n/f | n/f | TH only | n/f | n/a | 4 |

[REC] US: Cartesia or ElevenLabs Flash (blind test). TH: blind test with native Thai listeners among Azure Thai
neural/HD, Google Chirp 3 HD Thai and ElevenLabs v4 Turbo (D-14).

### 7.6 Owner and caller messaging

| Option | Facts (official) | Lat | Rel | Cost | Ret | ZDR | Reg | Comp | Hook | Exit |
|---|---|---|---|---|---|---|---|---|---|---|
| SMS — Telnyx (US) | $0.004/part + carrier fees; 10DLC brand $4.50, vetting $41.50, campaign $15 + $1.50–10/mo; Ed25519 webhook signatures; STOP/START/HELP reserved [S-38] | n/f | 4 | 5 | — | — | US 5 | — | 5 | 4 |
| SMS — Twilio (US) | $0.0083/segment + carrier fees; 10DLC fees (figures on two Twilio pages differ); HMAC-SHA1 webhook signature; default opt-out handling; opt-outs unified SMS/MMS/RCS since 16 Mar 2026 [S-36, S-37] | n/f | 4 | 4 | — | — | US 5 / TH 4 | — | 5 | 4 |
| iMessage via Sendblue / Blooio / LoopMessage | Sendblue runs Mac Minis with real Apple IDs "without Apple review"; $100/mo line is inbound-first, full outbound Enterprise only; Blooio has a `safety.number_banned` event "when Apple bans a sending number"; LoopMessage: first message needs add-on + warm-up + opt-in, "we do not guarantee message delivery" [S-32–S-34] | n/f | **2** | 3 | n/f | n/f | US only | Sendblue SOC 2 II | Blooio HMAC; others shared-secret header | 2 |
| Apple Messages for Business | Requires an Apple-approved messaging service provider; conversations start from customer entry points; automation must identify itself [S-35] | — | 4 | n/f | — | — | US | Apple policies | via MSP | 3 |
| WhatsApp Cloud API | Per message; North America utility/service $0.0034, marketing $0.025; "Rest of APAC" (incl. TH) utility $0.0113, marketing $0.0842; free-form only in 24 h window [S-39] | n/f | 4 | 4 | — | — | US 4 / TH 3 | — | 5 | 3 |
| **LINE OA + Messaging API (TH)** | Free 300 msgs/mo; Basic ฿1,280/mo (15,000), Pro ฿1,780/mo (35,000); push counts against quota; HMAC-SHA256 `x-line-signature`; `X-Line-Retry-Key` idempotency for push (24 h); **from 1 Feb 2027: 25,000 free Reply API messages/mo, then ฿5,000/mo via a LINE-designated agency** [S-40–S-42] | n/f | 4 | 5 | — | — | TH 5 | — | 5 | 3 |
| LINE notification messages (by phone number) | Japan/Thailand/Taiwan; corporate applicants via LINE sales/partner; not for commercial/advertising use; price n/f [S-43] | — | — | n/f | — | — | TH | — | — | — |
| Thai SMS — ThaiBulkSMS | ฿0.15–0.20/credit; sender name 4–10 Latin chars, 5–7 business days, paid package ฿3,000–3,500 (search excerpts) [S-44] | n/f | 3 | 5 | — | — | TH 5 | — | 3 | 5 |
| Thai SMS — Twilio | $0.0305/segment; sender ID registration required (unregistered blocked since 6 Oct 2025, ~2 weeks); **shortened links prohibited, full links must be registered**; marketing banned 21:00–09:00 [S-45] | n/f | 4 | 3 | — | — | TH 5 | — | 5 | 4 |

[REC] **US owner channel = SMS** (baseline; MVP); iMessage only as an optional owner-side extra after D-05, never
for caller texts — relay-device providers carry Apple-ban and delivery risk. **US caller texts = SMS** after 10DLC
registration. **TH owner channel = LINE push** from one O2-operated "receptionist" Official Account that owners add
(quota on one Pro plan across tenants) or from each business's own OA (D-05); **TH caller texts = SMS** with a
registered sender name per business; LINE to callers only in a later phase for verified LINE-linked clients.

### 7.7 Database, workflow, hosting

| Option | Facts (official) | Lat | Rel | Cost | Ret | ZDR | Reg | Comp | Hook | Exit |
|---|---|---|---|---|---|---|---|---|---|---|
| Neon Postgres | $0.106–0.222 per CU-h; restore window up to 7 d (Launch) / 30 d (Scale); regions Singapore, US East/West [S-46] | 4 | 4 | 4 | PITR | — | US 5 / TH 3 (SG) | SOC 2, ISO 27001/27701, HIPAA (Scale) | — | 5 |
| Supabase | Pro from $25/mo; PITR $100/mo per 7 days; RLS off by default; Singapore + US [S-47] | 4 | 4 | 4 | PITR add-on | — | US 5 / TH 3 | SOC 2/ISO (Team+), HIPAA add-on | — | 4 |
| AWS RDS/Aurora PostgreSQL | Multi-AZ 99.95% SLA; backups 0–35 d; **Thailand region ap-southeast-7 available** (Multi-AZ DB *clusters* not offered there) [S-48] | 5 | 5 | 3 | 35 d | — | US 5 / **TH 5 (in-country)** | AWS programs | — | 5 |
| Postgres job queue (e.g. pg-boss / graphile-worker; library, runs on the same DB) | No vendor; jobs enqueued **in the same transaction** as the domain write | 5 | 4 | 5 | — | — | any | — | — | 5 |
| Temporal Cloud | $25–50 per M actions; 99.9–99.99% SLA; AWS Singapore/US; workflow-ID dedupe [S-51] | 4 | 5 | 3 | — | — | US 5 / TH 3 | SOC 2, HIPAA | 5 | 2 |
| Cloudflare Workflows + Queues | $0.30/M requests + steps; `step.sleep` to 365 d; instance ID dedupe; global edge incl. Bangkok [S-53] | 4 | 4 | 5 | 7–30 d instances | — | US 5 / TH 4 | — | 4 | 2 |
| AWS Step Functions + SQS | ~$0.025 per 1,000 transitions; runs up to 1 year; in ap-southeast-7 [S-54] | 4 | 5 | 4 | 90 d history | — | US 5 / TH 5 | AWS | 4 | 2 |
| Hosting: AWS (ECS/Fargate or EC2) | Bangkok + Singapore + US regions; API Gateway WebSockets 2 h max [S-59] | 5 | 5 | 3 | — | — | US 5 / TH 5 | AWS | — | 4 |
| Hosting: Fly.io | Singapore + US, no Bangkok; cold start "~2 s+" [S-56] | 4 | 3 | 4 | — | — | US 5 / TH 3 | — | — | 5 |
| Hosting: Cloudflare Workers + Durable Objects | Edge incl. Bangkok; WebSockets via DO; $5/mo min [S-55] | 5 (edge) | 4 | 5 | — | — | US 5 / TH 5 | — | — | 2 |

[REC] **One Postgres per geography with a Postgres-backed job queue** (timers for holds, PQ reminders/expiry,
retries, reconciliation, retention) — the job and the domain change commit together, which removes a whole class of
"timer created but row missing" bugs and one vendor. Temporal is the upgrade path if workflows outgrow it.
**US:** AWS (or Fly.io) in us-east + RDS or Neon US. **TH:** AWS ap-southeast-7 (Bangkok) for the voice runtime,
core and RDS when data must stay in Thailand; Singapore (Neon/Supabase/AWS) is acceptable for Gates A–B with
cross-border safeguards (L-T5). Cloudflare stays in front for DNS/WAF and may host the messaging-webhook edge.

### 7.8 Booking and calendar connectors, billing

| Option | Facts (official) | Lat | Rel | Cost | Ret | ZDR | Reg | Comp | Hook | Exit |
|---|---|---|---|---|---|---|---|---|---|---|
| Google Calendar API | Least-privilege scopes: `calendar.events.owned`, `calendar.app.created` (calendars the app creates), `calendar.events.freebusy`/`calendar.freebusy`; watch channels don't self-renew, no body in notifications; 410 on sync token → full resync [S-61] | 4 | 4 | 5 | — | — | global | Google verification for some scopes | 4 | 5 |
| Square Bookings API (US, Phase 3) | Search availability, create/update/cancel; webhooks `booking.created/updated` with HMAC-SHA256; **managing all bookings needs Square Appointments Plus ($49) or Premium ($149) per location**; **not available in Thailand** [S-60] | 4 | 4 | 3 | — | — | US 5 / TH 0 | — | 4 | 3 |
| Thai booking platform with public API | **None found** (Fresha, GoWabi: no public developer API found) | — | — | — | — | — | — | — | — | — |
| Stripe Billing | 0.7% of billing volume; metering up to 100M events/mo; Stripe now recommends Metronome for new usage integrations; usage events cancellable only within 24 h; **Thailand listed for sign-up**; TH cards 3.65% + ฿10 domestic, PromptPay 1.65% [S-62, S-63] | — | 5 | 4 | — | — | US 5 / TH 4 | PCI | 5 | 3 |
| Opn Payments (Omise, TH) | Cards 3.65%, PromptPay 1.65%; schedules API; no usage metering [S-64] | — | 4 | 4 | — | — | TH 5 | PCI | 4 | 4 |

[REC] Mirror our bookings into a calendar **the app creates** (`calendar.app.created`) and read the owner's own
calendars only as free/busy — the smallest grant that works. Meter in our own `usage_events` (SM-14) and invoice
through Stripe (invoice items keyed by usage-event id); Stripe Meters are optional, not the record.

### 7.9 Recommended stacks (neither approved nor deployed)

| Layer | **US variant** | **Thailand / LINE variant** |
|---|---|---|
| Inbound number | Business forwards its own number to a Telnyx (or Twilio) number | Business forwards to a number held **in the business's name** (Twilio TH mobile, or a Thai SIP provider) — D-11 |
| Voice runtime | LiveKit Agents on LiveKit Cloud (US) | LiveKit Agents + LiveKit SIP self-hosted in AWS Bangkok |
| STT | Deepgram Nova-3 / Flux | Azure th-TH or Deepgram Nova-3 Thai (blind test) |
| LLM | Claude (Haiku 5.5 / Sonnet 5.5 / Opus 5.5 by eval) | same, Thai prompts; residency check |
| TTS | Cartesia or ElevenLabs | Azure Thai neural/HD or Google Chirp 3 HD or ElevenLabs v4 (blind test) |
| Owner channel | SMS (iMessage optional later) | LINE OA push |
| Caller texts | SMS (10DLC) | SMS (registered sender name) |
| Core + DB + jobs | Postgres (RDS or Neon US) + Postgres job queue; AWS/Fly | Postgres (RDS Bangkok) + job queue; AWS Bangkok |
| Calendar | Google Calendar (app-created mirror + free/busy) | same |
| Booking platform | Internal ledger; Square in Phase 3 | Internal ledger (no Thai API exists) |
| Billing | Stripe Billing/Invoicing | Stripe Thailand (or Opn) |
