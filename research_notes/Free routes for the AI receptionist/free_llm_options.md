# Free (zero extra spend) ways to run the AI receptionist's model-driven test harness — November 2026

Researched 12 Nov 2026 from public pages only (no sign-ups, no credentials). Every price is US$. The harness data is fictional (seeded spa, sandbox transport), so "inputs may be used for training" is a hygiene note here, not a blocker — but it would matter for any real caller data later.

**What the harness actually needs (read from the local code, not the web):**
- `sim/model/run.ts` is written against the Anthropic SDK (`messages.create`), with a second model playing the caller (default `--caller-model claude-opus-5-5`), up to 12 caller turns per call, 8 scenarios × 2 repeats, and its own per-conversation cost guess (Opus ≈ $0.35, Sonnet ≈ $0.20, Haiku ≈ $0.08, caller included) — [local: `Studio/AI receptionist/engine/sim/model/run.ts`, lines 1–66](file:///Users/natdanaisuanpong/Documents/O2%20Group/O2%20Design%20Studio/Studio/AI%20receptionist/engine/sim/model/run.ts)
- The receptionist wrapper uses Claude-specific features: prompt caching (`cache_control: ephemeral`), `output_config: { effort }`, and Anthropic's server-side refusal fallback (`fallbacks: "default"`) for Opus/Sonnet 5.5 — [local: `engine/sim/model/receptionist.ts` lines 57–77; `engine/README.md` line 50](file:///Users/natdanaisuanpong/Documents/O2%20Group/O2%20Design%20Studio/Studio/AI%20receptionist/engine/README.md)
- It already goes through a `ModelClient` interface (`import { Receptionist, type ModelClient } from './receptionist.ts'`), so any free route below needs one adapter for an OpenAI-compatible `/v1/chat/completions` (+ tools) endpoint — [local: `engine/sim/model/run.ts` line 14]
- Working size assumption used for the arithmetic below (an inference, not measured): ~400 receptionist model calls per model-run (16 calls × up to 12 turns × ~2 calls per turn for tool loops) at ~4,000 input + ~250 output tokens each, plus ~190 caller calls at ~1,500 in / ~100 out ⇒ **≈ 1.6–2.0 M input tokens and ≈ 0.1–0.15 M output tokens per model-run**, with no prompt caching on most free tiers. The harness logs real token counts, so one dry or small run would replace this guess.

---

## 1. Local models (Ollama / llama.cpp / MLX) on the M4 Pro, 24 GB

### Takeaway
Local is the only route that is truly $0, unlimited and private; the strongest Thai open models that physically fit are Gemma 4 (12B comfortably; 26B/31B only just) and Qwen 3.6 27B (tight), with Typhoon 2.5 30B-A3B as the Thai-specialised option with explicit tool support. On SEA-HELM Thai (18 Sep 2026) Gemma 4 31B (74.30) and Qwen 3.6 27B (73.22) lead every model ≤35B and beat gpt-oss-120b (66.88); no leaderboard measures Thai tool calling, so the harness itself is the tool-calling test. Expect tens of tokens/s, i.e. roughly 0.5–2 h per model-run, and plan for memory pressure with Postgres running alongside.

### Cited Findings
**Thai quality (benchmarks)**
- SEA-HELM Thai leaderboard, dated 18 Sep 2026 (average of 2,000 bootstraps): Gemma 4 31B **74.30** (instruction following 97.36, multi-turn chat 84.84); Qwen 3.6 27B **73.22** (IF 92.05, MTC 82.71); SEA-LION v4.5 (Qwen) 27B **73.00**; Muse Glimmer 30B 69.38; SEA-LION v4.8 (Nemotron) 30B 62.60; GLM 4.7 Flash 30B 59.29; Gemma 4 E2B 5B 58.32; for comparison Qwen 3.5 122B-A10B 72.75, **GPT OSS 120B (mxfp4) 66.88**, Mistral Medium 3.5 128B 64.35. Typhoon, gpt-oss-20b and Llama are not on the board — [SEA-HELM Thai](https://leaderboard.sea-lion.ai/detailed/TH)
- SEA-HELM's capability areas include "instruction-following in Southeast Asian languages", but there is no tool/function-calling sub-score — [SEA-HELM](https://leaderboard.sea-lion.ai/)
- Typhoon 2.5 (released 20 Oct 2025, built on Qwen3 Instruct 2507; 4B and 30B-A3B MoE) reports Tau-Bench retail (customer-service tool-use simulation) average 55 (Thai 50, English 60) and "enhanced function calling", "well ahead of earlier Typhoon and Qwen baselines" — vendor's own evaluation, Qwen3 numbers only in charts — [Typhoon 2.5 release](https://opentyphoon.ai/blog/en/typhoon2-5-release)
- Older Thai MT-Bench figures: Typhoon2.1 12B 7.5, Typhoon 2 70B 7.4, Gemma 3 12B IT 7.5 (effectively a tie) — [Together AI customer page](https://www.together.ai/customers/scb10x)
- ThaiExam (HELM) is dated (2024): Qwen2 72B Instruct 0.638 EM vs Typhoon 1.5X 70B 0.617 — [Stanford CRFM ThaiExam](https://crfm.stanford.edu/2024/09/04/thaiexam.html)
- The studio's own October 2026 test of local models (O2 Agent): `gpt-oss:20b` "follows the rules at about 5 s a Thai answer when the Mac is well"; `qwen3:14b` "writes cleaner Thai at about 17 s and repeats itself"; Typhoon 2.1 "writes the most natural Thai but invented web addresses and facts"; the model took "about 13 GB" of memory, and answers took 20–60 s one evening on a 15-watt charger — [local: `.claude/studio-notes.md`, `Studio/agent/` row; answers in `Studio/Website remodel/phase-4/own-agent-2026-10-10/`]

**What fits and what supports tools (Ollama)**
- `gemma4`: 12b 7.7–8.0 GB (256K ctx), 26b 16–19 GB, 31b 19–20 GB, e4b 6.6–9.5 GB, MLX builds of each (31b-mlx 19 GB); the family is labelled "tools" with "native function-calling support"; also `:cloud` tags that run remotely — [Ollama gemma4](https://ollama.com/library/gemma4)
- `qwen3.6`: 27b 18–19 GB, 35b (= latest) 23 GB, MLX builds; capabilities "vision", "tools", "thinking"; 256K ctx; Thai support not stated on the page — [Ollama qwen3.6](https://ollama.com/library/qwen3.6)
- SCB 10X's Ollama models with "tools": `typhoon2.5-qwen3-30b-a3b`, `typhoon2.5-qwen3-4b`, `typhoon2.1-gemma3-12b`, `typhoon2.1-gemma3-4b`, `llama3.1-typhoon2-8b-instruct` (all updated "1 year ago"; nothing newer than Typhoon 2.5 listed) — [Ollama scb10x](https://ollama.com/scb10x)
- The 30B-A3B GGUF can also be pulled as `ollama run hf.co/typhoon-ai/typhoon2.5-qwen3-30b-a3b-gguf:Q4_K_M` (the models moved to the `typhoon-ai` Hugging Face org; the `scb10x` org now shows "None public yet") — [HF typhoon-ai GGUF](https://huggingface.co/typhoon-ai/typhoon2.5-qwen3-30b-a3b-gguf); [HF scb10x](https://huggingface.co/scb10x)
- Typhoon2.1-Gemma3-12B: 128K context, function calling, card shows a vLLM tool-call parser example — [HF model card](https://huggingface.co/scb10x/typhoon2.1-gemma3-12b)
- Ollama's OpenAI-compatible endpoint supports "Tools", "JSON mode", streaming and reasoning control; **`tool_choice` is not supported**; `response_format` is accepted but `json_schema`/strict structured outputs are not documented there — [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)
- Tool support depends on each model's chat template; check with `ollama show <model>` for "tools" under Capabilities — [Ollama tool calling docs](https://docs.ollama.com/capabilities/tool-calling)

**Speed on an M4 Pro 24 GB (no measured Ollama figure found)**
- Qwen3-30B-A3B Q4_K_M: ~35 tok/s via MLX, first token ~1.0 s (LLMCheck); ~22 tok/s on 24 GB (BestLLMfor, engine unclear) — [LLMCheck](https://llmcheck.net/models/qwen-3-30b-a3b-on-m4-pro/); [BestLLMfor](https://bestllmfor.com/best/mac-mini-m4-pro/)
- gpt-oss-20b MXFP4: ~64 tok/s *estimated* (LLMCheck says its figures are estimates); a community oMLX benchmark on an M4 Pro 16-core GPU 24 GB shows 54.5 tok/s generation at 4K context — [LLMCheck](https://llmcheck.net/models/gpt-oss-20b-on-m4-pro/); [oMLX community benchmarks](https://omlx.ai/benchmarks)

### Inferences
- **Best local shortlist for this harness:** (1) `gemma4:12b` (8 GB: safe headroom, family leads SEA-HELM Thai — but the 74.30 score is for 31B, not 12B); (2) `typhoon2.5-qwen3-30b-a3b` (Thai-specialised, tool-trained, MoE so fast; ~18–19 GB at Q4 — size not verified from an official page); (3) `qwen3.6:27b` (18–19 GB, top-2 Thai ≤35B) or `gemma4:26b`/`31b` only if the run is done with little else open; (4) `gpt-oss:20b` (~13 GB per the studio's own note) as the open-weight sibling of the website's Cloudflare model.
- 18–20 GB models leave ~4–6 GB for macOS, the harness, Postgres 18 and the KV cache on a 24 GB Mac; long multi-turn contexts make that tighter. macOS also caps GPU-wired memory below total RAM by default (raising it is a system setting — owner's call; not verified here).
- At ~25–60 tok/s generation and a few hundred tok/s prompt processing (not sourced), ~400 receptionist calls of ~4K tokens each is roughly 0.5–2 h per model-run, longer on low-wattage charging (the studio saw 20–60 s answers on a 15 W charger). Check `system_profiler SPPowerDataType | grep -i wattage` first, as the studio notes already require.
- Because Ollama lacks `tool_choice` and strict schema enforcement on the OpenAI endpoint, "strict JSON-schema tool calls" must be enforced by the harness (validate, reject, count the rejection) — which is arguably what the test should measure anyway, since the runtime already "discards an ungrounded reply".
- Each model is a large download (8–20 GB); the studio's standing rule is that every model download is asked for with file name, source and size, and all five earlier models were removed on 11 Oct 2026 to free 48 GB. Disk (~185 GB free) is not a constraint for 3–4 models.

### Gaps
- No measured Ollama tokens/s for any of these models on an M4 Pro 24 GB; no prompt-processing (prefill) figures found. Run `ollama run <model> --verbose` and read `eval rate`.
- No Thai tool-calling benchmark exists publicly (SEA-HELM has none; Typhoon's Tau-Bench Thai is vendor-run). OpenThaiGPT and SeaLLM were not found in current leaderboards or Ollama's library; not assessed. SEA-LION v4.5 (Qwen) 27B's Ollama availability was not checked.
- Gemma 4 12B and 26B Thai scores are not on SEA-HELM (only 31B and E2B).

---

## 2. Cloudflare Workers AI (account already on Workers Paid)

### Takeaway
Workers AI gives 10,000 neurons/day free on every plan (reset 00:00 UTC) and charges $0.011 per 1,000 neurons beyond it on Workers Paid. One harness model-run is a few days' worth of the *entire* free allowance — which the live o2-designstudio.com adviser already draws from — so in practice it is "cents, billed", not $0: roughly $0.15 (Qwen3-30B-A3B) to $0.75 (gpt-oss-120b) to ~$1+ (Qwen 3.8 27B) per model-run. gpt-oss-120b is listed with function calling and zero data retention.

### Cited Findings
- Free allocation 10,000 Neurons/day on Workers Free and Workers Paid; $0.011 per 1,000 Neurons beyond it (Workers Paid only); limits reset daily at 00:00 UTC; page last updated 20 Oct 2026 — [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- Per-model prices (per M tokens, neurons per M in/out): `@cf/openai/gpt-oss-120b` $0.35/$0.75 (31,818 / 68,182); `gpt-oss-20b` $0.20/$0.30 (18,182 / 27,273); `@cf/qwen/qwen3-30b-a3b-fp8` $0.051/$0.335 (4,625 / 30,475); `@cf/qwen/qwen3.8-27b` $0.45/$3.20 (40,909 / 290,909); `@cf/google/gemma-3-12b-it` $0.345/$0.556; `@cf/mistralai/mistral-small-3.1-24b-instruct` $0.351/$0.555; `@cf/meta/llama-4-scout-17b-16e-instruct` $0.27/$0.85; `@cf/zai-org/glm-4.7-flash` $0.06/$0.40; plus Kimi K2.5–2.7, GLM 5.x, DeepSeek V4 (several marked as requiring a paid billing method) — [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)
- gpt-oss-120b model page: "Function calling | Yes", 128,000-token context, reasoning effort low/medium/high, Batch yes, "Zero data retention | Yes"; Workers AI offers OpenAI-compatible `/v1/chat/completions` — [gpt-oss-120b on Workers AI](https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/)
- Function calling comes in "traditional" (model returns `tool_calls`, you call `env.AI.run` again) and "embedded" (`runWithTools` from `@cloudflare/ai-utils`) forms; the catalogue marks capable models with a "function calling" property — [Workers AI function calling](https://developers.cloudflare.com/workers-ai/features/function-calling/)
- The studio's context: Workers Paid on since 11 Oct 2026; the live adviser's daily ceilings were lifted to 1,000,000, and "Everything past Cloudflare's free allowance is billed to the owner" — [local: `.claude/studio-notes.md`, `Studio/` row]

### Inferences
- Neurons per call at ~4,000 in / ~250 out: gpt-oss-120b ≈ 144; qwen3-30b-a3b ≈ 26; glm-4.7-flash ≈ 31; qwen3.8-27b ≈ 237 (reasoning tokens are billed as output and would raise these). Over ~400 receptionist + ~190 caller calls per model-run ⇒ ≈ 65–70K neurons for gpt-oss-120b (≈ 6–7 days of the whole free allowance, ≈ $0.75 if billed), ≈ 12–15K for Qwen3-30B-A3B or GLM 4.7 Flash (≈ $0.15), ≈ 100K+ for Qwen 3.8 27B (≈ $1.1+).
- Equivalently, the 10K free neurons cover only ~55–70 receptionist turns of gpt-oss-120b, or ~300–400 turns of Qwen3-30B-A3B — and only on a day the live chatbot uses none of it. Whatever the chatbot leaves unused is what the harness gets free; the rest lands on the owner's bill.
- Workers AI is still attractive as the *production-shaped* route (same account, same model as the website, ZDR), and a run spread over many days at a small daily cap would stay inside the free allowance — but it cannot be guaranteed $0 without knowing the adviser's daily use (visible in the Cloudflare dashboard, owner's account).

### Gaps
- Whether `/v1/chat/completions` on Workers AI accepts an OpenAI `tools` array for every function-calling model (the model page lists function calling but does not confirm the endpoint form).
- The live adviser's actual daily neuron use (only in the owner's dashboard).
- Which other Workers AI models (Qwen 3.8, GLM, Kimi, DeepSeek) carry the function-calling property was not checked model by model.

---

## 3. Free API tiers from other providers

### Takeaway
Two free tiers are genuinely usable for a ~2 M-token model-run: **Cerebras's free trial** (gpt-oss-120b and Qwen 3.8 27B, 1 M tokens/day per model, 5 RPM) and **Google's Gemini API free tier** (several current Flash/Flash-Lite models are free of charge, but free-tier prompts *are* used to improve Google's products, and per-model daily limits are only shown inside AI Studio). Groq's documented base limits (200K tokens/day for gpt-oss-120b) and OpenRouter's truly-free 50 requests/day make a full run take days; GitHub Models no longer exists (retired 30 Jul 2026). Mistral and NVIDIA offer small free/trial allowances with weaker documentation.

### Cited Findings
**Cerebras**
- Free Trial per model: `gpt-oss-120b` and `qwen-3.8-27b` — 5 RPM, 30K uncached TPM, 90K total TPM, 1M tokens/hour, 1M tokens/day; every model in the Shared Inference catalogue is available on the Free Trial subject to those limits; no context limit stated — [Cerebras rate limits](https://inference-docs.cerebras.ai/support/rate-limits)
- Third-party sources conflict on extras (a $5 credit after adding a payment method vs on sign-up; one claims 8K context on the free tier); unverified — [costbench Cerebras free plan](https://www.costbench.com/software/llm-api-providers/cerebras-inference/free-plan/); [benchlm Cerebras free tier](https://benchlm.ai/free-tier/cerebras)

**Google Gemini API (AI Studio)**
- Free of charge on the Standard tier: Gemini 3.8 Flash, 3.6 Flash, 3.5 Flash-Lite, 3.1 Flash-Lite, 3 Flash Preview, 2.5 Pro, 2.5 Flash, 2.5 Flash-Lite; **Gemini 3.1 Pro Preview has no free tier**. "Used to improve our products": **Yes on the free tier, No on paid** for every model listed. Paid reference prices: 3.8 Flash $0.75 in / $3.75 out per M through 31 Dec 2026 (doubling on 1 Jan 2027); 3.5 Flash-Lite $0.30 / $2.50; 2.5 Flash-Lite $0.10 / $0.40; 2.5 Flash is deprecated and routes to 3.5 Flash-Lite on 1 Dec 2026 — [Gemini API pricing](https://aistudio.google.com/docs/pricing)
- Rate-limit page: Free tier qualification is an active project ("some projects need verification"); Tier 1 needs a linked billing account; limits are per project, RPD resets at midnight Pacific; per-model free RPM/RPD are not published on the page — "View your active rate limits in AI Studio"; "Specified rate limits are not guaranteed" — [Gemini API rate limits](https://aistudio.google.com/docs/rate-limits)
- Third-party reports of Flash free RPD range from ~20 to ~1,500 after cuts in late 2025 and April 2026; treat as unverified — [developersdigest](https://www.developersdigest.tech/rate-limits/google); [agentdeals](https://agentdeals.dev/gemini-api-pricing-changes); [scriptbyai](https://www.scriptbyai.com/gemini-api-free-tier-limits/)

**Groq**
- The public page shows only "base limits for the Developer plan": `openai/gpt-oss-120b` and `gpt-oss-20b` 30 RPM, 1K RPD, 8K TPM, 200K TPD; `qwen/qwen3.8-27b` the same; free-plan values are only in the account's limits page — [Groq rate limits](https://console.groq.com/docs/rate-limits)
- A third-party summary says Groq does not retain inference data by default and does not train on inputs without permission — not verified against Groq's own terms — [developersdigest Groq](https://www.developersdigest.tech/models/free-api/groq)

**OpenRouter `:free` models**
- 20 requests/minute; **50 requests/day** if you have bought less than 10 credits in total, 1,000/day after buying at least 10 credits; the limits page says nothing about logging or training — [OpenRouter limits](https://openrouter.ai/docs/api-reference/limits)

**GitHub Models**
- "As of July 30, 2026, GitHub Models has been fully retired." Playground, catalogue, inference API and BYOK are no longer available — [GitHub Docs](https://docs.github.com/en/github-models/use-github-models/prototyping-with-ai-models)

**Mistral La Plateforme (Experiment plan)**
- Free Experiment plan; API requests under it may be used to train Mistral's models, with an opt-out — [Mistral help: Experiment plan](https://help.mistral.ai/en/articles/450104-how-can-i-try-the-api-for-free-with-the-experiment-plan); [Mistral help: training data](https://help.mistral.ai/en/articles/323757-do-you-use-my-user-data-to-train-your-artificial-intelligence-models)
- Limits are only shown in the console; third-party figures of 1 request/s, 500K TPM, 1B tokens/month are unverified — [cheahjs free-llm-api-resources](https://mintlify.com/cheahjs/free-llm-api-resources/providers/free/mistral-plateforme)
- Thai reference point: Mistral Medium 3.5 128B scores 64.35 on SEA-HELM Thai — [SEA-HELM Thai](https://leaderboard.sea-lion.ai/detailed/TH)

**NVIDIA build.nvidia.com (NIM trial)**
- Forum answer from NVIDIA: a trial "limited to 5000 free API credits", 1,000 granted at sign-up; third-party guides add 40 RPM, OpenAI-compatible `integrate.api.nvidia.com/v1`, intended for development/test — [NVIDIA developer forum](https://forums.developer.nvidia.com/t/api-credits-for-build-nvidia-com/306633); [lilting.ch guide](https://lilting.ch/en/articles/nvidia-nim-free-inference-100-models-openai-compatible)

**SambaNova**
- A comparison site lists a $0/month free tier for SambaNova Cloud; no credit amounts, limits or models found — [costbench NIM vs SambaNova](https://costbench.com/compare/nvidia-nim-vs-sambanova-cloud/)

### Inferences
- **Cerebras** fits one full model-run per model per ~2 days (1M TPD vs ~2M tokens), and 5 RPM ⇒ ~600 calls in ~2 h of wall time per day's quota. It gives gpt-oss-120b — the exact model behind the website — and Qwen 3.8 27B at no cost and very low latency (useful for a voice product). The 30K uncached-TPM ceiling means ~4K-token turns are fine; very long contexts would throttle.
- **Gemini free tier** is the only free route to a frontier-class proprietary model, which makes it the best free stand-in for "a Claude-class model" in a quality comparison; its weakness is the unpublished, changing daily cap (could be as low as ~20 RPD for the newest Flash) and the training-use of prompts (acceptable for fictional data only). Using it also for the *caller* role would keep the caller constant across receptionist models.
- **Groq** at 200K TPD needs ~8–10 days per model-run for gpt-oss-120b; **OpenRouter free** at 50 RPD needs ~12 days. Neither is practical for 8 × 2 scenarios without paying (OpenRouter's 1,000/day needs a $10 purchase — not $0).
- Strict tool calling and Thai quality vary by host even for the same weights (quantisation, chat templates, parsers); the harness should log rejections per provider, not just per model.

### Gaps
- Gemini's actual free RPD/TPM per model (only visible in the owner's AI Studio project); whether free-tier Gemini prompts may be read by human reviewers (not checked).
- Cerebras, Groq, NVIDIA and OpenRouter-provider data-use terms (training/logging) were not verified on primary pages. OpenRouter free endpoints' providers may log prompts (not verified).
- Whether Groq's free plan equals or is below the Developer base limits.
- Ollama's own `:cloud` model tags (seen on the gemma4 page) and any free cloud allowance were not researched.
- Note on source handling: the Gemini pricing page contained an embedded instruction block aimed at automated readers; it was treated as page data and ignored.

---

## 4. Anthropic itself: free credit, startup programme, and using a Claude subscription (`claude -p`)

### Takeaway
There is no free Anthropic API route found for November 2026: the Claude for Startups programme is closed ("current cohort is now full"), its credits are first-party API only, and no free starting Console credit was found. Running the harness through a Claude subscription with `claude -p` is technically possible but (a) Anthropic's docs say developers building products "should use API key authentication", the Consumer Terms bar scripted access except via an API key or where explicitly permitted, and subscription limits "assume ordinary, individual usage"; and (b) it would not measure the same thing as the planned API path. Treat it as a policy grey zone at best, not a substitute for the paid run.

### Cited Findings
- Claude for Startups: "current cohort is now full, and we're not accepting new applications right now"; offers "discounts and credits worth up to $45,000 from companies building with Claude" and "up to $100K in additional API credits, claimed through your VC" (VC in Anthropic's partner network); credits apply only to the first-party Claude API in Claude Console, not AWS/Google/Azure — [Claude for Startups](https://www.claude.com/programs/startups)
- Third-party reports agree the cohort closed as of 30 Oct 2026 and describe an earlier $1,000-credit offer as paused — [guptadeepak guide](https://guptadeepak.com/startup-offers/guides/anthropic-for-startups); [Towards AI](https://pub.towardsai.net/anthropic-paused-its-1-000-startup-credit-here-is-what-is-left-01c04221c2e3)
- Claude Code legal page, verbatim: "**OAuth authentication** is intended exclusively for purchasers of Claude Free, Pro, Max, Ultra, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications." — "**Developers** building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication through Claude Console or a supported cloud provider. Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, Max, or Ultra plan credentials on behalf of their users." — "Advertised usage limits for Pro, Max, and Ultra plans assume ordinary, individual usage of Claude Code and the Agent SDK." — "Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice." Free/Pro/Max/Ultra use is under the Consumer Terms; Team/Enterprise/API under the Commercial Terms — [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)
- Consumer Terms (effective 8 Oct 2025), prohibited use: "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, to access the Services through automated or non-human means, whether through a bot, script, or otherwise." Also: Materials may be used to train models unless the user opts out — [Anthropic Consumer Terms](https://www.anthropic.com/legal/consumer-terms)
- Headless docs: `claude -p` is the Agent SDK "available as a CLI for scripts and CI/CD"; `--output-format json` with `--json-schema` returns `structured_output`; `--system-prompt` replaces the default prompt; custom tools come in via `--mcp-config`; `--max-budget-usd` caps spend; **`--bare` "doesn't use your subscription login"** (needs `ANTHROPIC_API_KEY`) and "is the recommended mode for scripted and SDK calls, and will become the default for `-p` in a future release" — [Run Claude Code programmatically](https://code.claude.com/docs/en/headless)

### Inferences
- The owner running the unmodified `claude` binary on their own Mac with their own login is not the "third-party developer routing users' credentials" case the docs forbid, and headless mode is a documented Anthropic feature (arguably "explicitly permit[ted]"). But this harness is product development (it is the prototype of O2's receptionist runtime), which is exactly the case the docs say "should use API key authentication". Whether the studio's plan is a consumer plan (Pro/Max: Consumer Terms) or Team (Commercial Terms) changes which text applies — unknown here. Conservative reading: do not build the harness's model comparison on subscription credentials; if it is tried once, keep it small, owner-run, and ask Anthropic sales/support if in doubt (the legal page invites that).
- Fidelity: `claude -p` wraps the model in Claude Code's agent loop; tools must be exposed as MCP servers rather than the harness's own API tool definitions; prompt caching, `output_config.effort`, the server-side refusal fallback and per-call token accounting the harness relies on are not exposed the same way; and the planned `--bare` default would cut subscription use from scripts. So even a permitted run would not reproduce the API path being evaluated.
- Subscription runs also consume the same usage limits the studio uses for its daily Claude Code work.

### Gaps
- No evidence found either way of a free starting credit for new Claude Console accounts in 2026, or of the minimum prepaid purchase.
- Which Claude plan the studio holds (consumer vs Team) — determines Consumer vs Commercial Terms.

---

## 5. Startup credit programmes for LLM APIs

### Takeaway
For a small, self-funded Thai studio the realistic programmes are AWS Activate Founders (~$1,000, usable on Bedrock including Anthropic models) and the Google for Startups Start tier (~$2,000 reported, Google Cloud only); large tiers ($100K–$350K) need investor or accelerator referral. These are "free credit", not $0-forever, and need an application and approval, but AWS Activate is the only path found that could pay for the *Claude* models themselves at no cash cost.

### Cited Findings
- AWS: Activate credits are "redeemable for third-party models on Amazon Bedrock", with providers listed as "AI21 Labs, Anthropic, Cohere, Meta, Mistral AI, Stability AI, and Amazon" (article dated 2 Apr 2024; editor's note says offers may have changed) — [AWS Startups article](https://aws.amazon.com/aws-startups/learn/aws-activate-credits-now-accepted-for-third-party-models-on-amazon-bedrock/)
- AWS Activate Founders tier $1,000 (select participants up to $5,000); Portfolio tier up to $100,000 via an Activate Provider (search-result summaries of AWS's own pages; not opened directly) — [AWS: everything about Activate credits](https://aws.amazon.com/aws-startups/learn/everything-you-need-to-know-about-aws-activate-credits/)
- Google for Startups Cloud AI programme: up to $350,000 (up to $250K year one incl. $150K AI tier, up to $100K year two) for qualifying funded AI startups; a $2,000 Start tier is reported by third parties; credits are for Google Cloud services, not third-party or Marketplace — [Google Cloud AI startups](https://cloud.google.com/startup/ai); [guptadeepak Google for Startups](https://guptadeepak.com/startup-offers/guides/google-for-startups-cloud)
- Microsoft for Startups: figures conflict (one source: $5,000 for every approved startup in two steps; another: $2,000 for 90 days + $4,800 after verification; investor-referred up to $150,000); credits reportedly cover Azure OpenAI — [guptadeepak Microsoft](https://guptadeepak.com/startup-offers/guides/microsoft-for-startups); [creditforstartups](https://creditforstartups.com/resources/microsoft-azure-startup-credits)
- Anthropic's own programme is closed and its credits cannot be used on AWS/Google/Azure — [Claude for Startups](https://www.claude.com/programs/startups)
- Claude Code itself lists Amazon Bedrock, Google Cloud's Agent Platform and Microsoft Foundry as supported third-party providers — [Claude Code legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)

### Inferences
- AWS Activate Founders → Claude on Bedrock is the cleanest "no cash" way to run the harness on Haiku/Sonnet/Opus as planned (≈$10 of a $1,000 grant), provided O2 qualifies, the 5.5 models are offered on Bedrock in a usable region, and the 2024 Bedrock eligibility still holds. The harness would need a Bedrock client (the Anthropic SDK has one) and model IDs in Bedrock form.
- Google's Start-tier credits would likely pay for paid-tier Gemini (removing the training-use and the low free caps); whether they cover Claude on Vertex AI is unknown.
- Applying means creating accounts and submitting company details — the owner's to do; nothing was applied for.

### Gaps
- Eligibility details for a Thai-registered, self-funded studio (company age, website, funding, country) and approval times for AWS, Google and Microsoft were not found on primary pages.
- OpenAI startup credits and Cloudflare for Startups were not researched (budget).
- Whether Claude Haiku/Sonnet/Opus 5.5 are on Bedrock / Vertex / Foundry, and whether startup credits apply to them there in Nov 2026, was not verified.

---

## 6. Bottom line: which route best preserves the test's purpose at $0, and what is lost

### Takeaway
At genuinely $0, the best design is a three-part comparison with a fixed caller model: **local Ollama models** (Gemma 4 12B, Typhoon 2.5 30B-A3B, Qwen 3.6 27B / Gemma 4 26–31B if memory allows, gpt-oss-20b) for unlimited private repeats; **Cerebras free trial** for gpt-oss-120b (the website's own model) and Qwen 3.8 27B; and **Gemini free-tier Flash/Flash-Lite** as the frontier-class reference (fictional data only, since free prompts train Google's models). Workers AI is the production-shaped option but costs cents beyond the shared allowance. What is lost is the answer the harness was built to give — how Claude Haiku/Sonnet/Opus 5.5 behave in this runtime — and that only a paid or credit-funded Claude run (e.g. AWS Activate on Bedrock) can supply.

### Cited Findings
- The harness defaults to Claude for both roles and prices them (`--models claude-haiku-5-5,claude-sonnet-5-5,claude-opus-5-5`, `--caller-model claude-opus-5-5`, hard stop `--budget-usd 30`) — [local: `engine/sim/model/run.ts`]
- Among open models ≤35B, Gemma 4 31B and Qwen 3.6 27B lead Thai; gpt-oss-120b trails at 66.88 — [SEA-HELM Thai](https://leaderboard.sea-lion.ai/detailed/TH)
- Cerebras gives 1M tokens/day per model free on gpt-oss-120b and qwen-3.8-27b — [Cerebras rate limits](https://inference-docs.cerebras.ai/support/rate-limits)
- Gemini free-tier models are "Used to improve our products: Yes" — [Gemini API pricing](https://aistudio.google.com/docs/pricing)
- Workers AI: 10K neurons/day free, then $0.011/1K — [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/)

### Inferences
- **Recommended free plan:** (1) add an OpenAI-compatible `ModelClient` adapter (Ollama, Cerebras, Gemini's OpenAI-compatible endpoint and Workers AI all speak that shape); (2) pick one caller model and keep it fixed for every receptionist model (a local Gemma 4 12B or a Gemini free Flash model), so differences come from the receptionist; (3) run local models first (no quota, unlimited repeats — raise repeats above 2 for steadier pass rates), then Cerebras, then Gemini within its AI-Studio-shown cap; (4) record per model: pass rate, runtime rejections (ungrounded/invalid tool calls), Thai transcript quality by a Thai reader, latency.
- **What is lost by not testing Claude:** the harness's purpose (D-04b, "which turn model completes the scenarios") is a choice among Claude models; open-model results do not transfer to them. Claude-specific behaviour — the server-side refusal fallback, prompt-caching cost/latency, effort control, Anthropic's strict tool-use — is untested; so is real per-call cost and latency of the intended production model. A free-route run can still validate the harness, the runtime's grounding guards and the scenarios, and it can establish whether an open model (local or Cerebras/Workers AI) is good enough to be the production choice — which, for a ฿-sensitive Thai spa product, may itself be the more valuable finding.
- **Cheapest faithful Claude path, if wanted later:** AWS Activate Founders credits on Bedrock (if eligible), otherwise a small Console prepayment run at reduced scope (e.g. Haiku + Sonnet only, caller on a free model) — the harness's own `--budget-usd` cap already bounds it. A subscription `claude -p` run is not recommended as the measurement (policy grey zone, different code path).
- **Data-use summary (data here is fictional):** local — nothing leaves the Mac; Workers AI gpt-oss-120b — zero data retention listed; Gemini free — used to improve Google's products; Mistral Experiment — may train, opt-out available; Claude consumer plans — may train unless opted out; Cerebras/Groq/NVIDIA/OpenRouter — not verified.

### Gaps
- No measured comparison of Thai tool-calling reliability across these models exists publicly; only the harness can produce it.
- Real token counts per model-run (the ~2M-token figure is an estimate from the code's structure; one small run would fix it).
