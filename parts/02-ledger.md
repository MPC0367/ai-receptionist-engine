## 2. Evidence ledger

### 2.1 Method and limits

- **Kirx evidence** comes only from the supplied dossier (`K-01`, 11 Nov 2026), which cites Kirx's public pages
  (`K-02…K-08`). For this blueprint **no Kirx page was opened**, no call placed, no form submitted, no account
  created, no endpoint probed. Every Kirx row is therefore second-hand; its confidence is capped at **Medium**.
- **Provider facts** come from three research passes on 11 Nov 2026 that read only official vendor pages (and, for
  law, statutes, regulators and reputable firm summaries); sources `S-xx` and `LS-xx` in §19.
- Labels are used literally: **OBS** observed · **DIS** disclosed · **INF** corroborated inference (hypothesis) ·
  **REC** design recommendation · **UNK** unknown (never filled in).

### 2.2 Kirx claims

| Id | Claim | Class | Source | Confidence | Implication for our design | Verification needed |
|---|---|---|---|---|---|---|
| C-01 | U.S.-only AI receptionist for appointment-led beauty and wellness businesses | OBS | K-01 §1; K-02, K-05 | Medium | Kirx is not in Thailand as of the evidence; US variant competes directly | Counsel re-reads Terms geography before any market statement |
| C-02 | Published starting price US$0.49 per call/conversation | OBS | K-01 §2; K-02 | Medium | Market reference only (§14) | — |
| C-03 | Terms bill "each conversation the AI answers" (vs homepage "per call") | OBS | K-01 §2; K-05 | Medium | Define our unit precisely (SM-14, D-02) | — |
| C-04 | No subscription, setup fee or minimum | OBS | K-01 §2 | Medium | Low-friction trial is the norm to beat | — |
| C-05 | Missed calls not charged | OBS | K-01 §2; K-05 | Medium | Our non-billable reasons list (SM-14) | — |
| C-06 | Monthly in arrears to a saved Stripe card | OBS | K-01 §2 | Medium | — | — |
| C-07 | Possible free period / free usage limit | OBS | K-01 §2 | Medium | Free allowance in §14 | — |
| C-08 | ≥30 days' notice before unit price increases | OBS | K-01 §2 | Medium | Adopt similar notice (D-02) | — |
| C-09 | Unpaid balances may pause service | OBS | K-01 §2 | Medium | SM-1 `paused` routes to the owner's phone | — |
| C-10 | Cancel by turning off forwarding and informing Kirx | OBS | K-01 §2 | Medium | Forwarding-first design (D-11) | — |
| C-11 | No refund for handled conversations except errors/legal | OBS | K-01 §2 | Medium | Adjustments flow (SM-14) | — |
| C-12 | Owner may keep their number and forward; Kirx-assigned numbers stay with Kirx after cancellation | OBS | K-01 §2 | Medium | We prefer forwarding and disclose exit plainly | — |
| C-13 | Discloses AI and, on calls, active recording | OBS (stated behaviour, not exercised) | K-01 exec. | Medium | Disclosure templates (§10.1) | — |
| C-14 | Owner notifications by iMessage/SMS; no new staff app | OBS (marketing) | K-01 §1 | Medium | Owner lives in an existing channel (LINE in TH) | — |
| C-15 | Unknown question → uncertainty, handoff offer, follow-up confirmation, owner text, caller text after reply | OBS (marketing; not exercised) | K-01 §1, §5E | Medium | SM-8 designed independently | — |
| C-16 | Owner answer saved for future callers only after explicit approval | OBS (stated) | K-01 exec. | Medium | KC machine | — |
| C-17 | Marketing lists health practices, physical therapy, med-spa-like categories | OBS | K-01 §1 | Medium | We list only eligible categories | — |
| C-18 | Terms exclude HIPAA-covered businesses (medical practices, PT clinics, medically operated med spas) and businesses mainly serving under-13s | OBS | K-01 §1; K-05 | Medium | Eligibility gate SM-1 | — |
| C-19 | C-17 and C-18 conflict | INF | K-01 §10 | Medium | Resolve at onboarding (§3.11) | — |
| C-20 | Square or similar booking data; Google Calendar write-back and busy reading; optional WhatsApp | OBS (marketing) | K-01 §1 | Medium | Production readiness UNK; ours is phased | — |
| C-21 | Client context: preferred name, near-birthday, recent visits, notes, loyalty, gift-card balance (restricted) | OBS (stated) | K-01 §1 | Medium | Phase 3+; notes never spoken | — |
| C-22 | Public site is Next.js on Vercel | OBS (HTTP/bundle) | K-01 §4 | Medium | None (frontend choice irrelevant) | — |
| C-23 | `/demo` polls `/api/demo` every 3 s; returns tenant, time zone, menu, totals, live-call state, hours, staff windows, bookings, blocks | OBS | K-01 §4 | Medium | Demo-as-proof pattern (§3.3) with labelled synthetic data | — |
| C-24 | Homepage "Pick up" is a canned animation; no microphone; "Try your voice" had no handler | OBS | K-01 §4 | Medium | Not evidence of browser voice | — |
| C-25 | Get Started: US phone, Turnstile, OTP via waitlist service, server-side sign-in | OBS | K-01 §4 | Medium | Our SM-1 starts similarly with stronger abuse controls | — |
| C-26 | Neon database; Railway and Vercel hosting | DIS | K-01 §4 | Medium | Not adopted by default (§7.7) | — |
| C-27 | `api.` and `waitlist.` subdomains resolve to Railway | OBS (DNS) | K-01 §4 | Medium | — | — |
| C-28 | Generic JSON 404 consistent with FastAPI/Starlette | INF (weak) | K-01 §4 | Low | None | — |
| C-29 | Demo API returns UUID ids; demo appointments marked source `kirx` | OBS | K-01 §4 | Medium | `source` + `is_synthetic` fields | — |
| C-30 | Disclosed providers: Anthropic (replies), Vapi (orchestration, recording, speech), Deepgram (STT), Telnyx (numbers/calls), Blooio (iMessage, SMS, codes), Meta (WhatsApp), OpenAI (limited voice testing), Stripe (billing) | DIS | K-01 §4; K-06 | Medium | Independent selection (§7) | — |
| C-31 | Call path Telnyx → Vapi → Deepgram → Anthropic → tools → TTS → events → ledger | INF | K-01 §4 | Low–Medium | Our boundary is provider-neutral (§6) | — |
| C-32 | Exact model, TTS provider, call duration, concurrency, vendor rates | UNK | K-01 §1 | — | Measure our own (§14, §15) | — |
| C-33 | Paying businesses, calls, bookings, revenue, conversion; demo "bookings added" is demo data | UNK / OBS (demo) | K-01 §1, §3 | — | No traction claim anywhere | — |
| C-34 | Same legal entity operates Bowers (Thai beauty/wellness booking platform); registry aggregator corroborates a Thai company | OBS + aggregator | K-01 §2; K-09 | Medium | Possible Thai-market entrant; relevant to D-03 | Thai DBD official record for diligence |
| C-35 | Shared code between Bowers and Kirx | UNK | K-01 §2 | — | Not claimed | — |
| C-36 | Kirx Terms prohibit reverse engineering, scraping, competitive use, attempts to reveal other businesses' data | OBS | K-01 §15; K-05 | Medium | Clean-room record (§2.5); counsel review | Counsel |
| C-37 | Early-stage (fresh legal dates, waitlist sign-in, limited indexing, "new software") | INF | K-01 §10 | Low | Not used as a fact | — |
| C-38 | Public Vapi calculator: $0.05/min hosting; illustrative stack $0.082–0.129/min → $0.49 ≈ 3.8–6.0 min | INF (provider page) | K-01 §2 | Medium | Our own calculation (§14) replaces it | — |
| C-39 | Kirx promises a 30-day recording policy (dossier failure-mode list) | OBS (implied) | K-01 §9 | Low–Medium | Our retention classes (§8.3) | Counsel/diligence |
| C-40 | Live phone demo for fictional "Lotus Thai Spa" with visible calendar | OBS (page; not called) | K-01 §2 | Medium | Our demo uses a fictional business with badges | — |
| C-41 | Holds vs recheck | UNK | K-01 §14 | — | We hold + recheck (§11.4) | — |
| C-42 | Owner-answer authentication and reuse approval mechanism | UNK | K-01 §14 | — | §5.8.5, KC | — |
| C-43 | iMessage provisioning; fallback for non-Apple owners | UNK | K-01 §14 | — | SMS baseline (US), LINE (TH) | — |
| C-44 | SLAs, uptime, recovery objectives | UNK | K-01 §14 | — | Publish ours only after Gate C | — |
| C-45 | Whether health categories are blocked at onboarding | UNK | K-01 §14 | — | We block (SM-1) | — |

