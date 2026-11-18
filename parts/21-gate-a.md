
---

## Gate A progress (11 Nov 2026)

Opened on the owner's "Use the defaults" (§18). Simulation only: fictional data, stand-in providers, sandbox
messages; nothing reached a phone, LINE or a calendar.

**Built** in `engine/` (GitHub repository `MPC0367/ai-receptionist-engine`, private from 17 Nov 2026 and public since 18 Nov 2026, whose root is this whole folder, blueprint included; start at `engine/README.md`): Postgres schema with tenant
keys, row-level security for the app role and the `no_double_booking` exclusion constraint; the date/time resolver;
the booking engine; the Tool Gateway with signed per-call tokens; the safety gate, owner-reply validation and the
pending-question and knowledge-approval machines with timers; LINE/SMS signature checks, replay protection,
STOP/START/HELP and one-time links; the outbox and job queue; metering; a scripted stand-in for the voice runtime and
`npm run sim`.

**Tested:** 73 automated tests, all passing, covering AT-01–AT-11, AT-13–AT-29, AT-31–AT-33, AT-35, AT-37–AT-41,
AT-43–AT-52, plus RLS on raw SQL, the audit hash chain, quiet hours, STOP after a question, the per-number booking limit,
calendar scope and staleness rules, and a regression test for each review finding.

**Step 2 (12 Nov 2026, on "continue with the next Gate A steps"):** retention and deletion (`src/privacy.ts`), the Google
Calendar connector against a stand-in with Google's response shapes (`src/connectors/calendar.ts`, `sim/fake-google.ts`),
the latency watchdog and call clock (`src/runtime/limits.ts`), recording objection and recording off by default for Thai
tenants (D-09), and the model-driven harness (`sim/model/`) proven in a dry run with a scripted model.

