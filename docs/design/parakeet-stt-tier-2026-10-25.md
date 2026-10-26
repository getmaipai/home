# Parakeet v2 as the hub's speech-to-text pin on the larger tiers (2026-10-25)

Owner's decision (Jesse, 2026-10-25, in chat, after the bench below): "write the design note for Parakeet v2 as a hardware-tier stt
pin, Moonshine stays the default and robot fallback." Slices 01 and 03 were built the same day; the follow-up 2026-10-25 ruling (owner) removed the fallback model: no other Stack role has one.

Architect verdict: pending (see "Gate" at the end).

## Answer

1. **The change is a Stack pin, not a Home change.** Home sends finished utterances to the Stack's `stt` role (`backend/src/lib/stt.ts`);
   the recognizer, its model pin and its session logic live in the Stack (`modelCatalog.ts`, `speech/session.ts`, `speech/worker.ts`).
   Home only consumes the transcript, and later one additive field (item 5).
2. **Parakeet TDT 0.6B v2 int8 becomes a second `stt` model record, bound to the larger tiers.** The Stack already chooses a model per
   role from `PROFILE_MODEL_BINDINGS` (`stack/backend/src/profiles.ts`); the bind is one line per tier, `stt: "parakeet-tdt-0.6b-v2-int8"`.
   No new selection mechanism, no new setting.
3. **Moonshine tiny stays the pin on `p16` and `p32` and the robot's recognizer.** It is the model the robot runs without a hub
   (platform principle 2). There is no fallback model and no automatic switching: no other Stack role has one (owner, 2026-10-25), so
   each tier has exactly one `stt` model.
4. **Parakeet v2, not v3.** v3 measured worse for English (below) and its only gain is other European languages, which no household
   asked for. v3 is named, not pinned.
5. **Word timestamps are a later, additive spec field.** `SttWireEvent` gains an optional `words` list only when a consumer exists (the
   duplex heard-text mapping). Not part of the first slice.

## Measured (2026-10-25, Mac Studio, Apple M5 Max, 128 GB)

Same runtime the Stack ships: `sherpa-onnx-node` 1.13.8, CPU, 2 threads, offline recognizer, as `speech/sherpa.ts` loads it. Test set:
150 clean and 150 noisy clips from the public LibriSpeech test sets (read book speech). The machine was heavily loaded by other work
(load average 113), so every latency figure is an upper bound; accuracy and memory are not affected. Scripts and raw results:
`data-scratch/bench/parakeet-stt-2026-10-25/`.

| | Moonshine tiny int8 | Parakeet v2 int8 | Parakeet v3 int8 |
|---|---|---|---|
| WER, clean | 4.4% | 1.5% | 1.8% |
| WER, noisy | 13.2% | 3.7% | 5.9% |
| Empty results, noisy set | 2 of 150 | 0 | 0 |
| Decode, clips under 3 s (median) | 48 ms | 149 ms | 193 ms |
| Decode, clips 6 to 10 s (median) | 190 ms | 522 ms | 639 ms |
| Resident memory, worker | 0.27 to 0.57 GB | 1.75 to 1.85 GB | 1.76 to 1.87 GB |
| Load time | 0.4 s | 2.5 s | 2.4 s |
| Download | 107.6 MB | 482.5 MB | 487.2 MB |

- Parakeet v2 makes about 3 times fewer errors on clean speech and 3.5 times fewer on noisy speech.
- The CoreML provider was slower than CPU (about 2.5 times) and used 3.3 GB; the pin stays `provider: "cpu"`.
- The duplex note's "23 ms for a 2.5 s clip" did not reproduce on CPU (about 150 ms under load). That note's use of it (a 0.5 s segment
  decoded twice) still fits, but its figure should read "about 150 ms on CPU, measured".
- Not measured: household audio (kitchen noise, children, far-field), a quiet machine, streaming partials end to end.

## The design

### 1. The record and the pin

