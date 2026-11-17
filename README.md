# Receptionist engine — Gate A (simulation only)

The deterministic core of the clean-room AI receptionist specified in `../BLUEPRINT-2026-11-11.md`. **Gate A:**
synthetic data, stand-in providers, no telephony, no language model, no real messages, no accounts. Every business,
person and phone number in `sim/seed.ts` is fictional. Owner decisions in force (blueprint §18, 11 Nov 2026): Thailand
first with LINE as the owner channel, massage / day spa, LiveKit Agents as the future voice runtime.

Its copy off this Mac is the private GitHub repository `MPC0367/ai-receptionist-engine` (since 17 Nov 2026), pushed
daily by the studio backup (`Studio/tools/snapshot.sh`, which checks the repository is private first). A backup only:
nothing here is deployed.

## Run it

```bash
npm run db:start      # project-local PostgreSQL 18 on 127.0.0.1:54421 (data in .data/, git-ignored)
npm test              # 123 tests (resets the rcpt_test database per test)
npm run sim           # seeds `rcpt` and plays three scripted calls, printing what each side receives
npm run db:stop
```

Node 26 runs the TypeScript directly (type stripping); dependencies are `pg` and the bundled PostgreSQL binaries
(`@embedded-postgres/darwin-arm64`, the same build Bella Clinic uses). After `npm install`, npm skips that package's
link script: run `node scripts/hydrate-symlinks.js` from inside `node_modules/@embedded-postgres/darwin-arm64` once.

## What is here

