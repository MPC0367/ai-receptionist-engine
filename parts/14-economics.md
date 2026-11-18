## 14. Economics model

A worksheet, not a forecast. Every input is either an official price (§7, read 11 Nov 2026) or a stated
**assumption** to be replaced by Gate B/C measurements (U-01, U-02). The model script is reproducible
(`economics-model.mjs` beside this blueprint). Kirx's US$0.49 appears only as a **market reference price**; it says
nothing about Kirx's margin (brief, §3.9).

### 14.1 Assumptions (all to be measured)

| Assumption | Value | Why / source |
|---|---|---|
| Duration distribution (answered calls) | 0–1 min 20% · 1–2 min 30% · 2–4 min 30% · 4–8 min 15% · 8–15 min 5% → mean **2.95 min** | Placeholder (U-01) |
| Booking share of answered calls | 40% | Placeholder (U-02) |
| Task completion share | 70% | §15 target |
| AI speaking share / speech rate | 45% of call time; EN ~150 wpm → ~405 TTS chars/min; TH ~400 chars/min | Placeholder |
| LLM calls per minute | 4 (turns + tool round-trips) | Placeholder |
| Tokens per LLM call | 4,000 cached prefix (system + tools) + 1,500 uncached + 160 output incl. thinking; Thai ×2 on uncached/output | Placeholder; measured at Gate A |
| Messages per call | 1.6 owner/client messages average (owner notice 0.6, client confirmation 0.4, pending-question flow 0.6) | Placeholder |
| Escalation rate | 10% of calls create a pending question | Placeholder |
| Volume per business | 300 answered calls/month | Placeholder |
| Fleet for fixed-cost sharing | 50 businesses (15,000 calls/month) | Placeholder |
| Platform fixed cost | US ~$400/mo, TH ~$600/mo (core, DB HA, runtime, monitoring) | Estimate |
| Support and rework | $0.02 per call (≈1 h O2 ops per 1,000 calls) | Estimate |
| Payment and billing fees | US 3.6% of revenue; TH 4.4% + ฿10/invoice (Stripe TH cards 3.65% + Billing 0.7%) | S-62, S-63 |
| Refunds/adjustments | 2% of revenue | Placeholder |
| Free allowance | First 30 answered calls per new business free (acquisition cost, not in per-call margin) | Proposal |
| Exchange rate | 33 THB = 1 USD | Assumption |

### 14.2 Direct cost per answered minute and per conversation

| Line | US recommended | US managed (Vapi) | TH recommended |
|---|---|---|---|
| Carrier inbound | $0.0032 (Telnyx) | $0.0032 | $0.0100 (Twilio TH mobile) |
| SIP leg / orchestration | $0.004 + $0.010 (LiveKit Cloud) | $0.050 (Vapi) | ~$0.003 self-hosted compute (estimate) |
| STT | $0.0077 (Deepgram) | $0.0077 | $0.0167 (Azure th-TH) |
| LLM | $0.0011 (Haiku 5.5) | $0.0011 | $0.0020 (Haiku 5.5, Thai tokens) |
| TTS | $0.0158 (Cartesia) | $0.0158 | $0.0060 (Azure Thai neural) |
| **Per answered minute** | **$0.0418** | **$0.0778** | **$0.0377** |
| Number + registration per call | $0.037 ($1 number + ~$10/mo 10DLC campaign ÷ 300) | $0.037 | **$0.084** ($25.30 TH mobile number ÷ 300) |
| Messages per call | $0.011 | $0.011 | $0.010 (SMS ฿0.20 × 2.5 credits; LINE push within quota) |
| Platform fixed per call | $0.027 | $0.017 | $0.040 |
| Support/rework per call | $0.020 | $0.020 | $0.020 |
| **Fixed per conversation** | **$0.095** | **$0.085** | **$0.154** |
| **Cost per answered conversation (mean 2.95 min)** | **$0.22** | **$0.31** | **$0.27** |
| Cost per completed task (÷0.70) | $0.31 | $0.45 | $0.38 |
| Cost per confirmed booking (÷0.40) | $0.54 | $0.79 | $0.66 |
| LLM sensitivity per minute | Sonnet 5.5 +$0.019; Opus 5.5 +$0.039 | same | Sonnet +$0.036; Opus +$0.075 |

Recording, when on, adds ~$0.002/min (Telnyx) and storage. Recording is off by default in the Thailand variant until
D-09.

### 14.3 Margin by duration band and break-even duration (flat per-call price, after fees and refunds)

| Duration band | US cost | US @ $0.49 | US @ $0.39 | US @ $0.59 | TH cost | TH @ $0.49 | TH @ $0.59 |
|---|---|---|---|---|---|---|---|
| 0–1 min | $0.126 | 69% | 62% | 73% | $0.183 | 56% | 63% |
| 1–2 min | $0.157 | 62% | 54% | 68% | $0.211 | 51% | 58% |
| 2–4 min | $0.220 | 50% | 38% | 57% | $0.267 | 39% | 48% |
| 4–8 min | $0.345 | 24% | 6% | 36% | $0.381 | 16% | 29% |
| 8–15 min | $0.554 | −19% | −48% | 0% | $0.569 | −23% | −3% |
| **Break-even duration** | — | **8.8 min** | **6.6 min** | **11.1 min** | — | **8.1 min** | **10.6 min** |

With the managed (Vapi) stack the US break-even at $0.49 falls to **4.9 min** — the platform fee alone is larger
than all other per-minute costs combined. That is the economic reason, beside control and exit cost, for §7.2.

### 14.4 Price alternatives (illustrative, for D-01)

| Model | Example | Margin by band (US stack) | Reading |
|---|---|---|---|
| Flat per call | $0.49 | 69% → −19% | Simple; long calls lose money |
| Per minute | $0.15/min, 1-min minimum | 10% → 61% | Short calls barely pay; owners fear an open meter |
| Outcome-based | $X per confirmed booking only | Cost per booking $0.54 must be covered; FAQ-only calls earn nothing | Attribution disputes |
| **Hybrid** | $0.39 per call incl. 4 min, then $0.10/min | 62%, 54%, 38%, 36%, 44% | **Every band ≥ 36%** — recommended shape for the US |
| Subscription + usage (TH) | ฿1,990/mo incl. 150 calls, ฿12 per extra call | 100 calls 8% · 150 calls −4% · 300 calls 24% · 600 calls 39% | Thin at low volume because of the $25.30 Thai number |
| Same, with a cheaper Thai SIP number (price unknown; ฿300/mo used for illustration) | as above | 35% · 23% · 38% · 46% | **The per-business Thai number is the main Thailand margin driver** |

### 14.5 What the model tells the owner

1. Direct voice cost is dominated by speech (STT + TTS) and the orchestration fee, not by the language model.
2. A managed orchestration platform roughly halves the break-even duration.
3. In Thailand, the per-business inbound number ($25.30/month at Twilio's published rate) costs more per call than
   the language model and the speech recognition combined at 300 calls/month; a Thai SIP provider's price (not
   published) decides whether a low-priced Thai plan works (D-06/D-11).
4. Long calls need a policy: hybrid pricing (US), included calls with overage (TH), a 15-minute cap (SM-2), and
   abuse controls (TH-17).
5. Nothing here is validated until Gate B measures real durations, token counts and speech characters per minute;
   the cost-regression suite (§17) then holds them.
