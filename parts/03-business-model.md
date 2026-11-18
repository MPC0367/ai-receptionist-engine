## 3. Business-model teardown

This section dissects the **capability class** using the dossier's evidence about Kirx, then states what an
original product should do differently. Claim ids (`C-xx`) point into the evidence ledger (§2). Nothing here
re-checks Kirx; every Kirx statement is second-hand from the dossier of 11 November 2026.

### 3.1 Customer segment and painful job

| | Evidence | Reading |
|---|---|---|
| Segment | Owner-operated or small-team appointment businesses in beauty and wellness [OBS, C-01, C-17] | The person who answers the phone is also the person with their hands on a client. |
| Painful job | A call missed while serving a client is a booking lost; callers who reach voicemail often call the next business [INF — common industry claim, **no evidence in the dossier**; must be measured in our own pilot] | The job is "turn an interrupted call into a booked appointment, and tell me", not "talk nicely". |
| What the buyer must believe | That the AI will not double-book, invent prices, or embarrass the business [INF] | Trust is bought with visible correctness: the booking appearing in the owner's own calendar, and the owner being told. |

**Thailand variant [REC]:** many Thai salons take bookings in LINE chat as much as by phone. The voice-first MVP
the brief prescribes is kept, but owner decision **D-03** asks whether a LINE-chat-first receptionist should come
before voice in Thailand, because it removes the hardest parts (Thai speech recognition, telephony provisioning) and
reuses O2's running LINE Messaging API work.

### 3.2 Commercial offer and billing unit

- Kirx: from US$0.49 per handled call/conversation, no subscription, setup fee or minimum; billed monthly in arrears
  to a saved card; missed calls free; ≥30 days' notice of price rises; no refunds for handled conversations except
  errors or legal requirement [OBS, C-02…C-11].
- **Ambiguity [OBS→INF, C-03]:** the homepage says "per call", the Terms say "each conversation the AI answers". For
  a text thread that spans days, or a call followed by a text answer, those differ.
- **Our rule [REC, SM-14, D-02]:** one billable *conversation* = one answered inbound call meeting the billable rule;
  every follow-up message, transfer, pending-question relay and caller reply that belongs to it is the same
  conversation; a later separate text conversation (Phase 4) is its own unit with a 24 h session window. The rule is
  versioned and printed on the invoice.

### 3.3 Acquisition and onboarding funnel

Observed Kirx funnel [OBS, C-23…C-25, C-40]: category landing page → canned homepage animation → callable demo for
a fictional spa with a live calendar → U.S. phone verification (Turnstile + OTP) → waitlist/sign-in → onboarding →
optional free use → usage billing.

Lesson [INF]: the strongest device is **seeing the action** — call, then watch the appointment appear. The canned
animation is marketing, not evidence of browser voice [OBS, C-24].

Our funnel [REC]: (1) a demo number answering for a clearly fictional business with a public, labelled demo
calendar (synthetic data only, `demo` badge on every event — INV-12); (2) assisted onboarding for the first 10
businesses (O2 sets up services/staff/FAQs with the owner — matches how O2 already sells); (3) self-serve only at
Gate D.

### 3.4 Activation moment

First real booking created by the AI that appears in the authoritative calendar **and** whose owner notice was
delivered (SM-1). Secondary activation: the first owner answer relayed to a caller.

### 3.5 Expansion and retention loops

| Loop | Mechanism | Our stance |
|---|---|---|
| Knowledge loop | Unknown question → owner answers by text → (separately) approved as FAQ → fewer escalations [OBS stated behaviour, C-15, C-16] | Keep, with KC approval (SM-8 §5.8.7). This is the main compounding asset. |
| Channel expansion | Calls → messages → WhatsApp/LINE → reminders → promotions [OBS, C-20] | Phase-gated (§16); promotions only with affirmative opt-in. |
| Client memory | Preferred name, visits, notes, loyalty, gift-card balance [OBS, C-21] | Phase 3+; bounded, notes never spoken. |
| Mappings | Staff/service/calendar mappings accumulate [INF] | Exportable at any time (switching cost should come from usefulness, not lock-in). |

### 3.6 Switching costs

