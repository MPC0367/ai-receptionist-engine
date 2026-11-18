# Free ($0) Thai + English speech-to-text and text-to-speech for the AI receptionist (as of 12 Nov 2026)

Scope: every realistic zero-spend route for Thai and English STT and TTS, both local/open models and hosted free tiers, for a LiveKit Agents receptionist on an M4 Pro MacBook Pro (24 GB). Public pages only; nothing was signed up for. Kirx was not researched.

Reading note: where a figure comes from a vendor's own benchmark, a third-party blog, or my prior knowledge rather than a page read in this session, it is flagged. Prices are US$.

---

## 1. Local Thai STT: which open models, how accurate, how fast, what licence

### Takeaway
The Typhoon (SCB 10X) family now leads open Thai ASR. **Typhoon ASR Real-time** (115M, CC-BY-4.0, true streaming, runs on CPU) is the only open *streaming* Thai model found, at about 10% CER on broadcast Thai. **Typhoon Whisper Large-v3 / Turbo** (MIT) are the most accurate open models but batch-only, so they need VAD chunking. Pathumma-Whisper (NECTEC, Apache-2.0) and Thonburian Whisper (biodatlab, Apache-2.0/MIT) are close behind. None of them reports results on 8 kHz telephone audio.

### Cited Findings
**Typhoon ASR Real-time (SCB 10X / typhoon-ai)**
- FastConformer-Transducer, about 114–115M parameters, built on NVIDIA's FastConformer Transducer. Licence **cc-by-4.0**, and use also requires agreeing to the OpenTyphoon Terms and Conditions. Loaded through NVIDIA NeMo (`nemo_asr.models.ASRModel.from_pretrained`) or a `typhoon-asr` pip package. The card says it runs "efficiently on standard CPUs", with optional `--device cuda`, and reports CER 0.0984. Trained on Thai audio; the card says nothing about English support or telephony. — [HF model card](https://huggingface.co/typhoon-ai/typhoon-asr-realtime)
- The paper (arXiv 2601.13044, 19 Jan 2026) says the transducer enables "true streaming inference" and claims about **45× fewer GFLOPs** per 30 s segment than Whisper Large-v3. That is a compute estimate, not a measured latency. It reports no latency, real-time factor, chunk size or sample rate, and no telephony/8 kHz test. Training took about 17 h on 2× H100. — [arXiv 2601.13044](https://arxiv.org/html/2601.13044v1)
- Training data: about 11,000 h of Thai from Gigaspeech2, CommonVoice and internal curated media. — [Typhoon ASR search summary / paper](https://arxiv.org/html/2601.13044v1)
- Sibling model **Typhoon Isan ASR Real-time** covers the Isan dialect. — [SCBX: Typhoon Isan](https://www.scbx.com/en/scbx-exclusive/typhoon-isan/)

**Benchmark, Typhoon paper, Table 6 (CER %, lower is better)** — [arXiv 2601.13044](https://arxiv.org/html/2601.13044v1)

| Model | Type | TVSpeech | Gigaspeech2-Typhoon | FLEURS (orig.) | FLEURS (normalised) |
|---|---|---|---|---|---|
| Gemini 3 Pro | proprietary, offline | 10.95 | 12.50 | 11.35 | 6.91 |
| Biodatlab (Thonburian) Whisper Large | open, offline | 18.96 | 13.22 | 16.50 | 15.26 |
| Biodatlab Distil-Whisper Large | open, offline | 13.82 | 8.24 | 6.77 | 8.63 |
| Pathumma-Whisper Large-v3 | open, offline | 10.36 | 5.84 | 6.29 | 7.88 |
| **Typhoon ASR Realtime** | **streaming** | 9.99 | 6.81 | 13.87 | 9.68 |
| Typhoon Isan ASR Realtime | streaming | 9.34 | 6.93 | 14.55 | 10.15 |
| Typhoon Whisper Turbo | offline | 6.85 | 4.79 | 10.52 | 7.08 |
| Typhoon Whisper Large-v3 | offline | 6.32 | 4.69 | 9.98 | 5.69 |

- Base Whisper Large-v3, Google, Azure and ElevenLabs were not evaluated in that table, and Common Voice was used only for training. — [arXiv 2601.13044](https://arxiv.org/html/2601.13044v1)

**Typhoon Whisper Turbo / Large-v3**
- Turbo is fine-tuned from openai/whisper-large-v3-turbo. Licence **MIT** (inherited from Whisper). It has 4 decoder layers against 32 in Large-v3, which gives higher throughput. The card says it is "best suited for offline transcription rather than real-time streaming". Last updated January 2026. — [HF: typhoon-whisper-turbo](https://huggingface.co/typhoon-ai/typhoon-whisper-turbo); [HF: typhoon-whisper-large-v3](https://huggingface.co/typhoon-ai/typhoon-whisper-large-v3)

**Pathumma-Whisper (NECTEC)**
- `nectec/Pathumma-whisper-th-large-v3`, licence **apache-2.0** in the card metadata, base openai/whisper-large-v3, published 2024. The card's description and limitations sections are placeholders. An unofficial MLX FP16 conversion is mentioned in the discussions. — [HF: Pathumma-whisper-th-large-v3](https://huggingface.co/nectec/Pathumma-whisper-th-large-v3)

**Thonburian Whisper (biodatlab, Mahidol)**
- Distilled large-v3 Thai: **MIT**. WER 6.82% on Common Voice 13 (against 41.53% for the original Whisper) and 10.65% on FLEURS, all DeepCut-tokenised. — [HF: biodatlab/distill-whisper-th-large-v3](https://huggingface.co/biodatlab/distill-whisper-th-large-v3)
- Medium combined: **Apache-2.0**, WER 8.44% on CV11. Small combined V4: 13.14% on CV13. A community CTranslate2 (faster-whisper) conversion of large-v3-combined reports 6.59% on CV13. — [HF: whisper-th-medium-combined](https://huggingface.co/biodatlab/whisper-th-medium-combined); [HF: whisper-th-small-combined](https://huggingface.co/biodatlab/whisper-th-small-combined); [HF: whisper-th-large-v3-ct2](https://huggingface.co/Avocaduu14/whisper-th-large-v3-ct2)
- Paper: ICNLSP 2024. — [ACL Anthology 2024.icnlsp-1.17](https://aclanthology.org/2024.icnlsp-1.17.pdf)
- Caveat: Thai WER depends on the word tokenizer (DeepCut here), so these WERs cannot be compared with the CERs in the Typhoon table. — [HF card](https://huggingface.co/biodatlab/distill-whisper-th-large-v3)

**Speed on Apple Silicon**
- On a MacBook Pro M4 (24 GB), a short clip took **1.02 s with mlx-whisper (large-v3-turbo, unquantised)** and 1.23 s with whisper.cpp (q5_0, Core ML, 4 threads). That is one short utterance, not a real-time factor. The same README's "~110× RTF on M4 Pro" line is unattributed, so treat it as unverified. — [mac-whisper-speedtest](https://github.com/anvanvan/mac-whisper-speedtest)
- On long audio, mlx_whisper was about **2× faster** than whisper.cpp with turbo models (Jan 2026 update; older chips). — [Bill Mill, Jan 2026](https://notes.billmill.org/dev_blog/2026/01/updated_my_mlx_whisper_vs._whisper.cpp_benchmark.html)
- A ready MLX build of whisper-large-v3-turbo exists. — [HF: mlx-community/whisper-large-v3-turbo](https://huggingface.co/mlx-community/whisper-large-v3-turbo)

### Inferences
- **Best local STT for a live call:** Typhoon ASR Real-time is the only open Thai model that streams natively, and it is small enough to run on the Mac's CPU next to an LLM. Its CER (≈10% on TV speech, 6.8% on Gigaspeech2) matches or beats Pathumma-Whisper on two of the three sets at a fraction of the compute.
- **Best local STT for accuracy:** Typhoon Whisper Turbo (MIT) through MLX, cut into utterances by VAD. Whisper-family models decode a whole segment, so the end-of-turn delay is VAD silence plus the decode of that segment. At about 1 s per short clip on an M4, that is workable for testing; real latency on the M4 Pro must be measured.
- **Licences for a commercial product:** MIT (Typhoon Whisper), Apache-2.0 (Pathumma, Thonburian medium) and CC-BY-4.0 (Typhoon ASR Real-time) all allow commercial use, with attribution for CC-BY. The OpenTyphoon Terms that Typhoon ASR Real-time adds were not read and must be checked before launch.
- **English:** every model here is tuned for Thai. Mixed Thai/English callers (English treatment names, foreign tourists) may need plain Whisper turbo for English turns, or language ID, which means running two models.

### Gaps
- No open Thai model reports accuracy on **8 kHz G.711 telephone audio**. The benchmarks are TV, YouTube/podcast (Gigaspeech2) and read speech (FLEURS, Common Voice). It has to be tested by downsampling test sets to 8 kHz and back up.
- No measured RTF or latency for Typhoon ASR Real-time (NeMo) on Apple Silicon. Whether NeMo runs on MPS or only CPU on macOS was not confirmed.
- The English accuracy of the Thai fine-tunes is not reported.
- Gowajee results for these models were not found.
- The OpenTyphoon Terms and Conditions were not read.

---

## 2. Local Thai TTS: which open models speak Thai, quality, speed, licence

### Takeaway
Local Thai TTS is the weak link. The general multilingual open models (XTTS-v2, Kokoro, Piper) **do not speak Thai**. What does speak Thai is either **non-commercial** (Meta MMS-TTS `tha` CC-BY-NC 4.0, Typhoon2-Audio's speech output CC-BY-NC, OpenJaiTTS CC-BY-NC 4.0) or an **F5-TTS fine-tune** (VIZINTZOR F5-TTS-THAI, ThonburianTTS), whose licence chain has to be checked and whose quality reports are modest (ThonburianTTS: 25.7% WER on its own output). That is fine for building and testing at $0. For a commercial launch, a hosted Thai voice is the safer path.

### Cited Findings
- **Meta MMS-TTS Thai (`facebook/mms-tts-tha`)**: VITS, one checkpoint per language. Licence **CC-BY-NC 4.0** ("The model is licensed as CC-BY-NC 4.0"), so no commercial use. Output is non-deterministic without a fixed seed. — [HF: facebook/mms-tts-tha](https://huggingface.co/facebook/mms-tts-tha)
- **Typhoon2-Audio (`scb10x/llama3.1-typhoon2-audio-8b-instruct`)**: an end-to-end speech-in, speech-out model for Thai and English. The HF card lists speech input and LLM under the Llama 3.1 Community License and **speech output under CC-BY-NC**. The GitHub repo says Apache-2.0 for the code and is archived. Typhoon 2 report: December 2024. No standalone Typhoon TTS model was found. — [HF card](https://huggingface.co/scb10x/llama3.1-typhoon2-audio-8b-instruct); [arXiv 2412.13702](https://arxiv.org/abs/2412.13702v2); [GitHub mirror](https://gh.r-mj.com/scb-10x/typhoon2-audio)
- **VIZINTZOR F5-TTS-THAI**: fine-tuned from SWivid/F5-TTS on about 500 h (Common Voice Thai ~160 h, Porjai ~300 h, Common Voice English ~40 h). Outputs 24 kHz. The card lists **CC-BY-4.0**. It clones a voice from 2–8 s of reference audio and speaks Thai and English, and English words are best written in Thai transliteration. The card admits long texts and some words are not yet read correctly. — [HF: VIZINTZOR/F5-TTS-THAI](https://huggingface.co/VIZINTZOR/F5-TTS-THAI)
- **f5-tts-th (PyPI)**: v1.0.5 ships two models, v1 (better Thai pronunciation) and v2 (IPA input to reduce misread words). — [PyPI f5-tts-th](https://pypi.org/project/f5-tts-th/1.0.5/)
- **ThonburianTTS (biodatlab, 2025)**: F5-TTS and E2-TTS fine-tunes. The best model (F5, Thai script) scores **25.72% WER / 8.70% CER** on its synthesised speech; IPA input was also tried. Code: GitHub biodatlab/thonburian-tts. — [Mahidol repository](https://repository.li.mahidol.ac.th/items/01425a99-9731-4855-ba46-c7c77b0c9079/full)
- **OpenJaiTTS v1.0 (JTS-AI, 2026)**: open-weight Thai voice cloning on F5-TTS. Licence **CC BY-NC 4.0**, gated download. — [HF: JTS-AI/OpenJaiTTS-v1.0](https://huggingface.co/JTS-AI/OpenJaiTTS-v1.0)
- **Coqui XTTS-v2**: 17 languages (en, es, fr, de, it, pt, pl, tr, ru, nl, cs, ar, zh-cn, ja, hu, ko, hi). **No Thai.** Coqui Public Model License. — [HF: coqui/XTTS-v2](https://huggingface.co/coqui/XTTS-v2)
- **Kokoro-82M**: Apache-2.0. Voices in American and British English, Japanese, Mandarin, Spanish, French, Hindi, Italian and Brazilian Portuguese. **No Thai.** — [HF: Kokoro VOICES.md](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md)
- **Piper**: **no th_TH voice** in the official voice list. — [rhasspy/piper VOICES.md](https://github.com/rhasspy/piper/blob/master/VOICES.md)

### Inferences
- For **development and demos with fictional callers**, MMS-TTS `tha` (small VITS, fast) or an F5-TTS Thai fine-tune can be used locally at $0. MMS-TTS and Typhoon2-Audio must not be used for paying clients (NC).
- **F5-TTS licence chain (unverified in this session):** from prior knowledge, the upstream SWivid/F5-TTS *pretrained* weights are CC-BY-NC because their Emilia training data is non-commercial. If so, a fine-tune that keeps those weights may inherit the restriction whatever its own card says (VIZINTZOR lists CC-BY-4.0). The F5-TTS README and the fine-tunes' terms must be read before any commercial use.
- **Speed:** F5-TTS is a flow-matching model (the card's example uses 32 steps), so it generates a whole utterance per call rather than streaming. Time-to-first-audio on the M4 Pro is unmeasured. Expect it to be slower than VITS (MMS) and slower than hosted streaming voices. Sentence-by-sentence synthesis in LiveKit hides part of the delay.
- English sentences need their own voice (Kokoro, Apache-2.0, is fine for English) or Thai-transliterated English in the F5 models.

### Gaps
- No public MOS or listening-test comparison of MMS-TTS `tha` against F5-TTS-THAI against ThonburianTTS against the hosted Thai voices was found.
- ThonburianTTS's model licence, PyThaiTTS's bundled models and licences, and any "OpenThaiTTS" project were not found or not verified.
- Measured synthesis latency on Apple Silicon was not found for any Thai TTS.
- No 8 kHz/telephone listening reports were found for any Thai TTS.

---

## 3. Hosted free tiers and credits with Thai (amounts, expiry, data use)

### Takeaway
The two strongest $0 hosted routes with real Thai voices and recognition are **Azure Speech F0** (5 audio hours of STT and 0.5M neural TTS characters a month, Thai real-time STT, Thai voices Premwadee, Niwat and Achara plus preview HD voices) and **Google Cloud** (60 STT minutes a month; TTS 4M Standard/WaveNet and 1M Chirp 3: HD characters a month; Chirp 3 Thai STT is Preview). **Deepgram** has a $200 one-time credit and Nova-3 Thai streaming (since March 2026). **ElevenLabs Free** is non-commercial and needs attribution; on its TTS side only Eleven v3 speaks Thai. **AWS** Transcribe streams Thai (credit-based free plan), and no Thai Polly voice was found.

### Cited Findings
**Microsoft Azure AI Speech**
- Free F0: speech-to-text **5 audio hours a month**, neural text-to-speech **0.5 million characters a month**, speech translation 5 audio hours a month. Paid rates showed as placeholders in the cached pages. — [Azure Speech pricing](https://azure.microsoft.com/pricing/details/cognitive-services/speech-services)
- Thai STT: `th-TH` is supported for real-time transcription, post-stream refinement, batch, fast transcription and custom speech (phrase lists included). Thai is also listed for MAI-Transcribe-1.5 and MAI-Transcribe-2. — [Azure language support](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=stt)
- Thai TTS voices: `th-TH-PremwadeeNeural` (F), `th-TH-NiwatNeural` (M), `th-TH-AcharaNeural` (F) are standard neural voices. `th-TH-Krit:MAI-Voice-2` and `th-TH-Nattapong:MAI-Voice-2` (M, Neural HD, with "-Flash" variants and styles such as `caringempathy` and `friendlycheerful`) are in public preview in limited regions. — [Azure language support](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=stt)
- Third-party claim, unverified: neural TTS costs $16 per 1M characters. — [costbench](https://costbench.com/software/ai-voice-tools/microsoft-speech/)
- Vendor-run comparisons, low confidence: Soniox claims 9.5% Thai WER for itself against 15.5% for Azure; Speechmatics lists Azure at 7.49% Thai WER. — [Soniox vs Azure](https://soniox.com/compare-stt/soniox-vs-azure/thai); [Speechmatics Thai](https://www.speechmatics.com/speech-to-text/thai)

**Google Cloud**
- Speech-to-Text: free **0–60 minutes a month per account**, then $0.078/min on the official v1 table. Chirp runs on the V2 API. A third party lists V2 standard (Chirp included) at $0.016/min with the same 60-minute free tier (checked Oct 2025). — [GCP STT pricing](https://cloud.google.com/speech-to-text/pricing/); [costbench](https://costbench.com/software/ai-transcription-apis/google-speech-to-text/free-plan/)
- Chirp 3: **Thai (`th-TH`) is Preview**, with streaming, sync (`Recognize`) and batch (`BatchRecognize`). No Thai diarization. The `us` and `eu` multi-regions are GA. The page says nothing about telephony or 8 kHz audio. — [Chirp 3 docs](https://docs.cloud.google.com/speech-to-text/v2/docs/chirp_3-model)
- Text-to-Speech: **Standard and WaveNet 0–4M characters a month free**, then $4 per 1M. **Chirp 3: HD 0–1M characters a month free**, then $30 per 1M (US$0.00003 per character). Billing must be enabled; usage beyond the free allowance is charged automatically. — [GCP TTS pricing (pt)](https://cloud.google.com/text-to-speech/pricing?hl=pt); [GCP TTS pricing (id)](https://cloud.google.com/text-to-speech/pricing?hl=id); [Developers Digest](https://www.developersdigest.tech/models/speech/text-to-speech)
- The US$300 new-customer credit (90 days, from prior knowledge) was not confirmed in this session: the official pages came back truncated.

**AWS**
- Amazon Transcribe has supported **Thai streaming since November 2022**, and `th-TH` is a valid StartStreamTranscription language code. — [AWS What's New, Nov 2022](https://aws.amazon.com/about-aws/whats-new/2022/11/amazon-transcribe-thai-hindi-streaming-audio); [StartStreamTranscription](https://docs.aws.amazon.com/goto/WebAPI/transcribe-streaming-2017-10-26/StartStreamTranscription)
- New AWS accounts (since 15–16 July 2025): up to **$200 in credits** ($100 at sign-up, plus $100 from onboarding tasks). The free plan ends after **6 months or when the credits run out**, whichever comes first. — [AWS What's New, Jul 2025](https://aws.amazon.com/about-aws/whats-new/2025/07/aws-free-tier-credits-month-free-plan); [AWS News Blog](https://aws.amazon.com/blogs/aws/aws-free-tier-update-new-customers-can-get-started-and-explore-aws-with-up-to-200-in-credits)
- Amazon Polly: no Thai voice appeared in the language listings that loaded. — [Polly languages](https://docs.aws.amazon.com/polly/latest/dg/supported-languages.html)

**Deepgram**
- Nova-3 supports Thai (`th`, `th-TH`), per the 17 March 2026 changelog. Deepgram claims a 69.43% relative WER reduction for Thai streaming against Nova-2; this is Deepgram's own benchmark. — [Deepgram changelog 2026-03-17](https://developers.deepgram.com/changelog/2026/3/17); [Deepgram APAC blog](https://deepgram.com/blog/deepgram-nova-3-expands-speech-to-text-support-across-asia-pacific)
- Free pay-as-you-go: **$200 credit**, no card (per third parties). Sources conflict on expiry: "credits don't expire" against "expires after 1 year". — [Deepgram pricing](https://www.deepgram.com/pricing); [toolradar](https://toolradar.com/tools/deepgram/pricing); [dev.to](https://dev.to/stevengonsalvez/deepgram-200-free-stt-that-makes-voice-coding-actually-work-16g4)
- Nova-3 list price: $0.0077/min monolingual and $0.0092/min multilingual (third party). Through LiveKit Inference it is $0.0048/min monolingual on Build/Ship. — [toolradar](https://toolradar.com/tools/deepgram/pricing); [LiveKit Inference pricing](https://livekit.com/pricing/inference)

**ElevenLabs**
- Free plan: **10,000 credits a month**, **non-commercial** (no commercial licence on Free), with attribution required on public output. Starter, the first paid tier with a commercial licence, is about $5–6 a month (sources conflict). — [bigvu](https://bigvu.tv/blog/elevenlabs-pricing-2026-plans-credits-commercial-rights-api-costs/); [dupple](https://dupple.com/learn/is-elevenlabs-free)
- Thai TTS: **only Eleven v3** (70+ languages, 5,000-character limit) lists Thai. Multilingual v2 (29 languages), Flash v2.5 (~100 ms) and Turbo v2.5 (32 languages) do not. The models page mentions v3 Conversational at about 165 ms. Scribe v2 / Scribe v2 Realtime (~150 ms) cover 90+ languages; Thai was not confirmed on the page read. — [ElevenLabs models](https://elevenlabs.io/docs/overview/models)

**Others**
- **Soniox**: supports Thai streaming. It claims about $0.12/h streaming and $0.10/h async, billed per token (vendor claim). No API free credit was found, only weekly free credits in its consumer app. — [Soniox vs Speechmatics (Thai)](https://soniox.com/compare/soniox-vs-speechmatics/thai)
- **Cartesia**: per Soniox (a competitor), Ink 2 streaming is English-only and other languages use the batch ink-whisper model. Sonic-3 Thai TTS was not confirmed. — [Soniox vs Cartesia (Thai)](https://soniox.com/compare-stt/soniox-vs-cartesia/thai)
- **Gemini API free tier, data use**: on Unpaid Services Google may use content "to provide, improve, and develop Google products and services and machine learning technologies", "human reviewers may read, annotate, and process your API input and output", and the terms say: "Do not submit sensitive, confidential, or personal information to the Unpaid Services." On Paid Services prompts are not used for improvement. Paid only for API clients offered to EEA users. — [Gemini API terms](https://aistudio.google.com/docs/terms)

### Inferences
- **Azure F0 is the best free source of a commercial-grade Thai voice.** 0.5M neural characters a month is a few hundred short test calls. Rough estimate: an agent's side of a 3-minute Thai call is about 1,000–1,500 characters, so roughly 300–500 calls. 5 STT hours is 300 minutes of caller audio.
- **Google** adds 60 STT minutes and 1–4M TTS characters a month on top. Running both side by side during development costs nothing. Chirp 3 Thai being Preview matters only at launch.
- **Deepgram's $200** is the largest STT credit with Thai streaming. At $0.0077/min it is about 26,000 minutes; toolradar's figure of about 43,000 minutes is for cheaper Nova models. That is ample for testing, but it is a one-time grant, not monthly.
- **Data use:** for real callers (names and phone numbers, which are personal data under Thailand's PDPA), free tiers whose terms allow training or human review, such as the Gemini API Unpaid Services, are unsuitable. Only synthetic or staff test calls should go through them. The data terms of Azure, Google Cloud, Deepgram and ElevenLabs free tiers were not read in this session.
- **ElevenLabs Free cannot be used for client work** (non-commercial). Its only Thai TTS model is v3, which is not its lowest-latency model.

### Gaps
- Azure F0 concurrency limits, current neural TTS price, and data-use terms were not confirmed.
- Whether Google Chirp 3: HD and WaveNet include th-TH voices was not confirmed in this session.
- Google's $300 new-account credit: amount and 90-day expiry not confirmed in this session.
- Deepgram credit expiry (conflicting sources), Deepgram Aura-2 Thai (likely none; unconfirmed), and Deepgram's free-tier data and model-improvement terms are open.
- ElevenLabs Scribe Thai accuracy and the official Free-plan terms (only third-party summaries were read) are open.
- AssemblyAI, Gladia, OpenAI and Cartesia: Thai support and free credits were not established (OpenAI has no standing free tier, from prior knowledge, unverified here).
- No independent, non-vendor Thai benchmark of the hosted APIs (Azure, Google, Deepgram, Soniox, ElevenLabs) on phone audio was found.

---

## 4. LiveKit Agents: plugins, local servers, LiveKit Cloud inference allowance

### Takeaway
LiveKit Agents has official plugins for every hosted Thai-capable option found (Azure, Google Cloud, Amazon Transcribe, Deepgram, ElevenLabs, Soniox, Gladia, Gemini, Nvidia, OpenAI). Local models plug in by pointing the OpenAI plugin's `base_url` at a local OpenAI-compatible server, or by wrapping a non-streaming STT in `StreamAdapter` with VAD. LiveKit Cloud's free Build plan has 1,000 agent session minutes but only **$2.50 of inference credit (~50 minutes)**, with a hard cap.

### Cited Findings
- STT plugins (bring your own key), with Python/Node availability: Amazon Transcribe (Py), AssemblyAI (Py, Node), Azure AI Speech (Py), Azure OpenAI (Py), Baseten (Py), Cartesia (Py), Clova (Py), Deepgram (Py, Node), ElevenLabs (Py, Node), fal (Py), Gemini (Py), Gladia (Py), Google Cloud (Py), Groq (Py), Inworld (Py, Node), Mistral AI (Py, Node), Nvidia (Py), OpenAI (Py, Node), Sarvam (Py, Node), Simplismart (Py), Soniox (Py, Node), Speechmatics (Py) and others. — [LiveKit STT models](https://docs.livekit.io/agents/models/stt/)
- Whisper is named as a model without streaming input, to be paired with VAD and `StreamAdapter`; the example uses `openai.STT()`. — [LiveKit STT models](https://docs.livekit.io/agents/models/stt/)
- For any provider not included, the API key and base URL can be overridden at initialisation for the LLM, STT and TTS interfaces. Install with `uv add "livekit-agents[openai]~=1.8"`. — [LiveKit OpenAI integration](https://docs.livekit.io/agents/integrations/openai/overview)
- In `@livekit/agents-plugin-openai@1.4.1` (Node), the default `openai.STT` model changed from `whisper-1` to `gpt-realtime-whisper` over WebSocket. Set `useRealtime: false` to keep the batch HTTP path, which is what a local Whisper server needs. — [LiveKit OpenAI STT](https://docs.livekit.io/agents/models/stt/plugins/openai/)
- The plugin system is meant to allow "directly load[ing] models for local inference". — [LiveKit plugins](https://docs.livekit.io/agents/plugins)
- LiveKit Cloud **Build plan: $0, no card, 1,000 agent session minutes a month, $2.50 of LiveKit Inference credit (~50 min)**. Ship gets $5 (~100 min), Scale $50 (~1,000 min). The Build allowance is a **hard cap**: once used, Inference rejects requests. Concurrency on Build is 5 STT and 5 TTS connections. — [LiveKit pricing](https://livekit.io/pricing); [LiveKit quotas and limits](https://docs.livekit.io/deploy/admin/quotas-and-limits/)
- LiveKit Inference per-minute STT prices (Build/Ship): Deepgram Nova-3 mono $0.0048, multilingual $0.0058; Flux $0.0065; AssemblyAI Universal-Streaming $0.0025; Cartesia Ink 2 $0.0090; Google Gemini 3.5 Transcribe Live $0.0095; OpenAI GPT-Live Transcribe $0.0170; Speechmatics Oak-1 $0.0038. TTS per 1M characters: Google Gemini 3.8 Flash TTS $24, Flash-Lite TTS $16; Deepgram Aura-2 $30; Cartesia Sonic 3 $50; Inworld Realtime TTS 2.0 $25. The page names no Thai support for any model, and ElevenLabs is not on it. — [LiveKit Inference pricing](https://livekit.com/pricing/inference)

### Inferences
- **The local path works without LiveKit Cloud.** Self-hosted LiveKit (already running in the project's colima spike) plus the Python agent can call a local STT server. Options: an OpenAI-compatible server in front of MLX-Whisper or faster-whisper with the Typhoon or Thonburian weights, reached through `openai.STT(base_url=…)`; or a small custom plugin around NeMo for Typhoon ASR Real-time to get true streaming.
- The Azure plugin is **Python only**, so the Thai TTS route through Azure F0 points to a Python agent (Node has Deepgram, ElevenLabs and OpenAI but not Azure or Google).
- LiveKit Cloud's $2.50 inference credit is too small to count as a development route. Hosted STT and TTS should be called with the developer's own free keys through plugins, not through LiveKit Inference.

### Gaps
- No ready-made LiveKit plugin for Typhoon ASR Real-time / NeMo streaming or for MLX-Whisper was found. Whether the Nvidia plugin (Riva/NIM) can host a NeMo FastConformer locally on a Mac was not established, and it is unlikely: Riva targets NVIDIA GPUs.
- Exact plugin package names and a confirmed working local example (such as Speaches or faster-whisper-server) were not verified in docs.
- LiveKit Inference language lists per model (whether Deepgram Nova-3 Thai passes through Inference) were not shown on the pricing page.

---

## 5. Free speech-to-speech options with Thai

### Takeaway
The free speech-to-speech options are **Gemini Live (native audio) on the Gemini API free tier**, whose limits are no longer published and whose free-tier data can be used for training and human review, and **Typhoon2-Audio** locally, an 8B model whose speech output is CC-BY-NC. Both suit experiments only, not real callers or a commercial launch.

### Cited Findings
- An older Google quota page listed Gemini 2.5 Flash Preview Native Audio on the free tier at 100 concurrent sessions and 1M TPM. A third-party summary (dated 2 Sep 2026) says Google no longer publishes free-tier RPM/RPD for these models and lists Gemini 2.5 Flash Native Audio and Gemini 3.1 Flash Live Preview as free. — [Gemini increase quota](https://ai.google.dev/docs/increase_quota); [benchlm free tier summary](https://benchlm.ai/md/free-tier/google-ai-studio.md)
- Developers report that free-tier Live sessions are rejected below the visible TPM, and that a free-tier key stalled on live translation while a paid key did not. — [Google AI forum](https://discuss.ai.google.dev/t/native-audio-live-free-tier-setup-quota-rejection-below-visible-tpm-which-admission-metric-applies/186840); [Google AI forum](https://discuss.ai.google.dev/t/gemini-3-5-live-translate-preview-started-having-long-audio-and-text-translation-delays-on-the-free-tier/179803)
- Free-tier data may be used for improvement and read by human reviewers, and the terms say not to submit personal information. — [Gemini API terms](https://aistudio.google.com/docs/terms)
- LiveKit has a Gemini plugin (Python). — [LiveKit STT models](https://docs.livekit.io/agents/models/stt/)
- Typhoon2-Audio: speech in, speech out for Thai and English. Speech output is CC-BY-NC, and the repository is archived. — [HF card](https://huggingface.co/scb10x/llama3.1-typhoon2-audio-8b-instruct)

### Inferences
- Gemini Live is worth one comparison run with fictional callers, to judge Thai naturalness and turn-taking against the cascaded STT → LLM → TTS pipeline. Its free tier is unpredictable (unpublished limits, reported rejections) and unsuitable for personal data.
- The project's design keeps the booking ledger and the tools as the authority, which favours a cascade anyway: the transcript and each tool call can be audited.

### Gaps
- Gemini Live's official Thai support and Thai voice quality were not confirmed in this session.
- No Thai speech-to-speech benchmarks were found.
- OpenAI Realtime has no free tier (prior knowledge, not verified here).

---

## 6. Bottom line: best $0 Thai + English stack now, and what to pay for at launch

### Takeaway
**For development now, at $0:** self-hosted LiveKit, with **Typhoon ASR Real-time** (streaming, CC-BY-4.0, CPU) or **Typhoon Whisper Turbo via MLX** (MIT, VAD-chunked) for Thai STT, plain Whisper turbo for English, and **Azure Speech F0** for Thai and English voices (Premwadee, Niwat, Achara; 0.5M characters a month). Google Cloud's free tier is the second hosted option, and Deepgram's $200 credit is a hosted streaming-STT baseline. **At launch, pay for:** a commercially licensed Thai TTS voice (Azure or Google; local Thai voices are NC or licence-unclear) and either hosted Thai STT (Deepgram Nova-3 Thai / Azure / Google) or a server to self-host the Typhoon models. The project also needs its own 8 kHz Thai test set, because nobody publishes telephone-band Thai results.

### Cited Findings
- Typhoon ASR Real-time: streaming, CC-BY-4.0 plus OpenTyphoon Terms, CPU-capable, ~10% CER. — [HF card](https://huggingface.co/typhoon-ai/typhoon-asr-realtime); [arXiv 2601.13044](https://arxiv.org/html/2601.13044v1)
- Typhoon Whisper Turbo: MIT, offline, 4.79–10.52% CER across benchmarks. — [HF card](https://huggingface.co/typhoon-ai/typhoon-whisper-turbo); [arXiv 2601.13044](https://arxiv.org/html/2601.13044v1)
- Azure F0: 5 STT hours and 0.5M neural characters a month; Thai real-time STT and three Thai neural voices. — [Azure pricing](https://azure.microsoft.com/pricing/details/cognitive-services/speech-services); [Azure language support](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=stt)
- Google: 60 STT minutes a month; TTS 4M Standard/WaveNet and 1M Chirp 3: HD characters a month; Chirp 3 Thai STT in Preview. — [GCP TTS pricing](https://cloud.google.com/text-to-speech/pricing?hl=pt); [Chirp 3](https://docs.cloud.google.com/speech-to-text/v2/docs/chirp_3-model)
- Local Thai TTS licences: MMS CC-BY-NC, Typhoon2-Audio speech output CC-BY-NC, OpenJaiTTS CC-BY-NC; XTTS, Kokoro and Piper have no Thai. — sources in §2
- Launch-scale reference prices: Deepgram Nova-3 $0.0048/min through LiveKit Inference or about $0.0077/min direct; Google Chirp 3: HD $30/1M characters; Google WaveNet $4/1M; Azure neural about $16/1M (unverified). — [LiveKit Inference](https://livekit.com/pricing/inference); [toolradar](https://toolradar.com/tools/deepgram/pricing); [GCP TTS pricing](https://cloud.google.com/text-to-speech/pricing?hl=id); [costbench](https://costbench.com/software/ai-voice-tools/microsoft-speech/)

### Inferences
- **Recommended test plan:** run three STT candidates on the same fictional massage/spa call recordings, downsampled to 8 kHz: (a) Typhoon ASR Real-time (local, streaming), (b) Typhoon Whisper Turbo on MLX (local, VAD-chunked), (c) Deepgram Nova-3 Thai or Azure (free credit). Measure CER on names, times, treatment words and phone numbers, plus end-of-turn latency. Pick a TTS by ear between Azure Premwadee/Niwat, Google (if it has Thai voices) and a local F5-TTS Thai, the last for prototyping only.
- **Mac budget:** a 115M transducer plus an MLX Whisper Turbo plus a VITS or F5 TTS fit easily in 24 GB alongside a small local LLM. The LLM is the main memory cost. Earlier studio notes record a 20B model at about 13 GB.
- **Costs at launch (illustrative):** at 1,000 three-minute calls a month, STT is about 3,000 min × $0.005–0.008 ≈ **$15–24 a month**. TTS at about 1.5M characters is about $6 (WaveNet) to $45 (Chirp 3: HD), or about $24 (Azure at the unverified $16/1M), minus each provider's free allowance. These are estimates built from the cited unit prices, not quotes.
- **Commercial-licence watch-list before launch:** OpenTyphoon Terms (Typhoon ASR Real-time); the F5-TTS pretrained-weights licence for any F5-based Thai voice; the ElevenLabs Free non-commercial clause; Gemini free-tier data use.

### Gaps
- No measured end-to-end latency for any Thai stack on an M4 Pro. It has to be measured in the Gate A harness.
- Thai accuracy on narrowband 8 kHz G.711 audio is unknown for every option, local and hosted.
- Data-processing terms (training, retention, human review) for the Azure F0, Google Cloud, Deepgram and ElevenLabs free tiers were not read, and they matter for PDPA once real callers' audio is involved.
