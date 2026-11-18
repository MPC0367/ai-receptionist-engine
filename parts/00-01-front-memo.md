# AI Receptionist — Clean-Room Architecture and Implementation Blueprint

**Prepared** 11 November 2026 (Asia/Bangkok) for the owner of O2 Design Studio · **Status:** design only — nothing
built, deployed, called or sent · **Controlling brief:** "Claude Opus 5.5 Master Prompt — Clean-Room Reconstruction
of Kirx's Capability" · **Evidence pack:** "Kirx Voice Receptionist — Business Model, Action Chain, and Clean-Room
Mechanism Dossier" (both 11 Nov 2026) · **Working name:** "the Receptionist" (D-15).

**How to read the labels.** Evidence: **[OBS]** observed · **[DIS]** disclosed · **[INF]** corroborated inference
(a hypothesis) · **[REC]** design recommendation (ours, not a claim about Kirx) · **[UNK]** unknown (never filled
in). Conversation sentences: **[CODE]** fixed template · **[RECORD]** value from a verified record · **[MODEL]**
model phrasing within limits. Ids: C/P/L claims (§2), INV invariants (§4), SM state machines (§5), T tools (§9),
TH threats (§12), RB runbooks (§13), AT acceptance tests (§17), D decisions (§18), K/S/LS sources (§19).

**Contents.** 1 Executive decision memo · 2 Evidence ledger · 3 Business-model teardown · 4 Product truth and
unknowns · 5 Journey maps and state machines · 6 Architecture and trust boundaries · 7 Provider decision matrix ·
8 Data model · 9 Tool/API contracts · 10 Conversation policy · 11 Booking-integrity design · 12 Security, privacy and
abuse model · 13 Failure and operations matrix · 14 Economics model · 15 Metrics and dashboards · 16 Gated delivery
roadmap · 17 Test program and acceptance catalogue · 18 Owner decisions required · 19 Source register · Closing
lists.

---

## 1. Executive decision memo

**Decision asked of the owner:** whether O2 builds an original AI receptionist for appointment businesses, where it
launches first, and whether to open Gate A (simulation only).

### What the evidence supports

- The capability class is real and narrow: answer the call, disclose AI, understand the request, read live
  availability, confirm exactly, write the booking once, tell both sides, and escalate what the AI does not know
  [OBS/INF, §3]. The defensible part is the **verified action chain**, not the voice.
- Kirx is a U.S.-only, usage-priced (from US$0.49 per handled conversation) entrant whose legal entity also runs
  Bowers, a Thai beauty/wellness booking platform [OBS, C-01, C-02, C-34]. Its traction, margins, models and
  internals are **unknown** and are not used anywhere in this plan [UNK, C-32, C-33].
- Its own materials contradict each other on eligibility (health categories marketed, HIPAA businesses excluded) and
  on the billing unit (call vs conversation) [OBS, C-17–C-19, C-03]. We resolve both by design (§3.11).

### Recommendation [REC]

1. **Open Gate A only** (simulation: synthetic data, stand-in telephony and messaging, no real people) once the four
   Gate A blockers are decided: **D-00** proceed as a clean-room build with counsel briefed; **D-06** geography;
   **D-16** vertical; **D-04** voice runtime.
2. **Thailand first, LINE as the owner channel** (D-06). O2 already runs the LINE Messaging API in production, Thai
   speech is a barrier for U.S. entrants, and the U.S. owner channel Kirx relies on (iMessage) depends on
   relay-device providers that Apple has not sanctioned [OBS, P-09]. The U.S. variant is fully specified and
   deferred.
3. **One non-medical vertical** (massage/day spa or hair salon), **one location, one authority** — our own booking
   ledger, because Square does not operate in Thailand and no Thai booking platform publishes an API [OBS, P-12,
   P-13]; Google Calendar only as busy-time source and mirror.
4. **The model never writes.** Every booking passes signed slot tokens → a database hold that physically refuses
   overlaps → a code-built confirmation sentence → an idempotent, versioned write committed with its messages
   (§9, §11).
5. **Voice runtime: LiveKit Agents (open source)** — the only option that lets us prove a human answered a transfer
   (screen + DTMF), self-host in Bangkok, and leave cheaply (§7.2).
6. **Unknown questions never hold the caller**: admit uncertainty → safety gate → live transfer if a person is
   actually available → otherwise confirm the exact question, the number and permission to text → expiring pending
   question → owner gets only the minimum on LINE/SMS → the owner's reply is authenticated, validated and previewed
   → the caller receives the owner's exact words → saving it as reusable knowledge is a separate tap (§5.8).

### Economics in one paragraph

With the recommended stacks and **placeholder** call lengths (mean 2.95 min), direct cost is about **US$0.22 (US)
and US$0.27 (Thailand) per answered conversation**, about US$0.54 / US$0.66 per confirmed booking. A flat US$0.49
per call breaks even at **~8.8 min (US) / ~8.1 min (TH)**; on a managed platform (Vapi) the U.S. break-even falls to
4.9 min. A **hybrid** price (per call including 4 minutes, then per minute) keeps every duration band above ~36% in
the U.S. model. In Thailand the **per-business inbound number** (US$25.30/month at Twilio's published rate) is the
largest margin driver at small volumes; a Thai SIP provider's (unpublished) price decides whether a low-priced Thai
plan works (§14).

### Legal and timing flags

Counsel before Gate B: disclosure/consent wording (EN/TH), Thai telecom licensing (O2 must not issue or resell
numbers — L-T15), PDPA cross-border transfers to model and speech providers (L-T5), recording basis in Thailand
(L-T9), and the competitive-use risk of studying Kirx's site (§2.5). Dates: **FCC revocation-of-consent rules in
force 25 Nov 2026** (L-U13); **LINE Reply API charges from 1 Feb 2027** (P-10).

### What must not happen

No traction or comparison claims involving Kirx; no health/medical vertical (Bella Clinic itself is excluded); no
payments, promotions, reminders or outbound AI calls in the MVP; no iMessage for caller texts; no automatic learning
from calls; no real calls or messages before Gate B approvals.

### Decisions needed now

D-00, D-06, D-16, D-04 (Gate A). Everything else in §18 can wait for its gate.

**Update, 11 Nov 2026:** the owner answered "Use the defaults". Decided: proceed as a clean room (D-00); Thailand
first with LINE (D-06); massage / day spa (D-16); LiveKit Agents (D-04). Gate A (simulation only) is open — see §18.

**Update, 12 Nov 2026:** the screened transfer is proven on self-hosted LiveKit against SIPp (seven cases, media proof
of who heard whom). Self-hosted LiveKit cannot move a call between rooms, so staff is screened in the caller's room
with the caller muted at the server — see "LiveKit screened transfer" at the end. The paid model comparison is
approved and waits only for an API key on this Mac.
