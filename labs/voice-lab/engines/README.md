# Voice server (proof of concept)

A small local server that loads one voice model on the GPU, clones voices from a short clip, and streams speech as a WAV.
Plain Python, standard-library HTTP plus `mlx-audio`. It listens on 127.0.0.1 only.

## Start

```
cd data-scratch/voices
nohup venv/bin/python ../../labs/voice-lab/engines/voice_server.py --model chatterbox-turbo --port 9923 > voice_server.log 2>&1 &
```

Flags: `--model` (default `chatterbox-turbo`), `--port` (default 9923), `--store <folder>` (default `data-scratch/voices/voices_store`).
`GET /health` says `loading` until the model is in memory and warmed up.

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
| `POST /tts` JSON or multipart: `text`, optional `voice`, `style`, `temperature` | chunked `audio/wav`, 24 kHz mono 16-bit, 44-byte header with placeholder sizes |
| `POST /voices/<id>/styles` `{"styles":[...]}` (empty: whisper, shout, angry, excited) | builds styled reference clips with higgs-v3. Returns 202 at once; the loaded model is swapped out and comes back afterwards. While it runs `/tts` answers 503 |

Models: `chatterbox-turbo` (default), `pocket`, `qwen3-base-1.7b`, `zonos3-mini`, `higgs-v3` (slow, no streaming, the only one with native styles).

### /tts details

- The first piece is small (about 125 to 250 ms of sound) so audio starts fast. Leading silence is cut; trailing silence of the last piece is capped at about 80 ms; pauses inside the speech are kept.
- If the client disconnects, generation stops after the current piece.
- Sound tags in square brackets (`[laugh]`, `[sigh]`, `[cough]`, `[gasp]`, `[chuckle]`, `[clear throat]`) are rewritten to the loaded model's own syntax when it supports them, and removed silently when it does not. No other word is changed.
- `style` is `neutral` (default), `whisper`, `shout`, `angry` or `excited`. If the voice has a styled reference for it, the model clones from that clip. Otherwise a model with native styles (higgs-v3) uses its own tokens, and every other model speaks the plain voice.
- Each request prints one line to stdout: model, voice, style, chars, ttfa_ms, total_ms, audio_s. Numbers only, never the text.

## Files

- `voice_server.py`: HTTP, the worker thread, voice preparation, the audio shaper.
- `tts_engines.py`: one adapter per model (load, prepare a voice, stream) and the tag rewriting.
- `voice_store.py`: voices on disk, audio cleaning, WAV header.
- `style_refs.py`: the sentences and the higgs-v3 calls that make styled reference clips.
- `style_verdicts.json`: measured verdicts from the emotion-by-reference experiment, shown by `GET /models`.

Voices live in `<store>/<id>/`: `ref.wav`, `ref.txt`, `styles/<style>.wav`, and `prep/<model>/<plain|style>.npz` (the cached preparation per model).
