# IMGQ-12b: lead-image similarity bench, dev results (2026-10-12)

Result of item IMGQ-12b (arm 2.2 of `imgq-12-picture-design-2026-10-12.md`). Dev numbers only. The sealed IMGQ-11 set was not opened.
Verdict in plain words: this arm does not reach the bar. Used alone it is no better than the text arm of IMGQ-12a. Combined with the
text score by requiring both to agree, it catches most wrong tiles, but only by also dropping about half of the right ones, and on
the tuning questions a wrong tile still remains on 10 to 13 in 100 questions, against the bar of 1 in 40.

## Method

- Same 12a tiles, models (CLIP B/32, TinyCLIP 39M/16, SigLIP 2 base; ONNX Runtime CPU, same pinned files), tile embeddings and
  tuning/held-out split. Pre-registered in `data-scratch/imgq-12a/PREREG.md` (addendum "IMGQ-12b", written before any lead score).
- Lead image: the subject's English Wikipedia page image (action=query, prop=pageimages, 500 px thumbnail, redirects followed).
  Fetched 1 per second with the Home user agent, no 429. 50 of 54 thing subjects have one. Unavailable (tiles left out): Pikachu,
  Real Madrid, Jurassic Park, Manchester United F.C. (no page image). Persons never scored: the 8 person subjects (Blaine, Curie,
  Feldman, Obama, Serena Williams, Michael Jackson, Einstein, Taylor Swift) are excluded by rule. Note several lead images are
  logos or vector drawings (iPhone, Kindle, Switch, Star Wars, Stranger Things, Lakers), so for products and media the "lead" is
  not a photo.
- Tiles scored: 548 (378 tuning, 170 held-out). Bad tiles: 32 tuning, 9 held-out. Held-out intervals are very wide.
- Scores: L = cosine(tile, lead image). AND = drop only when L and the 12a text score A are both below the same quantile p of the
  right tiles. SUM = z(L) + z(A). Two points per score, thresholds from tuning only, applied unchanged to held-out: catch70
  and fd2 (right-tile false drop at most 2 percent on tuning).
- Twelve to fifteen tiles per model are the lead image itself or a near copy (cosine above 0.98); all are labelled right, as expected.

## Tile level, held-out (Wilson 95 percent in brackets)

Separation (AUC, bad versus right, tuning / held-out): L 0.80 / 0.81 (CLIP), 0.78 / 0.80 (TinyCLIP), 0.80 / 0.81 (SigLIP 2). The
12a text score A on the same tiles: 0.83 / 0.80, 0.83 / 0.83, 0.84 / 0.84. SUM: 0.83 / 0.81, 0.82 / 0.83, 0.83 / 0.85. The lead image
adds almost nothing over the text.

| model | score | catch70: catch | catch70: right dropped | fd2: catch | fd2: right dropped |
|---|---|---|---|---|---|
| CLIP B/32 | L | 0.56 [0.27,0.81] | 0.255 [0.194,0.327] | 0.11 [0.02,0.44] | 0.025 [0.010,0.062] |
| CLIP B/32 | SUM | 0.56 [0.27,0.81] | 0.155 [0.107,0.219] | 0.11 [0.02,0.44] | 0.031 [0.013,0.071] |
| CLIP B/32 | AND | 0.89 [0.56,0.98] | 0.584 [0.507,0.657] | 0.11 [0.02,0.44] | 0.012 [0.003,0.044] |
| TinyCLIP | L | 0.67 [0.35,0.88] | 0.224 [0.166,0.294] | 0.00 [0.00,0.30] | 0.000 [0.000,0.023] |
| TinyCLIP | SUM | 0.67 [0.35,0.88] | 0.199 [0.144,0.267] | 0.11 [0.02,0.44] | 0.037 [0.017,0.079] |
| TinyCLIP | AND | 1.00 [0.70,1.00] | 0.565 [0.488,0.639] | 0.11 [0.02,0.44] | 0.000 [0.000,0.023] |
| SigLIP 2 | L | 0.56 [0.27,0.81] | 0.205 [0.150,0.274] | 0.00 [0.00,0.30] | 0.000 [0.000,0.023] |
| SigLIP 2 | SUM | 0.67 [0.35,0.88] | 0.143 [0.097,0.205] | 0.11 [0.02,0.44] | 0.031 [0.013,0.071] |
| SigLIP 2 | AND | 1.00 [0.70,1.00] | 0.553 [0.476,0.627] | 0.00 [0.00,0.30] | 0.012 [0.003,0.044] |

