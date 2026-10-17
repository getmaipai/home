# Studio voice: what was decided, what was not (2026-10-17)

Status: open. No expressive model has been selected for the Studio. One question is waiting on Jesse (bottom).

## Decision trail

- 2026-09-04, `docs/dev.md` "TTS model decision": Pocket TTS picked by ear over Kokoro-82M, Chatterbox Turbo, Orpheus-3B, Dia-1.6B and CSM-1B.
  Chatterbox Turbo on this Mac (MPS): 1.4 to 1.6x real time, no streaming, over 5 s of silence before audio for a 66-character reply.
  Orpheus 3B GGUF on Metal: 1.26 to 1.53x real time, about 2.0 s to the first chunk, real streaming. Dia: batch only, not live-tested.
  Pocket TTS: real-time factor 0.09 to 0.10 on CPU, streaming. Written cues (`*cough*`) did not render as sounds; only spoken fillers did.
- 2026-09-17, `docs/plans/hub-on-apple-silicon-2026-09-17.md` (commit b8e5b4f3): the Studio criterion adds natural disfluencies and
  nonverbal sounds by inline tags. Chatterbox Turbo 350M first; Orpheus 3B, Qwen3-TTS 1.7B MLX and Dia are to be compared.
  The plan states no fresh benchmark was run. It is a criterion, not a selection.
- 2026-09-20, stack commits 38214d9 and 456f420 (STACK-94a, 94c): the Stack shipped `tts` on Pocket TTS 3.1.0 (CC-BY-4.0 weights,
  about 219 MB), voice `alba`. `stack/docs/dev.md` still calls it "the owner's pick"; the Stack's catalog has this one TTS engine only.
- 2026-10-02/06, `docs/BACKLOG.md` REG-02 (open): the composer writes the model's tags into `reply.speech`; `reply.text` stays clean;
  owner ruling: default light, rate limited, `voice.hesitations` key, never inside numbers, names, instructions, safety, alarms or
  child learning. The blind listening test is follow-up. Nothing is built.

No search of the repos, data-scratch or session records finds a chosen expressive model. Chatterbox, Orpheus and Dia were each
rejected or unmeasured on the 2026-09-04 live numbers; the 2026-09-17 criterion reopened them for the Studio without choosing.

## What the code supports today

- Stack engines: `ENGINE_ROLE` and the managed runtime list in `stack/backend/src/lib/engineCatalog.ts` name `uv` and `pocket-tts`
  for `tts`. A second TTS engine needs a catalog entry, a hashed requirements file, a supervisor adapter beside `pocketTts.ts`, an
  install route entry and a voice list source in `speech/voiceList.ts`.
- Tags: `reply.speech` exists (THIN-0J) but the composer emits no model tags (REG-02 open). `normalizeForSpeech` in
  `commons/spec/voice/ts/normalizeForSpeech.ts` strips markdown only; bracket tags without a following `(...)` pass through, but no
  test proves a tag survives the whole path to the engine.

## Next, once Jesse answers

1. STACK-TTS-02: bench Chatterbox Turbo and Orpheus on the Studio (time to first audio, real-time factor, memory, a WAV with one
   hesitation, one laugh and one cough), then install the winner as a second `tts` engine with Pocket TTS kept as the small-machine
   fallback.
2. REG-02: tag vocabulary per engine, tag passthrough test from `reply.speech` to the engine.

## The one question

Is the voice you remember choosing Chatterbox Turbo, Orpheus, or something else (a name or where you heard it)?
