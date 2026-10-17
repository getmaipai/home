# IMGQ-12a: offline picture-check bench, dev results (2026-10-12)

Result of item IMGQ-12a in `../design/retired/imgq-12-picture-design-2026-10-12.md`. Dev numbers only. The sealed IMGQ-11 set was not opened.
Verdict: no model tried meets the marks. At a 2 percent right-tile false drop, every model catches only 10 to 41 percent of
wrong tiles. At a 70 percent catch, every model drops 17 to 40 percent of right tiles. The note's hope (zero-shot CLIP-family
scoring of a tile against the subject name) is not supported on this data.

## Data and method

- 645 Commons tiles from the IMGQ-08 labelled captures (43 tuning subjects, 27 held-out dev subjects), fetched as 500 px
  thumbnails at 1 per second with the Home user agent, no 429 seen. 643 decoded (2 files truncated); 29 labelled Commons files
  had no thumbnail URL in the capture and 165 labelled rows are non-Commons search-engine pages (flickr, news sites), not
  fetched: unavailable. Tuning set: 410 right, 39 bad (25 wrong subject, 6 private person, 8 junk). Held-out dev: 177 right, 17 bad
  (15 wrong subject, 2 private person). Intervals on the held-out bad tiles are wide (17 tiles).
- Models, ONNX Runtime CPU, fp32, pinned by repository revision, file sha256 in `data-scratch/imgq-12a/models_pinned.json`:
  CLIP ViT-B/32 (`Xenova/clip-vit-base-patch32` at d15189d7, MIT), SigLIP 2 base patch16-224 (`onnx-community/siglip2-base-patch16-224-ONNX`
  at ba1f3b0, Apache-2.0), TinyCLIP ViT-39M/16 text-19M YFCC15M (`onnx-community/...-ONNX` at 3db5c5b, MIT; the 40M/32 variant
  has no ONNX export, so this is the nearest one). The ONNX files are third-party conversions of the official weights, not the
  official repositories; a production pin would convert from the official checkpoint.
- MobileCLIP-S0 was not run: its licence on the official repository is `apple-amlr`, a research-use licence, which fails the
  licence check the note asked for.