A second `CatalogModelLike` beside `STACK_STT_MODEL` in `stack/backend/src/lib/modelCatalog.ts`:

| Field | Value |
|---|---|
| `id` | `parakeet-tdt-0.6b-v2-int8` |
| `role` | `stt`, `engine` `sherpa-onnx-node`, `quantization` `int8` |
| `download.url` | `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8.tar.bz2` |
| `download.sha256` | `157c157bc51155e03e37d2466522a3a737dd9c72bb25f36eb18912964161e1ad` (computed on the 2026-10-25 download; the rolling tag can replace an asset, so the hash is the pin) |
| `approx_bytes` | 482,468,385 |
| `license` | CC-BY-4.0 (NVIDIA's model card); attribution line in `NOTICE` and the Stack's `docs/components.md` |
| `measured.footprintBytes` | about 1.85 GB, re-measured by the prove script on the target tier before the bind lands |

The recognizer is a different shape from Moonshine: three ONNX files (`encoder.int8.onnx`, `decoder.int8.onnx`, `joiner.int8.onnx`)
plus `tokens.txt`, configured as a `transducer` with `modelType: "nemo_transducer"`. `speech/sherpa.ts` gains a `loadParakeet` beside
`loadMoonshine`, behind the same `Transcriber` interface, so `session.ts` and the wire contract do not change.

### 2. Which tiers

| Tier | stt model | Why |
|---|---|---|
| `p16` | Moonshine tiny | 16 GB already holds the 8B chat model, tts and the judge; 1.8 GB more is not free there. |
| `p32` | Moonshine tiny until measured | 30B chat plus judge leaves little margin; bind Parakeet only after a resident-memory run on a 32 GB machine. |
| `p64`, `p128` | Parakeet v2 | Memory is not the constraint (the Studio is p128); accuracy is the gain. |

This is a starting binding, judged by the memory run, not a rule. The bind is `PROFILE_MODEL_BINDINGS[tier].stt`; moving a tier is a
one-line change plus the disk-plan regeneration. Today that map has no `stt` entry, so p16 and p32 get Moonshine only because it is the
first installed record; slice 3 adds an explicit `stt: "moonshine-tiny-en-int8"` binding for both, so a manual Parakeet install on
p32 can never become its default by catalog order.

### 3. Readiness (no fallback)

- `selectedModel("stt")` prefers the person's choice, then the tier binding, then the first record that can serve the role. The install
  plan installs only the bound model (Parakeet on p64 and p128, Moonshine on p16 and p32), so there is one model per role, as for every
  other role.
- The readiness probe already transcribes the bundled clip (`bundledClipBase64`); it runs against whichever model loaded. If Parakeet
  fails to load or probe, the role is not ready and the admin reinstalls the model, the same as any other role. While the role is not
  ready, Home shows its existing spoken "not ready" line (`voiceFailureLine("listening_engine", ...)` in Home's `lib/failureCopy.ts`).
  No new status surface, no switching logic.
- The robot never takes Parakeet: its standalone recognizer is Moonshine through its own runtime, unchanged.

### 4. Session behavior that must be re-checked, not assumed

- **Partials re-decode the whole buffer every 1.0 s** (`DEFAULT_SESSION_CONFIG.partialIntervalS`). At Parakeet's measured cost, a 10 s
  utterance spends about 0.9 s of CPU per second of audio, against about 0.4 for Moonshine. Slice 2 measures a real 30 s session and, if
  needed, sets a longer partial interval for the Parakeet record (a per-record value, not a global change), keeping the final decode
  unchanged. A partial is only ever a guess (duplex note, item 1 of "What the first real use found"), so a slower partial cadence never
  changes who is interrupted.
- **The silent-head retry and the 0.32 s pre-roll are Moonshine rules.** Parakeet returned no empty results in the bench, so the retry
  is skipped for it (a per-record flag, default on for Moonshine); the pre-roll stays, it costs nothing.
- **Case and punctuation.** Parakeet returns cased, punctuated text; Moonshine returns lowercase. The reaction rule and the question-mark
  rule in the duplex note read the transcript, so slice 2 adds a test that both outputs reach the same decision on the existing fixtures.

### 5. Word timestamps (later)

sherpa-onnx returns per-token timestamps for this model. A spec change adds an optional `words: { w, startMs, endMs }[]` to the final
`SttWireEvent` and to `SttTranscribeResponse` (spec first, then the Stack, then Home, per the org order; additive, so older clients
ignore it). It is added only when DUPLEX's heard-text mapping is built; until then it is not exposed.

### 6. Install, disk plan and size

The install plan and `shared/diskPlan.json` (generated, never hand-edited) list the extra 482.5 MB on p64 and p128, and the first-run
copy for those tiers says so in plain words ("a larger listening model, about 0.5 GB, for better accuracy with names and background
noise"). The hash is checked at download as for every pin.

## Reuse check

The Stack's per-tier model bindings, `selectedModel`, the sherpa-onnx worker, the readiness probe and the install plan all exist; this
adds one record, one loader function, one binding per tier and per-record session values. No second STT path, no second selection
mechanism, no new setting. Home needs no change in the first slice.

## Not in this design

- Parakeet v3 and other languages (named, not pinned).
- Whisper, Canary or Qwen-ASR as alternatives (not benched).
- A streaming (cache-aware) Parakeet model; the Stack's offline recognizer with partials is kept until a streaming session is designed.
- Any change to the robot's recognizer.
- A user-facing model picker (the existing per-role preference in the Stack stays as is).

## Build slices (Stack repo unless noted; each is a decided, testable task)

1. **STT-PARAKEET-01**: record, `loadParakeet`, worker flag for the model type, unit tests with the Parakeet test wav, prove script
   run on the Studio. Done when the prove script transcribes the bundled clip with Parakeet and Moonshine remains the default.
2. **STT-PARAKEET-02** (optional, only if a live session shows the partial transcript lagging): per-record partial interval and retry flag, session tests, a 30 s live-session measurement with CPU and memory
   numbers recorded in the Stack's dev.md.
3. **STT-PARAKEET-03**: bind `p64` and `p128` and pin Moonshine explicitly on `p16` and `p32`; acceptance includes the CHAT-AB-01 spoken row (rule 13: the 3 s first-word bar reruns after
   each stage, and Parakeet adds about 100 to 330 ms to each final decode); regenerate the disk plan and components doc, `NOTICE` attribution, install-plan copy. Built
   2026-10-25 without a fallback model.
4. **STT-PARAKEET-04** (Home, after 03): the duplex note's latency figure corrected; a household clip bench (the owner's own kitchen
   audio and its transcripts stay in `data-scratch`, never in a log or a commit; rule 6a) comparing both models, as the acceptance for
   leaving the binding in place.
5. **STT-WORDS-01** (spec first, later): the optional `words` field, when the duplex heard-text work needs it.

## Supersedes

- Moonshine tiny as the `stt` pin on `p64` and `p128` (`PROFILE_MODEL_BINDINGS`): replaced by Parakeet TDT 0.6B v2 int8. Moonshine stays
  the pin on `p16` and `p32` and the robot's recognizer.
- The single global partial interval and silent-head retry in the Stack's `speech/session.ts`: become per-record values (Moonshine
  unchanged).
- `full-duplex-voice-2026-10-24.md`, the local-voice findings, item 6 ("Parakeet: 23 ms for a 2.5 s clip"): amended to about 150 ms on
  CPU, measured 2026-10-25.

## Gate

Rule check: no `RULES.md` rule is touched (no turn, search, stream or chat UI change; age and surface gates are unaffected because this
changes only which local model turns audio into text). The privacy rule holds: the model is downloaded once from a pinned release and
runs on the hub; nothing leaves the home at run time. Verdict file: `data-scratch/architect/PARAKEET-STT-2026-10-25.verdict`.
