# The `tts` role's wire contract

Platform plan 4.11 names `tts` as one of the model roles, its own port
with its own wire contract, `STACK.md`'s "the voice sidecar contract
(`spec/voice/`) for speech." The full voice sidecar (speech
normalization, `stt`, wake word, the robot's shared Python
implementation) is Hub v0.3 and has not started - `docs/dev.md`'s "Notes
for later" still carries it as a research item. This directory holds only
the first real, narrow slice: the `tts` role, text in, WAV bytes out,
against **Kyutai Pocket TTS** - live-tested and picked over Kokoro-82M,
Chatterbox Turbo/Nano, Dia-1.6B, and CSM-1B (`docs/dev.md`'s TTS model
decision entry), built because Jesse asked to actually hear chat replies
in the browser, not because Hub v0.3's sequencing arrived.

Same precedent as `spec/llm/`: plain types and a plain HTTP client,
language-portable in spirit even though only a TypeScript implementation
exists so far (the robot's own Python port is Hub v0.3's job, not this
pass's). `backend/src/lib/ttsSupervisor.ts` and `backend/src/lib/tts.ts`
in the hub are the real consumer.

## Scope of this pass

**One backend, no selection wizard.** Unlike `chat` (a household picks a
catalog model, downloads it, `chat.model_id` records the choice), `tts`
has exactly one implemented backend (Pocket TTS) and no catalog entry,
download job, or settings key yet - there is only one thing to run, so
there is nothing to choose between. A catalog entry and a real
model-selection story are a named future gap for whenever a second `tts`
candidate is evaluated.

**Real streaming, no voice selection or cloning.** Pocket TTS's real
`/tts` endpoint (confirmed live, 2026-09-04) streams its WAV body in
chunks, arriving well before the whole reply finishes generating -
`client.ts`'s `synthesizeStream()` returns the raw, unbuffered response
stream rather than waiting for it to finish, and
`frontend/src/lib/streamingWavPlayer.ts` decodes and schedules each chunk
as it arrives (Jesse, 2026-09-04: "make sure you are streaming responses
as you get [them] instead of generating the entire wav and then just
playing that" - the household's own experience with an older,
non-streaming version of this same pipeline was the reason to ask). The
endpoint also takes `voice_url` and `voice_wav` for voice cloning and
named preset voices; this pass sends neither, so every reply uses the
model's own default voice.

**A real, load-bearing quirk of Pocket TTS's own response, not a bug in
this client:** its WAV header's declared data-chunk size is a bogus
placeholder (~2,000,000,000 bytes, confirmed live) regardless of the
real, much shorter body - written for its own demo page's hand-rolled
streaming player, which never checks it. `synthesizeStream()`
deliberately does not try to fix this up (an earlier, buffered version of
this client did, before streaming existed here): `streamingWavPlayer.ts`
only reads the header's *format* fields (sample rate, channels, bits per
sample) and otherwise treats every byte after the first 44 as raw PCM
until the stream itself ends, the same technique Pocket TTS's own
reference player uses. A consumer that instead buffers the whole
response and hands it to a browser `<audio>` element - the very thing
streaming replaces - would need to correct the header size or risk the
decoder waiting indefinitely for audio that will never arrive.

**Speech normalization is real now (2026-09-05), built ahead of Hub
v0.3's own sequencing at Jesse's direct request** ("build the entire
thing properly, not partial"): `ts/normalizeForSpeech.ts` is the
mechanical half - numbers, times, dates, currency, percentages, units,
common abbreviations, and stray markdown/emoji, each read the way a
person actually says them, never touching the text a household sees on
screen (Jesse: "if you have the voice say ten O four, you still display
10:04"). `backend/src/lib/turnEngine.ts`'s `finalizeReply()` is the one
central point (never per recipe) that fills every reply's `speech` field
with it; the browser frontend imports the identical function for its own
live, sentence-by-sentence TTS streaming (`ChatPage.tsx`), so there is
one implementation, not two that could drift. Still real, not-yet-built:
the register question (brevity, hedging, contractions - a PROMPT concern,
`turnEngine.ts`'s `NATURAL_REGISTER_POLICY`, not this module) and the
robot's own Python port, still Hub v0.3's job.

## What's real vs. stubbed

`client.ts`'s `PocketTtsClient` is a real HTTP client against Pocket
TTS's actual FastAPI server (`pocket-tts serve`, confirmed 2026-09-04:
`GET /health` returns `{"status": "healthy"}`, `POST /tts` takes
multipart/form-data with a `text` field and returns raw `audio/wav`
bytes). It works unmodified against either a real `pocket-tts serve`
process or `stubServer.ts`'s in-process stand-in, because both speak the
same two endpoints.

`backend/src/lib/ttsSupervisor.ts` decides which backend to point the
client at, the same lazy-start-once shape as `llmSupervisor.ts` scaled
down (one backend, no catalog): a configured `MAIPAI_TTS_URL` (point at
an already-running server), or - when the `uvx` command is on `PATH` -
spawn `uvx pocket-tts serve` as a real child process, or the stub
(`stubServer.ts`, a real HTTP server returning a short, deterministic,
valid silent WAV for any `/tts` request), which is what the test suite
uses (`MAIPAI_TTS_DISABLE_SPAWN=1`, `backend/tests/preload.ts`) and any
dev machine without `uv` installed falls back to.

## The `uv`/Python dependency (a real stack note, not hidden)

Pocket TTS ships as a Python package, run via `uvx pocket-tts serve`.
Every other piece of the `chat` role's provisioning (the GGUF, the
llama-server binary) is a plain downloaded file Bun spawns directly - no
extra runtime. This is the first hub feature whose real backend needs
`uv`/Python present on the host at *run* time, not just at spec-codegen
build time (`spec/.venv` already exists for that). `STACK.md` names no
Python runtime dependency for the hub itself, only for the robot and for
build-time tooling, so this is a deviation worth a first-class flag
rather than a silent scope-creep: `ttsSupervisor.ts` detects `uv`'s
absence and falls back to the stub with a clear reason instead of
crashing, so a fresh install without `uv` still boots, just without real
voice replies until `uv` is installed. Revisit when Hub v0.3's real
voice sidecar design lands: it may package Pocket TTS (or whatever wins
that pass's eval) behind `uv`'s own installer, behind a downloaded
platform-matched binary the way `engineCatalog.ts` does for
llama-server, or accept the Python dependency outright as this role's
standard shape, matching the robot's stack.
