# YouTube videos and companion write-ups for building an AI phone receptionist on free / open-source tools (as of 12 Nov 2026)

Method note for the report writer: no video was played. Everything below comes from search-result snippets, YouTube page titles, third-party video summaries, companion blog posts and the GitHub READMEs linked from them. A YouTube page fetch returned only the title (no description, channel or chapters), so where a claim rests only on a title or on a third-party summary of a video, it is marked **[title only]** or **[summary only]**. "~N days old" means the age the search index showed. Approximate dates computed from it assume the index was current on 12 Nov 2026 and are marked "≈". Nothing about Kirx was searched or opened (clean-room rule).

## Which videos and tutorials are worth watching or copying (curated list)?

### Takeaway
The only genuinely $0 video builds are "local voice agent" demos: LiveKit or Pipecat with Whisper, a small Ollama/llama.cpp model and Kokoro, tested in a browser. None of them shows a phone line, Thai, or a real booking. The receptionist and booking tutorials that do show phones and calendars almost all run on paid platforms (Vapi, Retell, Twilio, OpenAI Realtime), with n8n and Google Calendar/Sheets, and "free" there means signup credit. The most useful material for O2 is two GitHub repos rather than videos: LiveKit's `frontdesk` example (booking tools plus simulated callers) and ShayneP's `local-voice-ai` (the local LiveKit stack, native on Apple Silicon).

### Cited Findings

**A. Fully local LiveKit builds (truly $0 after hardware)**