- Prompts, class table and thresholds are in `data-scratch/imgq-12a/PREREG.md` and `prompts.py` (PREREG sha256 prefix 634ab209f99f425c,
  prompts.py 170bd93fdf9a0824), written before any score was computed. The class is the capture's `kind` field mapped to a
  branch by keyword (a stand-in for IMGQ-12b's Wikidata table). Thresholds were chosen on the tuning set only and applied unchanged to held-out.
- Scoring modes. A: one against nothing, cosine to "a photo of {subject}, a {kind}" minus cosine to "a photo". B: softmax
  (scale 100) over subject, class and 13 negatives, drop when the negatives hold too much probability. C: B without the class prompt.
- Operating points. catch70: threshold that catches 70 percent of bad tiles on tuning. fd2: threshold that gives 2 percent right-tile
  false drops on tuning.

## Tile level

Catch = bad tiles dropped. FD = right tiles dropped. Wilson 95 percent intervals in brackets. Held-out rows are the honest
numbers (thresholds fixed on tuning). AUC is bad-versus-right separation (0.5 none, 1.0 perfect), tuning / held-out.

| model | mode | AUC | at catch70: held-out catch | held-out FD | at fd2: held-out catch | held-out FD |
|---|---|---|---|---|---|---|
| CLIP B/32 | A | 0.82 / 0.80 | 0.65 [0.41,0.83] | 0.232 [0.176,0.299] | 0.18 [0.06,0.41] | 0.017 [0.006,0.049] |
| CLIP B/32 | B | 0.74 / 0.79 | 0.82 [0.59,0.94] | 0.333 [0.268,0.406] | 0.18 [0.06,0.41] | 0.028 [0.012,0.064] |
| CLIP B/32 | C | 0.76 / 0.78 | 0.82 [0.59,0.94] | 0.328 [0.263,0.400] | 0.24 [0.10,0.47] | 0.023 [0.009,0.057] |
| TinyCLIP 39M/16 | A | 0.82 / 0.84 | 0.76 [0.53,0.90] | 0.232 [0.176,0.299] | 0.12 [0.03,0.34] | 0.011 [0.003,0.040] |
| TinyCLIP 39M/16 | B | 0.75 / 0.81 | 0.82 [0.59,0.94] | 0.345 [0.279,0.417] | 0.29 [0.13,0.53] | 0.034 [0.016,0.072] |
| TinyCLIP 39M/16 | C | 0.78 / 0.82 | 0.82 [0.59,0.94] | 0.299 [0.237,0.371] | 0.18 [0.06,0.41] | 0.034 [0.016,0.072] |
| SigLIP 2 base | A | 0.83 / 0.80 | 0.65 [0.41,0.83] | 0.198 [0.146,0.263] | 0.24 [0.10,0.47] | 0.011 [0.003,0.040] |
| SigLIP 2 base | B | 0.70 / 0.83 | 0.88 [0.66,0.97] | 0.599 [0.525,0.668] | 0.35 [0.17,0.59] | 0.028 [0.012,0.064] |
| SigLIP 2 base | C | 0.78 / 0.80 | 0.82 [0.59,0.94] | 0.367 [0.300,0.440] | 0.41 [0.22,0.64] | 0.028 [0.012,0.064] |
| Qwen2-VL-2B-Instruct (4-bit, optional) | yes/no | n/a | 0.29 [0.13,0.53] (tuning 0.46) | 0.102 [0.065,0.155] (tuning 0.12) | one fixed point only | |

Competing descriptions (B, C) against one-versus-nothing (A): competing scoring catches more at a loose threshold (held-out
0.82 to 0.88 against 0.65 to 0.76) but at far higher right-tile loss (0.30 to 0.60 against 0.20 to 0.23). At the 2 percent point,
C is slightly better than A for CLIP and SigLIP 2 (0.24 against 0.18, 0.41 against 0.24) with overlapping intervals. Neither is usable. A
per-question relative score (each tile's A against its question's other tiles, a post-hoc extra) was worse on both splits (FD 0.41 to 0.57 at 70 percent catch).
The SigLIP 2 softmax uses temperature 100 because the learned scale is not in the split ONNX; it may sharpen with the true scale.

## Question level (held-out dev, 22 questions with Commons tiles; tuning in `results.json`)

A "question" is a subject and its labelled tiles (all candidates, not only the five shown). Coverage = every candidate
suppressed. Wrong-question = at least one bad tile remains. Kept = share of questions that had a right tile and still have one.
Wrong-question rate before any check was 0.41 held-out and 0.49 tuning.

| model, mode, point | coverage | wrong-question after | kept |
|---|---|---|---|
| CLIP A catch70 | 0.09 | 0.23 | 0.95 |
| CLIP C catch70 | 0.18 | 0.14 | 0.86 |
| TinyCLIP A catch70 | 0.14 | 0.18 | 0.90 |
| SigLIP 2 B catch70 | 0.18 | 0.09 | 0.86 |
| any model, fd2 | 0.00 to 0.05 | 0.27 to 0.36 | 0.95 to 1.00 |
| Qwen2-VL-2B yes/no | 0.05 | 0.36 | 0.95 |

Even the loosest point leaves a wrong tile on 9 to 27 percent of questions, against the 1-in-40 (2.5 percent) bar; the
fd2 points barely move the wrong-question rate. Question counts are small, so intervals (in `results.json`) span roughly plus or minus 0.2.

## Cost (Apple M4 Pro CPU, batch 1, 500 px thumbnail in, ONNX Runtime default threads)

| model | tile p50 / p95 (ms), prep plus encode | 1 thread p50 | 4 threads p50 | resident memory | text encode per prompt |
|---|---|---|---|---|---|
| CLIP B/32 | 16 / 29 | 19 | 18 | 1.3 GB | 5 ms |
| TinyCLIP 39M/16 | 17 / 35 | 33 | 20 | 1.1 GB | 3 ms |
| SigLIP 2 base | 34 / 142 | 59 | 37 | 1.9 GB (2.6 GB at 1 thread) | 8 ms |
| Qwen2-VL-2B 4-bit (MLX, GPU, 448 px) | 359 / 448 | n/a | n/a | 2.3 GB peak | n/a |

All three CLIP-family models are far under the p50 150 ms mark on this Mac. The engine box (8 GB, weaker CPU) was not
measured, so the speed mark is met here and unknown there. Memory includes both towers; the vision tower alone is smaller.

## Stack VL-8B (VISION-02), not run

The harness is ready (`data-scratch/imgq-12a/vl_engine_bench.py`: one yes/no question per tile to an OpenAI-compatible
endpoint, thumbnail bytes as the image). No engine was started: the Stack's Qwen3-VL-8B is reached through the SSH
tunnels on 8771 and 8773, both busy with other benches and off limits, and no other free slot was found. Open
and unmeasured: its catch and false-drop rates, per-tile latency, and the effect of 5 tiles per answer on the single chat engine
(the 02b launch keeps chat's slots, so a tile call either takes a slot or queues behind chat; that needs a measurement, not a guess).
A 500 px thumbnail already is the smallest input the Commons API serves from its standard steps above 330 px; image tokens grow
with pixels, so the thumbnail-only call is the cheaper form and is what the harness sends. The 2B proxy above (catch 0.29 to 0.46 at false drop 0.10 to 0.12)
is a weak hint, not a prediction for the 8B.

## What is known and unknown

- Known (dev, one Mac): zero-shot name scoring with these three CLIP-family models and a 2B yes/no model cannot reach the marks. The
  failures are the "about the subject, not of it" tiles of section 1.1 of the design note, which these models also rate as the subject.
- Unknown: the 8B VL model; the engine-box speed; SigLIP 2 with its true logit scale; the lead-image similarity of section 2.2 (not run);
  larger CLIP variants (B/16, L/14) that may separate better but miss the speed mark; the person-presence side table for IMGQ-06 (not run).
- Caveats: kind-to-branch map and negatives were authored by looking at the dev subject list; 17 held-out bad tiles; search-engine tiles unavailable.
- Suggestion for the coordinator: do not build IMGQ-12c as written on these models. Next arms: the VL-8B yes/no pass above once a slot
  is free, and image-to-lead-image similarity (2.2) with the models already installed, both on the same scratch harness.

Scratch artefacts: `data-scratch/imgq-12a/` (git-ignored): manifest, tiles, venvs, embeddings, `results.json`, `vlm_out.json`.
