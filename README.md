# O2 AI receptionist (clean-room)

O2's original AI phone receptionist for small businesses: it answers calls, books into the business's own diary without
double-booking, texts confirmations, and passes questions it cannot answer to the owner on LINE. Designed clean-room on
11 Nov 2026; built so far only as **Gate A: simulation**. Fictional businesses, people and numbers; nothing reaches a
real phone, LINE account or calendar. Public since 18 Nov 2026, to share with colleagues.

| Path | What it is |
|---|---|
| `BLUEPRINT-2026-11-11.md` | The blueprint: memo, evidence ledger, state machines, architecture, providers, data model, tools, policies, economics, gates, tests, decisions. Assembled from `parts/` by `assemble.sh`: edit the parts, then reassemble. |
| `parts/` | The blueprint's sections, one file each. `21-gate-a.md` records what Gate A has built and found. |
| `engine/` | The Gate A engine: PostgreSQL booking core, tool gateway, escalation to the owner, messaging sandbox, the model harness and the talk page. Start at `engine/README.md`. |
| `economics-model.mjs` | Reproduces the blueprint's §14 unit economics. |
| `reports/`, `research_notes/` | The free-routes research of 12 Nov 2026 (free models, Thai speech, telephony credits, tutorials) and its notes. |

## Talk to it

```bash
cd engine
npm run db:start
npm run talk          # http://127.0.0.1:4520 — a voice call in Safari or Chrome, or typing
```

Decisions in force (blueprint §18, 11 Nov 2026): clean room, Thailand first with LINE as the owner's channel,
massage / day spa, LiveKit Agents as the future voice runtime. Never open kirx.com for this work, never issue Thai
phone numbers, and keep Bella Clinic out of it (medical). Counsel decides the disclosure and consent wording before
Gate B.

Built by O2 Design Studio — https://o2-designstudio.com
