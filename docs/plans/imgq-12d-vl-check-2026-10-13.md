# IMGQ-12d: can the app's vision model filter answer-picture tiles? Dev results (2026-10-13)

Result of item IMGQ-12d, the "VL-8B yes/no judge" arm left open by `imgq-12a-bench-results-2026-10-12.md` and
`imgq-12b-lead-image-2026-10-12.md`. Dev numbers only. The sealed IMGQ-11 and IMGQ-15 sets were not opened.

Verdict in plain words: it does not reach the bar. Qwen3-VL-8B-Instruct separates wrong tiles from right ones about as well as the small
CLIP-family models did (AUC 0.81 tuning, 0.80 held-out; they scored 0.80 to 0.84), not better. Asked "does this picture clearly show X as the
main thing?" and dropping every "no", it drops 17 percent of right tiles on tuning, 13 percent held-out, and catches 67 percent of wrong tiles on
tuning but only 41 percent held-out (17 tiles). After the check a wrong tile is still left on 27 in 100 questions (35 in 100 held-out), against
the bar of 2.5 in 100. At the 2 percent right-tile loss point it catches 6 percent of held-out wrong tiles. The picture-reading model is also
about five times slower than the speed mark on the machine it was run on.

## Method

- Model: the app's pin, `qwen3-vl-8b-instruct-q4-k-m` with its Q8_0 projector, same revision (f982a075) and sha256 as `modelCatalog.ts`; both
  hashes checked after download. Licence: Apache-2.0 (Hugging Face model card tag `license:apache-2.0`, and the catalog record).