### 2.3 Provider facts that drive decisions (official pages, 11 Nov 2026)

| Id | Fact | Class | Source | Confidence | Implication | Verification needed |
|---|---|---|---|---|---|---|
| P-01 | Vapi transfer events do not confirm the destination answered; regions US and EU only | OBS | S-10, S-09 | High | Cannot meet INV-09 as-is; no SEA region | — |
| P-02 | Retell reports `transfer_bridged/cancelled/ended`; no Asia region stated | OBS | S-12 | High | Better, but "bridged" ≠ human; DTMF screening still ours | Region with Retell |
| P-03 | LiveKit Agents Apache-2.0, self-hostable; Cloud telephony regions exclude SEA | OBS | S-13, S-14 | High | Self-host in Bangkok for TH | Gate A spike on DTMF screening |
| P-04 | Twilio sells Thai mobile/local numbers; mobile $25.30/mo, inbound $0.0100/min; KYC needs Thai company docs | OBS | S-02, S-03 | High | Main TH margin driver (§14) | Thai SIP provider prices (unpublished) |
| P-05 | Plivo: Thai inbound not supported | OBS | S-06 | High | Excluded for TH | — |
| P-06 | Deepgram Nova-3 lists Thai; Flux does not; streaming per language not stated | OBS | S-18 | Medium | Thai STT needs a blind test | Gate A test |
| P-07 | Azure Speech th-TH real-time supported; no data at rest | OBS | S-22 | High | In-region Thai STT/TTS candidate | — |
| P-08 | ElevenLabs Flash v2.5 has no Thai; v3/v4 do | OBS | S-23 | High | Voice choice per language | — |
| P-09 | iMessage relay providers run real Apple IDs on Mac hardware without Apple approval; Apple may ban numbers | OBS (vendor statements) | S-32, S-33 | High | Not for caller texts; owner-only option after D-05 | — |
| P-10 | LINE: push counts against plan quota; from 1 Feb 2027 Reply API 25,000 free/month then ฿5,000/month via an agency | OBS | S-40, S-42 | High | Owner pushes fine; plan for Phase 4 chat | Agency list, VAT |
| P-11 | Thai SMS: registered sender ID mandatory (since 6 Oct 2025); shortened links banned; full links registered | OBS | S-45 | High | Caller texts in TH carry no shortened links; sender registration in SM-1 | — |
| P-12 | Square Bookings not available in Thailand; managing all bookings needs Plus/Premium | OBS | S-60 | Medium–High | TH = internal ledger | — |
| P-13 | No Thai booking platform with a public API found | OBS (search) | — | Medium | Internal ledger is the Thai authority | Re-check before Phase 3 |
| P-14 | Google Calendar `calendar.app.created` and free/busy scopes exist | OBS | S-61 | High | Least-privilege connector | Google app verification |
| P-15 | AWS has a Thailand region (ap-southeast-7) with RDS (no Multi-AZ DB clusters there) | OBS | S-48 | High | In-country data option | Service-by-service availability |
| P-16 | Claude model prices (Haiku 5.5 $0.10/$0.50; Sonnet 5.5 $2/$10; Opus 5.5 $4/$20 per 1M) | OBS (cached 3 Nov 2026) | S-31 | High | LLM is a minor cost line | ZDR terms with Anthropic |
| P-17 | Stripe lists Thailand for sign-up; TH cards 3.65% + ฿10 | OBS | S-63 | High | One billing provider for both | — |

