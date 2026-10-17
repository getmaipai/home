# Studio voice: what was decided, what was not (2026-10-17)

Status: decided 2026-10-17. Chatterbox Turbo (MLX) is the Studio's voice, chosen by ear by Jesse; slice 1 built and live (default on p64 and p128, Pocket TTS fallback).

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
rejected or unmeasured on the 2026-09-04 live numbers (Chatterbox and Orpheus reversed by the 2026-10-17 MLX measurements below); the 2026-09-17 criterion reopened them for the Studio without choosing.

## What the code supports today

- Stack engines: `ENGINE_ROLE` and the managed runtime list in `stack/backend/src/lib/engineCatalog.ts` name `uv` and `pocket-tts`
  for `tts`. A second TTS engine needs a catalog entry, a hashed requirements file, a supervisor adapter beside `pocketTts.ts`, an
  install route entry and a voice list source in `speech/voiceList.ts`.
- Tags: `reply.speech` exists (THIN-0J) but the composer emits no model tags (REG-02 open). `normalizeForSpeech` in
  `commons/spec/voice/ts/normalizeForSpeech.ts` strips markdown only; bracket tags without a following `(...)` pass through, but no
  test proves a tag survives the whole path to the engine.

## Measured on the Studio, 2026-10-17 (supersedes the 2026-09-04 Chatterbox verdict)

Hardware: Apple M5 Max, 128 GB, macOS 27. Script (about 8 s of speech): "Oh, that is hilarious [laugh]. Sorry. [cough] Excuse me.
Um, let me think. [sigh] Okay, here is the plan for tomorrow." (Orpheus uses `<laugh>` style tags.) Warm run, second pass; the first pass
pays 6 to 14 s of one-time compile and cache cost, so a real engine must warm at boot. Reference voice for cloning: the Pocket TTS alba clip.
Scratch env only (uv, Python 3.11); the live Stack was not touched. Quality was not listened to by me: the WAVs are for Jesse's ear.

| Run | Time to first audio | Real-time factor | Peak memory | Streams |
|---|---|---|---|---|
| Pocket TTS (live Stack, CPU) | about 0.1 s (whole 8 s clip in 0.66 s) | 0.08 | small | yes |
| Chatterbox Turbo, upstream `chatterbox-tts`, PyTorch MPS | whole clip only: 7.2 s (2 s clip took 3 to 4 s) | 0.87 to 1.03 (1.79 cold) | 15.8 GB MPS | no |
| Chatterbox Turbo, MLX port in `mlx-audio` (`mlx-community/chatterbox-turbo-fp16`) | 0.45 s | 0.27 | 4.8 GB | yes, 9 chunks |
| Orpheus 3B, MLX 4-bit in `mlx-audio` (`mlx-community/orpheus-3b-0.1-ft-4bit`) | 0.75 s | 0.42 | 3.2 GB | yes, 9 chunks |
| `davidbrowne17/chatterbox-streaming` fork, original 500M Chatterbox, MPS | 2.8 s | 3.4 (batch call 1.8) | 20 GB MPS | yes, 10 chunks |

### What this changes
- The 2026-09-04 result was upstream PyTorch on MPS. That path still measures about 1.0x real time with no streaming (upstream has no
  streaming code), so the old number was right for that path. It was the wrong runtime: the same Turbo model on MLX is 0.27x real time
  with 0.45 s to first audio and real chunk streaming. Chatterbox Turbo is no longer disqualified.
- Jesse's streaming-fork point is half right. The fork streams, but it was last updated June 2025, predates Turbo and has no tags, and on
  this Mac it is slower than real time (RTF 3.4). The streaming that matters is in the MLX port.
- Orpheus also drops from 1.3 to 1.5x (llama.cpp, 2026-09-04) to 0.42x on MLX 4-bit.

### Claims in the pasted third-party summary
- 350M parameters: holds (model card). Tags: card names [cough] [laugh] [chuckle] "and more"; I did not verify [sigh] by ear.
- Native streaming: false for upstream; true for the MLX port and the fork (original model only). Streaming is chunk-level.
- 150 to 300 ms first byte and RTF 0.5 on an RTX 4090: not reproduced; on the M5 Max MLX port 450 ms and 0.27. Fork quotes 0.47 s on a 4090.
- Distilled one-step decoder: upstream describes a streamlined 350M design for low-latency agents; not checked in code.
- Zero-shot cloning needs a reference clip: holds (Turbo requires `audio_prompt_path`).
- Watermark: upstream always applies Resemble's PerTh watermark in `generate` (no flag). The MLX port contains no watermark code (grep). Inaudible
  by design; for a private hub it is harmless, but removing it means the MLX route, not a patch.