- **"Set up a 100% Local AI Voice Agent in 10 minutes! | (LiveKit)"**, youtube.com/watch?v=78JFdQd04Kg. A third-party summary names the presenter as David Nguyen and dates it 20 Nov 2025, with 12,138 views when it was captured; length not given — [readray.ai summary](https://readray.ai/ms/notes/ai-agent-20260202/local-ai-voice-agent-10-min). Its companion post embeds the same video ID, dated 20 Nov 2025 — [GrowwStacks](https://growwstacks.com/blog/local-ai-voice-agent-livekit-docker/).
  - Stack: Whisper STT, Ollama running Gemma 3 4B, a TTS the summaries spell "Cooro" (almost certainly Kokoro), a LiveKit server, a custom web front end, and Docker Compose. Repo: `github.com/livekit-examples/local-voice-agent` — [GrowwStacks](https://growwstacks.com/blog/local-ai-voice-agent-livekit-docker/). The summary credits the repo to a LiveKit developer — [readray.ai](https://readray.ai/ms/notes/ai-agent-20260202/local-ai-voice-agent-10-min).
  - Free vs paid: the post claims $0 in ongoing API fees and no monthly charges after setup — [GrowwStacks](https://growwstacks.com/blog/local-ai-voice-agent-livekit-docker/).
  - Demo quality [summary only]: the presenter notes a "noticeable delay" because everything runs locally. The agent answers greetings and tells a joke. Nothing shows interruptions, tools or bookings — [readray.ai](https://readray.ai/ms/notes/ai-agent-20260202/local-ai-voice-agent-10-min).
  - Hardware and setup: about 45 GB of disk and 12 GB of RAM recommended, CPU-only. First setup takes 30–60 minutes, not 10 — [GrowwStacks](https://growwstacks.com/blog/local-ai-voice-agent-livekit-docker/). Docker must already be running before the agent service is reloaded, or it errors — [readray.ai](https://readray.ai/ms/notes/ai-agent-20260202/local-ai-voice-agent-10-min).
  - Telephony: none, browser only — [GrowwStacks](https://growwstacks.com/blog/local-ai-voice-agent-livekit-docker/).
- **"Set up a 100% Local AI Voice Agent in 10 minutes! [UPDATED] | (LiveKit)"**, youtube.com/watch?v=VvGLdwSf41w. Channel and date were not retrievable from the page — [YouTube page](https://www.youtube.com/watch?v=VvGLdwSf41w). The search snippet says it moves to Ollama's gemma-4-e2b and also mentions Nemotron **[title/snippet only]** — [search listing](https://www.youtube.com/watch?v=VvGLdwSf41w).
- **ShayneP/local-voice-ai** (MIT), the repo whose stack matches the updated video — [GitHub](https://github.com/ShayneP/local-voice-ai).
  - Stack: built on LiveKit Agents. STT is a Nemotron Q8 streaming runtime, with faster-whisper as a fallback (`STT_PROVIDER=whisper`). The LLM runs on llama.cpp: Qwen3 1.7B or Gemma 4 E2B. TTS is Kokoro (Kokoro ONNX on the lean profiles).
  - Apple Silicon: runs natively, not in Docker, using Metal, `livekit-server` and `llama-server` from Homebrew. Memory targets are about 4.7–6.5 GB.
  - Running it: `python3 run.py`, then a web front end at `localhost:8080`. No SIP is mentioned.
  - Warnings in the README: dev credentials, and no authentication on the local model endpoints.
- **"Build a 100% OFFLINE AI Voice Agent with LiveKit, Ollama & Docker! Full Local Setup"**, youtube.com/watch?v=PHFrchtDIoE **[title only]** — [YouTube](https://www.youtube.com/watch?v=PHFrchtDIoE).
- **"LiveKit + XTTS V2: Best Open Source Local AI Voice Assistant (100% Free)"**, youtube.com/watch?v=_ReI2nKPYHc. Indexed as ~742 days old (≈ late Oct 2024, **older material**). Stack: LiveKit, Coqui XTTS v2, and Groq or Ollama models **[snippet only]** — [YouTube](https://www.youtube.com/watch?v=_ReI2nKPYHc). Groq is a hosted API, so the "100% Free" title covers only the Ollama route.
- LiveKit beginner videos **[title only]**: "Build Your First Voice Agent" — [YouTube](https://www.youtube.com/watch?v=Ym6jT4Z3ydY); "How To Build Your First AI Voice Agent On LiveKit" — [YouTube](https://www.youtube.com/watch?v=rYJb-YIeS1M).
- Written companions:
  - A Medium tutorial connects LiveKit Agents to Ollama through an OpenAI-compatible endpoint — [Medium, T. Dawood](https://medium.com/@tdawood140/build-a-local-voice-text-virtual-assistant-with-python-livekit-ollama-6021eeaf7491).
  - Flavio Copes's guide notes that the LLM is fully local if Ollama is running — [flaviocopes.com](https://flaviocopes.com/livekit/).
  - LiveKit documents an Ollama LLM plugin for both Node.js and Python — [LiveKit docs](https://docs.livekit.io/agents/models/llm/ollama.md).

**B. Fully local Pipecat builds on Apple Silicon (truly $0)**

- **kwindla/macos-local-voice-agents** (Kwin Kramer, the reference repo; ~451 days old ≈ Aug 2025) — [GitHub](https://github.com/kwindla/macos-local-voice-agents).
  - Stack: Silero VAD, smart-turn v2, MLX Whisper, Gemma3n 4B served by any OpenAI-compatible server (LM Studio suggested), and Kokoro TTS.
  - Reported latency: under 800 ms voice to voice on an M-series Mac.
  - Testing: a React client over serverless WebRTC (SmallWebRTCTransport).
  - Gaps in the README: no telephony, no language notes, and no linked video.
- **"Local Voice AI translator (Pipecat, Daily, Whisper, Gemma3, ...)"**, youtube.com/watch?v=QEB03jm6LIU. Indexed as ~473 days old (≈ Aug 2025) **[title only]** — [YouTube](https://m.youtube.com/watch?v=QEB03jm6LIU).
- **"Local Voice AI Agent in 19 lines of Python (FREE & PRIVATE!)"**, youtube.com/watch?v=M6vI4Wk-Y4Q. Indexed as ~578 days old (≈ Apr 2025). Its description links a GitHub repo **[snippet only]** — [YouTube](https://www.youtube.com/watch?v=M6vI4Wk-Y4Q).
- Newer community repos, no videos:
  - **Apoorva87/local-voice-agent**: Pipecat, Smart Turn v3, MLX Whisper, Ollama, Kokoro, plus a memory server. About 2 GB of weights download on first launch — [GitHub](https://github.com/Apoorva87/local-voice-agent).
  - **mthomas100/local-voice**: Pipecat, streaming ASR, Qwen3-TTS, a local LLM; about 0.87 s to first audio, with iPhone and Mac apps — [GitHub](https://github.com/mthomas100/local-voice).
  - **Ianodad/voice-stack**: parakeet-mlx, Qwen3.6 on mlx-lm, Kokoro, Pipecat — [GitHub](https://github.com/Ianodad/voice-stack).
  - **ocnwaokoro/voice-page**: Silero, Smart Turn v3, Ollama, local and free — [GitHub](https://github.com/ocnwaokoro/voice-page).
- **cooldip00/voice-agent** is the closest "business call" local build: payment-reminder calls on Pipecat, Whisper, Qwen 2.5 7B (Ollama) and Kokoro, on one 8 GB laptop GPU, with measured latency and a test bench that scores 27 calls **[repo description only]** — [GitHub](https://github.com/cooldip00/voice-agent).
- Written companion: a DEV guide to Whisper.cpp with Metal, Ollama and Kokoro ONNX on Apple Silicon, without Pipecat (~230 days old) — [DEV Community](https://dev.to/xadenai/building-a-local-voice-ai-stack-whisper-ollama-kokoro-tts-on-apple-silicon-eo0).

**C. Receptionist / appointment-booking tutorials (mostly paid platforms)**

- **LiveKit `frontdesk` example** (official, in livekit/agents, no video) — [Front Desk README](https://cdn.jsdelivr.net/gh/livekit/agents@main/examples/frontdesk/README.md).
  - Purpose: an appointment-scheduling agent whose LLM must call `list_available_slots` before `schedule_appointment`, which needs a `slot_id`.
  - Error handling: an invalid slot raises a `ToolError` so the model can correct itself. Email is collected with `GetEmailTask()`, and an interruption before that task finishes aborts the booking before any API call.
  - Calendar: cal.com when `CAL_API_KEY` is set. Simulations use a deterministic `FakeCalendar`.
  - Not stated in the README: the default STT/LLM/TTS providers.
- **livekit-examples/outbound-caller-python**: an outbound agent with an appointment-reminder flow. It needs a SIP outbound trunk — [uithub mirror](https://uithub.com/livekit-examples/outbound-caller-python). The `make_call` recipe in python-agents-examples dispatches an agent and then dials through SIP — [GitHub](https://github.com/livekit-examples/python-agents-examples), [LiveKit docs](https://docs.livekit.io/recipes/make_call/).
- **kirklandsig/AIReceptionist** (a generic open-source project, AGPL-3.0) — [GitHub](https://github.com/kirklandsig/AIReceptionist).
  - Stack: LiveKit plus the **paid** OpenAI Realtime API speech-to-speech, with a SIP trunk (Twilio, Telnyx).
  - Cost: the README estimates about $0.20–0.30 per minute.
  - Booking: Google Calendar tools `check_availability` and `book_appointment`. The agent confirms the time with the caller before booking and tags events UNVERIFIED.
  - Testing: the LiveKit Playground works when `RECEPTIONIST_AGENT_NAME` is set to an empty string.
- **Vapi + n8n + GoHighLevel**, "I Build the Ultimate AI Voice Agent – Create Appointment Tool". Builds a "Create Appointment" tool in the Vapi dashboard (~550 days old ≈ May 2025, **older**) — [Vapi library](https://vapi.ai/library/i-build-the-ultimate-ai-voice-agent-create-appointment-tool-vapi-n8n-ghl).
- **Nate Herk, "Build Your Own AI Receptionist with VAPI and n8n"** ("Kylie"). The companion is a PDF in a Skool community, so access may be gated — [Skool asset](https://assets.skool.com/f/b51c57150c70495899bf4bc8aaee8166/0bd39bfeab434cdea0ea4c09dddab68dae20024b8cf3476a9c182b08281e9401).
- **Vapi + n8n pest-control receptionist**: built from scratch and tested with a live call **[description only]** — [builtwithagents.ai](https://www.builtwithagents.ai/strategy/pest-control-ai-voice-receptionist-vapi-n8n).
- Repos tied to tutorials:
  - **Retell + n8n**: creates a Google Calendar event during the call and logs it to Sheets — [GitHub](https://github.com/syedaliasghar6655-ops/retell-n8n-appointment-booking).
  - **Vapi + n8n**: books to Calendar and Sheets — [GitHub](https://github.com/rajaharoonaftab2000-ui/ai-voice-receptionist-vapi-n8n).
  - **Alejandro's free n8n workflows** (GHL + Retell, linked to his YouTube video) — [Gumroad](https://aiwithalejandro.gumroad.com/l/aivns).
  - A **$20 paid** GHL + Retell template bundle — [Gumroad](https://xolarion.gumroad.com/l/ghl-retell-ai-receptionist).
- **n8n template 21189**: a Vapi receptionist with Google Calendar and Twilio SMS — [n8n](https://n8n.io/workflows/21189-run-an-ai-voice-receptionist-with-vapi-google-calendar-and-twilio-sms/).
- **OpenAI Realtime beginner series** with a simulated scheduling call, youtube ID AZ0WziqO_QA. Whether it uses Twilio or a calendar was not confirmed **[mirror summary only]** — [videohighlight mirror](https://videohighlight.com/v/AZ0WziqO_QA).
- **Twilio + Ultravox + FastAPI**, an end-to-end receptionist tutorial dated 7 May 2026 (not opened) — [faketut.github.io](https://faketut.github.io/2026/05/07/voxflow-01-ai-receptionist-tutorial/).
- **Soniox's LiveKit voice-agent guide**: a dental booking flow with mock calendar tools, using Soniox STT (paid; Soniox advertises Thai STT for voice agents) — [Soniox](https://soniox.com/docs/integrations/livekit/voice-agent), [Soniox Thai](https://soniox.com/speech-to-text/use-cases/voice-agents/thai).

**D. Other open frameworks seen in tutorials**

- **Bolna**: the open-source repo is MIT and underpins Bolna's closed hosted API. Its local telephony uses Twilio or Plivo (paid numbers) — [GitHub bolna-ai/bolna](https://github.com/bolna-ai/bolna), [Dograh blog (competitor; treat as biased)](https://blog.dograh.com/bolna-ai-vs-open-source-voice-agent-which-to-choose/).
- **Vocode**: telephony-focused, with Twilio and Vonage built in. One tutorial pairs it with Ollama — [CallSphere tutorial (vendor-affiliated)](https://callsphere.ai/blog/vw4h-build-voice-agent-vocode-open-source.md).
- **A FreePBX community post** describes a fully self-hosted STT→LLM→TTS stack that answers PBX calls on your own GPU, as a "drop-in OpenAI Realtime" **[title only]** — [FreePBX community](https://community.freepbx.org/t/fully-self-hosted-voice-ai-for-your-pbx-drop-in-openai-realtime-runs-on-your-own-gpu-open-source/109855).

### Inferences
- For O2, "watch the video" is less useful than "read the repo". `livekit-examples/local-voice-agent` and `ShayneP/local-voice-ai` show the $0 local wiring on Apple Silicon. `frontdesk` shows the booking-tool discipline and the simulated-caller harness. Neither local video covers SIP, which O2 already has working.
- The "10 minutes" and "100% Free" titles are marketing. Real first setups take 30–60 minutes, and some "free" builds route the LLM through a hosted API (Groq).
- The Vapi/Retell/n8n receptionist videos are useful only for their conversation design and tool shapes (check availability → confirm → book → notify). Their platforms are per-minute paid services once the credit runs out.

### Gaps
- Channel names, lengths and chapters for most videos could not be read: YouTube pages returned only titles, and no transcripts were reachable. The presenter of 78JFdQd04Kg (David Nguyen) comes from a single third-party summary.
- I could not confirm whether PHFrchtDIoE and VvGLdwSf41w are from LiveKit's own channel or from creators.
- No video was found that combines a fully local stack with SIP telephony and a booking tool end to end.

## Which tutorials are truly $0, and which quietly depend on paid services or free trials?

### Takeaway
Truly $0, once the hardware exists: the local LiveKit and Pipecat builds (Whisper/MLX Whisper/Nemotron + Ollama/llama.cpp/LM Studio + Kokoro, over browser WebRTC). Everything that touches a real phone number, or uses Vapi, Retell, Bland, OpenAI Realtime or Twilio, is paid after a small signup credit. Even the reported credit amounts conflict between sources.

### Cited Findings
- **$0 claims:**
  - The local LiveKit write-up claims $0 ongoing fees, with hardware the only cost — [GrowwStacks](https://growwstacks.com/blog/local-ai-voice-agent-livekit-docker/).
  - kwindla's Pipecat build runs every model on the Mac — [GitHub](https://github.com/kwindla/macos-local-voice-agents).
  - ocnwaokoro/voice-page says it is "fully local, free" — [GitHub](https://github.com/ocnwaokoro/voice-page).
- **Vapi:**
  - Third-party guides report about $10 of trial credit (about 60 minutes) with no card. Another analysis reads it as $5 (100 minutes at the $0.05 hosting rate). After the credit there is no ongoing free allowance: $0.05/min plus provider costs. A startup programme for up to 90,000 free minutes was reported as on hold — [flexprice](https://flexprice.io/pricing-index/vapi), [Layer3Labs](https://www.layer3labs.io/guides/vapi-pricing), [CloudTalk](https://cloudtalk.io/blog/vapi-ai-pricing).
  - None of these are Vapi's own page. Confirm at vapi.ai/pricing.
- **Retell:** $10 of free credits and 20 concurrent calls, with no permanent free plan. The base rate is listed at $0.07/min, and one analysis puts all-in costs at $0.13–$0.31/min — [Layer3Labs](https://www.layer3labs.io/guides/retell-ai-pricing), [Dupple](https://dupple.com/learn/vapi-vs-retell-ai). Retell's own blog comparison of Vapi is a competitor's claim — [Retell blog](https://www.retellai.com/blog/vapi-ai-review).
- **OpenAI Realtime receptionists:**
  - AIReceptionist needs a paid OpenAI key, about $0.20–0.30/min.
  - Its README says the ChatGPT/Codex OAuth route stopped working for Realtime after OpenAI's Beta sunset on 3 Jun 2026 — [GitHub](https://github.com/kirklandsig/AIReceptionist). This is an example of a "free" route disappearing.
- **Bolna and Vocode telephony** route through Twilio, Plivo or Vonage, which bill for numbers and minutes — [GitHub bolna](https://github.com/bolna-ai/bolna), [CallSphere](https://callsphere.ai/blog/vw4h-build-voice-agent-vocode-open-source.md).
- **LiveKit's own tooling:**
  - Console mode needs no LiveKit connection. However, it still needs credentials if the agent uses LiveKit Inference (LiveKit's hosted models) — [LiveKit testing docs](https://docs.livekit.io/agents/start/testing/), [startup modes](https://docs.livekit.io/agents/server/startup-modes/).
  - The browser **Agent Console** is launched from the LiveKit **Cloud** dashboard — [LiveKit blog](https://livekit.com/blog/agent-console-debugging-dashboard).
- **Typhoon hosted API:** an aggregator lists a no-card free tier (5 requests/second, 200 RPM for text models, no daily cap published) on `api.opentyphoon.ai/v1` — [free-llm.com](https://free-llm.com/provider/opentyphoon). This is unverified, the two rate figures look inconsistent, and it is not Typhoon's own documentation.
- **Cost framing from a 2026 LiveKit telephony post:** failed and waiting calls are billed too, so measure cost per resolved call rather than per minute — [knightli.com](https://knightli.com/en/2026/07/28/livekit-voice-ai-agent-telephony-sip-interruption-human-handoff-logs/).

### Inferences
- The only truly $0 route is self-hosted LiveKit (which O2 already runs) plus local models. The one unavoidable cost for real callers is the SIP trunk or number, which none of the $0 videos address.
- "Free tier" platforms are prototyping credit (~$5–10, roughly one to two hours of calls), not a way to run a business line. Their pricing pages and programmes change: the Vapi startup programme is on hold, and OpenAI's Realtime beta was sunset.
- If O2 uses LiveKit's Python console or Cloud Agent Console for testing, it must not switch on LiveKit Inference or Cloud models, or it leaves $0.

### Gaps
- None of the vendors' own pricing pages were fetched, so the Vapi and Retell figures rest on third-party sites, some of them competitors.
- Bland's trial terms were not researched.
- Typhoon's official free-tier limits were not confirmed on docs.opentyphoon.ai.

## Which resources support Thai, or could? (Thai channels, Typhoon, Thai Whisper, Thai TTS)

### Takeaway
I found **no Thai-language YouTube tutorial** that builds a phone receptionist or voice agent end to end. Thai material is chat (a LINE bot with Typhoon), commercial vendors (BOTNOI, CIPHER), and model releases.

- **Thai STT is solved by open models:** Typhoon ASR Real-time (115M, streaming, runs on CPU) and Typhoon Whisper.
- **Thai TTS is the weak link:** Kokoro and Piper, used in every local video, showed no Thai voice in any search. Open Thai TTS exists (F5-TTS fine-tunes, VachanaTTS/PyThaiTTS), but some is licensed non-commercial, and Typhoon's own TTS is a research preview behind registration.

### Cited Findings
- **Thai YouTube / Thai blogs:**
  - Searches in Thai for voice-bot and phone-answering tutorials returned no Thai YouTube walkthroughs — [search: LiveKit results only](https://github.com/livekit/agents).
  - The LINE Developers Thailand Medium post builds a LINE chatbot on Typhoon LLM through BOTNOI (chat, not voice) — [Medium LINE Dev TH](https://medium.com/linedevth/line-chatbot-%E0%B9%80%E0%B8%8A%E0%B8%B7%E0%B9%88%E0%B8%AD%E0%B8%A1%E0%B8%81%E0%B8%B1%E0%B8%9A-typhoon-llm-ai-%E0%B8%84%E0%B8%99%E0%B9%84%E0%B8%97%E0%B8%A2-%E0%B9%83%E0%B8%84%E0%B8%A3-%E0%B9%86-%E0%B8%81%E0%B9%87%E0%B8%97%E0%B8%B3%E0%B9%84%E0%B8%94%E0%B9%89-042d15660b92).
  - A Thai vendor guide (CIPHER) describes inbound appointment booking for clinics as a voice-AI use case — [CIPHER](https://www.cipher.co.th/en/blogs/voice-ai-%e0%b8%84%e0%b8%b7%e0%b8%ad%e0%b8%ad%e0%b8%b0%e0%b9%84%e0%b8%a3-%e0%b8%84%e0%b8%b9%e0%b9%88%e0%b8%a1%e0%b8%b7%e0%b8%ad%e0%b9%83%e0%b8%8a%e0%b9%89-ai-%e0%b8%a3%e0%b8%b1%e0%b8%9a%e0%b8%aa%e0%b8%b2%e0%b8%a2-%e0%b9%82%e0%b8%97%e0%b8%a3%e0%b8%ad%e0%b8%ad%e0%b8%81%e0%b8%a0%e0%b8%b2%e0%b8%a9%e0%b8%b2%e0%b9%84%e0%b8%97%e0%b8%a2%e0%b8%aa%e0%b8%b3%e0%b8%ab%e0%b8%a3%e0%b8%b1%e0%b8%9a%e0%b8%98%e0%b8%b8%e0%b8%a3%e0%b8%81%e0%b8%b4%e0%b8%88/).
  - BOTNOI sells a Thai inbound and outbound voicebot (commercial) — [BOTNOI](https://botnoigroup.com/?lang=en).
- **Typhoon docs:** the quickstart shows an OpenAI-compatible API with `typhoon-v2.1-12b-instruct` and a Thai-only system prompt, so it plugs into the LiveKit/Pipecat "OpenAI-compatible LLM" slot — [Typhoon quickstart](https://docs.opentyphoon.ai/en/quickstart/).
- **Typhoon ASR Real-time:**
  - Code: `pip install typhoon-asr`; Apache-2.0 code, with weights and datasets under their own licences; Linux/Mac, Python 3.10. The one CPU example is RTF 0.293× (1.32 s for a 4.5 s clip). No LiveKit or Pipecat integration is shown, and numbers, code-switching, noise and 8 kHz phone audio are not addressed — [GitHub scb-10x/typhoon-asr](https://github.com/scb-10x/typhoon-asr).
  - Paper: a 115M-parameter FastConformer-Transducer, chosen over Whisper for low-latency streaming with "hallucination-free" output (the authors' claim) — [arXiv 2601.13044](https://arxiv.org/html/2601.13044v1).
  - Model card — [Hugging Face](https://huggingface.co/typhoon-ai/typhoon-asr-realtime).
- **Typhoon Whisper Turbo and Large v3:** Thai ASR fine-tunes of Whisper, under OpenTyphoon terms — [HF turbo](https://huggingface.co/typhoon-ai/typhoon-whisper-turbo), [HF large-v3](https://huggingface.co/typhoon-ai/typhoon-whisper-large-v3). A community CTranslate2 (faster-whisper) Thai small model also exists — [HF Thaweewat/whisper-th-small-ct2](https://huggingface.co/Thaweewat/whisper-th-small-ct2/blob/main/README.md?code=true).
- **Typhoon Isan (27 Nov 2025):**
  - Released: two open ASR models (a streaming one of ~115M and a Whisper-Medium one of ~800M) and a demo voice agent chaining Typhoon Isan ASR → Typhoon LLM 2.5 → Typhoon Isan TTS.
  - Not stated: whether the TTS is released or open-weights, any latency figures, or any licence name.
  - Footer: a "Join Text-to-Speech Research" link to voice.opentyphoon.ai — [Typhoon blog](https://opentyphoon.ai/blog/en/typhoon-isan-release).
  - SCB 10X also posted a "Human Voice vs AI Voice" comparison — [SCB10X on X](https://x.com/SCB10X_OFFICIAL/status/1909849654281585032).
- **Typhoon2-Audio:** its repo added TTS to the audio-to-audio model class — [GitHub mirror](https://gh.r-mj.com/scb-10x/typhoon2-audio).
- **Community Typhoon voice builds:**
  - TiNYsx/Typhoon-TTS-STT-Instruction: a Typhoon 2 LLM with a Thai MMS-TTS voice (not Typhoon TTS) — [GitHub](https://github.com/TiNYsx/Typhoon-TTS-STT-Instruction).
  - hakumaguro/vrc-translate-typhoon: a Rust app with local Typhoon ASR and VAD on live Thai speech — [GitHub](https://github.com/hakumaguro/vrc-translate-typhoon).
- **Open Thai TTS:**
  - ThonburianTTS: F5-TTS and E2-TTS Thai fine-tunes; the best F5 model reports CER 8.70%, with code and weights on GitHub (biodatlab) — [Mahidol repository](https://repository.li.mahidol.ac.th/items/01425a99-9731-4855-ba46-c7c77b0c9079/full).
  - f5-tts-th: v1 pronounces Thai better; v2 uses IPA to cut misreadings — [PyPI](https://pypi.org/project/f5-tts-th/).
  - OpenJaiTTS-v1.0: F5-based, RTF below 0.2, **CC BY-NC 4.0 (non-commercial)** — [HF](https://huggingface.co/JTS-AI/OpenJaiTTS-v1.0).
  - PyThaiTTS: Apache-2.0, with VachanaTTS (VITS), Lunarlist ONNX and KhanomTan backends — [PyPI](https://pypi.org/project/PyThaiTTS).
  - An 82M on-device Thai TTS, Wayu-Paxa-TTS-Edge, is described as open-sourced in a 2026 paper (authors not seen) — [HF papers](https://huggingface.co/papers/2609.03502).
- **No Thai in the default local voices:**
  - No Thai Kokoro voice turned up in searches — [tts.ai 2026 guide](https://tts.ai/blog/open-source-text-to-speech-guide-2026/?lang=th).
  - No Thai Piper voice was found. A Home Assistant thread shows Piper lacks some languages (Urdu), and a 2026 blog says Piper was archived on 6 Oct 2025 (secondary source; status contested) — [HA community](https://community.home-assistant.io/t/human-sounding-local-offline-urdu-tts-for-home-assistant-piper-has-no-urdu-voice-xtts-v2-doesn-t-support-urdu-officially/972954), [kunalganglani.com](https://www.kunalganglani.com/blog/local-ai-voice-assistant-whisper-piper-ollama).
- **LiveKit multilingual:** LiveKit has a guide to agents that detect the caller's language and switch TTS — [LiveKit field guide](https://livekit.com/field-guides/guide/build-multilingual-voice-agent-automatic-language-switching).

### Inferences
- A Thai version of the $0 videos means swapping two parts:
  - STT: MLX Whisper or Nemotron → Typhoon ASR Real-time (streaming, CPU) or Typhoon Whisper Turbo.
  - TTS: Kokoro → a Thai TTS. On licence grounds, PyThaiTTS/VachanaTTS (Apache-2.0 library) is the safest $0 starting point, but voice quality is unknown. ThonburianTTS and f5-tts-th sound like better quality, but their weight licences must be checked (see Gaps).
- English turns can keep Kokoro.
- No Thai creator has published this. O2 would be ahead of public Thai tutorials, and must test Thai quality itself; there is no demo to rely on.

### Gaps
- Typhoon TTS availability (open weights, API or licence) is unconfirmed; only a research-preview registration link was found.
- The weight licences of ThonburianTTS and f5-tts-th were not checked. F5-TTS base checkpoints may carry a non-commercial licence (not verified this session).
- Thai searches surfaced no Thai YouTube channels on voice agents. Facebook-group posts and Thai-language videos may exist but were not reachable by web search.
- No Thai Kokoro or Piper voice was confirmed absent from the official voice lists. This is a "not found", not a verified "does not exist".
- Home Assistant's Thai support was not established.

## How do others test voice agents without paying for phone numbers or API calls?

### Takeaway
The recurring free test ladder is: text mode and unit tests → terminal console (voice) → a browser WebRTC client/playground → simulated callers scored by judges against a fake calendar on a fixed clock → only then SIP. LiveKit's own `frontdesk` example packages the simulated-caller harness. Its Python-only console mode is a catch for O2's TypeScript stack.

### Cited Findings
- **LiveKit console and text mode:**
  - `lk agent console` or `python myagent.py console` runs the agent in the terminal without connecting to LiveKit, by voice or text (`--text`) — [LiveKit testing docs](https://docs.livekit.io/agents/start/testing/).
  - Console mode is **Python-only** — [LiveKit startup modes](https://docs.livekit.io/agents/server/startup-modes/).
  - The docs recommend text-mode tests as cost-efficient and deterministic, saving audio runs for turn-taking issues. A CLI debugger replays conversations from a script — [LiveKit testing overview](https://docs.livekit.io/testing/overview/), [CLI agent testing](https://docs.livekit.io/reference/developer-tools/livekit-cli/agent/testing/).
- **Browser Agent Console:** works with Python or Node agents, local or deployed, launched from the LiveKit Cloud dashboard — [LiveKit blog](https://livekit.com/blog/agent-console-debugging-dashboard).
- **Simulated callers with judges (frontdesk):** 10 scenarios in `scenarios.yaml` (happy paths and adversarial callers) run against a simulated user (`simulation.py`).
  - Each scenario sets the available slots, an `expected_booking` checked against the final calendar state, and an optional `now` clock (default 2026-06-12).
  - Tools are mocked through `mock_tools` over one shared `FakeCalendar`, so a booking changes later slot lists.
  - A `JudgeGroup` scores each session — [Front Desk README](https://cdn.jsdelivr.net/gh/livekit/agents@main/examples/frontdesk/README.md).
  - LiveKit also markets "agent simulations" as a product — [LiveKit](https://livekit.com/products/agent-simulations).
- **Browser WebRTC clients in every local build:**
  - Pipecat's SmallWebRTCTransport with a React debug console — [kwindla](https://github.com/kwindla/macos-local-voice-agents).
  - A web front end at `localhost:8080`, with pytest and frontend builds — [ShayneP](https://github.com/ShayneP/local-voice-ai).
  - The LiveKit Playground with the agent name emptied — [AIReceptionist](https://github.com/kirklandsig/AIReceptionist).
- **Scored call bench:** a local payment-reminder agent ships "a test bench that scores 27 calls" **[repo description only]** — [cooldip00/voice-agent](https://github.com/cooldip00/voice-agent).
- **Practical test order and fault drills** (author's experience):
  - Check in a browser room or the Playground first that the agent hears the caller, replies promptly, stops on interruption, calls a safe tool and frees resources.
  - Then run fault drills: kill the worker, break the STT key, time out the LLM, fail TTS, and take the human queue offline. Confirm the caller hears a degraded but clear response.
  - Load-test with controlled SIP test accounts, not manual dialling — [knightli.com](https://knightli.com/en/2026/07/28/livekit-voice-ai-agent-telephony-sip-interruption-human-handoff-logs/).

### Inferences
- O2's engine is TypeScript, so LiveKit's Python console mode does not apply to its agent. The free equivalents are a local browser client against self-hosted LiveKit (as ShayneP and Pipecat do), the CLI text-mode debugger, and O2's existing SIPp harness for the phone leg.
- The `frontdesk` pattern (scenario file + simulated user + judges + fake calendar with a fixed `now`) maps almost one to one onto a Gate A simulation. It can run $0 if both the simulated caller and the judges point at a local OpenAI-compatible model (Ollama/llama.cpp). Whether `JudgeGroup` accepts a local model was not verified.

### Gaps
- Whether LiveKit's `JudgeGroup` and simulation tooling exist in the Node/TS Agents SDK, or only in Python, was not confirmed.
- No tutorial was found that runs LLM-vs-LLM voice evaluations fully on local models.

## What pitfalls recur (latency on CPU, turn detection, Thai tokenisation, changing free tiers)?

### Takeaway
Four pitfalls recur:

- **CPU latency:** "noticeable delay" on CPU-only Docker builds; under 0.8–0.9 s only on Apple Silicon with MLX or Metal.
- **Turn detection:** LiveKit's multilingual turn detector does not list Thai, and VAD tuned in a quiet office fails on noisy phone audio.
- **Thai speech:** Whisper hallucinations and weaker Thai ASR, plus no Thai voice in the default TTS.
- **Install and free-tier churn:** large first downloads, package-extra quirks, and trial credits or beta routes that change or vanish.

### Cited Findings
- **Latency:**
  - The CPU-only LiveKit/Ollama video shows a "noticeable delay" — [readray.ai](https://readray.ai/ms/notes/ai-agent-20260202/local-ai-voice-agent-10-min).
  - Under 800 ms voice to voice on an M-series Mac with MLX — [kwindla](https://github.com/kwindla/macos-local-voice-agents); about 0.87 s to first audio — [mthomas100](https://github.com/mthomas100/local-voice).
  - ShayneP says Nemotron's streaming partials beat Whisper on latency — [GitHub](https://github.com/ShayneP/local-voice-ai).
  - faster-whisper with greedy decoding (`beam_size=1`) and short chunks cuts latency — [DEV](https://dev.to/mupromax/how-to-run-whisper-locally-for-real-time-speech-to-text-faster-whisper-35df).
  - In one (non-Thai) streaming study, a hallucination pushed latency from 0.506 s to 1.882 s — [arXiv 2409.00965](https://arxiv.org/html/2409.00965v1).
- **Turn detection:**
  - The LiveKit docs say the MultilingualModel covers English plus 13 languages — [LiveKit turn detector](https://docs.livekit.io/agents/logic/turns/turn-detector).
  - The list in plugin v1.3.3 omits Thai — [PyPI 1.3.3 via socket.dev](https://socket.dev/pypi/package/livekit-plugins-turn-detector/overview/1.3.3).
  - A community request to add Thai (the base model, Qwen2.5-0.5B, handles Thai) was only acknowledged — [LiveKit community](https://community.livekit.io/t/add-language-for-turn-detection/668).
  - Pipecat builds use Smart Turn v2/v3 instead — [kwindla](https://github.com/kwindla/macos-local-voice-agents), [Apoorva87](https://github.com/Apoorva87/local-voice-agent).
  - Tune VAD and turn detection on real phone recordings, not quiet browser-mic tests: phone audio is narrower and noisier, and callers pause while reading numbers. Over-sensitive VAD treats coughs or TV as interruptions — [knightli.com](https://knightli.com/en/2026/07/28/livekit-voice-ai-agent-telephony-sip-interruption-human-handoff-logs/).
- **Thai ASR:**
  - Typhoon's authors chose a transducer over Whisper to avoid hallucinations in streaming — [arXiv 2601.13044](https://arxiv.org/html/2601.13044v1).
  - A Thai streaming-ASR paper says Thai ASR traditionally lags English and Chinese — [SciTechAsia](https://ph02.tci-thaijo.org/index.php/SciTechAsia/article/download/261609/172781/998662).
  - Typhoon ASR's README does not cover numbers, code-switching or 8 kHz phone audio — [GitHub](https://github.com/scb-10x/typhoon-asr).
- **Install pitfalls:**
  - The "10-minute" setup really takes 30–60 minutes and ~45 GB — [GrowwStacks](https://growwstacks.com/blog/local-ai-voice-agent-livekit-docker/).
  - `pipecat-ai[mlx-whisper]` alone cannot import; the whisper extra is also needed. About 2 GB downloads on first run — [Apoorva87](https://github.com/Apoorva87/local-voice-agent).
  - Warm the Kokoro cache with a one-off `mlx-audio.generate` before the first run — [DhanushPrince/Jarvis](https://github.com/DhanushPrince/Jarvis).
  - pipecat-local-tts-server pins mlx-audio 0.6.1 — [PyPI](https://pypi.org/project/pipecat-local-tts-server/0.8.3/).
  - First startup can take 30 s or more while models download — [kwindla](https://github.com/kwindla/macos-local-voice-agents).
- **Security defaults:** the local stacks ship dev credentials and unauthenticated model endpoints — [ShayneP](https://github.com/ShayneP/local-voice-ai).
- **Free tiers and routes changing:**
  - Conflicting Vapi credit figures and a paused startup programme — [Layer3Labs](https://www.layer3labs.io/guides/vapi-pricing), [flexprice](https://flexprice.io/pricing-index/vapi).
  - OpenAI's Realtime beta sunset (3 Jun 2026) broke an OAuth route — [AIReceptionist](https://github.com/kirklandsig/AIReceptionist).
  - Piper's archive status is contested — [kunalganglani.com](https://www.kunalganglani.com/blog/local-ai-voice-assistant-whisper-piper-ollama).
- **Licences to watch:**
  - AIReceptionist is AGPL-3.0, so modifications run as a network service must be released — [GitHub](https://github.com/kirklandsig/AIReceptionist).
  - OpenJaiTTS is non-commercial — [HF](https://huggingface.co/JTS-AI/OpenJaiTTS-v1.0).
  - Typhoon weights carry their own licences — [GitHub](https://github.com/scb-10x/typhoon-asr).
- **Tricks worth copying:**
  - Booking tools that enforce availability → `slot_id` → book, with a `ToolError` on a bad slot, and abort the booking if interrupted before details are complete — [frontdesk](https://cdn.jsdelivr.net/gh/livekit/agents@main/examples/frontdesk/README.md).
  - Confirm before booking and tag AI-made events UNVERIFIED — [AIReceptionist](https://github.com/kirklandsig/AIReceptionist).
  - Log timestamps for voice start, VAD, TTS stop, final STT and first reply audio; track P50/P95. Play one short wait prompt on slow tools, and cache fixed greetings — [knightli.com](https://knightli.com/en/2026/07/28/livekit-voice-ai-agent-telephony-sip-interruption-human-handoff-logs/).

### Inferences
- On O2's M4 Pro (24 GB), the MLX/Metal route (kwindla's or ShayneP's native mode) is the one the evidence says reaches sub-second replies. The CPU-only Docker route from the most-watched LiveKit video is the slow one.
- Thai turn-taking is the hardest unsolved piece. Without a Thai-capable turn detector, O2 falls back to VAD plus silence timeouts (LiveKit's stated fallback, per the community thread), or tries Smart Turn, whose Thai support was not checked. Both must be tuned on recorded 8 kHz Thai calls, including callers reading out phone numbers.
- Thai word segmentation was not raised in any tutorial found. It matters on O2's side (TTS sentence chunking, keyword matching) rather than in the videos.

### Gaps
- Smart Turn v3's language coverage (Thai or not) was not verified.
- No YouTube comment threads or issue trackers were read, because comments are not reachable through fetch. The pitfalls above come from READMEs and blogs, not viewers' comments.
- Thai-specific evidence on Whisper hallucination, and real-world latency numbers for Typhoon ASR on 8 kHz phone audio, were not found.
- Vocode, Ultravox (self-hosted), Moshi, Sesame/CSM and Home Assistant pipelines were only touched at the framework level. No 2025–2026 video for them was confirmed, and none was confirmed to support Thai.
