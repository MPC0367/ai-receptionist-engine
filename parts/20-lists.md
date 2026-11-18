## Closing lists

### Safe to build now *(on the owner's go for Gate A — synthetic data, stand-in providers, no real people)*

- Postgres schema and migrations (§8), RLS policies, the `no_double_booking` exclusion constraint, hash-chained
  audit.
- Booking engine: availability maths, holds, CAS updates, internal-authority reschedule/cancel (§11).
- Deterministic date/time resolver incl. US DST rules, Thai six-hour clock and Buddhist Era years, with unit tests
  (Thai phrase table to be confirmed by the D-14 reviewer).
- Tool Gateway with envelope binding, schemas, typed errors and idempotency (§9).
- All state machines (SM-1…SM-14) including UQ/PQ/KC, against stand-in telephony, LINE and SMS adapters that replay
  recorded official payload shapes.
- Owner-reply validators (card/ID detectors, URL allow-list, price-conflict check) and the STOP/START/HELP parser.
- Conversation templates as **drafts** marked "pending D-07".
- Call simulator, all automated suites in §17.1, cost-regression baselines, synthetic dashboards (badged).
- A LiveKit spike proving screened transfer (whisper + DTMF 1) against a SIP stand-in.

### Needs an owner, legal or provider decision

- D-00 proceed as clean room; counsel on competitive-use risk.
- D-06 geography and data location; D-16 vertical; D-04 runtime; D-04b turn model (eval).
- D-07 disclosure, recording and consent wording (EN/TH) — counsel.
- D-09 recording on/off and retention values; D-19 counsel engagement.
- D-11 numbers (forwarding; Thai number held by the business or a licensed partner) — counsel on Thai licensing.
- D-05 owner channel model (one O2 LINE OA vs each business's OA; iMessage in the US or not).
- D-10 US 10DLC registration; Thai SMS sender-name registration per business.
- D-13 pilot business and its written consent; D-14 Thai speech blind-test panel.
- D-01/D-02 pricing and billing rule; D-12, D-17, D-18 operating defaults; D-20 on-call.
- Provider items: Anthropic zero-data-retention terms for the chosen model; Thai SIP trunk pricing and number
  rules; LINE agency requirements from 1 Feb 2027; Google OAuth app verification for calendar scopes.

### Must not be built or claimed yet

- Any claim about customers, bookings, conversion, savings, uptime or "24/7" — ours or Kirx's — until measured at
  Gate C; any comparison naming Kirx without counsel.
- Real calls, real texts, real customer data, real calendars (before Gate B/C approvals).
- Health, medical, physical-therapy or child-focused businesses; Bella Clinic's clinic lines.
- Payments, deposits, gift cards, loyalty, promotions, reminders, outbound AI calls.
- O2-issued or resold Thai phone numbers.
- iMessage for caller texts; any relay-device channel as a core dependency.
- Automatic learning: knowledge from calls, transcripts, AI summaries or unapproved owner messages.
- Voiceprints, speaker identification or voice cloning.
- Machine-translated owner answers sent without the owner's approval of the exact text.
- Anything using Kirx's code, prompts, copy, branding, UI, artwork or private APIs.