- License: model card says MIT; the code repo is MIT. Weights and code share the license.

### Field survey (October 2026), sources in the notes below
Newer than the 2026-09-17 plan and worth knowing: Fish Audio drama-3 (35B MoE, 3B active, new this week, MLX 4-bit 22 GB, about 26 GB peak,
roughly 2x real time on an M3 Max, `[laughs]` `[sighs]`, Fish Community License, research or non-commercial, no cough or "um"); Fish S2 Pro
(5B, 15,000 free-form tags, research license); Maya1 (3.3B, Apache-2.0, 20 tags incl. laugh, sigh, gasp, no cough; CUDA-first); VoxCPM2
(2B, Apache-2.0, emotion by prompt, no nonverbal tags); OmniVoice (0.6B, laughter and sigh tags, weights CC-BY-NC); Dia2 (1B and 2B,
Apache-2.0, streaming, (laughs) (coughs), MLX conversion exists, not run here); Supertonic 3 (about 99M, `<laugh>` `<breath>` `<sigh>`, licence
reports conflict, not run); Breeze TTS 2 and Voxtral TTS (top open entries on Artificial Analysis, non-commercial). `mlx-audio` also carries
Higgs Audio, IndexTTS, Qwen3-TTS, Dia and CSM ports. I did not run these: the 6 GB download cap was already passed (about 11 GB fetched).
No independent arena number puts any of them clearly above Chatterbox Turbo for a permissive licence; Fish drama-3 is the likely
expressiveness ceiling but its licence blocks selling the product.

### Ranking for the Studio
1. Chatterbox Turbo on MLX: MIT, fastest measured, 4.8 GB, streams, three named nonverbal tags, cloning. Needs a cough/sigh/"um" ear test.
2. Orpheus 3B MLX 4-bit: Apache-2.0 headline (Llama-based; read the Llama terms), 3.2 GB, streams, widest documented tag set (laugh, chuckle,
   sigh, cough, gasp, groan), less like a clone-from-clip system. Choose it if Turbo's cough or sigh sounds weak.
3. Fish drama-3 / Dia2 as later bakeoffs (licence and 22 GB, or untested).
Fallback on small machines: Pocket TTS stays (CPU, 0.08 RTF, 219 MB, CC-BY-4.0).

### Fit in the Stack
Second `tts` engine (catalog entry plus `mlx-audio` as a hashed managed runtime beside `uv`/`pocket-tts`, adapter beside `pocketTts.ts`).
`reply.speech` carries the engine's tags, so tag syntax is per engine (REG-02); the chosen engine needs a tag passthrough test.
Memory beside keep-warm models: 3 to 5 GB resident, small against 128 GB. Warm once at boot (first call costs 6 to 14 s). Weights are
downloaded at install, never vendored, so MIT and Apache weights sit cleanly with AGPL; non-commercial weights (Fish, Breeze, OmniVoice,
Voxtral) do not suit a product Jesse may sell.

### Files (scratch, listen here)
`/private/tmp/claude-501/-Users-jessetorres-Developer-github-com-getmaipai-home/fba2f4f9-9b1a-4dc5-ae7f-b12315c3b680/scratchpad/bench/wav/`:
`cbturbo_mlx_fp16.wav`, `orpheus_mlx_4bit.wav`, `turbo_mps.wav`, `fork_stream_mps.wav`, `pocket_tags.wav`, `pocket_plain.wav`.

