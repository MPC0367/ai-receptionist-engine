# Model-driven runs: what they found

Raw results (transcripts, tool logs, timings) are in `results/` (git-ignored). This file keeps what they taught us.

## 12 Nov 2026 — Gemma 4 12B on this Mac (Ollama 0.40.2), the first real model through the harness

Free route, on the owner's "Yes, build it" and "Yes, download it". Receptionist and caller both `gemma4:12b`
(7.7 GB), thinking off, 16,384-token context, M4 Pro 24 GB on a 90 W charger. Fictional data only; nothing left the Mac.

| Run | Code | Passed | Mean time per model call | Notes |
|---|---|---|---|---|
| First full run | `ac4de1f` + labels | 14/16 | 28.4 s | both reschedules failed; 6 retries, one call hit the 5-minute timeout |
| Second full run | `bc568bb` | 15/16 | 12.1 s | one M02 run ended when the caller model stopped answering |
| M04 + M07 ×2 | after the emergency fixes | 3/4 | 9–23 s | one reschedule lost to empty replies (below) |
| Third full run | `29df4e4` (words-only retry) | 15/16 | 10.9 s | 3 runaways all recovered; the failure was the retry claiming "recorded" |
| **Fourth full run** | **`ee4c3bf`** (retry with tools, then words only, no claims) | **16/16** | 12.8 s | 1 runaway, recovered; no "system trouble" line reached a caller |
| Fifth full run | `8ea5030` (promised transfers caught) | 14/16 | 8.9 s | M02: an unknown service read as "nothing free"; M03: a question promised, never sent |
| Sixth full run | `3ea4a51` (relay promises, NOT_FOUND names the service) | 15/16 | 7.9 s | the failure was the caller model hanging up on a question; M02 then 3/3 with the caller rule |
| **Seventh full run** | **`c257179`** (a text only on the caller's yes) | **16/16** | 5.9 s | Gemma set the text flag unasked in 7 of 16 calls (both English bookings whose caller said no text): all blocked, no text sent |
| Eighth full run | `808b427` (the runtime offers the text) | 13/16 | 5.2 s | offered every time; the simulated callers had hung up in the same breath as their yes |
| Ninth full run | `8ee122c` (a caller's own request is honoured) | 14/16 | 5.6 s | texts exactly as agreed (2 requested, 1 declined); M06 an unsearched time, M07 a cancel-and-rebook |
| M07 ×4 | `b091b6d` (no change to a cancelled booking) | 4/4 | 3.6–8.4 s | every move by search → hold → reschedule, each followed by the runtime's offer |

Passing scenarios across both full runs: Thai booking, English booking, unknown question → pending question, prompt
injection, known FAQ, emergency. Gemma's Thai is natural and polite; it follows the tool flow once the runtime keeps it
on the rails.

### Faults in our runtime that the run exposed (all fixed, each with a test)

| Found | Fix |
|---|---|
| Gemma changed one character of a signed slot token and could not hold the time | The model sees short labels (S1, H1, B1); the runtime maps them back and refuses a label it never gave. Internal `*_id` fields are left out |
| It booked as "คุณลูกค้า" / "Guest" without asking | Placeholder names are refused: the model must ask |
| The confirmation read "ในชื่อคุณคุณ…" | A name given with คุณ is not doubled (engine) |
| A move was confirmed with "ยืนยันจองเลยไหมคะ" ("book it?"), which reads like a second booking | A hold that moves a booking reads "เลื่อนนัด… จาก… เป็น… ยืนยันเลื่อนนัดเลยไหมคะ" / "moving … from … to … Shall I move it?" (engine) |
| It called create_booking on a reschedule hold (refused), **then told the caller the move was confirmed** | Only the write tool that fits the hold is offered; after a failed or refused write the caller hears the runtime's "nothing has changed yet", never the model's words |
| It said "ลำดับที่ B1" to the caller | A reply that contains an internal label is thrown away; the prompt says never to say them |
| It asked for the caller's phone number | The prompt says the number is already known |
| After 1669, "แม่ยังไม่รู้สึกตัว" / "สลบ" were not emergency words, and the caller heard "no confirmed answer" twice | ไม่รู้สึกตัว, ไม่ฟื้น, ไม่ตอบสนอง, สลบ, ไม่ได้สติ, unresponsive, won't wake added (the list is still PENDING human verification); once an emergency came up, any discarded reply is replaced by the emergency line |
| A reply that runs to the token limit could have been read out | Never read out (`reply_cut_off`); Ollama caps a reply at 1,024 tokens without thinking |
| The caller's "yes, thanks [HANGUP]" was dropped with the hang-up | The words before [HANGUP] reach the receptionist (harness; would have hit the Claude run too) |
| The caller model spent its 400 tokens thinking and said nothing | Thinking off by default on Ollama, as on the Claude route |

### The empty runaway replies (fixed 13 Nov 2026)

Replaying the call that triggered them showed what they were: with tools on offer, Gemma sometimes starts a tool call it
never finishes, and Ollama's `gemma4` parser holds every token back, so the reply arrives empty at the cap — no words,
no reasoning, no call. Bisecting the tool list found no single tool to blame; a lower temperature made it worse (5 of 6
replays at 0.3, so it is a loop, not bad luck); with the tools removed it answered normally every time. Fixed in the
runtime, not the model:

- a broken reply (cut off, empty, markup) is asked again with the tools first, then once for words only
  (`tool_choice: none`; Ollama gets no tools), and the broken reply leaves the history;
- a words-only reply that says something was booked, sent, recorded, moved, cancelled or transferred is thrown away —
  no tool could have run (the first version of the retry let Gemma say "บันทึกคำถาม…ไว้ให้ทีมงานแล้วค่ะ" when nothing
  was sent); negations ("ไม่สามารถโอนสาย", "can't transfer") are kept;
- Ollama caps a reply at 200 tokens without thinking (normal replies ran 16–62), so a runaway costs ~10 s, not a minute.

### Said but not done (fixed 13 Nov 2026)

The same fault three ways: the model tells the caller something happened, or will, that no tool did.

| Seen | Now |
|---|---|
| "เดี๋ยวจะต่อสายให้เจ้าหน้าที่" (I'll put you through) without `request_human_transfer` | `promisesTransfer`: unless a transfer was bridged (DTMF 1), the reply is asked again with a note; a second time the runtime says "ตอนนี้ดิฉันยังต่อสายให้เจ้าหน้าที่ไม่ได้ค่ะ…" |
| "จะส่งคำถามให้ทางทีมงานแจ้งกลับ…" without `request_owner_answer` — no question was sent | `promisesRelay`, backed by `request_owner_answer` or `log_booking_request`; a second time the runtime says it has not been sent and offers to send it |
| A bare `NOT_FOUND` for "นวดเท้า 60" (the menu has 45) told the caller ten times that nothing was free | The gateway says it is the service that was not found, with the name given and the menu (`ToolError.detail`); the prompt says NOT_FOUND never means no free times |

Offers ("…ต่อสายให้ไหมคะ?", "would you like me to pass this to the team?") and refusals ("ไม่สามารถโอนสายได้") are not
promises; over the 462 real AI lines from the runs the two checks flag only the genuine false claims. On the real model
the re-ask led Gemma to call the tool and answer its result honestly. The simulated caller now answers a question
before hanging up (it had hung up on "ยืนยันจองเลยไหมคะ").

### Texts only on the caller's yes (fixed 13 Nov 2026)

The model's `send_confirmation_text` used to be the whole of the consent. Now the gateway sends a booking, reschedule or
cancellation text (and records transactional consent) only with `text_consent_turn`, the runtime's evidence of the
caller's yes; the runtime notes the AI turn that offers a confirmation text and reads the caller's next turn itself
(a refusal wins: "ใช่ค่ะ จองเลย ไม่ต้องส่งข้อความนะคะ" is no). Without it the write goes through without a text and the
model is told why; "จะส่งข้อความยืนยัน…" with nothing queued is caught like the other unkept promises. M07 and M08, whose
callers want no text, now fail if one is queued. In the seventh run Gemma set the flag unasked in 7 of 16 calls and
**never once asked** the caller: every one was blocked.

### The runtime offers the text (13 Nov 2026, the owner's "Yes, offer it")

After a booking or a move with no text sent, if the number can take one (`can_text`: a valid mobile, a sender, no STOP)
and the caller has not said no, the runtime ends the turn with its own question ("จองเรียบร้อยแล้วค่ะ ต้องการรับข้อความ
ยืนยันการจองทางเบอร์ที่โทรมาไหมคะ"). The answer is read by code: yes sends it through the runtime-only `send_booking_text`
(it needs the caller's yes as evidence, only for their own booking, once; no client name in the text), no settles it,
anything else goes to the model. A caller who asks for a text in their own words ("ขอข้อความยืนยันทางมือถือด้วยนะคะ")
gets it without being asked. In the ninth run texts went exactly as agreed: two callers asked and got one, one said
"No, thank you" and got none, callers who hung up before answering got none.

Found on the way and fixed: "ขอบคุณครับ" would have counted as a yes ("ครับ" contains "รับ"), so yes is read by whole Thai
words; a move's summary text read "เลื่อนนัด… เลื่อนนัด… ไหมคะ" after the move wording changed; and Gemma once moved a
booking by cancelling it and rebooking, leaving the caller with nothing when the rebooking failed — a cancelled booking
can no longer be moved (the error points to a new booking) and the prompt forbids cancel-and-rebook.

## 16 Nov 2026 — gpt-oss-20b against Gemma 4 12B (the owner's "Yes, download it")

`gpt-oss:20b` (13 GB, OpenAI's open-weight model, reasoning "low") as the receptionist, the caller fixed at `gemma4:12b`
as before, code `b264c80`. Run on battery in macOS Low Power Mode (the Mac's own setting, not changed), so for the times
Gemma was re-run on three scenarios under the same conditions. The first attempt stopped after two scenarios when the
lid closed (Clamshell Sleep at 23:01; every later call timed out); the run below was made again with `caffeinate`.

| | gpt-oss-20b | Gemma 4 12B |
|---|---|---|
| Passed (graders checking the day, below) | **8/16** | 14/16 in its last full run; 3/3 on the re-run |
| Thai bookings on the right day | **0 of 4** (all booked "today" for "พรุ่งนี้") | every one, in all nine runs |
| Invalid tool calls | 27 in 105 calls | 2 in 20 calls (re-run) |
| Mean time per call, Low Power Mode | 8.7 s; **4.8 s without loading** | 6.4 s (one model loaded, no swaps) |

The two models do not fit in the Mac's GPU together, so gpt-oss's 8.7 s includes Ollama swapping it with the Gemma
caller; on a phone line only the receptionist runs, so 4.8 s is the fair figure: about Gemma's speed, still not a
live-call speed. gpt-oss writes its Thai with mixed ค่ะ/ครับ and ฉัน/ผม in one reply, and stiffer phrasing than Gemma.

**The grader gap it exposed (fixed):** M02 and M08 checked the hour, not the day, so M02 passed gpt-oss's booking for
today. Both now require Friday 13 Nov (`bangkokDay` in `scenarios.ts`). Every earlier Gemma booking was on the right
day (checked in the saved transcripts), so its results stand.

**What gpt-oss did, and which of it our runtime let through:**

| Seen | Runtime | 
|---|---|
| **"Your booking is confirmed for tomorrow at 4 pm" with no booking made** (M08 #2: both holds refused, no write attempted) | **Let through** (fixed the same day, below). The "nothing has changed yet" line covers a *failed* write; nothing checked a completion claim when no write was tried. Applies to every model |
| "ไม่มีเวลาที่บ่ายสามโมงในวันที่ 21" after searching only "21 พฤศจิกายน" (the morning came back); 15:00 was free. The caller took 11:00 (M07 #2) | Let through: the grounding check sees offered times, not a claim that a time is *not* free |
| `date_phrase` cut from the caller's words: "พรุ่งนี้ตอนบ่ายสาม" → "ตอนบ่ายสามโมง" (booked today), "21 พ.ย. บ่ายสาม" → "21 พฤศจิกายน" | Let through: the runtime trusts the model's phrase. The read-back said "วันพฤหัสบดีที่ 12" and the simulated caller agreed; a person might not notice either |
| Names never given: "คุณสวัส" (from "สวัสดีค่ะ"), "คู่นี้", "คุ" | Let through: only placeholder words ("ลูกค้า", "Guest") are refused |
| Every optional field sent as `""` (`for_booking_ref: ""`): 14 of the 27 invalid calls | Refused and handed back; it retried without the field. Costs a call each time |
| `request_owner_answer`'s `reply_target` guessed nine ways, an invented `owner-123`, and the parking question filed as "ร้านมีกี่ชั่วโมงทำการ" (M03 #1) | Refused; the caller heard that nothing was sent (safe, no use) |

### The four gaps fixed (16 Nov 2026, the owner's "Yes, fix them"), and both models again

| Gap | Now |
|---|---|
| A completion claim with no write | `claimsDone`: unless a booking, move or cancellation succeeded in this call, the reply is asked again with a note, then the runtime says "ยังไม่ได้จองหรือเปลี่ยนนัดให้นะคะ…" / "nothing has been booked or changed yet" |
| "Not free" for an unsearched time | `claimsTaken`: allowed only after a search found a time taken or a CONFLICT; otherwise asked again, then "ดิฉันยังไม่ได้เช็กเวลานั้นค่ะ…". Staff/transfer wording is not a time |
| A date phrase without the caller's day or time | `mentions()` in the resolver: a search or booking request that leaves out a day (other than today) or a time the caller said is refused with their words, once per caller turn; only a missing part, never a different one (a move names two days) |
| A name the caller never said | `saidAsName`: whole words of the caller's own turns, Thai segmented ("สวัส" in "สวัสดีค่ะ" is not a word); a name may end before a polite particle, because the segmenter reads "ชื่อบีนะคะ" as ชื่อ\|บีน\|ะ\|คะ (the first version refused Gemma's "บี" for it). A move leaves the name out |

Also: an empty string for a field now means "not given", like null. Replayed over every saved call, the claim
checks stop 4 lines, all genuine false claims (gpt-oss's two, and Gemma's "the move is confirmed" after a refusal
on 12 Nov); every name they refuse is a stand-in, the staff member's name or a piece of a greeting.

| Run, same scenarios, caller and graders | Passed | Thai bookings on the right day | What the new checks did | Time per call |
|---|---|---|---|---|
| gpt-oss-20b before (`b264c80`) | 8/16 | 0 of 4 | — | 8.7 s (4.8 s without loading) |
| **gpt-oss-20b after (`1cc7777`)** | **14/16** | **all** | kept the day 7 times, refused 3 names, 1 unsearched "taken" | 9.1 s (5.0 s without loading) |
| **Gemma 4 12B after** | **16/16** | all | refused 2 names ("คุณลูกค้า", and "บี" by the bug above) | 5.9 s |

All three on battery in Low Power Mode. gpt-oss's two failures: M02 ended at the read-back because the simulated
caller had already said yes and hung up (gpt-oss had closed its offer with "ขอบคุณครับ."); M07 is a new gap:

- **A move made as a new booking.** Asked to move the 20 Nov appointment, gpt-oss never called
  get_bookings_for_caller and booked 21 Nov as a new appointment: the caller now has two. The read-back said
  "ยืนยันจองเลยไหมคะ", not "เลื่อนนัด", and the simulated caller agreed. Nothing ties a caller's "ขอเลื่อนนัด" to a
  hold that moves a booking. Not fixed.

### A move made as a new booking, fixed (16 Nov 2026, the owner's "Yes, fix it")

The first fix (`6b3d159`): while the caller is asking to move a booking ("ขอเลื่อนนัด", "reschedule"), a new-booking
hold is refused until get_bookings_for_caller has run, and while it found one, until that booking is moved or the
caller asks for another appointment as well. M07 again: gpt-oss 2/3, Gemma 2/2. The failure was a second road to
the same double booking:

| Seen (gpt-oss, M07) | Now (`031eca0`) |
|---|---|
| The caller only described their booking ("ขอสายคุณบีที่จองนวดไทยไว้ตอนบ่ายสามวันที่ 20"); gpt-oss held a second appointment at the same time with another therapist | `mentionsOwnBooking` ("ที่จองไว้", "มีนัด", "my appointment") counts like a move: the bookings are looked up first. It fires on no saved line outside M07 |
| The caller's answer to the read-back was "ขอเปลี่ยนวัน…แทนได้ไหมคะ?"; two turns later their "ยืนยันค่ะ" booked the stale hold: the gateway only checked that the yes came after the read-back | `readBackYes`: a booking, move or cancellation needs the caller's **first** turn after the read-back to be a yes (`answersReadBack`: "ยืนยันจองเลยค่ะ", "ถูกต้องค่ะ"; a no to a text in the same breath is not a no to the booking), with nothing after it that changes it; that turn is the confirm_turn. Over 111 saved read-backs it reads 109 yeses and the two corrections |
| gpt-oss wrote "(ระบบอ่าน) "ย้ายคิวของคุณบี … 21 พ.ย. …"" itself, for a hold on 20 Nov, and the caller said yes to that | `speaksAsRuntime`: a reply in the runtime's voice ("(ระบบ…)", opening "ขอทวนนะคะ:") is asked again, then replaced |

M07 once more: gpt-oss 2/3, Gemma 1/1 (and M01, M08 1/1 each, the yes rule on ordinary bookings). The Mac slept
mid-run when the lid closed (Gemma's M07 shows 204 s a call: the pause, not the model). gpt-oss's failure was not a
double booking: it wrote the month as "พรรณิกายน", the runtime read back a move to Thursday 12 Nov, the caller said
"ไม่ใช่ 12", and the yes rule moved nothing. That exposed a fault in the resolver itself:

- **A day of the month without a month name was read as today.** `resolveWhen` at 10:00 on 12 Nov: "วันที่ 21 บ่ายสาม"
  → 12 Nov 15:00, "the 21st at 3pm" → 12 Nov 15:00, and "วันศุกร์ที่ 20 บ่ายสาม" → Fri 13 Nov (the "20" ignored). Callers say
  "วันที่ 21" all the time; every route and model goes through it. **Fixed the same day ("Yes, fix it"):** a bare day
  of the month ("วันที่ 21", "วันศุกร์ที่ 20", "the 21st", "on the 21") is that day this month, or next month once it
  has passed; a day the month lacks ("วันที่ 31" in November) and a weekday that disagrees ("วันพฤหัสที่ 20", a Friday)
  are asked, never guessed; "the 21st of December" now reads its month. Of the 72 date phrases in the saved runs, only
  gpt-oss's five "21 พรรณิกายน" read differently (12 Nov → 21 Nov). 123 tests.

### Still open

- **Vaguer promises** such as "เดี๋ยวฉันประสานงานให้" (I'll coordinate it) after a refused transfer are not caught: too
  loose to read reliably.
- **A words-only reply thrown away for a claim** leaves the caller with "ระบบขัดข้องเล็กน้อย" — safe, but blunt.
- **Latency.** 4–20 s a call on this Mac is a test speed, not a phone speed (the blueprint's filler is at 1.8 s,
  recovery at 4 s). Gemma 4 12B on this Mac is not a live-call model as it stands.
- **The grounding guard makes a weak model look evasive**: asked for "around 4pm", Gemma answered with a time it had
  not searched and was replaced twice by "I don't have a confirmed answer". Safe, but a search on the caller's words
  would have been better. The grader passed it (it books the first offer).
- **The caller model is weak too**: one failure (M02) was the caller going silent. A stronger fixed caller (Gemini free
  tier, Cerebras) would make results steadier.
- None of this says how Claude would do (D-04b). The fixes above apply to every route.

## 18 Nov 2026 — talking to it (sim/talk, the owner's "make it something i can talk to")

The talk page (`npm run talk`, http://127.0.0.1:4520) puts a person in the caller's seat against the same runtime, with
the real date and time, the fictional spa in its own database (`rcpt_talk`) and the sandbox transport. The first
conversations, Gemma 4 12B, Thai, on mains power (90 W):

- **A booking in three turns:** "ขอจองนวดไทย 60 นาที พรุ่งนี้บ่ายสาม" → one search, Thursday 19 Nov 15:00 offered (13.8 s
  with the model loading, 7.8 s warm); the name → the runtime's read-back (1.5–4.3 s); "ใช่ค่ะ" → booked, the runtime
  offered the text (12 s); "ได้ค่ะ" → text queued. Once the model set `send_confirmation_text` before the caller had
  said yes to a text: refused (`text_without_consent`), and the runtime asked instead.
- **The owner loop works end to end:** an unknown question (parking) went to the owner's LINE; the owner's reply came
  back as a preview to approve; Send texted it to the caller; "save for future callers" made it an approved answer, and
  a new Thai caller was then answered from it by `get_business_facts`.
- **Fixed (18 Nov, "Yes, fix both") — the model skipped the restatement:** on "ได้ค่ะ ส่งให้หน่อย" Gemma called `record_consent` and
  `request_owner_answer` at once, without restating the question and asking whether it is right (the prompt asks for
  it; the runtime does not enforce it). It also said once that the question had been sent before any tool ran
  (`relay_promise_without_tool`: asked again, then it ran the tools).
- **Fixed (18 Nov, "Yes, fix both") — a learned answer was found only in its own language:** asked in English "do you have parking at the spa?",
  `get_business_facts` returned no_answer; the answer the owner saved is found by its Thai words only (retrieval is by
  keyword, see README limits). A saved answer needs keywords in both languages, or retrieval beyond keywords.
- **Fixed — the English greeting read the Thai name** "ร้านสปาตัวอย่าง": locations now have `name_en` (migration 009).

### The two fixes, a voice call, and the greeting (18 Nov 2026)

- **The runtime reads a question back before it goes to the owner.** `request_owner_answer` (or `record_consent`) first
  makes the runtime say "ขอทวนคำถามนะคะ: “…” ถูกต้องไหมคะ ถ้าถูกต้อง ให้ทีมงานส่งคำตอบเป็นข้อความไปที่เบอร์ที่ลงท้ายด้วย 01
  ได้ไหมคะ"; only the caller's yes as their next turn sends it, and that yes is the recorded permission to text. A
  correction or a no to the text sends nothing. Gemma 4 12B on the talk page: read back, then sent on "ถูกต้องค่ะ".
- **Facts are looked up in both languages.** `get_business_facts` takes `question_other_language`; Gemma filled it
  unprompted beyond the instruction, and the parking answer the owner saved in Thai was found for "is there parking at
  your spa?" and answered in English.
- **A voice call** on the talk page (Safari or Chrome): the browser's speech service hears the caller; the reply is
  spoken in Gemini's voice (as O2's video voice-overs; `gemini-3.8-flash-lite-tts` and three others in turn, ~3 s a
  line, every line kept in `.data/tts`), with "สักครู่นะคะ" at 1.8 s while the model works; it listens again only when
  the voice has finished. When the free voice quota is used up, the Mac's voice answers.
- **The greeting no longer has to say it is an AI** (the owner: "dont anounce that you're an ai assistant"): the
  tenant policy `ai_disclosure` (on unless set false; the talk page sets it off by default). Asked "am I talking to a
  person?", the runtime always answers "ดิฉันเป็นผู้ช่วย AI ของร้านค่ะ…" itself, and a reply that claims to be a person
  or staff is replaced by that sentence (`asksIfAI`, `claimsHuman`). The blueprint's ledger still says to disclose
  anyway in Thailand (L-T14, draft Thai AI Act) and at the start of US calls (L-U3, L-U5): counsel decides before Gate B.

## 18 Nov 2026 — Gemini 3.5 Flash-Lite for speed, a name, a more human voice

The owner: "make the voice more human sounding … it introduces itself as in name … It doesnt have to say สักครู่ just
increase the speed of the processor … i dont have to click send every time".

- **Gemini 3.5 Flash-Lite (free tier, the key already in the shell) is the talk page's default model.** One request
  measured about 1 s at first (Gemma 4 12B: 4–15 s), but the free tier's speed swings with Google's load: later the
  same request took 5–9 s and a one-line request 5.5 s; 3.8 Flash answered 503 "high demand". On the 16 scenarios:
  14/16, then 16/16 once two things were fixed: (1) **Gemini 3 signs each tool call** (`extra_content.google.thought_signature`)
  and refuses the next turn unless the call comes back with it; `free-models.ts` now keeps and returns it; (2) with no
  name the model **invented one for itself**, once the caller's ("แพรยังไม่มีข้อมูล…", "ให้แอมส่ง…"); the prompt now
  says to call itself ดิฉัน, or the business's name for it, never any other name. M03's caller persona was written for
  the old flow and hung up on the runtime's new read-back; it now answers it.
- **A name:** policy `assistant_name` (per language); the greeting says it as a front desk does ("สวัสดีค่ะ
  ร้านสปาตัวอย่าง มิ้นท์รับสายค่ะ", "this is Mint"), the prompt gives it, and the truthful answer uses it ("ดิฉันชื่อมิ้นท์
  เป็นผู้ช่วย AI ของร้านค่ะ…"). Without a name nothing changes.
- **More human speech:** the prompt asks for everyday spoken phrasing (times as "บ่ายสาม", no brackets or symbols, a first
  name or nickname is enough); what is voiced is the spoken form of each line (`sim/talk/spoken.ts`: "15:00 น.
  (บ่ายสามโมง)" → "บ่ายสามโมง", no year). Gemini rated both voice models 7/10, the giveaway "the flat pitch on each
  ค่ะ", so the named Thai greeting says ค่ะ once.
- **Faster voice:** Gemini's speech now streams (`streamGenerateContent?alt=sse`): the first audio after about 1 s
  instead of about 3.3 s for the whole line; the page plays the pieces as they come and the whole line is cached.
- **No fillers** ("สักครู่นะคะ" is gone, by the owner's word), and **no Send button needed**: the page sends what it
  heard after about a second of quiet, final or not (Safari rarely marks speech final, so words sat in the box).
- **Open:** the free tier's speed. Consistently fast replies need a faster host (Groq's free tier, an account) or a paid
  Gemini key (a fraction of a cent a turn): the owner's choice.

## 20 Nov 2026 — Groq (the owner's "Groq free account"), and a consent bug it found

- **Speed:** gpt-oss 120B, gpt-oss 20B and Qwen 3.8 27B on Groq answer a receptionist request in 0.5–0.7 s (Gemini's free
  tier the same night: 5–9 s; Gemma on this Mac 4–15 s). **Limits** (free tier, per model): 8,000 tokens a minute,
  1,000 requests and 200,000 tokens a day; a request is about 2,100 tokens, so roughly three a minute and ~90 a day.
  The talk page's default "Fast" chains gpt-oss 120B → 20B → Gemini Flash-Lite and skips a model at its limit (a
  minute, or half an hour when the day is used up) instead of waiting.
- **Groq refuses a whole reply** when a tool argument does not match the schema on its side (a `null` in an optional
  field, `tool_use_failed`): `free-models.ts` now hands the refused call (`failed_generation`) to the runtime, which
  checks arguments itself. **Gemini 3 needs every tool call in the conversation signed**: calls another model made
  carry Google's documented `skip_thought_signature_validator`; Groq never gets Google's field.
- **Scenarios:** booking (M01, M02, M08) 6/6 on gpt-oss 120B on the final prompt; M03–M07 passed on 120B before the last
  prompt change and again on gpt-oss 20B after it; a clean 16/16 on 120B was cut short by its daily tokens. Two
  failures were the stand-in callers (Gemini, then Qwen) hanging up on the read-back: the harness now reminds a caller
  once to answer a direct question, and M02/M08's scripts answer the read-back.
- **Fixed — one booking question, not two:** gpt-oss asked "อยากจองเลยไหมคะ?" and then the runtime read back "ยืนยันจองเลย
  ไหมคะ". When the search finds the very time asked for and the name is known, the model now holds at once, and the
  read-back is the only question (one turn fewer).
- **Fixed — a text the caller refused was sent:** "ไม่อยากได้ข้อความยืนยันนะคะ" was read as a request ("อยากได้ข้อความ").
  `declinesText` (ไม่อยาก/ไม่ต้องการ/ไม่จำเป็น/ไม่ขอ…, "no need for a text") now always wins: no text is sent or offered.
- **Fixed — English calls said "นก":** free times carry `staff_name_en`.
- **Open:** a name read as "บีนะ" from "บีนะคะ" (Thai word breaking; "ชนะ" shows why "นะ" cannot simply be cut); the
  live link's address changes whenever the quick tunnel restarts (it was dropped overnight: "Tunnel not found").