Kirx-assigned numbers stay with Kirx after cancellation [OBS, C-12]. That is a retention lever [INF]. **Our rule
[REC, D-11]:** prefer call-forwarding from the business's own number; if we assign a number, the Terms state plainly
what happens on exit and we support porting out where the carrier allows. Knowledge, services and booking history are
exportable (CSV/JSON) from the dashboard.

### 3.7 Provider and regulatory dependencies

Kirx discloses ~10 providers (model, orchestration, STT, carrier, iMessage/SMS, WhatsApp, billing, database,
hosting) [DIS, C-26, C-30]. Every one is a correlated failure and contract risk [INF]. Regulatory dependencies:
AI and recording disclosure, texting consent (TCPA/CTIA in the US; PDPA in Thailand), carrier registration (A2P
10DLC), health-data exclusion (HIPAA in the US; PDPA section 26 sensitive data in Thailand). Details: §12 and the
legal register in §2.4.

### 3.8 Direct variable costs

Per answered minute: carrier inbound minutes, speech-to-text, language-model tokens, text-to-speech, orchestration
platform fee (if managed), recording storage; per conversation: confirmation/owner messages, number rental share,
support and rework. Computed with current official prices in §14.

### 3.9 Duration sensitivity under flat per-call pricing

Revenue per call is flat; cost grows with minutes. The dossier's illustrative band (US$0.082–0.129/min on one
public configuration) means US$0.49 covers roughly 3.8–6.0 minutes of direct voice-stack cost before messaging,
hosting and support [INF from a provider calculator, C-38 — not Kirx's actual cost]. Our model (§14) computes
break-even minutes for both stacks and recommends a duration policy: soft cap with a warning at 13 min, hard end at
15 min (SM-2), long-call monitoring, and a pricing decision (D-01) between flat-per-call, per-minute, hybrid, and
subscription + usage.

### 3.10 What can and cannot be concluded about traction

**Cannot be concluded:** number of paying businesses, calls, bookings, revenue, conversion lift, labour saved, or
product-market fit [UNK, C-33]. The demo's "bookings added" count is demonstration data [OBS, C-33]. "Early-stage"
is an inference from fresh legal dates, a waitlist sign-in and limited indexed presence [INF, C-37] — not proof of
launch status. **Can be concluded:** a callable workflow exists that writes to a visible demo calendar [OBS, C-40],
and the company has chosen a usage-priced, iMessage-first, U.S.-only wedge [OBS].

### 3.11 Contradictions to resolve in our own product

| Contradiction | Evidence | Our resolution [REC] |
|---|---|---|
| Marketing lists health practices, physical therapy and med-spa-like categories; Terms exclude HIPAA-covered and medically operated businesses and businesses mainly serving under-13s | [OBS, C-17, C-18] | Eligibility enforced in SM-1 `eligibility_review` with an allow-list; marketing lists only allowed categories; no health vertical in the MVP in either geography. |
| "Per call" vs "per conversation" | [OBS, C-02, C-03] | One written, versioned billing rule (SM-14, D-02). |
| "24/7" vs "subject to provider availability" | [OBS] | Publish a measured availability figure only after Gate C data exists; until then say "answers when the service is available; falls back to your number". |
| AI-assigned number vs owner's number | [OBS, C-12] | Forwarding first (D-11). |

### 3.12 The O2 business model options (owner decision D-01)

| Model | For | Against |
|---|---|---|
| Flat per answered call | Simple, feels fair, easy trial | Long calls compress margin (§14) |
| Per minute | Cost-aligned | Owners fear an open meter; punishes good long conversations |
| Outcome-based (per booking) | Aligned with value | Disputes over attribution; zero revenue on FAQ-only calls that still cost money |
| Hybrid (per call + per-minute over N min) | Protects margin on outliers | Slightly harder to explain |
| Subscription + usage (THB monthly plan with included calls, then per call) | Matches how Thai SMBs already buy LINE OA plans; predictable revenue | Higher entry barrier than pure usage |

Recommendation [REC]: hybrid for the US variant; subscription + included calls + overage for the Thailand variant.
Final prices only after Gate C measures real duration distributions (§14).
