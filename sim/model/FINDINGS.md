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

### Still open

- **Nobody asks about the text.** Gemma never offered one, so no caller got a confirmation text even when they would
  have liked one (M01's caller would have said yes). Whether the runtime should ask itself, as a fixed sentence after a
  booking, is a product decision.

- **Vaguer promises** such as "เดี๋ยวฉันประสานงานให้" (I'll coordinate it) after a refused transfer are not caught: too
  loose to read reliably.
- **A words-only reply thrown away for a claim** leaves the caller with "ระบบขัดข้องเล็กน้อย" — safe, but blunt.

- **Latency.** 4–20 s a call on this Mac is a test speed, not a phone speed (the blueprint's filler is at 1.8 s,
  recovery at 4 s). Gemma 4 12B on this Mac is not a live-call model as it stands.
- **Text consent is the model's word.** In one reschedule Gemma set `send_confirmation_text: true` without asking (the
  persona did not want a text). The gateway records consent on that flag; the runtime cannot tell whether the caller
  agreed. Worth a deterministic check (the caller's yes after a texting question) before any real call.
- **The grounding guard makes a weak model look evasive**: asked for "around 4pm", Gemma answered with a time it had
  not searched and was replaced twice by "I don't have a confirmed answer". Safe, but a search on the caller's words
  would have been better. The grader passed it (it books the first offer).
- **The caller model is weak too**: one failure (M02) was the caller going silent. A stronger fixed caller (Gemini free
  tier, Cerebras) would make results steadier.
- None of this says how Claude would do (D-04b). The fixes above apply to every route.
