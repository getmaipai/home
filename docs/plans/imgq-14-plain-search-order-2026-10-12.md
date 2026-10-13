# IMGQ-14: plain search order against the current candidate order (2026-10-12)

Offline measurement, no production code changed. Question: is a plain search by exact subject name (the engine's own top 5)
more accurate than the current candidate order (Commons category plus depicts P180, which has no relevance rank)?

**Verdict: no. Leading with plain-search order is clearly worse than the current order, under strict and lenient judging, on
things and on the 9 dev persons. No arm comes near the bar (a wrong tile on at most 1 of 40 questions, clean rate 0.975).
The current order itself is at 0.80 clean on dev, so a picture checker or a better entity step is still needed; IMGQ-12a showed
the CLIP-family checkers do not supply it.**

## Method

- Data: the IMGQ-08 dev subjects, 43 tuning plus 27 held-out, 70 in all (9 persons, 61 others). Pre-registration:
  `data-scratch/imgq-14/PREREG-14.md` (with an addendum for what was added later).
- Arms, top 5 each: **A1** Commons search by exact name (`generator=search`, `gsrnamespace=6`, ordered by `index`);
  **A2** same with " photo" appended; **B** the household SearXNG, `categories=images`, adult safesearch, rows in returned order;
  **M** Commons MediaSearch ranking; **C** the current first 5 visible tiles from the IMGQ-08-era final capture.
- Home user agent, one request per second, no 429 seen. Pictures fetched as 500 px thumbnails.
- Judging: strict single judge, from contact sheets. Right means the picture is of the subject, as a picture of it; wrong subject,
  about-the-subject, logo, map, signature, crowd, related object, junk, or a person who cannot be confirmed count as not right.
  Existing IMGQ-08 labels were reused for tiles that already had one. A lenient pass (only wrong subject, junk, unsure, unreadable
  count as not right) is reported as a sensitivity check.
- Statistics: Wilson interval on tiles, subject-cluster bootstrap for the clean rate, paired cluster bootstrap for the
  wrong-question difference against C.

### The MediaSearch request

Reproduced from the extension's source (not called through the extension):

`format=json&uselang=en&action=query&generator=search&gsrsearch="filetype:bitmap|drawing -fileres:0 <term>"&gsrlimit=40&gsroffset=0&gsrinfo=totalhits|suggestion&gsrprop=size|wordcount|timestamp|snippet&prop=info|imageinfo|entityterms&inprop=url&gsrnamespace=6&iiprop=url|size|mime&iiurlwidth=500&wbetterms=label`

Its top 5 equals plain Commons search for 56 of 70 subjects, so M adds almost nothing over A1.

### SearXNG engines

Image engines enabled on the household instance: bing images, openverse, duckduckgo images, flickr, google cse images, pinterest,
wikicommons.images, brave.images. In practice brave, duckduckgo and google cse images were suspended or erroring, and pinterest and
flickr timed out intermittently, so the top-5 rows came only from bing, openverse and wikicommons.images. Plain `google` is
disabled. **No Google-class engine is working in the mix**, so Jesse's Google Images result is not reproduced by arm B. Bing is the
only accurate engine there (about 0.95 per tile); openverse and wikicommons.images are about 0.55. The DDGS sidecar returns web
text rows, not images, and was not used.

## Dev results

Tile precision (right of available) and question clean rate (no wrong tile in the top 5), 95 percent intervals in brackets.

| Arm | Tile precision, strict | Clean rate, strict | Tile precision, lenient | Clean rate, lenient |
|---|---|---|---|---|
| A1 exact name | 0.71 [0.66, 0.75] | 0.40 [0.29, 0.51] | 0.87 [0.83, 0.90] | 0.63 [0.51, 0.74] |
| A2 name + photo | 0.54 [0.49, 0.59] | 0.17 [0.09, 0.26] | 0.77 [0.72, 0.81] | 0.54 [0.42, 0.65] |
| B SearXNG | 0.71 [0.66, 0.76] | 0.31 [0.21, 0.43] | 0.86 [0.82, 0.89] | 0.63 [0.51, 0.74] |
| M MediaSearch | 0.71 [0.66, 0.76] | 0.40 [0.29, 0.51] | 0.87 [0.83, 0.90] | 0.63 [0.51, 0.74] |
| C current order | 0.94 [0.91, 0.96] | 0.80 [0.71, 0.89] | 0.94 [0.91, 0.96] | 0.80 [0.71, 0.89] |

Paired difference in the share of questions with a wrong tile, arm minus C (positive means the arm is worse), strict: A1 +0.40
[0.24, 0.56], A2 +0.61 [0.49, 0.73], B +0.49 [0.34, 0.61], M +0.40 [0.26, 0.54]. Lenient: A1 +0.17 [0.01, 0.33], A2 +0.26 [0.11, 0.40],
B +0.17 [0.03, 0.30], M +0.17 [0.03, 0.33]. Every interval is above zero. Per subject, A1 beat C on 6 subjects and lost on 34.

Splits (strict clean rate): tuning A1 0.44, B 0.33, C 0.84; held-out A1 0.33, B 0.30, C 0.74. Under lenient judging the held-out
split is the one place plain search catches up (A1 0.78, M 0.74, C 0.74), because the held-out subjects are mostly single things;
the tuning split still favours C (0.84 against 0.53 to 0.58).

### Things and persons separately

| Group | Arm | Tile precision, strict | Clean, strict | Tile precision, lenient | Clean, lenient |
|---|---|---|---|---|---|
| things (61) | A1 | 0.71 | 0.41 | 0.87 | 0.66 |
| things (61) | B | 0.71 | 0.34 | 0.86 | 0.64 |
| things (61) | C | 0.96 | 0.80 | 0.96 | 0.80 |
| persons (9, 45 tiles) | A1 | 0.69 [0.54, 0.80] | 0.33 | 0.87 [0.74, 0.94] | 0.44 |
| persons (9) | A2 | 0.62 | 0.11 | 0.80 | 0.44 |
| persons (9) | B | 0.69 | 0.11 | 0.87 | 0.56 |
| persons (9, 25 tiles) | C | 0.76 [0.57, 0.89] | 0.78 | 0.76 | 0.78 |

Persons are reported as a measurement only; the private-person rule stays at zero and is not being changed. Nine subjects is too
few for any conclusion: under lenient judging plain search on persons (0.87) is above C's tile precision (0.76), but C has only
25 visible person tiles because the private-person rule removes the rest, and the intervals overlap. Plain search shows people
who cannot be confirmed (crowds, event photos), which is the case the private-person rule exists for.

### What the rows show

- Plain search fails on ambiguous names and media subjects (franchises, characters, products named like other things). The
  worst subjects are names with a second meaning, where the top 5 is a different thing entirely.
- It wins on a few single-thing subjects with an unambiguous name (Machu Picchu, iPhone, Kindle, Petra, pizza, and Einstein
  for A1). Those are the subjects the current order already gets right most of the time.
- Adding " photo" makes Commons search worse (0.54), the opposite of Jesse's manual impression for one person query; it pulls in
  files with "photo" in the title, not better photos. That impression was a single subject.
- Jesse's Statue of Liberty check holds (Commons top 5 are right); the dev average does not follow from single cases.

## Does either order reach the bar alone?

No. Plain search reaches 0.31 to 0.40 clean strict (0.63 lenient) against 0.975. The current order reaches 0.80. Reaching the
bar needs a picture checker on top of whichever order is used, and the IMGQ-12a CLIP-family models missed their marks, so that
part is still open (the Stack VL-8B pass is not yet run).

## Caveats

- Arm C is the IMGQ-08-era final capture, not a dedicated IMGQ-10 dev capture, and its labels came from an earlier pass whose
  strictness may differ from this one. Single judge, small sample (70 subjects, 9 persons), strict rule conservative on
  group photos and cosplay. SearXNG engine health varied during the run and no Google-class engine answered. DDGS is not an image source.
  The earlier per-tile 0.92 and 0.91 figures in the brief are of the current order; here it is 0.94 on dev.

## Sealed set (IMGQ-11), read-only final line

Run once after the dev numbers and verdict were fixed, tiles judged strictly under the same rule, nothing changed afterwards. The
67 sealed subjects are now development data (IMGQ-13), so this is a last check, not a new test. A1 tile precision 0.72
[0.67, 0.77], clean 0.34 [0.22, 0.46] (44 of 67 questions with a wrong tile); B 0.75 [0.70, 0.79], clean 0.40 [0.28, 0.52] (40 of 67);
C (IMGQ-11 after-capture) 0.91 [0.87, 0.94], clean 0.76 [0.64, 0.86] (16 of 66). Paired wrong-question difference against C:
A1 +0.42 [0.28, 0.55], B +0.36 [0.21, 0.51]. Persons (10): A1 0.78 precision, B 0.60, C 0.92; clean A1 0.40, B 0.20, C 0.80.
Same direction and size as dev.

Scratch artefacts: `data-scratch/imgq-14/` (git-ignored): queries, tiles, contact sheets, labels, `analyze.py`, results JSON.
