# Free ($0) routes to test the AI phone receptionist end to end, and the credit programmes for later (as of 12 Nov 2026)

Scope note: public pages only, nothing signed up for. Kirx was not researched. Prices in US$. "Inference" = my reasoning, not a source. Where a page could not be rendered or sources disagree, it is said.

## 1. Testing calls with no phone number at all (browser, terminal, softphone into self-hosted livekit/sip)

### Takeaway
Four no-number levels exist and all are $0. (1) Console mode: talk to the agent in the terminal. (2) `dev` mode plus a browser client (Agent Console on LiveKit Cloud, or the open-source agents-playground / a Meet-style client against the self-hosted server). (3) A free SIP softphone dialling livekit/sip directly by IP. LiveKit SIP does not accept REGISTER, so the softphone sends an INVITE to the server's SIP URI and is matched by an inbound trunk's credentials or allowed address. (4) The same softphone over a phone's 4G into LiveKit Cloud's SIP URI. None of them exercises the PSTN: no carrier timing, carrier transcoding, Thai caller-ID formats or number portability.

### Cited Findings
- Startup modes: `start` is production; `dev` is development (debug logging, reload on code change in Python); `console` is "Local, single-session, terminal-based testing" and "Doesn't connect to LiveKit"; `connect` joins a named room (Python `uv run src/agent.py connect --room my-test-room`, Node `pnpm tsx agent.ts connect --room my-test-room`) — [LiveKit docs: startup modes](https://docs.livekit.io/agents/server/startup-modes/)
- Console mode needs LiveKit credentials only when LiveKit Inference is used, and then only as environment variables, never as CLI flags. Options: `--text` (Ctrl+T toggles audio/text), `--input-device`/`--output-device`, `--list-devices`, and `--record` (writes to `console-recordings/session-<timestamp>/`) — [LiveKit docs: startup modes](https://docs.livekit.io/agents/server/startup-modes/)
- **Conflict on language support:** the startup-modes page shows one command, `lk agent console`, with no Python/Node split. A search summary of LiveKit pages says console mode is "only available for Python agents" (command `uv run src/agent.py console`; older v1 docs used `python agent.py console`) — [LiveKit docs: startup modes](https://docs.livekit.io/agents/server/startup-modes/); [LiveKit v1 voice AI docs](https://docs.livekit.io/agents/v1/start/voice-ai)
- The current quickstart tests through `lk agent dev`: open the printed Agent Console link, click "Start a session" and talk into the browser mic. Its default pipeline is STT-LLM-TTS through LiveKit Inference, so "you don't need provider API keys" — [LiveKit docs: Voice AI quickstart](https://docs.livekit.io/agents/start/voice-ai/)
- Agent Console is opened from the LiveKit Cloud dashboard ("Launch Console"). It is "compatible with agents running anywhere", including self-hosted and local ones. Panes: Audio, Events, Session, Participants, RPC, DTMF, Metrics, Usage. It needs Node SDK ≥1.2.4 or Python SDK ≥1.5.2. The page does not say whether it works against a self-hosted livekit-server rather than a Cloud project — [LiveKit docs: Agent Console](https://docs.livekit.io/testing/agent-console/)
- `livekit/agents-playground` is public and labelled "currently work in progress", with no deprecation notice. Setup: copy `.env.example` to `.env.local` and set `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `NEXT_PUBLIC_LIVEKIT_URL` (the placeholder suggests a Cloud URL; a self-hosted `ws://` URL is not documented but is the same variable) — [GitHub livekit/agents-playground](https://github.com/livekit/agents-playground)
- LiveKit's telephony feature table marks "SIP Registration (REGISTER) | ❌ Not Supported". SIP over UDP/TCP/TLS, DTMF and cold transfer (REFER) are supported — [LiveKit docs: telephony](https://docs.livekit.io/telephony/); community answer: use "trunk-based authentication … rather than registration-based" — [LiveKit community](https://community.livekit.io/t/does-livekit-support-sip-providers-that-use-trunk-registration-register/113)
- On a softphone that could not register, the maintainer answered: "for incoming calls, you only need to send the call to the SIP URI you get from LiveKit". Registration only comes in via an intermediary such as Asterisk when a PSTN provider demands it — [GitHub livekit/sip issue #231](https://github.com/livekit/sip/issues/231) (seen through a search mirror)
- An inbound trunk must set `numbers`, `allowed_addresses`, or both `auth_username` and `auth_password`. It is created with `lk` from JSON, so a softphone can authenticate with a username and password and no phone number — [LiveKit docs: inbound trunk](https://docs.livekit.io/telephony/accepting-calls/inbound-trunk/)
- A community project's local flow: start the services with Docker Compose, then "use a SIP client (e.g., MicroSIP, Linphone) to dial the phone number you configured" — [stimm SIP integration guide](https://stimm-ai.github.io/stimm/developer/sip-integration)
- A softphone tip (Zoiper on iOS, with Telnyx): use credential trunks; turning STUN off and adjusting rport helped registration. This is one user's report — [liviaerxin blog](https://liviaerxin.github.io/blog/telnyx-zoiper-call-setup)
- SIP2SIP (sip2sip.info) still says "SIP2SIP is free to use" (© 2026 footer); an account is needed to receive calls. Calling other SIP domains and PSTN are not mentioned — [sip2sip.info](https://sip2sip.info/)
- Linphone's free SIP service page (`linphone.org/en/free-sip-service/`) returned 404 on 12 Nov 2026 — [linphone.org](https://www.linphone.org/en/free-sip-service/)
- Testing guidance for a real telephony setup: "Place a test call and verify the room, SIP participant, and agent logs end to end" — [LiveKit docs: telephony quickstart](https://docs.livekit.io/agents/start/telephony/)

### Inferences
- What each level proves:
  - **Console:** prompts, Thai/English turn-taking, tool calls into the TypeScript/Postgres booking engine, and STT/TTS voice choice. No WebRTC, no SIP, no rooms or dispatch.
  - **`dev` + browser:** WebRTC transport, VAD and interruption, agent dispatch to rooms, observability panes. Browser audio is wideband, so it flatters STT compared with an 8 kHz phone call.
  - **Softphone → livekit/sip on the LAN:** real SIP INVITE handling, trunk auth, dispatch rules, DTMF, narrowband G.711 audio into Thai STT, and the screened warm transfer with a human on a real handset UI instead of SIPp.
  - **Softphone over 4G → LiveKit Cloud SIP URI:** public-internet NAT and jitter.
  - **What none of them proves:** carrier post-dial delay and ring timing, carrier caller-ID formats (+66 / withheld), early media, carrier codec transcoding, or how a Thai mobile network handles a forwarded call.
- A softphone needs no SIP account to dial livekit/sip on the LAN. A direct-IP URI such as `sip:<number-or-user>@<mac-LAN-IP>:5060`, with the trunk set to `allowed_addresses` (the LAN subnet) or auth credentials, should be enough. Free macOS options are Linphone, Zoiper free and Telephone.app; MicroSIP is Windows-only. Turn the softphone's "register" off. (Not tested here.)
- Free public SIP accounts such as SIP2SIP only help to test SIP-to-SIP across the internet without PSTN. They add nothing over a direct softphone → server call unless the aim is to test calls arriving from another SIP domain.

### Gaps
- Whether console mode runs a Node.js agent today (the sources conflict). If O2's agent is Node, `connect`/`dev` with a browser client are the sure options.
- Whether Agent Console attaches to a self-hosted livekit-server or only to Cloud projects. Not stated.
- Linphone's free SIP account terms in 2026 (page 404). Whether SIP2SIP lets its users dial arbitrary external SIP URIs (not stated).
- No official LiveKit guide for softphone testing against self-hosted livekit/sip was found. The setup above comes from the REGISTER notes and a maintainer reply.

## 2. LiveKit Cloud free "Build" plan (Nov 2026): minutes, SIP, numbers, Inference, card

### Takeaway
Build is $0/month with "No credit card required". It includes 1,000 agent-session minutes (5 concurrent, 1 deployment, no cold-start prevention), 5,000 WebRTC minutes, 1,000 third-party SIP minutes, **one free US local number with 50 inbound minutes**, and $2.50 of LiveKit Inference credit (about 50 minutes). LiveKit Phone Numbers are US only (local and toll-free), so there is no Thai number. Build is enough for a first real PSTN call ($0 to O2) and for bring-your-own-trunk SIP tests.

### Cited Findings
- Build plan ($0/mo, "No credit card required"):
  - Agents: 1,000 agent session minutes, 5 concurrent agent sessions, 1 agent deployment (0 non-production), no cold-start prevention or instant rollback.
  - WebRTC: 5,000 minutes, 100 concurrent connections, 50 GB downstream.
  - Telephony: "1 free US local number" (no toll-free), 50 US local inbound minutes, 1,000 third-party SIP minutes, Twilio and WhatsApp connectors at 5 concurrent calls each.
  - LiveKit Inference: "$2.50 in credits (about 50 minutes)", concurrency 5.
  - Other allowances: 100 min voice isolation, 1,000 min session recordings, 100,000 observability events, 350 text-simulation turns, 60 audio-simulation turns.
  - Support: community only. No overage prices are listed for Build.
  - Source: [LiveKit pricing](https://livekit.com/pricing)
- Ship plan (from $50/mo):
  - Agents: 5,000 agent minutes then $0.01/min, 20 concurrent.
  - WebRTC: 150,000 minutes then $0.0005/min.
  - Phone numbers: 1 free US local number then $1.00/month each; US toll-free $2.00/month.
  - Telephony minutes: 100 US local inbound minutes then $0.01/min; toll-free inbound $0.02/min; 5,000 third-party SIP minutes then $0.004/min.
  - Inference: $5 credit.
  - Source: [LiveKit pricing](https://livekit.com/pricing)
- Inference list prices (Build/Ship) — [LiveKit pricing](https://livekit.com/pricing):
  - LLM: OpenAI GPT-5.4 mini $0.0030/min; Gemini 3.1 Flash Lite $0.0010/min; GPT OSS 120B $0.0006/min.
  - STT: Deepgram Nova-3 (monolingual) $0.0048/min; AssemblyAI Universal-Streaming $0.0025/min.
  - TTS: Deepgram Aura-2 $0.0180/min; Cartesia Sonic 3 $0.0300/min.
- The pricing page lists no phone-number prices for any country other than the US — [LiveKit pricing](https://livekit.com/pricing)
- "LiveKit Phone Numbers" is Cloud-only and covers local and toll-free numbers in the United States; no other country is mentioned — [LiveKit docs: telephony](https://docs.livekit.io/agents/start/telephony/)
- SIP trunk providers LiveKit has tested: Twilio, Telnyx, Exotel, Plivo, Wavix, Sinch, didlogic, DIDWW. Connectors that need no SIP trunk exist for WhatsApp Business and Twilio (websockets) — [LiveKit docs: telephony](https://docs.livekit.io/agents/start/telephony/)
- The quickstart `lk cloud auth` lets you "sign up for free" — [LiveKit docs: Voice AI quickstart](https://docs.livekit.io/agents/start/voice-ai/)

### Inferences
- A worker running on the Mac in `dev` mode, connected to a Build project, uses Cloud for media and SIP and needs no hosting. Calls to the free US number then reach the agent through real PSTN. The only cost is the caller's international call from Thailand, unless someone in the US places it.
- 1,000 third-party SIP minutes means a licensed Thai partner's SIP trunk, or a softphone, can be pointed at the Cloud SIP URI for free later. That fits O2's rule that the business keeps its own number.
- $2.50 of Inference is about 50 minutes, so a model-heavy test series will spend it quickly. Bring-your-own keys (e.g. the Anthropic key already approved, or the Deepgram $200 credit in section 5) stretch it.
- 5 concurrent sessions is enough for functional tests, not for load tests.

### Gaps
- Whether claiming the free US number on Build needs a card or identity verification. The pricing page says no card for the plan but nothing about number provisioning.
- LiveKit Cloud regions (Singapore?) and where call audio is processed, which matters for Thai latency and PDPA. Not covered here.
- Which LiveKit Inference STT/TTS models handle Thai well. Not checked.

## 3. Free trial telephony (Twilio, Telnyx, Plivo, Vonage, SignalWire, Sinch), calling Thai mobiles, Thai inbound numbers, free SIP-to-SIP

### Takeaway
Every carrier trial restricts calls to verified numbers. None gives a free Thai inbound number. Twilio's 2026 trial is no longer a dollar balance: it gives 75 voice minutes for 30 days, no card, voice limited to the sign-up country, up to 5 verified recipients. Thailand is a trial country, so a Thai sign-up can reach verified Thai numbers. Telnyx gives $5 testing credit restricted to one verified number. Plivo advertises $10; Vonage €2 (calls only to your own registered number); SignalWire has no free credit (trial mode lifts at a $5 top-up). Thai numbers cost money and need NBTC paperwork (Twilio $25/mo local, Telnyx from $10/mo). For a real Thai test, LiveKit Cloud's free US number, or a business's own number over a licensed partner's trunk, is the realistic $0 route for O2.

### Cited Findings
- **Twilio (current docs):**
  - "Trial accounts expire 30 days after sign-up."
  - Product-specific free units "Instead of a dollar-based balance": 75 voice minutes, 100 SMS, 100 WhatsApp, 3,000 emails. TTS, speech recognition, AMD, conferencing and transcriptions are covered by those minutes.
  - Calls only to verified numbers, "up to 5 per account".
  - "voice calls are restricted to your sign-up country".
  - Trial calls use "a shared, Twilio-owned trial number"; some TwiML verbs are blocked.
  - Sources: [Twilio trial account docs](https://www.twilio.com/docs/usage/trials); [Twilio: how to use your free trial](https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account)
- Twilio: "You can sign up for a Twilio free trial account without a credit card"; you verify your personal phone number at sign-up — [Twilio free trial tutorial](https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account)
- **Conflict:** Twilio's marketing page still says "$15 free credits" and an unlimited trial; the docs describe 30 days of free units. Twilio support says the trial was restructured into product-specific limits — [Twilio signup-credits page](https://twilio.com/en-us/signup-credits) vs [Twilio trial docs](https://www.twilio.com/docs/usage/trials)
- Thailand is on Twilio's list of trial countries. Trial calls are "limited to calling low-risk destinations" — [Twilio trial docs](https://www.twilio.com/docs/usage/trials) (via search summary)
- Twilio Thailand voice pricing ("current as of October 2026") — [Twilio Thailand voice pricing](https://www.twilio.com/en-us/voice/pricing/th):
  - Numbers: local $25.00/mo, mobile $25.30/mo, toll-free $28.60/mo.
  - Inbound: local $0.0107/min, mobile $0.0100/min, toll-free $0.3225/min.
  - Outbound to Thai landline or mobile: $0.1000/min.
  - SIP interface or BYOC: $0.0040/min each way.
- Twilio Thailand guidelines: inbound PSTN to Twilio +66 numbers works; emergency numbers are not supported; "Thailand verified caller-IDs are not supported" for outbound calls to Thailand — [Twilio Thailand voice guidelines](https://www.twilio.com/en-us/guidelines/th/voice)
- **Telnyx trial:**
  - "USD $5 in testing credit".
  - Voice only to and from the one verified number; one phone-number order "regardless of the outcome".
  - Trial numbers are local numbers matching the sign-up origin.
  - Sources: [Telnyx trial docs](https://developers.telnyx.com/docs/account-setup/using-trial-account.md); search summary of the same docs
- Telnyx "pretrial" accounts: $25 in AI credits, no card. They cover AI products and one US local number, but voice, messaging and wireless need an upgrade (the credit then becomes a $5 full credit) — [Telnyx support: pretrial accounts](https://support.telnyx.com/en/articles/14327893-telnyx-pretrial-accounts)
- Telnyx Thailand local numbers "start at $10 per month", with a published list of Thailand DID requirements — [Telnyx Thailand numbers](https://telnyx.com/phone-numbers/thailand.md); [Telnyx Thailand DID requirements](https://support.telnyx.com/en/articles/3739661-thailand-did-requirements)
- Telnyx Elastic SIP list rates: outbound from $0.005/min, inbound from $0.0032/min (US) — [Telnyx Elastic SIP pricing](https://telnyx.com/pricing/elastic-sip.md)
- **Plivo:** "$10 in free credits. No credit card required" — [Plivo pricing](https://plivo.com/pricing/). The verified-numbers-only trial rule comes from a third-party site only — [apicostcalc Plivo](https://apicostcalc.com/plivo.html)
- **Vonage:**
  - €2 free credit; the account starts in DEMO mode.
  - Trial voice calls go only to your registered number. Help articles disagree on extra test numbers ("up to 4 extra" vs "up to 5 in total").
  - Trial credit cannot buy virtual numbers.
  - Sources: [Vonage API support: test numbers](https://api.support.vonage.com/hc/en-us/articles/204014853-How-do-I-add-test-numbers-during-my-Vonage-API-trial); [Vonage Voice API getting started](https://developer.vonage.com/en/voice/voice-api/getting-started)
- **SignalWire:**
  - No free credit: trial mode is removed by adding a card and at least $5.
  - In trial mode "SIP endpoints can register, but outbound calls and receiving traffic on a Domain App are blocked".
  - Calls go only to purchased or verified numbers; caps of 2 phone numbers and 10 verified caller IDs.
  - Source: [SignalWire docs: trial mode](https://signalwire.com/docs/platform/trial-mode)
- **DIDWW** offers Thai local, national and voice/SMS mobile DIDs (fax added July 2025) — [DIDWW news](https://news.didww.com/2025/07/30/didww-adds-fax-functionality-to-local-and-national-numbers-in-thailand-66/)
- **Reseller Thai numbers:** Bangkok $11.95/mo, mobile $41.95/mo — [Flynumber Thailand](https://www.flynumber.com/virtual-phone-number/thailand). Activation in 1–5 business days once NBTC paperwork is approved — [DIDHub Thailand](https://didhub-4jx.pages.dev/numbers/thailand) (aggregator, low confidence)

### Inferences
- A Twilio trial opened with a Thai number gives 75 minutes of calls to up to 5 verified Thai numbers for 30 days at $0. That is useful for an outbound test, e.g. calling the owner's own mobile through Twilio's API. It does not give a Thai inbound number. Whether it can feed LiveKit (Elastic SIP Trunking or the Twilio connector) on a trial is undocumented.
- Telnyx, Vonage and SignalWire trials are tied to one or a few verified numbers and mostly to the sign-up country. None is a better $0 Thai inbound route than LiveKit Cloud's free US number.
- Under O2's rule, the real Thai PSTN test should be a business's own Thai number forwarded or SIP-trunked by a licensed partner into LiveKit Cloud (1,000 free third-party SIP minutes) or into self-hosted livekit/sip. Whether O2 may rent a Thai DID for its own internal testing (not resold to anyone) is an owner decision: it costs $10–25/month plus NBTC KYC.

### Gaps
- Sinch voice/SIP trial terms: not found (a Sinch community thread on an Elastic SIP Trunking trial exists but was not read).
- Whether Twilio trials can use Elastic SIP Trunking or LiveKit's Twilio connector, and whether a trial plays a "trial account" announcement before calls. Older docs said so; the 2026 page does not mention it.
- Plivo's exact trial restrictions (no official page found).
- didlogic's listing claims "New accounts get up to $100 credit + a free number" (in its page title). Not opened and unverified — [didlogic Thailand](https://didlogic.com/virtual-phone-numbers/thailand/)
- What a Thai mobile caller pays to dial a US number (international rates per carrier). Not researched.

## 4. Free hosting for an always-on agent worker and Postgres; whether UDP/RTP works

### Takeaway
The agent worker itself needs no inbound UDP: it connects out to the LiveKit server. So it can run on the Mac, or on any free host that allows outbound UDP, while media is handled by LiveKit Cloud. Inbound UDP only matters for self-hosting livekit-server or livekit/sip (RTP). Among free tiers, only an IaaS VM gives that: Oracle Always Free, or Google's e2-micro, which is too small. PaaS free tiers block or limit it: Railway has no inbound UDP, Fly needs a dedicated IPv4 that its trial excludes, and Render spins down. Oracle's Arm allowance was **halved in 2026 to 2 OCPU / 12 GB**, Singapore capacity is unreliable, and idle VMs can be reclaimed. Free Postgres: Neon (no card, scales to zero after 5 minutes, used by O2 already in Singapore) or Supabase (pauses after 7 days idle).

### Cited Findings
- **Oracle Always Free (current docs):**
  - Arm: "first 1,500 OCPU hours and 9,000 GB hours per month … For Always Free tenancies, this is equivalent to 2 OCPUs and 12 GB of memory".
  - Two AMD micro VMs (1/8 OCPU, 1 GB, 50 Mbps).
  - 200 GB block storage; 10 TB/month outbound data; two Autonomous AI Databases (1 OCPU, 20 GB).
  - Always Free compute must be created in the home region.
  - Source: [Oracle docs: Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- Oracle idle reclamation: an instance is deemed idle if, over 7 days, 95th-percentile CPU is below 20%, network below 20% and (A1 only) memory below 20%. Idle Always Free instances "may be reclaimed". An "out of host capacity" error means a temporary lack of free shapes in the home region — [Oracle docs](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)
- The A1 cut from 4 OCPU / 24 GB (3,000 OCPU-h) to 2 OCPU / 12 GB (1,500) was found in the docs around June 2026, with no announcement. The console still showed 4/24 for some users and enforcement was unclear — [terminalbytes, 26 Jun 2026](https://terminalbytes.com/oracle-cloud-free-tier-changes-2026)
- Users report "Out of capacity" for VM.Standard.A1.Flex in ap-singapore-1, and a Singapore A1 instance disabled after the limit change (forum reports, anecdotal) — [Oracle community: Arm compute](https://community.oracle.com/customerconnect/discussions/tagged/arm-compute/p1); [space-node blog](https://space-node.net/blog/oracle-cloud-always-free-limits-2026)
- **Google Cloud:**
  - Free trial: "$300 in free Welcome credit which is valid for 90 days"; a card or other payment method is required; no GPUs or Windows on trial.
  - Always-free: "1 non-preemptible e2-micro VM instance per month" in us-west1, us-central1 or us-east1 only, 30 GB-months of disk, 1 GB/month egress from North America.
  - Cloud Run free tier: 2M requests, 180,000 vCPU-s, 360,000 GB-s.
  - Source: [Google Cloud free features](https://docs.cloud.google.com/free/docs/free-cloud-features)
- **Fly.io:**
  - Trial: "$1 of free credit, with no credit card required", lasting 7 days or until used.
  - Trial machines stop after 5 minutes of running; up to `shared-cpu-2x`/4 GB.
  - "dedicated IPv4 addresses" are unavailable during the trial.
  - After a card is added, months under $5 are waived.
  - Source: [Fly.io docs: free trial](https://docs.fly.io/about/free-trial)
- Fly.io UDP: "You need a dedicated IPv4 address"; bind to `fly-global-services`; same port inside and out; no public IPv6 UDP; no per-flow load balancing — [Fly.io docs: UDP and TCP](https://docs.fly.io/networking/udp-and-tcp)
- **Railway:**
  - Trial: "$5 one-time credit (30 days)", no card, up to 2 vCPU / 1 GB per service.
  - Free plan: "$1 of monthly usage credits", 1 vCPU / 0.5 GB.
  - Source: [Railway pricing](https://railway.com/pricing)
- Railway staff (forum): "does not support inbound UDP traffic at this time"; outbound has no protocol limits. A WebRTC session started from Railway did connect — [Railway Station: UDP inbound](https://station.railway.com/feedback/udp-inboud-connections-9f036ffc); [Railway Station: TURN on Railway](https://station.railway.com/questions/can-i-setup-turn-server-on-railway-db46bf40)
- **Render free:**
  - Web services spin down after 15 minutes without inbound traffic (WebSocket messages count) and take time to wake.
  - 750 free instance hours per month.
  - Free Postgres expires 30 days after creation; 1 GB; one per workspace.
  - Source: [Render docs: free](https://render.com/docs/free)
- **Koyeb:** the pricing page now shows only Pro ($29/mo), Scale and Enterprise; there is no free compute tier listed. A "Free 5h" serverless Postgres (0.25 vCPU, 1 GB RAM, 1 GB) exists in Washington, Frankfurt or Singapore. The banner says "Koyeb is joining Mistral AI" — [Koyeb pricing](https://www.koyeb.com/pricing)
- **Neon free:**
  - 100 projects; 1 GB per project (20 GB total); 100 CU-hours per project per month.
  - Scale to zero "suspends after 5 min, cannot be turned off"; 5 GB egress per project per month.
  - "no credit card required".
  - Source: [Neon pricing](https://neon.com/pricing)
- O2 already runs a Neon free-plan project in AWS Singapore (Bella members site, "orange-voice-86815498") — O2 studio notes (`O2 Group/.claude/studio-notes.md`, Bella entry)
- **Supabase free:** "Limit of 2 active projects", 500 MB database, 5 GB egress, shared CPU / 500 MB RAM, "paused after 1 week of inactivity" — [Supabase pricing](https://supabase.com/pricing)

### Inferences
- For testing, the cheapest always-on host is the M4 Pro Mac itself: the agent in `dev`/`start` mode plus the local Postgres. It is $0 and already set up. A cloud host is only needed when the Mac cannot stay on.
- Self-hosting livekit-server and livekit/sip for a real carrier needs a public IP with an RTP UDP port range open. A home connection behind CGNAT, or an HTTP/TCP tunnel, will not carry RTP. Cloudflare Tunnel's lack of UDP to origin is general knowledge, not checked here. LiveKit Cloud Build avoids the problem at $0.
- Oracle A1 (2 OCPU / 12 GB, with a public IP and security-list rules, 10 TB egress) is the only free VM large enough for livekit-server + livekit/sip + a worker. The catches: Singapore capacity, the home region being fixed at sign-up, the 2026 halving, and idle reclamation. A test box that sits idle for a week can meet all three idle thresholds.
- GCP e2-micro (1 GB RAM, US-only, 1 GB egress) is too small for VAD, turn-detection models and a worker, and is ~200 ms from Bangkok. The $300 / 90-day trial would run a proper VM in asia-southeast1 (Singapore) but needs a card.
- Neon's 5-minute scale-to-zero adds a cold start to the first booking query after idle. Supabase's 7-day pause is worse for a sporadic test system. For tests the local Postgres is simplest.

### Gaps
- Oracle's official page could not be fetched (403). Whether sign-up needs a card, and whether a Bangkok region exists (Singapore is ap-singapore-1), were not confirmed.
- LiveKit's recommended worker CPU/RAM per concurrent session was not checked, so the "e2-micro too small" call is reasoned, not sourced.
- Whether Neon offers Singapore on the free plan was not confirmed on its pricing page. O2's own project suggests yes.

## 5. Startup credit programmes: amounts, eligibility for a small Thai company (possibly pre-revenue), approval time

### Takeaway
For a bootstrapped Thai company, the realistic credits are:

| Programme | Amount | Main condition | Approval |
|---|---|---|---|
| LiveKit Startups | up to $23K | live site, incorporated, launching within 6 months | not stated |
| Google Cloud Start | up to $2,000 / 1 year | no equity funding needed | not stated |
| AWS Activate Founders | $1,000, up to $5,000 | self-funded; AWS paid-tier account | 5–10 business days |
| Microsoft Azure startup offer | $1,000 (90 days) + $4,000 (180 days) | business verification | not stated |
| Cloudflare Tier 3 | $10K | bootstrapped; **excludes agencies/consultancies** | ~48 hours |
| Deepgram | $200 signup + from $1,000 | **not agencies building for clients** | not stated |
| ElevenLabs Startup Grants | 33M credits / 12 months | under 25 staff | not stated |

Telnyx ($20K, needs $500K+ raised), Anthropic (cohort full; VC route up to $100K), OpenAI (VC-backed or ended) and Google Scale/AI ($100K–350K) need VC backing or are closed. O2 must present the receptionist as its own product, not client work.

### Cited Findings
- **LiveKit Startups:**
  - "up to $23K": one year of Scale with the "$500/month fee waived" ($6,000), $10,000 Cloud credits and $7,000 inference credits (~$1K each from AssemblyAI, Deepgram, Fish Audio, Gemma, Gradium, Inworld, Rime).
  - Credits expire 12 months after issue.
  - Eligibility: voice/video/physical AI core; under 50 staff; under $5M raised and pre-Series A; live website with a publicly identifiable team; incorporated; in production or launching within 6 months. Free-plan users may apply, but long-running or paying projects may be declined.
  - A card on file is needed to enrol (promo code at Scale checkout). Approval time is not stated.
  - Source: [LiveKit Startups](https://livekit.com/startups); terms last updated 07/04/2026 — [LiveKit startup terms](https://livekit.com/legal/startup-terms-of-service)
- **Google for Startups Cloud:**
  - Start tier, for those who "haven't yet received equity funding": "Up to $2,000 USD in credits valid for one year" — [Google one-pager PDF (undated)](https://services.google.com/fh/files/misc/startup_onepager.pdf)
  - Scale, for verified equity funding Seed to Series A: up to $100,000 in year 1 plus 20% of year-2 usage (up to another $100,000) — [Google one-pager PDF (undated)](https://services.google.com/fh/files/misc/startup_onepager.pdf)
  - The benefits page (via search) says "up to $200,000 … (up to $350,000 USD for AI startups)" for VC-backed firms, with Pre-Seed/Seed within 5 years or Series A within 12 months — [Google Cloud startup benefits](https://cloud.google.com/startup/benefits)
  - Grants, angel and friends-and-family money do not qualify for Scale but "will be evaluated for other program tiers" — [Google Cloud startup FAQ](https://cloud.google.com/startup/faq?hl=en)
  - The live pages would not render for direct reading.
- **AWS Activate:**
  - Founders: "Start with $1,000 USD in Activate Credits", up to $5,000 for select applicants; bootstrapped or self-funded.
  - Portfolio: up to $200,000 with an Activate Provider Org ID.
  - All tiers: pre-Series B, founded in the last 10 years, AWS account on a Paid Tier Plan.
  - "You'll hear back within 5–10 business days".
  - Source: [AWS Activate credits](https://aws.amazon.com/startups/credits)
- **Microsoft** (changes from 2 July 2025, page updated 14 Apr 2026):
  - "Founders Hub" name retired.
  - Two paths: investor-referral offer "Starts at $100,000"; Azure startup credit offer "Up to $5,000" = "$1,000 in credits (valid for 90 days)" plus "$4,000 (valid for 180 days) after business verification".
  - Requires a new Azure customer, a personal Microsoft account, and an eligible country.
  - ISV Success: $5,000–$50,000 for B2B apps published to the Microsoft marketplace.
  - Source: [Microsoft Learn: changes to Microsoft for Startups](https://learn.microsoft.com/microsoft-for-startups/changes-microsoft-for-startups)
- **Anthropic (Claude for Startups):**
  - "Our current cohort is now full, and we're not accepting new applications right now".
  - Partner discounts and credits "worth up to $45,000"; VC-partner route "up to $100K in additional API credits, claimed through your VC".
  - Credits are for the first-party Claude API only, not AWS/GCP/Azure.
  - Source: [claude.com/programs/startups](https://claude.com/programs/startups)
  - Third-party pages give a conflicting $1,000 baseline (Oct 2026 expansion) and a "full and closed … as of 30 October 2026" status — [unite.ai](https://unite.ai/anthropic-expands-claude-startups-program-with-new-founder-benefits); [guptadeepak guide](https://guptadeepak.com/startup-offers/guides/anthropic-for-startups)
- **OpenAI:** sources conflict.
  - A directory says OpenAI "has stopped running a startup credits offer … no application path" (14 Sep 2026) — [fin.ai](https://fin.ai/learn/ai-credits-for-startups)
  - Other pages describe VC-backed-only credits (e.g. up to $5,000 via OpenAI for Startups) — [guptadeepak OpenAI](https://guptadeepak.com/startup-offers/programs/openai-for-startups)
  - A regional Australian offer of up to $50,000 (Mar 2026) — [IT Brief Australia](https://itbrief.com.au/story/openai-boosts-australian-startups-credits-to-usd-50-000)
- **Cloudflare for Startups:**
  - Tiers: Tier 3 $10k (bootstrapped/self-funded, under $1M raised); Tier 2 $100k (under $5M, funded by an "affiliated partner"); Tier 1 $350k ($5M+).
  - All tiers need incorporation within 10 years, a live website, LinkedIn/X/GitHub activity, a business email on the company domain, for-profit status and a first-time application.
  - "consultancies, agencies, MSPs, and resellers are not a good fit".
  - Coverage: Workers, Durable Objects, KV, D1, R2 (≤$10K) and more. **Workers AI is "not covered by credits" for incoming startups effective Dec 1** (year not shown on the page).
  - Valid one year; review "up to 48 hours".
  - Source: [Cloudflare for Startups](https://www.cloudflare.com/forstartups/)
- **Telnyx Startups:**
  - "$20K in voice AI agent credits" for STT/TTS/LLM on Telnyx infrastructure, not call control.
  - Asks for "$500k+" raised or revenue from production users, and a working voice AI agent.
  - Credits last 6 months; applications evaluated "within 48 hours".
  - Source: [Telnyx startups program](https://telnyx.com/startups-program)
- **Deepgram:**
  - New accounts get "$200 in promotional credits available immediately upon signup".
  - The startup programme "starts at $1,000" (up to $100K tiers), expires 12 months after issue, and is used only after the signup credit.
  - For startups building their own voice AI, "not for agencies or consultants building on behalf of clients"; early-stage under $10M raised.
  - Sources: [Deepgram startup program](https://deepgram.com/startup-program); [Deepgram startup terms](https://deepgram.com/startup-program/terms-of-service)
- **ElevenLabs Startup Grants:** 12 months, "33 million free credits"; open to companies "with fewer than 25 employees, anywhere in the world"; unused characters do not carry over — [ElevenLabs blog](https://elevenlabs.io/blog/elevenlabs-startup-grants-just-got-bigger-now-12-months-and-over-680-hours-of-conversational-ai-audio); apply at [elevenlabs.io/startup-grants](https://elevenlabs.io/startup-grants)
- **NVIDIA Inception:** free membership, no equity. Cloud credits come through partners (AWS Activate, Nebius etc.), not from NVIDIA directly. Reported exclusions: consulting and outsourced development firms. Third-party only — [Thunder Compute guide](https://thundercompute.com/blog/nvidia-inception-program-guide); [guptadeepak NVIDIA](https://guptadeepak.com/startup-offers/programs/nvidia-inception)

### Inferences
- Order to apply in, once there is a public product page and a company-domain email:
  1. LiveKit Startups (biggest fit; covers telephony and Inference). Its "launching within 6 months" condition suits a Gate B/C timeline.
  2. Deepgram $200 at signup, no programme needed.
  3. ElevenLabs grant, if its Thai TTS is chosen.
  4. Google Start $2K or AWS Founders $1K–5K, whichever cloud hosts production.
  5. Microsoft $1K + $4K only if Azure is used.
- Cloudflare's and Deepgram's agency exclusions matter for a design studio. The application should present "O2's AI receptionist" as O2's own SaaS product with its own page, not as client services.
- Credits mostly expire in 6–12 months. Applying before the product can use them wastes them, so apply when moving from simulation to real calls.

### Gaps
- Twilio's startup programme: not researched in time.
- Exact Google Start eligibility today (company age, website, Thailand): the live pages would not render and the one-pager is undated.
- Approval times for LiveKit, Google, Microsoft and ElevenLabs: not published.
- Which year Cloudflare's "Dec 1" Workers AI exclusion refers to.
- OpenAI: no first-party page was reached; status is unresolved.

## 6. Thai government support (pointer only)

### Takeaway
depa's Digital Startup Fund (S2 Early, up to ฿1M, of which only ฿300K is grant; the rest is conditional and converts to depa equity) and NIA's grants are the relevant Thai routes. O2 has already researched depa in its vault.

### Cited Findings
- depa Digital Startup Fund: grants and conditional co-investment from pre-seed to growth — [depa startup page](https://www.depa.or.th/th/startup)
- O2's own research (6 Nov 2026):
  - O2 fits S2 (company ≤3 years, up to ฿1,000,000).
  - Only the first ฿300K is grant; the ฿700K part is conditional support that converts to depa shares by default.
  - Apply after registering as a depa Member.
  - Source: vault note `O2 Design Studio/context/method/depa-startup-fund.md`
- depa d-voucher / mini-Transformation Voucher (around ฿10,000 per SME) is for SMEs adopting digital tools, not startup funding. That could matter for O2's spa clients rather than for O2 — [Pertama Partners Thailand funding guide 2026](https://www.pertamapartners.com/funding/thailand-funding-guide-2026); [thailand.go.th on depa AI grants](https://www.thailand.go.th/issue-focus-detail/depa-targets-15600-businesses-with-ai-and-digital-grants-to-boost-competitiveness-in-southern-thailand?hl=en)
- NIA: IDEA proof-of-concept and POC prototype grants; Corporate Spark market-validation matching grants up to ฿5M; NIA reportedly leans to later-stage startups — [Startup Thailand (NIA) government support](https://startupthailand.nia.or.th/category/govsupport/); [NIA Corporate Spark](https://spark.nia.or.th/)

### Inferences
- If a spa client adopts the receptionist, the d-voucher or mini-Transformation Voucher might subsidise that client's first months. This is worth checking with depa as a sales aid.

### Gaps
- Current 2569/2570 NIA call dates and amounts were not checked.

## 7. Bottom line: cheapest path from "simulation on a Mac" to "first real test call", and what must eventually be paid

### Takeaway
O2 can reach a real PSTN call answered by its own agent with $0 spent by O2. The route: console or browser tests, then a softphone into the self-hosted livekit/sip on the LAN, then LiveKit Cloud Build (no card) with the worker still on the Mac, then the free US number. A real Thai number is the first thing that costs money and needs paperwork: either the business's own number via a licensed partner's SIP trunk, or a $10–25/month DID with NBTC KYC.

### Cited Findings
- Build plan: $0, no card; 1 free US local number with 50 inbound minutes; 1,000 third-party SIP minutes; 1,000 agent minutes; $2.50 Inference — [LiveKit pricing](https://livekit.com/pricing)
- `dev` mode connects the worker to LiveKit using `LIVEKIT_URL`/`API_KEY`/`API_SECRET`; console mode needs no LiveKit connection — [LiveKit docs: startup modes](https://docs.livekit.io/agents/server/startup-modes/)
- LiveKit SIP takes INVITEs on the SIP URI without REGISTER; inbound trunks can use credentials or allowed addresses — [LiveKit telephony docs](https://docs.livekit.io/telephony/); [inbound trunk docs](https://docs.livekit.io/telephony/accepting-calls/inbound-trunk/)
- Thai numbers: Twilio $25/mo local; Telnyx from $10/mo, both with Thailand DID requirements — [Twilio TH pricing](https://www.twilio.com/en-us/voice/pricing/th); [Telnyx Thailand](https://telnyx.com/phone-numbers/thailand.md)
- Paid LiveKit starts at Ship, $50/mo (5,000 agent minutes then $0.01/min; third-party SIP $0.004/min after 5,000) — [LiveKit pricing](https://livekit.com/pricing)

### Inferences
Step by step, each $0 to O2:
1. **Terminal.** Console mode, or `connect` if the agent is Node, against the local Postgres booking engine. Proves the dialogue, Thai/English handling and tools.
2. **Browser.** livekit-server already in Docker; worker in `dev` against `ws://localhost:7880`; self-run agents-playground (Next.js, env vars) or a Meet-style client. Proves WebRTC, VAD, barge-in and dispatch.
3. **LAN softphone.** Linphone, Zoiper or Telephone.app on the Mac, iPhone or Android, registration off, dialling `sip:…@<Mac LAN IP>` into livekit/sip. Inbound trunk with `allowed_addresses` for the LAN, or auth credentials. Proves narrowband audio into Thai STT, DTMF and the screened warm transfer with a real human leg.
4. **LiveKit Cloud Build, no card.** `lk cloud auth`; the worker stays on the Mac in `dev` pointing at the Cloud URL. Recreate the inbound trunk and dispatch rule in Cloud. Dial the Cloud SIP URI from a softphone on 4G. Proves internet NAT and jitter, and uses the 1,000 free SIP minutes.
5. **First real PSTN call.** Claim Build's free US number, attach it to the dispatch rule, and call it. Proves carrier signalling, ring timing and caller ID. O2 pays $0; the caller pays their own international rate unless someone in the US calls. Keep it within the 50 free inbound minutes.
6. **Optional, outbound.** A Twilio trial with a Thai sign-up (no card, 75 minutes, 30 days, up to 5 verified Thai numbers) can test calls to the owner's own mobile. Wiring it into LiveKit is unverified on a trial.

What eventually must be paid:
- A Thai inbound path per business: the business's own number plus a licensed partner's SIP trunk or forwarding (cost on the business/partner side), or a DID at $10–25/month plus per-minute rates.
- LiveKit beyond Build: Ship $50/month for more than 1,000 agent minutes or 5 concurrent calls, production SLAs, or more than one deployment. Alternatively a self-hosted VPS with a public IP for RTP.
- Model minutes: STT, LLM and TTS at list prices (e.g. Deepgram Nova-3 $0.0048/min, Aura-2 $0.018/min, GPT-5.4 mini $0.003/min via LiveKit Inference), or direct API keys.
- Postgres and hosting beyond free tiers.
- Credits (LiveKit up to $23K, cloud $1K–5K, Deepgram $200 + $1K) can cover the first 6–12 months once there is a public product page.

### Gaps
- How much a Thai mobile caller pays to dial the free US number. Whether Build's free number needs a card. Thai-quality STT/TTS choice and its cost. Data-residency (PDPA) implications of routing Thai callers' audio through LiveKit Cloud. None of these were researched here.
