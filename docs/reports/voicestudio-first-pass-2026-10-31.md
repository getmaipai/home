# VoiceStudio first pass (2026-10-31)

A read of [debpalash/voicestudio](https://github.com/debpalash/voicestudio) from its README, docs and file tree, so the full review
(VOICESTUDIO-REVIEW-01 in `docs/BACKLOG.md`) starts from facts. Nothing was downloaded, run or measured; nothing in Home or the Stack
changed. Not to be confused with VOICE-STUDIO-01, which is about the Mac Studio's voice.

## What it is

- "AI voice studio. On your device.": a local ElevenLabs alternative. Voice cloning from a 3 to 15 s clip, voice design from a text
  description, video dubbing with timed multi-speaker speech, a floating dictation widget, transcription, audiobooks and queued batch jobs,
  recipes and watch folders, a Model Manager that downloads only the models a person picks.
- Code AGPL-3.0 (the same licence as Home). Created 2026-04-09, last push 2026-10-31, about 6,400 commits, 95.9k stars, 10.6k forks,
  95 open issues, two core maintainers (Palash and Shimul Debnath) plus about a dozen contributors. Very active; the last ten
  commits are README work.
- Shape: a Python backend (`backend/`, about 410 files: FastAPI-style routers, Pydantic schemas, Alembic migrations, per-engine
  adapters under `backend/engines/`), an Electron and React 19 desktop app (`electron/`, about 1,100 TypeScript files, also built as
  a browser UI the backend serves to LAN devices), an `omnivoice/` model package, a Rust desktop bridge, iOS and Android apps in
  preview, Docker, Nix and Snap packaging. Tooling is Bun plus `uv`.
- Default TTS engine is OmniVoice (k2-fsa, 0.6B, zero-shot cloning, 600 plus languages, 24 kHz, 6 GB VRAM floor), with a GGUF
  build for small machines. Eighteen other TTS engines are selectable (VoxCPM2, MOSS-TTS, KittenTTS, mlx-audio with Kokoro, CSM and
  Dia, CosyVoice 3, GPT-SoVITS, Sherpa-ONNX, IndexTTS 2.5, Supertonic-3, dots.tts, Pocket TTS, Confucius4, audio.cpp with Breeze-TTS-2)
  and twelve STT engines (WhisperX, Faster-Whisper, MLX Whisper, whisper.cpp, Parakeet TDT on NeMo and on MLX, Moonshine, FunASR,
  Sherpa-ONNX streaming dictation, any OpenAI-compatible endpoint).
- Integration surface: OpenAI-compatible `POST /v1/audio/speech` and `POST /v1/audio/transcriptions`, a transcription WebSocket, an
  MCP server mounted at `/mcp` (`generate_speech`, `clone_voice`, `describe_voice`, `design_voice`, `transcribe`, `list_voices`,
  `check_health`), a `.well-known/voicestudio-speech` discovery document.
- Access model (`docs/api-auth.md`): loopback is never gated; off the machine, a per-session 6-digit share PIN for consumption
  routes, an API key for everything, trusted networks exempt the PIN; admin routes (`/system/*`, settings) are reached only from
  loopback or with the key. Clean separation of consumption from administration.

## Where it overlaps Home and the Stack

| Area | Home and Stack today | VoiceStudio |
|---|---|---|
| TTS engines | Pocket TTS (CPU fallback) and Chatterbox Turbo on `mlx-audio` 0.5.9 (Studio default) | 19 engines, OmniVoice default, `mlx-audio` among them |
| Cloning | Built (VOICES-04): admin uploads a 6 to 30 s clip, Chatterbox renders | Same idea, 3 to 15 s, with automatic transcript of the clip |
| Voice design from words | None | `describe_voice` and `design_voice` map a description to gender, age, pitch, style, accent |
| STT | `sherpa-onnx-node` (one engine) | 12 engines; Parakeet TDT on MLX is the Mac dictation default |
| Long-form speech | Read-aloud by sentence in chat; Books read-aloud open | `chunked_tts.py`, audiobook queue, batch jobs |
| Speech API shape | Stack serves `/v1/audio/speech` already | OpenAI-compatible, same route, plus transcriptions and SSE streaming |
| Agents | AGENTIC-DESIGN-01 in design | MCP tools for speech, cloning and transcription |
| Dubbing, dictation widget, mobile apps | Not Home needs | Core features |

## Flags for the review

- **Licences.** The app code is AGPL-3.0, fine beside ours. The default engine's weights are not: VoiceStudio's own
  `docs/licensing/model-inventory.md` lists OmniVoice, OmniVoice-GGUF, NLLB and Llama-OuteTTS as non-commercial, and Breeze-TTS-2
  weights as research only. Our studio-voice note (2026-10-17) already recorded OmniVoice as CC-BY-NC. VOICES-05's rule (reject
  non-commercial voice packs) applies to any engine we would borrow.