### Sources
[Chatterbox](https://github.com/resemble-ai/chatterbox), [Turbo card](https://huggingface.co/ResembleAI/chatterbox-turbo),
[streaming fork](https://github.com/davidbrowne17/chatterbox-streaming), [mlx-audio](https://github.com/Blaizzy/mlx-audio),
[Fish drama-3](https://huggingface.co/fishaudio/drama-3), [Fish S2 Pro](https://huggingface.co/fishaudio/s2-pro),
[Maya1](https://huggingface.co/maya-research/maya1), [Artificial Analysis arena](https://artificialanalysis.ai/text-to-speech/leaderboard).

## Built on the Studio, 2026-10-17 (stack commits fb93272, 89a6b01)

Stack `VOICE-STUDIO-01` slice 1 is landed and running on the Studio. Until Jesse picks by ear, both engines stay available through one
setting, `stack.voice.engine` (`auto`, `chatterbox-turbo`, `pocket`; applies at the voice engine's restart).

- **Default:** `auto` is Chatterbox Turbo on p64 and p128 and Pocket TTS on p16 and p32 (p32 keeps Pocket: the 17 GB Muse 30B pin leaves no
  room for a 4.8 GB voice). Pocket TTS is also the fallback: an engine that is not installed, or fails to start, leaves the voice on
  Pocket with a health warning (`tts.engine-fallback`) and the reason on the role; chat and the Stack are untouched.
- **Live check:** the Stack binary was swapped, `mlx-audio` 0.5.9 built into `data/engines/mlx-audio/0.5.9` (no torch, 36 packages), the
  eight Chatterbox pins downloaded (2.99 GB weights), the voice engine restarted and then the whole Stack kickstarted: keep-warm loaded `tts`
  on Chatterbox Turbo (warm in 4.6 s beside chat, embed, judge and stt). A real `POST /v1/audio/speech` with
  "Oh, that is hilarious [laugh]. Sorry. [cough] Excuse me. Um, let me think. [sigh] Okay, here is the plan for tomorrow." returned 10.3 s of
  audio, first byte 0.5 s. Sample: `scratchpad/chatterbox_turbo_via_stack_laugh_cough_sigh.wav`. While other bench jobs were using the GPU
  the real-time factor read 0.5 to 0.6, not the idle 0.27; still faster than real time and streaming. Resident set about 2.8 GB RSS, 4.3 GB
  measured footprint by the Stack.
- **Capability flag (Home reads this):** `GET /stack/v1/roles` gives the `tts` role `tts: { engine, requested, tags, fallback_reason }` and
  each entry of `GET /stack/v1/voices` carries `engine` and `tts: { engine, tags }`. `tags` is the list the engine renders as sounds;
  Pocket TTS returns an empty array. The composer (REG-02) writes only listed tags into `reply.speech`.
- **Tags verified (by measurement, not by ear):** each tag was synthesized alone, three runs, and compared with spoken words by voiced-frame
  fraction and spectral flatness. Spoken words: voiced 0.82 to 0.99, flatness 0.0025 to 0.0033. Rendered as non-speech sound: `[laugh]`
  (0.42, 0.053), `[chuckle]` (0.72, 0.019), `[cough]` (0.21, 0.019), `[sigh]` (0.23, 0.015), `[gasp]` (0.20, 0.029), `[clear throat]` (0.66,
  0.0085, weakest). Not offered: `[groan]` measures like speech, `[sniff]` and `[shush]` render as non-speech but were not asked for. An
  unknown bracket word is spoken aloud (`[banana]` read as "banana"). The model's tokenizer knows 19 bracket tokens (also `[whispering]`,
  `[angry]`, `[crying]` and mood tokens); those were not tested. The vocabulary served is the six above; Jesse's ear is the final test.
- **Licences recorded on the pins:** weights Apache-2.0 per the `mlx-community` card (the upstream ResembleAI card says MIT), `mlx-audio`
  code MIT, no watermark code in the MLX port; downloaded at install, never vendored. Reference-clip cloning is not in slice 1 (it needs
  S3TokenizerV2, 472 MB, pinned beside it).
- **Orpheus:** not built, rejected by ear 2026-10-17. The registry has the slot (`orpheus`, `built: false`), the server script takes a new engine class, and the setting
  gains the option when its pins land.
- **Home side (other agent):** nothing in Home changes for speech to work (same wire); composer tags and REG-02 read `tts.tags`.

## Decision (2026-10-17, owner)

After listening to the benchmark samples and the live Stack sample (`chatterbox_turbo_via_stack_laugh_cough_sigh.wav`), Jesse (owner)
chose Chatterbox Turbo (MLX) as the Studio's voice. He picked the Chatterbox sample by ear.

- Slice 1 is done and stands as built. The tags are live: the composer (REG-02) writes only the tags listed in `tts.tags`.
- Orpheus 3B was rejected by ear (owner, 2026-10-17: "was just bad"). It is not a candidate and not a later slice.
- Pocket TTS stays the small-machine fallback.
- Reference-clip cloning for Chatterbox stays later (slice 3, pins S3TokenizerV2).

## Next

1. REG-02: tag vocabulary per engine (read `tts.tags`), tag passthrough test from `reply.speech` to the engine.
2. Optional later: reference-clip voices (slice 3).
