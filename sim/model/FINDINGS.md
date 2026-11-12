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

### Still open

- **Empty runaway replies.** Several times a run Gemma produced ~1,000 tokens that were all reasoning (stripped), so
  the reply was empty: the runtime says "ระบบขัดข้องเล็กน้อย" and moves on, but each one costs 20–40 s and one cost a
  reschedule. Now counted (`replies that were all reasoning`). Possible fixes, untried: stop generation at `<think>`,
  and let the runtime ask once more before giving up.
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
