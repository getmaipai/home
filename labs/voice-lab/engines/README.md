# Voice server (proof of concept)

A small local server that loads one voice model on the GPU, clones voices from a short clip, and streams speech as a WAV.
Plain Python, standard-library HTTP plus `mlx-audio`. It listens on 127.0.0.1 only.

## Start

```
cd data-scratch/voices
nohup venv/bin/python ../../labs/voice-lab/engines/voice_server.py --model chatterbox-turbo --port 9923 > voice_server.log 2>&1 &
```

`data-scratch/voices/restart_server.sh` does the same (stops only the pid in `voice_server.pid`, starts the default model, rewrites the pid file).

Flags: `--model` (default `chatterbox-turbo`), `--port` (default 9923), `--store <folder>` (default `data-scratch/voices/voices_store`).
`GET /health` says `loading` until the model is in memory and warmed up (also while `POST /model` switches).

## One model at a time

The server keeps exactly one model loaded. `POST /model` unloads the current one, frees it fully (delete, `gc`, `mx.clear_cache()`), then loads the next.
One worker thread owns all MLX work, so requests queue and run one after another. Do not start a second server or a second model process beside it:
the Mac stops the largest growing process when memory runs short.

## Endpoints

| call | what it does |
|---|---|
| `GET /health` | `{"status":"ok"\|"loading","model","voice","task"}` |
| `GET /models` | every model key with `supports_clone`, `streams`, `slow`, `tags`, `styles`, `styles_by_reference` (measured verdicts), `approx_memory_gb`, `needs_transcript` |
| `POST /model` `{"model": key}` | switch model, warm it, return load and warm-up seconds |
| `GET /voices` | prepared voices: clip seconds, which models have a cached preparation, which styled references exist |
| `POST /voices` multipart: `file` (WAV), optional `text` (transcript), optional `id` | validates 3 to 30 s, converts to mono 24 kHz, trims silence, normalizes loudness, stores it, prepares it for the loaded model. No transcript and the model needs one: the recognizer from `wordcheck.py` (parakeet) writes it |
| `POST /tts` JSON or multipart: `text`, optional `voice`, `style`, `temperature`, `seed`, `context` | chunked `audio/wav`, 24 kHz mono 16-bit, 44-byte header with placeholder sizes |
| `POST /voices/<id>/styles` `{"styles":[...]}` (empty: whisper, shout, angry, excited) | builds styled reference clips with higgs-v3. Returns 202 at once; the loaded model is swapped out and comes back afterwards. While it runs `/tts` answers 503 |

Models: `chatterbox-turbo` (default), `voxcpm2`, `csm-1b`, `breeze-tts-2`, `pocket`, `qwen3-base-1.7b`, `zonos3-mini`, `higgs-v3` (slow, no streaming, the only one with native styles).

### The three added models (blind-test ranking on a casual reference: voxcpm2, csm-1b, breeze-tts-2, then chatterbox-turbo)

All three clone from the voice's clip and transcript (prepared once per model and cached), stream with a first piece of about 160 ms of sound,
cut leading silence, cap trailing silence, stop when the client disconnects, and have the runaway guard. None has sound tags.

- `voxcpm2` (VoxCPM2 2B bf16, about 6.5 GB, native 48 kHz resampled to 24 kHz). Continuation mode: the transcript goes in front of the text and the clip is the start of the sentence. The package returns the whole clip at once; `voxcpm_stream.py` repeats its loop and decodes every 1, 2 then 4 patches. Settings that matter: 300 ms of silence after the reference clip and a space between the transcript and the text. Without them a casual reference makes the model start sentences with "um" (22 of 40 lines); with them 39 of 40 lines were word-exact. Reference-only mode never adds words but loses the voice (similarity 0.42 against 0.66), so it is not used. No `style`.
- `csm-1b` (Sesame CSM-1B fp16, about 4.7 GB). The clip is an earlier finished utterance (words, audio, end frame) and the new text is the next one. The package default (clip words merged with the new text) dropped or changed the first words in 16 of 40 lines. Optional `context` (JSON list of up to 3 earlier turns, `{"speaker": "user"|"assistant", "text": "..."}`) goes in front as text-only turns (user is speaker 1, the voice is speaker 0, 300 characters per turn); the model has no audio for those turns. No `style`.
- `breeze-tts-2` (Breeze TTS 2 bf16, about 8.6 GB; the 4-bit build `mlx-community/Breeze-TTS-2-mlx-4bit` is the fallback if memory is short). `style` maps to its `instruct` field: whisper, shout, angry, excited, sad (the instruction texts are in `GET /models` under `instructions`). Measured on a cloned voice: whisper, shout and excited change the audio; angry and sad barely do. See `data-scratch/voices/server_bench2.md`.


### /tts details

- The first piece is small (about 125 to 250 ms of sound) so audio starts fast. Leading silence is cut; trailing silence of the last piece is capped at about 80 ms; pauses inside the speech are kept.
- If the client disconnects, generation stops after the current piece.
- Sound tags in square brackets (`[laugh]`, `[sigh]`, `[cough]`, `[gasp]`, `[chuckle]`, `[clear throat]`) are rewritten to the loaded model's own syntax when it supports them, and removed silently when it does not. No other word is changed.
- `style` is `neutral` (default), `whisper`, `shout`, `angry` or `excited` (and `sad`, `breeze-tts-2` only). If the voice has a styled reference for it, the model clones from that clip. Otherwise a model with native styles (higgs-v3) uses its own tokens, `breeze-tts-2` sends its delivery instruction, and every other model speaks the plain voice.
- `seed` (integer, optional) fixes the randomness of `voxcpm2` and `csm-1b` for a repeatable take. `context` is for `csm-1b` only (see above); other models ignore it.
- Runaway guard (`voxcpm2`, `csm-1b`): if the audio for one request grows past 2.2 times a length estimate from the text (about 14 characters per second, at least 1.5 s), generation stops, the audio is cut at that limit and the response ends normally. The log line says `runaway=1`.
- The words are never changed. The only edit to the text is the sound-tag handling above; `text_edited=1` in the log line says a tag was rewritten or removed.
- Each request prints one line to stdout: model, voice, style, chars, ttfa_ms, total_ms, audio_s, runaway, text_edited. Numbers only, never the text.

## Files

- `voice_server.py`: HTTP, the worker thread, voice preparation, the audio shaper.
- `tts_engines.py`: one adapter per model (load, prepare a voice, stream) and the tag rewriting.
- `voice_store.py`: voices on disk, audio cleaning, WAV header.
- `voxcpm_stream.py`: the streaming generator for VoxCPM2 (the package returns the whole clip at once).
- `speech_guard.py`, `test_speech_guard.py`: the length estimate behind the runaway guard, and its asserts (`python test_speech_guard.py`).
- `style_refs.py`: the sentences and the higgs-v3 calls that make styled reference clips.
- `style_verdicts.json`: measured verdicts from the emotion-by-reference experiment, shown by `GET /models`.

Voices live in `<store>/<id>/`: `ref.wav`, `ref.txt`, `styles/<style>.wav`, and `prep/<model>/<plain|style>.npz` (the cached preparation per model).