| Path | Blueprint | What it does |
|---|---|---|
| `migrations/` | §8 | Postgres schema: tenant keys everywhere, row-level security for the app role `rcpt_app`, the `no_double_booking` exclusion constraint (holds and bookings cannot overlap per staff member), append-only hash-chained `audit_events` |
| `src/time/` | §11.2 | Date/time resolution in the location's zone: Thai six-hour clock, Buddhist Era years, Thai digits, relative days, US DST gaps/overlaps; ambiguity becomes a clarification |
| `src/booking/engine.ts` | §11 | Availability, signed slot tokens, holds (180 s), code-rendered confirmation sentence, idempotent booking, atomic reschedule (incl. overlapping its own slot), cancellation with policy text from the record |
| `src/tools/` | §9 | Tool Gateway: Ed25519 per-call capability token (tenant/conversation/caller only from it), strict schemas, typed errors, idempotency keys, tool-call log |
| `src/escalation/` | §5.8 | Safety gate (tiers E/P/S/N, fail-closed), owner-reply validation, the pending-question state machine with timers, late path and the separate knowledge approval |
| `src/messaging/`, `src/inbound.ts` | SM-11, §5.8.5 | LINE and SMS signature checks, replay protection, STOP/START/HELP, one-time links, outbox with a sandbox transport |
| `src/jobs.ts`, `src/handlers.ts` | §11.8 | Postgres job queue: outbox dispatch with retries and dead-lettering, PQ reminders/expiry/late close, KC expiry |
| `src/metering.ts` | SM-14 | Billable-conversation rule v1 (draft, D-02), exactly once per conversation |
| `src/privacy.ts` | SM-12, SM-13 | Transcripts and stand-in recordings; retention passes (recordings 30 d incl. the provider's copy, content 90 d) honouring legal holds; code-verified deletion requests with an evidence package |
| `src/connectors/calendar.ts` | SM-10, §7.8 | Google Calendar: free/busy only from the owner's calendars, bookings mirrored to an app-created calendar with deterministic event ids, scope check, pause on revoked access, 410 resync, owner edits → staff tasks |
| `src/runtime/limits.ts` | §10.9, SM-2 | Latency watchdog (filler 1.8 s, recovery 4 s) and the call clock (warn 13 min, end 15 min) |
| `sim/model/` | D-04b | Model-driven runs: the model under test is the receptionist behind the deterministic runtime, a second model plays the caller, graders check the database; `node sim/model/run.ts` (dry run unless `--yes`, hard budget cap). `free-models.ts` runs the same harness on free routes (below) |
| `sim/fake-google.ts` | §17 | Google Calendar API v3 stand-in (shapes, 409, 410, 401, injected faults) |
| `spikes/livekit-transfer/` | D-04, SM-9 | The screened-transfer spike on self-hosted LiveKit + SIPp: seven cases pass (12 Nov 2026). Start at its `RESULTS.md`; `PLAN.md` was the plan |
| `sim/` | §17 | Seed, the scripted stand-in for the voice runtime (`session.ts`), and the demo (`run.ts`) |
| `test/` | §17 | Acceptance scenarios by AT id |

## Gate A limits (by design, not bugs)

- No voice runtime, telephony or LLM in `npm test`: `sim/session.ts` plays the runtime and the "model" parts come from
  scripts. Model-driven simulated callers (`npm run model:run -- --yes`) are the next Gate A step.
- Transfers are simulated in the engine (`transfer_sim`); only DTMF "1" counts as a human (INV-09). The LiveKit spike
  proved the real thing over SIP on 12 Nov 2026 (`spikes/livekit-transfer/RESULTS.md`): staff is screened in the
  caller's room with the caller's track muted at the server, because self-hosted LiveKit has no MoveParticipant.
- Model-driven runs on Claude need Anthropic credentials (`ANTHROPIC_API_KEY` in the git-ignored `.env.local`, or an `ant auth login` profile) and the owner's yes to spend (given 12 Nov 2026); the
  Opus 5.5 and Sonnet 5.5 calls opt into the server-side refusal fallback (`fallbacks: "default"`).
- Recording is off by default for Thai tenants (D-09); the policy flag `recording` turns it on (the greeting then says so).
- The owner web reply page accepts its one-time token alone; production also needs an owner session.
- Knowledge retrieval is keyword-based with Thai word segmentation (`Intl.Segmenter`); embeddings come later.
- The link domain `r.example.invalid` is a placeholder; a real one must be registered for Thai SMS (NBTC).
- Configuration is read live; pinning a call to a configuration snapshot is recorded but not enforced yet.
- Emergency numbers in `jurisdiction_contacts` are marked "PENDING human verification".

## Free model routes (12 Nov 2026)

The same harness runs on open models at no cost (`sim/model/free-models.ts`): Ollama on this Mac (native `/api/chat`,
so the context window is set per request, 16,384 tokens by default, `--num-ctx`), Cerebras's free trial and
Google's Gemini free tier (OpenAI-compatible `/chat/completions`), or any other OpenAI-compatible host
(`--provider openai-compatible --base-url …`). The runtime checks every tool call against the model-facing schema
itself (`checkArgs` in `tools.ts`): Claude's strict tool use guarantees the shape, these routes do not. A malformed call
never runs; the model gets `INVALID_ARGUMENTS` with the faults and the run counts it. Markup or an empty reply is
never read to a caller (`machine_text_rejected`, `empty_reply`). Reasoning in `<think>` is stripped. On every route the
model sees short labels (S1, H1, B1) instead of signed slot tokens and UUIDs, and no internal `*_id` fields; the runtime
maps labels back, and an unknown label is refused (`unknown_reference`). A placeholder for the caller's name
("คุณลูกค้า", "customer") is refused too: the model must ask.

```bash
npm run model:run -- --provider ollama --models gemma4:12b --yes          # local; the model must be pulled first
npm run model:run -- --provider cerebras --models gpt-oss-120b --yes      # CEREBRAS_API_KEY in .env.local
npm run model:run -- --provider gemini --models gemini-3.8-flash --yes    # GEMINI_API_KEY in .env.local
```

- Keys: `sh scripts/save-key.sh cerebras` (or `gemini`, `anthropic`): a hidden prompt; other saved keys are kept.
- One caller model for every receptionist model keeps the comparison fair: `--caller-provider`, `--caller-model`
  (default: the first `--models` entry on the same provider).
- Nothing is downloaded by the harness: a missing Ollama model stops the run with the `ollama pull` line to approve.
- Rate limits are waited out (Cerebras 5 a minute, Gemini 10 a minute, `--min-interval-ms`); a quota that is used up
  stops the run cleanly and the results so far are written. Cerebras stops at 900,000 tokens (`--max-tokens`).
- Ollama's thinking is off by default where a model can think, as on the Claude route (no extended thinking there,
  and a phone line cannot wait for it); gpt-oss cannot switch it off and reasons `low`. `--think on` or a level turns
  it on and gives the answer its own room on top of `max_tokens`.
- A broken reply (cut off, empty, markup) is asked again with the tools, then once for words only; a words-only reply
  that claims an action is thrown away. Ollama caps a reply at 200 tokens without thinking. `--temperature` sets it.
- A confirmation text goes only with the runtime's evidence that the caller said yes to a texting question
  (`text_consent_turn`); the model's `send_confirmation_text` alone books without a text. Promises the tools did not
  back (a transfer, a question sent, a text) are asked again once, then corrected by the runtime.
- `--only M01-book-thai,M04-emergency` runs chosen scenarios (a timing check first); results carry each run's tool log.
- Gemini's free tier uses prompts to improve Google's products: fictional data only, as here.
- What these runs cannot say: how Claude would do. No prompt caching, server-side fallback or strict tool use on this
  route. First real model, 12–13 Nov 2026: Gemma 4 12B on this Mac, 16/16 on the fourth full run; what it found and
  what is still open is in `sim/model/FINDINGS.md`.