- Engine: llama-server b10797 (the app's pinned build) with the Stack's flags for a picture-reading model (`--mmproj`, `--image-max-tokens 2560`,
  `--parallel 1`, `--jinja`, `--reasoning off`, `-fa on`, q8_0 KV cache, 4,096 context, all layers on the GPU).
- Where it ran, and why not the engine box: both engine-box GPUs were already at 6.3 and 6.6 GB of 8 GB with two resident 9B servers (one is the
  household's coding-model service, the other another bench's slot on 8773), so a 5 GB model plus projector could not be loaded without
  stopping someone else's work. Port 8771 on the Mac is the live hub's tunnel to the Stack, so it was not used. The model was served on the Mac (M4 Pro,
  Apple Metal) on port 8781, with a lane lock held and removed afterwards. Same weights and build, so the answer quality transfers; the speed and memory
  numbers below are for the Mac and are not a measurement of the box.
- Data: the same 12a dev tiles (500 px Commons thumbnails, tuning = 43 subjects, held-out = 27 subjects) and the same labels. 645 tiles
  answered (the 12a note's 643 plus two truncated files the model still decoded; the paired comparisons use the 643 12a tiles). Tuning: 410 right,
  39 bad. Held-out: 179 right, 17 bad. Same marks as 12a; they were not moved.
- Question, fixed in `PREREG.md` (addendum IMGQ-12d, sha256 prefix 564b42f6e2fec87986ae579d3f87a66e4a4d59ed9efd35dc440a25d63d950480, written before the first answer): "Does this picture clearly show {subject} ({kind}) as the main thing? Answer only yes or no."
  One tile per call, thumbnail as the only image, temperature 0, two tokens. All 645 answers began with yes or no.
- Points: fixed (drop on "no", nothing tuned); catch70 and fd2 on the probability of "no" (threshold from tuning only, applied unchanged to held-out).
  The model is so confident that fd2 needs a threshold of 0.999999, and catch70 lands at 0.47 so it is almost the same decisions as the fixed point.
- Intervals: Wilson 95 percent for tile rates, subject-cluster bootstrap 95 percent (500 draws) for question rates and for the paired differences.

## Tile level, fixed point ("no" drops the tile)

Catch = wrong tiles dropped. FD = right tiles dropped (1 minus recall of "yes"). Precision of "yes" = share of kept tiles that are right.
Precision of "no" = share of dropped tiles that really were wrong.

| set | catch | FD (right dropped) | recall of yes | precision of yes | precision of no |
|---|---|---|---|---|---|
| tuning | 0.667 [0.510,0.794] | 0.173 [0.140,0.213] | 0.827 [0.787,0.860] | 0.963 [0.938,0.978] | 0.268 [0.190,0.364] |
| held-out | 0.412 [0.216,0.640] | 0.134 [0.092,0.192] | 0.866 [0.808,0.908] | 0.939 [0.892,0.967] | 0.226 [0.114,0.398] |
| all dev | 0.589 [0.459,0.708] | 0.161 [0.134,0.193] | 0.839 [0.807,0.866] | 0.956 [0.934,0.970] | 0.258 [0.190,0.340] |

Three in four dropped tiles are right tiles (precision of "no" 0.26). By label over all dev: wrong subject 25 of 40 dropped, private person 4 of 8, junk 4 of 8.
catch70 point: held-out 0.412 catch, 0.134 FD (identical to fixed on held-out); tuning 0.692 catch, 0.173 FD. fd2 point: tuning 0.231 catch at 0.022 FD,
held-out 0.059 [0.010,0.270] catch at 0.022 [0.009,0.056] FD, all dev 0.179 catch at 0.022 FD.

### By how the tile was found

Source is read from which Commons query in the IMGQ-08 capture returned the file. The SearXNG stratum is unavailable, not zero: 12a never fetched
pixels for the 165 search-engine rows (they are web pages, not image files). Held-out tiles all came through the category listing.

| source (all dev unless noted) | tiles (bad) | catch | FD | precision of yes |
|---|---|---|---|---|
| Commons category | 423 (37) | 0.568 [0.409,0.713] | 0.168 [0.134,0.209] | 0.953 [0.924,0.971] |
| Commons category, held-out | 185 (17) | 0.412 [0.216,0.640] | 0.143 [0.098,0.204] | 0.935 [0.885,0.964] |
| Commons depicts (P180) | 175 (18) | 0.611 [0.386,0.797] | 0.178 [0.126,0.246] | 0.949 [0.898,0.975] |
| found by both | 32 (1) | 1 of 1 | 0.065 [0.018,0.207] | 1.000 [0.883,1.000] |
| unknown (no query recorded) | 15 (0) | n/a | 0.000 [0.000,0.204] | 1.000 [0.796,1.000] |
| SearXNG | unavailable | | | |

Category and depicts do not differ (intervals overlap fully); depicts tiles in this data are all tuning subjects.

### People and things

| group | tiles (bad) | catch | FD | precision of yes | recall of yes |
|---|---|---|---|---|---|
| things, all dev | 576 (44) | 0.614 [0.466,0.743] | 0.147 [0.119,0.179] | 0.964 [0.943,0.977] | 0.853 [0.821,0.881] |
| things, held-out | 181 (10) | 0.300 [0.108,0.603] | 0.123 [0.082,0.180] | 0.955 [0.911,0.978] | 0.877 [0.820,0.918] |
| people, all dev | 69 (12) | 0.500 [0.254,0.746] | 0.298 [0.195,0.427] | 0.870 [0.743,0.939] | 0.702 [0.573,0.805] |
| people, held-out | 15 (7) | 0.571 [0.250,0.842] | 0.375 [0.137,0.694] | 0.625 [0.306,0.863] | 0.625 [0.306,0.863] |

For people the model drops three in ten right tiles (a face shown small, a group, a stage photo read as "not clearly the main thing") and catches half the wrong ones. Held-out people has 15 tiles; treat it as a hint.

## Question level: the clean-question rate if "no" tiles are dropped

A question is a subject with all its labelled candidate tiles. Clean = no wrong tile left. Bar: wrong-question after at most 0.025 with kept at least 0.95.

| set | questions | wrong before | wrong after | clean rate | kept | coverage (all tiles dropped) |
|---|---|---|---|---|---|---|
| tuning | 39 | 0.487 | 0.231 [0.103,0.359] | 0.769 | 0.949 [0.872,1.000] | 0.051 |
| held-out | 23 | 0.391 | 0.348 [0.174,0.565] | 0.652 | 1.000 | 0.000 |
| all dev | 62 | 0.452 | 0.274 [0.161,0.387] | 0.726 | 0.967 [0.917,1.000] | 0.032 |

Best case is a clean rate of 0.77, which is far from 0.975. At the 2 percent loss point the clean rate is 0.62 (all dev), only 0.17 above doing nothing.

## Against the 12a and 12b marks (paired, same tiles, subject-cluster bootstrap 95 percent)

Differences are VL minus the other model, in catch and in right tiles dropped. The other models use their own tuned points from 12a.

| comparison (same operating idea) | scope | catch difference | right-tile-drop difference |
|---|---|---|---|
| VL fd2 vs SigLIP 2 C fd2 (both about 2 percent loss) | held-out | -0.353 [-0.586,-0.080] | -0.006 [-0.037,+0.019] |
| VL fd2 vs SigLIP 2 C fd2 | all dev | -0.089 [-0.216,+0.061] | -0.002 [-0.013,+0.008] |
| VL fixed vs CLIP B/32 A catch70 | held-out | -0.235 [-0.500,+0.080] | -0.096 [-0.171,-0.022] |
| VL fixed vs CLIP B/32 A catch70 | all dev | -0.089 [-0.224,+0.034] | -0.049 [-0.087,-0.015] |
| VL fixed vs TinyCLIP A catch70 | held-out | -0.353 [-0.550,-0.143] | -0.096 [-0.170,-0.025] |
| VL fixed vs SigLIP 2 C fd2 (different loss levels) | all dev | +0.321 [+0.176,+0.480] | +0.138 [+0.099,+0.180] |

At the same 2 percent loss the VL model catches fewer wrong tiles than SigLIP 2 (clearly on held-out). At the loose "catch most" point it drops
fewer right tiles than CLIP and TinyCLIP (about 10 points fewer on held-out) but also catches fewer wrong ones; the intervals on catch include zero for CLIP
on all dev. In short it sits on the same trade-off curve as the small models rather than above it. AUC bad-versus-right: VL 0.81 / 0.80 (tuning / held-out);
12a text arms 0.80 to 0.84; 12b lead-image arm 0.78 to 0.81.

## Cost (Mac M4 Pro, Metal, one tile per call, hub and other apps running)

- Time per tile (whole call: base64 upload, image encode, two tokens): p50 0.81 s, p95 5.7 s, mean 1.6 s, 1,039 s for 645 tiles. Mark was p50 150 ms (the CLIP-family models ran 16 to 34 ms): about 5 times over at p50, 38 times at p95 (large images take up to 2,560 image tokens). Five tiles per answer is about 4 s at p50 and 8 s at the mean if called one after another, or the same load as five extra chat turns if they share the chat engine's single slot.
- Memory: llama-server resident 3.8 GB rising to 3.9 GB, with the weights memory-mapped on top (model file 5.0 GB, projector 0.75 GB; the unified-memory total was not metered separately, so treat the real footprint as about 6 to 7 GB). The engine box was not measured: it cannot hold this model beside its two resident 9B servers.
- Licence: Apache-2.0, no licence blocker.

## What was measured and what was not

- Measured: the yes/no judge on 645 dev tiles, three operating points, source and people strata, question-level clean rate, paired comparison with the 12a arms, Mac speed and resident memory.
- Not measured: the engine box (speed, memory, effect on the chat slot); SearXNG tiles (no pixels); any prompt other than the one fixed in advance (a longer, subject-specific rubric might move the numbers, but that would be a new pre-registered arm); the model fine-tuned or with a different image size; the sealed sets.
- Caveats: 17 held-out wrong tiles, so held-out intervals are wide; both splits' conclusions point the same way on the AUC and at the 2 percent point. The kind field comes from the capture, as in 12a.
- Takeaway for the coordinator: the VL-8B judge does not close the gap. Its errors are the same "about the subject, not of it" tiles (a poster, a related person, a logo) plus many good-but-small subjects it calls "not the main thing". The remaining design arm is section 2.3 of the IMGQ-12 note (Wikidata type constraints and the IMGQ-13 entity fix), which acts before a tile is chosen.

Scratch (git-ignored): `data-scratch/imgq-12a/` (`vl12d_run.py`, `vl12d_score.py`, `vl12d_out.json`, `results_vl12d.json`, `sources.json`, `vl8b/`, `PREREG.md` addendum).
