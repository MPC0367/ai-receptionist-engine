# Receptionist engine — Gate A (simulation only)

The deterministic core of the clean-room AI receptionist specified in `../BLUEPRINT-2026-11-11.md`. **Gate A:**
synthetic data, stand-in providers, no telephony, no language model, no real messages, no accounts. Every business,
person and phone number in `sim/seed.ts` is fictional. Owner decisions in force (blueprint §18, 11 Nov 2026): Thailand
first with LINE as the owner channel, massage / day spa, LiveKit Agents as the future voice runtime.

## Run it

```bash
npm run db:start      # project-local PostgreSQL 18 on 127.0.0.1:54421 (data in .data/, git-ignored)
npm test              # 73 tests (resets the rcpt_test database per test)
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
| `sim/model/` | D-04b | Model-driven runs: the model under test is the receptionist behind the deterministic runtime, a second model plays the caller, graders check the database; `node sim/model/run.ts` (dry run unless `--yes`, hard budget cap) |
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
- Model-driven runs need Anthropic credentials (`ANTHROPIC_API_KEY` in the git-ignored `.env.local`, or an `ant auth login` profile) and the owner's yes to spend (given 12 Nov 2026); the
  Opus 5.5 and Sonnet 5.5 calls opt into the server-side refusal fallback (`fallbacks: "default"`).
- Recording is off by default for Thai tenants (D-09); the policy flag `recording` turns it on (the greeting then says so).
- The owner web reply page accepts its one-time token alone; production also needs an owner session.
- Knowledge retrieval is keyword-based with Thai word segmentation (`Intl.Segmenter`); embeddings come later.
- The link domain `r.example.invalid` is a placeholder; a real one must be registered for Thai SMS (NBTC).
- Configuration is read live; pinning a call to a configuration snapshot is recorded but not enforced yet.
- Emergency numbers in `jurisdiction_contacts` are marked "PENDING human verification".