At the 2 percent point every variant catches 0 or 1 of the 9 held-out bad tiles (tuning: 1 to 9 of 32, at most 0.28). The AND
catch70 point is the pre-registered "largest p that still catches 70 percent on tuning"; it lands at p near 0.4 to 0.5, which is why it drops
more than half of the right tiles. It catches the most, and costs the most.

## Question level (thing subjects only; 31 tuning questions, 18 held-out; wrong tile on a question before any check: 0.45 and 0.33)

| model, score, point | tuning wrong-question after | held-out wrong-question after [interval] | held-out kept | held-out coverage |
|---|---|---|---|---|
| CLIP L catch70 | 0.26 | 0.17 [0.00,0.33] | 0.94 | 0.06 |
| CLIP SUM catch70 | 0.23 | 0.17 [0.00,0.33] | 1.00 | 0.00 |
| CLIP AND catch70 | 0.10 | 0.06 [0.00,0.17] | 0.94 | 0.06 |
| TinyCLIP AND catch70 | 0.13 | 0.00 [0.00,0.00] | 0.89 | 0.11 |
| SigLIP 2 AND catch70 | 0.13 | 0.00 [0.00,0.00] | 0.94 | 0.06 |
| any model, fd2 | 0.35 to 0.45 | 0.28 to 0.33 | 0.97 to 1.00 | 0.00 |

The best cells (AND at catch70) reach 0 to 0.06 on the held-out questions, but the 18 questions cannot show a rate near 0.025 (zero of 18
is consistent with up to about 0.15), the tuning set at the same setting shows 0.10 to 0.13, and kept falls to 0.84 to 0.90 on
tuning (0.89 to 0.94 on held-out; bar 0.95). Those cells also drop 55 to 58 percent of right tiles, which is a poor picture count for a question that has few right tiles
(Notre-Dame, Stonehenge, Xbox, Pikachu have 1 to 2). With 10 or more candidates it may still leave a few, but that was not measured as a shown-picture count.

## Cost

Per tile the extra work is one dot product on an embedding 12a already computes (under 0.01 ms). Per subject one extra image encode
(same as a tile: CLIP 16 ms, TinyCLIP 17 ms, SigLIP 2 34 ms p50 on the M4 Pro CPU; cacheable by subject) plus one lead download
(about 1 second at the polite rate, or free if the pipeline already holds `leadImage`). Memory unchanged from 12a (1.1 to 1.9 GB resident).
Engine-box speed not measured.

## Verdict and next step

- Alone, lead-image similarity cannot reach the bar: at 2 percent right-tile loss it catches 0 to 11 percent of wrong tiles on held-out (9 tiles) and 3 to 25 percent on tuning.
- The AND combination reaches the question-level mark only on 18 held-out questions and only by discarding more than half of the right tiles; tuning does not confirm it (0.10 to 0.13, bar 0.025).
- Both arms of IMGQ-12 on small CLIP-family models are now measured and neither is worth building as IMGQ-12c. What is left from the design note is the VL-8B
  yes/no judge (12a, not run because no engine slot was free) and section 2.3 (Wikidata type constraints plus the IMGQ-13 entity fix, which targets the
  two worst IMGQ-11 failures, the wrong resolved entity). Wrong-entity questions are not something an image-to-image score can fix, since the lead image itself is of the wrong thing.
- Caveats: 9 held-out bad tiles; the lead-image source (page image) is sometimes a logo; a person-free subset only; kind-to-branch map as in 12a; scratch in `data-scratch/imgq-12a/` (`lead_fetch.py`, `embed_lead.py`, `score_lead.py`, `results_lead.json`, git-ignored).