### 2.4 Legal register (summary; not legal advice)

Ids follow the research register: L-U4 (California outbound AI-voice announcement) and L-U9 (adequate recording notice — the announcement itself is recorded) are folded into L-U1 and L-U8; L-T16 (Thai digital-platform decree) matters only for a later marketplace. "Counsel = yes" means counsel must confirm before the gate that relies on it.

| Id | Requirement | Jur. | Applies to | Product must | Conf. | Counsel |
|---|---|---|---|---|---|---|
| L-U1 | FCC 24-17: AI voices are "artificial voice" under TCPA — restricts calls a business *makes* | US | Outbound | No outbound AI calls without consent; inbound answering not "making" a call | High | yes |
| L-U2 | FCC 24-84 AI-disclosure proposal (would exclude inbound answering), not adopted | US | Inbound | Disclose anyway | Medium | no |
| L-U3 | CA B&P §17941 bot disclosure ("online"); AB 410 stalled | CA | Chat/text; voice unconfirmed | Disclose at start of every call and thread | Medium | yes |
| L-U5 | Utah 13-77-103: disclose on request; proactive for licensed occupations in high-risk interactions; sunset 1 Jul 2027 | UT | Calls, texts | Disclose at start; always answer "am I talking to a bot?" truthfully | Medium | yes |
| L-U6 | Maine 10 MRS §1500-DD covers "textual or aural" AI chat | ME | Calls, texts | Clear AI notice | Medium–High | no |
| L-U7 | Colorado SB 26-189 replaces SB 24-205 (from 1 Jan 2027); general notice survival unconfirmed | CO | — | Keep AI notice | Medium | yes |
| L-U8 | All-party recording consent states (CA, FL, IL, MD, MA, MT, NH, PA, WA; NV by case law; CT civil; others ambiguous) | US | Recording | Treat every call as all-party: notice before recording, recorded notice, no-recording route | Medium | yes |
| L-U10 | CIPA "capability" theory (Ambriz v. Google): vendors able to use call data for themselves may be third-party eavesdroppers | CA | Calls, data | Contractually and technically bar provider training/own use; consider naming the AI provider | Medium | yes |
| L-U11 | TCPA: texts are calls; informational needs prior express consent; marketing needs written consent | US | Texts | Spoken consent captured for follow-ups; promotions separate written consent | High | yes |
| L-U12 | FCC one-to-one consent rule vacated (11th Cir., Jan 2025) | US | Promotions | Consent per business anyway (CTIA) | High | no |
| L-U13 | **FCC 26-67 revocation rules in force 25 Nov 2026**: any reasonable means; 7 reply words; honour within 10 business days; one confirmation within 5 min | US | All texts | SM-11 as written (immediate, 5-min confirmation) | High | no |
| L-U14 | State mini-TCPAs (FL, OK, TX): quiet hours, frequency caps | US | Promotions/reminders | Quiet hours 09:00–20:00 promos; ≤3/24 h | Medium–High | yes |
| L-U15 | CTIA Messaging Principles (May 2023) | US | All texts | Opt-in confirmation content, HELP, STOP | High | no |
| L-U16 | A2P 10DLC registration required | US | All texts | Register brand/campaign per business before caller texts | Medium | no |
| L-U17 | HIPAA covered entities/business associates | US | All | Exclude health practices (SM-1) | High | yes |
| L-U18 | Washington My Health My Data Act (consumer health data) | WA+ | Calls, data | Don't ask about health; minimise health remarks | Medium | yes |
| L-U19 | COPPA amended rule (from 22 Apr 2026) | US | — | No child-directed use; parent for under-13 | Medium | yes |
| L-U20 | CCPA/CPRA service-provider contract terms; ADMT regs from 1 Jan 2026 | CA | Data | Service-provider DPA; no cross-client training | Medium | yes |
| L-U21 | BIPA / CUBI voiceprints | IL, TX | Recording | No speaker ID or voiceprints | Medium | yes |
| L-T1 | PDPA s.24 lawful bases (contract for booking; legitimate interest possibly for recording; consent for marketing) | TH | All | Map each purpose to a basis | High (law) | yes |
| L-T2 | PDPA s.23 notice at or before collection | TH | Calls | Short spoken Thai notice + texted link to full notice | High | no |
| L-T3 | PDPA s.26 sensitive data (health, biometric) needs explicit consent | TH | Calls, data | Exclude clinics in MVP; no voice biometrics | High | yes |
| L-T4 | PDPA s.40 processor duties | TH | Data | Processing agreement per business | Medium–High | no |
| L-T5 | PDPA s.28–29 cross-border transfers (PDPC rules in force 24 Mar 2024) | TH | Data (US model/speech providers, SG hosting) | Standard clauses with every overseas sub-processor; publish list | Medium | yes |
| L-T6 | DPO (s.41) for large-scale systematic monitoring or core sensitive data | TH | Data | Plan to appoint | Medium | yes |
| L-T7 | Breach notice to PDPC within 72 h where risk | TH | Data | RB-09 | Medium–High | no |
| L-T8 | PDPC enforcement active (fines 2024–2025; draft s.24 rewrite consulted Jul–Aug 2026) | TH | Data | Expect processor liability | Medium | no |
| L-T9 | Call recording: no specific statute found; PDPA governs | TH | Recording | Notice, basis, no-recording option; recording off by default (D-09) | Low | yes |
| L-T10 | Marketing messages: PDPA consent; Computer-Related Crime Act easy refusal; possible OCPB direct-marketing registration | TH | Promotions | Not in MVP | Medium | yes |
| L-T11 | NBTC SMS: registered sender IDs; registered full links; no shortened links | TH | Texts | Sender per business; link rules | Medium | no |
| L-T12 | Electronic Transactions Act: valid, intact electronic records | TH | Records | Hash-chained audit (§8.1) | Medium | no |
| L-T13 | Computer-Related Crime Act s.26: service providers keep traffic data ≥90 days | TH | Metadata | Keep call/SMS metadata 90 days pending counsel | Medium | yes |
| L-T14 | Draft Thai AI Act (consultation Jul–Aug 2026) not enacted | TH | Calls | Disclose anyway; monitor | Medium | no |
| L-T15 | Telephony/number issuing is licensed telecom business; foreign-ownership limits; anti-scam KYC (May 2026) | TH | Numbers | Do not issue/resell numbers; business-held number or licensed partner | Low–Medium | yes |

### 2.5 Clean-room record

- **Inputs used:** the dossier (K-01) and the master prompt; official provider/legal pages; O2's own vault notes
  (`booking-integrity`, `truth-ledger`). **Not used:** any Kirx source code, prompt, copy, artwork, private API, or
  account; no Kirx page was opened during this work.
- **Independent derivation:** state machines, contracts, schema and policies were written from first principles and
  the brief's requirements; any resemblance in the *capability class* (answer, book, notify, escalate) is the
  brief's scope, not copied expression.
- **Counsel items:** browsewrap enforceability of Kirx's Terms against whoever gathered the dossier; separation of
  people who studied Kirx's site from those who write product copy/code (LS-34); naming Kirx in any marketing
  comparison (do not, without counsel).
