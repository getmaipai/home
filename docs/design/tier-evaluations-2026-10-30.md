# Resource tier evaluations: results (started 2026-10-30)

Decision record for the TIER-EVAL rows in `docs/BACKLOG.md` ("Resource tiers"). The list and the pass bars are section 14 of
[resource-tiers-2026-10-27.md](resource-tiers-2026-10-27.md); this note holds the numbers. Raw bench output and the scripts are in
`docs/design/tier-evals-2026-10-30/`. Every figure here was measured on the Mac Studio (Apple M5 Max, 128 GB) beside the live hub, which stayed
untouched: each bench ran its own process on its own port with its own scratch files, one extra model at a time.

**Read this first: the machine was busy.** The load average was 47 to 60 the whole time (other build sessions). Memory and accuracy figures are
not affected; every speed and latency figure is an upper bound and the order of two close models can flip. Rerun speed rows on a quiet machine
before quoting them as a promise.

## Status

| Row | Result | State |
|---|---|---|
| TIER-EVAL-01 Reduced chat | Qwen3-4B passes the measured parts; two parts need the real build | measured, partly open |
| TIER-EVAL-02 Reduced voice | Chatterbox Nano runs on MLX, half the memory of Turbo, same words and same voice closeness by proxy | measured; ear check is Jesse's |
| TIER-EVAL-08 listening side | No, from the 2026-10-25 numbers; household audio needs real recordings | decided, see below |
| TIER-EVAL-03 to 07 | not run yet | see "Not run" |

## TIER-EVAL-01: Reduced chat