- **Privacy.** Not zero phone-home by default: install is `curl | sh` from voicestudio.sh, model weights come from Hugging Face on
  first use (the app asks first), analytics are opt-in PostHog with a US host baked into release builds, uncaught errors reach
  PostHog Error Tracking after consent, translation and dictation cleanup can use cloud LLM providers (OpenAI, Anthropic, Gemini
  and others, or a local Ollama), and an opt-in Twilio integration answers inbound calls. All opt-in or local by default, but each
  would be stripped or pinned off before any part ran inside a household (`docs/PRIVACY.md`).
- **Size and fit.** It is a desktop product with its own UI, database, migrations and engine venvs. Platform principle 1 (one
  implementation per role) and the Stack's role as Home's one engine host mean the whole app is not a candidate; its backend in
  server mode (Docker, loopback, OpenAI-compatible routes) could in principle be one more Stack-managed engine, but that would be a
  second TTS and STT host beside the ones we have and would need a measured reason.
- **Naming.** "VoiceStudio" collides with our VOICE-STUDIO-01 (the Mac Studio's voice). Backlog ids for this review use the one-word
  prefix `VOICESTUDIO-`.

## Worth a closer look (candidate borrowings, in order)

1. **STT upgrade candidates.** Parakeet TDT on MLX (their Mac dictation default, 25 languages) and whisper.cpp against our single
   `sherpa-onnx-node` engine: accuracy on the household's spoken turns, time to first word, memory. Their `docs/benchmarks.md` has
   starting numbers.
2. **Voice design from a description.** The `describe_voice` attribute map (gender, age, pitch, style, accent) is a small, engine-level
   idea that would let an admin make a voice without a clip (VOICES-04 follow-up), if Chatterbox or a permissive engine supports it.
3. **Long-form chunking and the audiobook queue** for Books read-aloud and news read-aloud: how `chunked_tts.py` splits, joins and
   masters, and how the batch queue reports progress (S6 status rows, not a new UI).
4. **The API gating pattern** (loopback free, PIN for consumption, key for admin, trusted networks) as a reference when Home's LAN and
   Tailscale exposure is designed; Home already separates admin from member routes by role, so this is a comparison, not an adoption.
5. **MCP tool shape** for AGENTIC-DESIGN-01: which speech tools an agent is given and how audio leaves the context (`files` mode
   returns a path or URL instead of base64).
6. **Engine adapters** (`backend/services/engine_memory.py`, `engine_routing.py`, `engine_evidence.py`): how they decide which engine
   loads, report why an engine is unavailable without leaking paths, and measure disk per engine. Compare with the Stack's governor and
   `engineCatalog.ts`.

## Not checked

The code was not run; no model was downloaded; latency, memory and quality numbers above are theirs, not ours. Their
`docs/competitive-analysis.md` and `docs/ROADMAP.md` were only skimmed. The mobile apps were not looked at.