**Not yet covered at Gate A:** AT-12 (external-platform saga — no external authority in the Thailand MVP), AT-30 as a
network test (needs the deployed runtime), AT-42 (no external booking platform in Thailand), AT-53 real calls (Gate B).
**Step 3 (12 Nov 2026, on the owner's "Approve both"): the LiveKit screened-transfer spike ran and passes** — see the
section below. **Still waiting on the owner:** the first model-driven run (`npm run model:run -- --yes` in `engine/`:
needs an Anthropic API key in the git-ignored `engine/.env.local`, which the owner pastes there themselves; estimated
≈ US$10 for 8 scenarios × 2 × Haiku 5.5, Sonnet 5.5 and Opus 5.5, hard stop at US$30). It is approved; it has not run
because no key is on this Mac yet.
**Step 4 (12 Nov 2026, on the owner's "Yes, build it", from `reports/Free routes for the AI receptionist.md`): the free
model routes.** `engine/sim/model/free-models.ts` runs the same harness on Ollama (this Mac, native `/api/chat` with the
context window set per request), Cerebras's free trial and Gemini's free tier (OpenAI-compatible). Because those routes
have no strict tool use, the runtime now checks every tool call against the model-facing schema itself and hands faults
back to the model (`INVALID_ARGUMENTS`; the tool never runs), and never reads markup or an empty reply to a caller —
two guards the real voice runtime needs too if it ever runs an open model. **First real model run, the same day (the
owner's "Yes, download it"): Gemma 4 12B on this Mac passed 14/16, then 15/16 after fixes.** Reading the transcripts
found faults in our runtime, each fixed with a test (91 now): the model sees short labels (S1, H1, B1) instead of
signed tokens and UUIDs (it changed a signature); placeholder names are refused; a move is confirmed as a move
("จาก… เป็น… ยืนยันเลื่อนนัด", not "book it"); only the write tool that fits the hold is offered; **after a failed write
the caller hears the runtime's "nothing has changed yet" — Gemma had said the move was confirmed after a refusal**;
labels are never spoken; ไม่รู้สึกตัว/สลบ and similar join the emergency list and a discarded reply after an emergency
repeats the emergency line; a cut-off reply is never read out. **On 13 Nov (the owner's "Yes, fix it") the empty runaway replies were traced and fixed: Gemma sometimes starts a tool
call it never finishes and Ollama's parser hides the tokens; a broken reply is now asked again with tools, then once
for words only, and a words-only reply may not claim an action. Fourth full run: 16/16, 93 tests.** Then ("Yes, fix it") promises the model never keeps are caught: a transfer said but
not bridged, a question said to be sent but never sent — asked again with a note, then the runtime tells the truth; and an
unknown service name now comes back as such, with the menu (it had been read as "nothing free"). Sixth full run 15/16
(the caller model's fault, fixed in the harness), 99 tests. **Then ("Yes, do that") a confirmation text goes only with
the runtime's evidence of the caller's yes to a texting question (`text_consent_turn`, gateway-enforced); the model's
flag alone sends nothing. Seventh full run 16/16: Gemma set the flag unasked in 7 of 16 calls, all blocked, 103
tests.** **Then ("Yes, offer it") the runtime offers the text itself after a booking or a move, reads the answer by code and
sends through a runtime-only step that needs the caller's yes; a caller's own request ("ขอข้อความยืนยันด้วย") is
honoured unasked. Ninth run: texts exactly as agreed. A cancelled booking can no longer be "moved" (Gemma had cancelled
and failed to rebook). 107 tests.** **On 16 Nov ("Yes, download it") gpt-oss-20b ran the same 16 against the same
Gemma caller: 8/16, against Gemma's 14/16.** It booked every Thai "พรุ่งนี้" for today (it shortened the caller's
words for the day and time), invented names ("คุณสวัส" from "สวัสดีค่ะ"), sent empty strings for optional fields (14 of
27 invalid calls), and about 4.8 s a call without model loading, the same as Gemma on battery. It exposed four gaps
in our runtime that apply to every model: **a "your booking is confirmed" with no write attempted was spoken** (only
claims after a *failed* write were caught), a time said to be taken that was never searched, a date phrase that drops
the caller's day or time, and a name the caller never said. The M02/M08 graders now check the day (Gemma's earlier
passes were all on the right day). **The same day ("Yes, fix them") all four were fixed in the runtime: a completion
claim needs a write that succeeded, "taken" needs a search that found it so, a date phrase missing the caller's day
or time is refused with their words, and a booking name must be whole words the caller said (Thai segmented). Re-run:
gpt-oss-20b 14/16, every Thai booking on the right day; Gemma 4 12B 16/16; 116 tests.** It also found a fifth gap,
a move made as a new booking, **fixed on "Yes, fix it"**: a new-booking hold waits for the caller's bookings to be
looked up when they ask to move or mention a booking they have; a booking, move or cancellation needs the caller's
*first* turn after the read-back to be a yes (the gateway had accepted any later turn, and gpt-oss booked a stale
hold on a "yes" to a confirmation it had written itself); the model may not speak as the runtime. 122 tests. The
re-run exposed a resolver fault: **a day of the month without a month name ("วันที่ 21", "the 21st") was read as
today**, and "วันศุกร์ที่ 20" as the coming Friday. **Fixed the same day ("Yes, fix it"):** that day this month, or
next month once passed; a day the month lacks or a weekday that disagrees is asked; of 72 saved date phrases only the
five misspelt ones read differently; 123 tests. Open: vaguer promises and latency (4–20 s a call: not a live-call
model on this Mac). Record: `engine/sim/model/FINDINGS.md`. **18 Nov 2026, a talk page (the owner's "make it something i can talk to"):** `engine/sim/talk/` (`npm run talk`, 127.0.0.1:4520) puts a person in the caller's seat, typing or speaking, against the same runtime and a free local model, with the real date, its own database and the sandbox; beside the call it shows each tool step and what the model saw, the diary, the caller's texts and the owner's LINE, where the owner's side can be played (answer, approve, save the answer). The first conversations booked, texted and learned an answer, and found two gaps: the question is not restated before it goes to the owner (prompted, not enforced), and an answer saved in Thai is not found when asked in English (keyword retrieval). 124 tests. **Both fixed the same day ("Yes, fix both"):** the runtime reads a question back and only the caller's yes sends it and stands as the permission to text; facts are looked up with the question in both languages. **A voice call** followed ("make it so that i can actually hop on a call"): in Safari or Chrome the browser's speech service hears the caller and the receptionist answers in Gemini's voice, as O2's video voice-overs ("make it sound more human"), with "สักครู่นะคะ" while it works. **The owner decided the greeting need not say it is an AI** ("dont anounce that you're an ai assistant"): it is now the business's policy `ai_disclosure` (on by default in the engine, off on the talk page); asked, the receptionist always says it is an AI, and a reply claiming to be a person is replaced. This departs from §10.1 and the ledger's "disclose anyway" (L-T14 Thailand, L-U3/L-U5 US): counsel decides before Gate B. 127 tests. Cerebras and Gemini wait on a free sign-up and key. These runs test the runtime and the scenarios and can say whether an open model is good enough;
they cannot rank Claude models (D-04b), which still needs the paid run or credits.

### LiveKit screened transfer (12 Nov 2026)

Run on this Mac against SIPp, with no carrier, number or cloud account: livekit-server v1.13, livekit/sip v1.23 and
redis in the colima VM; SIPp 3.8.0 as caller and staff phone; each phone sends a tone and records what it hears, so the
results prove who heard whom (`engine/spikes/livekit-transfer/RESULTS.md`, `RESULTS.json`).

| Case | Outcome | Proof |
|---|---|---|
| S1 staff presses 1 | `bridged`, 68 ms after the digit | caller heard no whisper or staff while screening; staff heard the whisper and not the caller; then each heard the other |
| S2 voicemail, no digit | `returning:no_dtmf` after 10 s | the voicemail never heard the caller |
| S3 staff presses 2 | `returning:declined` | as S2 |
| S4 no answer | `returning:no_answer` at the ring timeout | the caller heard only silence |
| S5 busy | `returning:busy` in 82 ms | — |
| S6 caller hangs up while staff is screened | `abandoned_during_transfer`; staff leg removed 24 ms later | no staff leg left behind |
| S7 caller presses 1 while staff is screened | ignored → `returning:no_dtmf` | only the staff leg's digits count |

Three full runs, every case passing every time. What it changed:

| Found | Change |
|---|---|
| `MoveParticipant` (screen in a separate room, then move staff in) is "not implemented" on self-hosted LiveKit | Staff is screened in the caller's room; before dialling, the caller's track is muted at the server and the caller hears nothing; DTMF 1 unmutes (SM-9; server needs `room.enable_remote_unmute: true`) |
| Unsubscribing the staff leg from the caller does not hold: the SIP leg subscribes when it answers, so a voicemail heard the caller at full level | Never used as a privacy control |
| Taking publish permission from the caller hides them, but livekit/sip never publishes again: no audio after the bridge | Never take publish permission from a SIP participant |
| The caller's keypad reaches the same room even with its audio muted | Only DTMF from the staff leg's identity counts (S7) |
| The caller hears silence while staff is screened; SM-9's 25 s cap did not fit its 20 s ring + 10 s screen | Ring 15 s + screen 10 s = 25 s; the announcement says the caller may hear silence. Hold audio on self-hosted (mute the staff track as it is published) is untested |

Not proven yet (Gate B): a real SIP trunk (Twilio/Telnyx, then a Thai provider), real phones and voicemail systems,
early media, carrier timing. Rig fixes worth knowing (UDP needs colima's grpc port forwarder; SIPp's `play_dtmf` needs
root on macOS) are in the results file.

### Independent review (11 Nov 2026)

A separate read-only reviewer checked the engine against this blueprint and confirmed 14 faults, four serious. All
14 are fixed, each with its own regression test (`engine/test/review.test.ts`):

| | Fault | Fix |
|---|---|---|
| R1 | An owner of two businesses: an answer quoted for one could be sent to the other business's caller ("the only open question" fallback ran in each business) | Explicit references only (quote or `Q-XXXX`); an unresolved reference is never redirected; plain text from a multi-business owner asks which question |
| R2 | Reschedule and cancel texted the caller without asking | Only after the caller's yes, with transactional consent recorded |
| R3 | A STOP while the answer waited for a retry left the question stuck in `relaying` | STOP closes it as `caller_unreachable(opted_out)` and tells the owner |
| R4 | Retrying an unreachable owner reused a message key, so nothing was re-sent | A retry round in the key |
| R5 | An owner reply while the question was `owner_unreachable` crashed and was lost | Allowed; a failed webhook frees its receipt so redelivery is processed |
| R6 | Opening a confirmation link (a link preview or carrier scanner does) confirmed a third party's number | Links show a page; only the button press acts (opt-out too) |
| R7 | `create_booking` could consume a reschedule hold → a second appointment | Refused; a reschedule search/hold must name a booking the caller owns |
| R8 | Quiet hours applied only to the answer | Every non-exempt caller text waits for 08:00–21:00 |
| R9 | An SMS owner with several open questions was messaged on LINE | Asked by SMS; `Q-XXXX: answer` accepted |
| R10 | Links on IP addresses and Thai-script domains passed the allow-list | Every link-shaped token is parsed; only allow-listed Latin domains pass |
| R11 | A booking could be saved under a name the caller did not confirm | The hold's confirmed name must match |
| R12 | Cancel checked only that confirmation fields existed | The spoken cancellation sentence (with its fee) is hash-checked and must come before the yes |
| R13 | A reschedule overlapping its own slot held nothing | The non-overlapping part is held; the commit claims the full span |
| R14 | The caller ID was texted unvalidated | Must be a valid mobile number for the country |

### Design changes found while building

| Finding | Amends | Change |
|---|---|---|
| Thai SMS sender names are one-way: replies cannot be routed back | UQ4, SM-11, §7.6, §5.8.4 | Thailand uses one-time links to confirm a different reply number and to opt out; the owner's SMS fallback carries a one-time reply page instead of "reply with the answer" |
| Thai has no spaces, so whitespace keywords never match | T-01 (§9.3), KC | Keywords are extracted with Thai word segmentation and a stop-word list; answers learned from owner replies need at least half their content words (≥2) to match, curated answers one |
| An owner reached by SMS has no button for "Send" | §5.8.4–§5.8.5 | Fixed grammar `SEND Q-XXXX` for two-way SMS; the web reply page is itself the preview |
| A staff member with no hours of their own matched nothing | §11.3 | Staff without their own rows follow the location's hours; any own row means only those rows |
| A reschedule to an overlapping time with the same staff member collided with its own booking | §11.6 | The hold defers its claim; the commit releases the old claim and claims the new span in one transaction |
| The emergency gate ran only when a question had no approved answer | UQ1, SM-2 | The tier-E rules now run on every caller turn in the runtime (tested: an emergency mid-booking interrupts it); the real voice runtime must do the same |
| Two callers inserting overlapping holds at the same instant can deadlock under an exclusion constraint (seen 1 run in 8) | §11.4 | Claim changes are serialised per staff member with a transaction-scoped advisory lock taken before any audit insert; deadlock/serialisation failures are retried (all writes are idempotent). The constraint remains the guarantee |
| A staff member whose calendar is disconnected or stale may be busy | SM-10, §11.3 | Never offered until a fresh sync (≤ 30 min); if nobody can be offered the AI logs a booking *request* for staff (`log_booking_request`) and says it is not a booking |
| A 15-minute call outlives a 15-minute call token | §6.3 | The runtime renews the token every 10 minutes while the call is live |
| A bare "สามโมง" is 09:00 or 15:00 | §11.2 | Business hours settle it when only one fits; otherwise the caller is asked; the read-back always gives 24-hour digits and the period word |