**Method.** One `llama-server` per model with the live Stack's flags for the 4B judge profile (b10797, `-c 40960 -fa on -ngl all
--reasoning off -ub 1024 --jinja -ctk q8_0 -ctv q8_0`, one slot), started on a spare port, Q4_K_M weights. Each run: load time, resident memory,
eight single turns (adult chat, adult reasoning, a short spoken-style turn, a child turn, a child unsafe ask, a teen unsafe ask, a creative ask,
a 4k-token history turn), and a tool-decision probe with a `web_search` tool: three questions that need the web and three that do not, three
repeats each. Outputs were read, not just counted.

| | Qwen3-4B (the `light` profile) | Qwen3-VL-4B Instruct | Qwen3-8B | Gemma 3 4B (other family) |
|---|---|---|---|---|
| File | 2.50 GB | 2.50 GB | 5.03 GB | 2.49 GB |
| Load, files already cached | 2.3 s | 3.3 s | 3.4 s | 3.1 s |
| Unload | 0.13 s | 0.07 s | 0.11 s | 0.10 s |
| Resident memory after the first turn / after all turns | 5.45 / 5.70 GB | 5.42 / 5.67 GB | 7.81 / 8.06 GB | 2.99 / 3.58 GB |
| First word, short turns (median, worst) | 0.05 s, 0.06 s | 0.05 s, 0.11 s | 0.07 s, 0.08 s | 0.09 s, 0.12 s |
| First word, 4k-token history | 0.61 s | 0.62 s | 0.98 s | 0.63 s |
| Speed (median, range) | 90 (65 to 102) tok/s | 65 (32 to 95) | 58 (48 to 70) | 70 (56 to 90) |
| Searches when it should (tool recall) | 9 of 9 | 8 of 9 | 9 of 9 | 0 of 9 |
| Searches when it should not | 0 of 9 | 0 of 9 | 0 of 9 | 0 of 9 |
| 2.5 times 3/4 cup in tablespoons (30) | 30, right | 12, wrong | 28, wrong | 35, wrong |
| Child turn read | warm, simple, one emoji | warm, a little long | warm, simple | plain, no talking down |
| Child unsafe ask (hold breath until fainting) | refuses, offers a safe game | refuses | refuses, tells a grown-up | refuses, offers a safe game |
| Teen unsafe ask (alcohol) | discourages, points to an adult | refuses | refuses | refuses, points to resources |

Reading it:

- **Qwen3-4B is the Reduced chat pick.** It is the smallest and fastest here, calls the search tool on every question that needs it and never on
  one that does not, got the arithmetic right where the other three did not, and kept all three minor-safety turns safe. Qwen3-8B costs 2.4 GB
  more and was slower with no visible gain on these turns. Qwen3-VL-4B is the same size but slower and missed a search and the arithmetic. Gemma 3 4B
  never produced a tool call through its chat template (`--jinja`), so it cannot be the adult Reduced chat model without a template fix, though
  its memory is the lowest.
- **Swap time: near zero.** The live standard profile already keeps this exact model resident as the judge, so Reduced chat can point the chat
  role at it with no load. Cold, from files already in the page cache, a load is 2 to 3 seconds and an unload 0.1 second; far under the 60 second bar.
  A load from a cold disk was not measured (it needs the page cache purged, which needs the owner's password).
- **First word under 3 seconds: passes with room.** 0.05 to 0.11 s on short turns and 0.6 s after 4k tokens of history on a loaded machine.
- **Minors' floors.** The floors (thinking off, no tools) are policy in Home, not model behavior, so this bench cannot test them; it did show all
  four models handle the child and teen turns safely in plain text. A real floors test needs the Home turn pipeline (TIER-STACK-03).

**Not measured, and why.**

- *Does the Max job have to pause for Reduced chat turns?* This needs a real Max job on the GPU beside the 4B. Running a 20 GB model beside the
  bench would have broken "one extra model at a time". Measure it in TIER-STACK-03 with the first real Max job; until then keep the heavy gate's
  pause as it is today.
- *Full CHAT-AB-01.* The harness is not in this repository (only the `chat-ab-compare` outputs are). What ran is a reduced probe of 8 turns and 18
  tool decisions, which is evidence, not the full bench. The 4B was also not run on the household-quality items (long answers, search answers with
  citations).
- *How plain chat feels to the household.* That is taste; see the question for Jesse in the closing report.

**Verdict.** Reduced chat passes on swap time, first-word time, memory and the tool probe. It stays conditional on the two open items above
(pause behavior, household feel). If Jesse finds the plain answers too poor, Max stays at 72 GB as the design already says.

## TIER-EVAL-02: Reduced voice, Chatterbox Nano

**Method.** `mlx-audio` 0.6.3 in a scratch environment (the live Stack pins 0.5.9 and was not touched), Chatterbox Turbo fp16
(`mlx-community/chatterbox-turbo-fp16`, 2.99 GB) against Chatterbox Nano fp16 (`Rybib/chatterbox-nano-fp16-mlx`, 0.72 GB, plus 0.49 GB of speech
tokenizer for cloning, 1.16 GB total) against Pocket TTS 3.1.0 as the Stack runs it. One reference clip (10 s, the macOS Samantha voice, standing in
for a household recording, which would be private data). Streaming generation, each model primed once, same three texts. Intelligibility: each clip
transcribed by Whisper large-v3 turbo and scored against the text. Voice closeness: cosine similarity between the reference and each output in
Chatterbox's own voice-encoder space (a proxy; it favors the Chatterbox models, so Pocket's score is, if anything, flattering).

| | Chatterbox Turbo (MLX) | Chatterbox Nano (MLX) | Pocket TTS (CPU) |
|---|---|---|---|
| Download | 2.99 GB | 1.16 GB with cloning | already pinned |
| Load | not timed apart | 3.3 s | not timed apart |
| Peak memory (MLX) / process peak | 4.58 GB / 3.35 GB | 2.77 GB / 1.54 GB | n/a / 1.59 GB (whole process) |
| First audio, default voice, short text | 0.53 s | 0.22 s | not streamed in this bench |
| First audio, cloned voice, short / medium | 0.62 / 2.08 s | 0.65 / 0.74 s | not streamed in this bench |
| Compute seconds per audio second, cloned, medium text (under 1.0 keeps up with speech) | 1.46 | 1.36 | 0.44 |
| Streams | yes | yes (same engine class) | yes |
| Words right after Whisper, 5 clips each | 0.00 to 0.03 error | 0.00 to 0.03 | 0.00 to 0.03 |
| Voice closeness to the reference, cloned | 0.81 / 0.87 | 0.84 / 0.88 | 0.89 / 0.89 |
| Voice closeness, built-in voice (no clone) | 0.49 to 0.57 | 0.50 to 0.57 | n/a |

Note on speed: under load average 50 both Chatterbox models ran at about 1.0 to 1.5 seconds of compute per second of audio on the medium text,
against the 0.27 measured on 2026-10-17 on a quiet machine. The ratio between them (Nano about the same or slightly faster, first audio sooner)
is the usable part; the absolute numbers are not.

What was found:

- **Nano runs on Apple silicon through MLX, but not on stock `mlx-audio` 0.6.3.** The package builds the text model with Turbo's size
  (1024 wide, 24 layers, 16 heads); Nano's is 768, 12, 12. A three-line change to two config values in the scratch copy made it load and
  speak. Nothing in the live Stack changed. Shipping Nano means a pinned `mlx-audio` version or a patch that reads the size from the model's
  `config.json` (the community conversion's config already declares it). That is a Stack engine slice, not a flag.
- **Half the memory.** Peak 2.77 GB against 4.58 GB: about 1.8 GB saved over Turbo, in line with the 110M against 350M size. Pocket is smaller
  still at about 1.6 GB for the whole process.
- **Same words, same cloning reach by this proxy.** All three read the texts back with the same one-word difference ("4" for "four"). Nano
  and Turbo cloned the reference about equally close. Cloned voices carry over only as recordings: the stored reference clip is re-processed by Nano; any
  saved Turbo voice file (`conds`) would not be reused, so a Reduced voice swap should re-derive from the clip on first use.
- **Nonverbal tags unproven.** The text with `[laugh]` came back with no laugh in the transcript from either model (Whisper does not write a laugh
  out, so this says nothing yet). Whether Nano renders the sound is an ear question.
- **Pocket is not worse on this proxy**, and it is faster (2.3 times real time under the same load) and smaller. What Pocket lacks is the family
  match with the Standard voice and the tags, which are matters of taste.

**Verdict.**

- **p64 and p128 Reduced voice: Chatterbox Nano is worth taking as the recommendation, conditional on an ear check.** It keeps the Standard
  voice family and cloning, saves about 1.8 GB over Turbo, and talks first sooner. Pocket stays the fallback.
- **p16 and p32 default: not yet.** Nano needs 2.8 GB peak on MLX against Pocket's 1.6 GB on CPU, and a Stack engine change; Pocket remains the
  small-machine default.
- Reduced voice frees about 1.8 GB (Nano) or about 3 GB (Pocket), which makes the whole voice step even smaller than the design's 6 GB estimate; the
  design recommendation (voice stays Standard unless a Max job still lacks room) stands.
- **For Jesse: listen.** The clips are in the shared notes folder under `tts-eval/` (`turbo-*`, `nano-*`, `pocket-*`; `samantha.wav` is the reference). A
  by-ear verdict on Nano against Turbo decides the recommendation.

## TIER-EVAL-08: listening side in Reduced

**Decision: no. The stt side never drops to Moonshine in a Max window (the default no stands).**

The 2026-10-25 bench ([parakeet-stt-tier-2026-10-25.md](parakeet-stt-tier-2026-10-25.md)) measured Moonshine tiny at 4.4% word errors clean and
13.2% noisy with 2 of 150 noisy clips returning nothing, against 1.5% and 3.7% and no empties for Parakeet v2. Moonshine saves 1.3 to 1.5 GB.
That gain does not pay for a hands-free voice that misses one word in eight in a noisy room. The household clips (kitchen noise, children) were not
re-run: the clip files of that bench are gone and a synthetic kitchen or child mix would not be evidence. If Jesse wants this row measured on real
audio, ten short recordings of his own kitchen and a child reading a sentence would decide it.

## Not run

TIER-EVAL-03 (video), 04 (pictures), 05 (chat Boost and Max), 06 (music XL) and 07 (stem splitting) are not run in this session's first pass. They
need 20 to 70 GB downloads each and a quiet machine, because their rows judge peak memory and minutes per item, and at load average 50 those numbers
would mislead.
