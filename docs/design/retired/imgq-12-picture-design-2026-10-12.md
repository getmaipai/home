> **Retired 2026-10-17.** Why: its four arms (12a, 12b, 12d, 14) were benched and none reached the bar; IMGQ-16 closed the plan with the setup that runs now. Replaced by [IMGQ-16, the final picture setup](../../plans/imgq-16-final-picture-setup-2026-10-13.md); the bench results stay in docs/plans.

# IMGQ-12: breaking the loop on answer pictures (design note, 2026-10-12)

A written design, no code. Asked for after four IMGQ cycles (IMGQ-03, 08, 09, 10) of metadata veto rules in
`backend/src/lib/answerImages/relevance.ts` each fixed a few wrong tiles and exposed new ones. Goal, in the owner's words:
pictures shown when they should be, the proper amount, and the correct ones. Bars: a wrong-subject tile visible on at most
1 of 40 questions, a private person on 0, an offer recall of 0.80 on who-is and what-is questions (plain wording 0.35,
reworded 0.54 today).

Scope boundary: IMGQ-09 (tool description plus few-shot, for offer recall) and IMGQ-11 (a fresh sealed subject set,
60 or more subjects, never tuned on) are running elsewhere. This note depends on IMGQ-11's set and reads IMGQ-09's result;
it duplicates neither. Nothing here edits production code, and no engine port was used: every number below comes from the
captured data under `data-scratch/chat-ab/imgq-08-2026-10-12/` (43 tuning subjects, 27 held-out subjects, labels keyed by
Commons file page) and the IMGQ-09 logs.

Rules read first: `docs/design/RULES.md` (0, 1, 6, 6a, 11, 13), the org `RULES-AND-LEARNED-COMPONENTS.md`, `PRIVACY.md`,
`RELEASES-AND-DEPENDENCIES.md`, `data-scratch/design/IMG-CATEGORY-ARCHITECT-REPORT.md` (2026-10-09, shadow APPROVED, veto
REJECTED until measured) and the backlog rows IMG-VISION-BENCH-01, IMG-VISION-SHADOW-01, IMG-VISION-VETO-01, IMGQ-06.

## 1. Root cause: why rule-by-rule filtering does not converge

### 1.1 The remaining wrong tiles are indistinguishable in the text the rules read

Every veto in `relevance.ts` reads metadata text: the file title, the description, the object name, the visible category
names, the host. The pipeline's own two-signal agree rule then asks whether that text names the subject. I tabulated the
labelled tiles of both captures against exactly that text (title, ImageDescription, ObjectName, category titles; "names
the subject" means every word of the subject longer than two letters appears):

| set | label | names the subject | does not | search row (no Commons text) |
|---|---|---|---|---|
| tuning (43 subjects) | right | 384 | 21 | 81 |
| tuning | wrong_subject | 20 | 5 | 0 |
| tuning | private_person | 5 | 1 | 0 |
| tuning | junk | 8 | 0 | 1 |
| held-out (27 subjects) | right | 158 | 10 | 126 |
| held-out | wrong_subject | 15 | 0 | 2 |
| held-out | private_person | 2 | 0 | 0 |

35 of 42 wrong-subject tiles (83 percent) and 7 of 8 private-person tiles name the subject in the very text the rules
use, while 31 right tiles do not. The name signal has no separating power left on the hard remainder, and every rule that
tightens it drops right tiles (IMGQ-08 measured 10 right dropped for 4 wrong caught, 2.5 to 1 the wrong way).

Read the survivors by eye and the pattern is one thing: each is a picture *about* the subject, not a picture *of* it.

- Xbox Series X: a controller, in the subject's own category.
- Apple Watch: an iPhone beside one, found through the depicts (P180) statement, which is true as stated.
- Machu Picchu: the railway station named after it, in the `Machu Picchu` category.
- Petra: an aircraft "going to Petra", in `Petra, Jordan`.
- AirPods: white boxes on an Apple Store shelf, category `AirPods`.
- Albert Einstein: a library entrance with his quote on a slab, and a 1933 group portrait with a named host family
  (the private-person leak), both in category `Albert Einstein`.
- Taylor Swift: the Taylor Swift Education Center building, category `Taylor Swift`.
- Real Madrid: a 1959 match crowd, category `Matches of Real Madrid C.F. at Santiago Bernabéu Stadium`.
- pizza: an assorted baked-goods tray, categories `Pizzas` and `Pastries`.
- Pikachu: a children's video page from image search.

Whether the subject fills the frame is a pixel fact. Commons metadata records what a file is connected to, and the
uploader's category choices are correct for every one of the files above. No text rule can tell "a controller for the
Xbox" from "the Xbox" because both carry the same words; the only rule that would is "controller", which is the next
closed vocabulary, and the one after that is "station", "aircraft", "boxes", "quote", "center", "match", "tray".

### 1.2 The method is the loop

Each cycle was authored on named failures from the 43-subject tuning set, as closed word lists (about 20 regex lists
today). The transfer numbers are the signature of fitting the tuning set: tuning wrong tiles 7 to 1 across IMGQ-08, the
held-out 10 to 7 (IMGQ-08) to 4 (IMGQ-10), paired difference for IMGQ-10 of minus 0.111 with a 95 percent interval of
[minus 0.296, plus 0.074], which includes zero. The org learned-components rule says it in one line: three phrasings is a
classifier. Twenty lists are a hand-trained classifier over the wrong feature.

### 1.3 The sources cap precision below the bar

Per-tile precision by source over both captures (a file can come from several sources; labels right against everything
else):

| source | right | not right | per-tile precision |
|---|---|---|---|
| Commons category members | 417 | 36 | 0.92 |
| Commons depicts (P180) | 187 | 19 | 0.91 |
| SearXNG image search | 207 | 3 | 0.99 |

The bar is a wrong tile on at most 1 question in 40 (0.975 clean questions). With 5 visible tiles drawn independently,
a clean question needs per-tile precision of about 0.995; at 0.92 the expected clean share is 0.66, at 0.97 it is 0.86.
Metadata rules have moved the Commons sources from roughly 0.92 toward 0.96 and cannot reach 0.995, because at that level
the remaining errors carry the same text as right tiles (1.1). Closing the last gap needs a signal the sources do not
provide: the picture itself.

Two side findings. Search rows are the most precise source but run only for adults and never for a person; their two
errors were the Pikachu video page and a fan wallpaper, both host and page facts. And the private-person leak (Einstein's
1933 group portrait) is a group photo of a famous person with named private people: a face-count fact, again pixels.

### 1.4 Recall is a different problem with a different owner

Offer recall (0.35 plain, 0.54 reworded) is whether the model calls `show_images` at all. The IMGQ-09 logs show the
pipeline yielding pictures on nearly every call that passed the gates (Eiffel 12 found, 5 visible; Switch 10, 5; koala 5, 5)
and a gated zero where designed (child band, minor subject, household name, no article). Precision work must not touch
offer recall, and this note leaves it to IMGQ-09 (section 2.5 names the one backstop and its rule conflict).

## 2. Candidates on merit, each checked against the rules

Constraints held throughout: local only, nothing leaves the home, no cloud API, no Ollama, every model fetched by the
Stack pinned by revision and checksum with its licence recorded (rule 11, `RELEASES-AND-DEPENDENCIES.md`), a privacy-page
row for the download (`PRIVACY.md`), logs carry numbers never titles, URLs or hashes (rule 6a), and a failed check keeps
today's behaviour, never an empty answer (rule 6).

### 2.1 A local zero-shot vision check on each tile (image-text model)

The tile and a small set of text prompts go through a CLIP-family model; the tile is scored for "a photo of {subject}"
and "a photo of a {expected class}" against a closed set of negatives ("a game controller", "packaging or a box", "a sign
or a plaque with text", "a crowd of people", "a building exterior", "a document or screenshot", "a map", "a logo", plus
the class-specific near misses from section 2.3). Scores and a yes/no/unknown per tile.

Models that run on a CPU or an 8 GB GPU (sizes are the published parameter counts and the fp16 weight size; speeds are
the only measured number on file, from the category report, and are flagged in section 4):

| model | params | weights (fp16) | licence | note |
|---|---|---|---|---|
| OpenAI CLIP ViT-B/32 | 151 M | about 300 MB | MIT | 77 to 115 ms per image on an M4 Pro CPU (category report); weakest of the four on fine distinctions |
| Google SigLIP 2 base patch16-224 | 203 M | about 400 MB | Apache-2.0 | best zero-shot accuracy at this size; sigmoid scores are per-prompt, so "unknown" is natural; ONNX export exists but its transformers.js path is unverified |
| Microsoft TinyCLIP ViT-40M/32 | 40 M | about 80 MB | MIT | distilled from CLIP; fastest at near CLIP B/32 accuracy |
| Apple MobileCLIP-S0 | 11 M image, 42 M text | about 100 MB | Apple ML research model terms (commercial use to verify) | phone-class speed; licence is the open question |

Runtime: ONNX Runtime (MIT) under the Stack as a `picture-judge` role, same shape as `embeddings` (a resident process
with a request API), CPU execution provider by default, CUDA or CoreML when the Stack already has it. Expected cost on the
hub: under 150 ms per tile on CPU for the two small models, run in parallel with the 2.5 s fetch window on the tiles as
they arrive, so it adds nothing visible to the turn when it keeps pace and is skipped past the deadline.

Rules. Rule 11: a model may run only as a Stack-installed, pinned, tested component, so this is a Stack capability, never
an in-process model in Home (the category report reads rule 11 the same way). Org learned-components rule: it is a learned
component, so it starts as a shadow (two numbers per tile, drops nothing), is adopted only when its measured false-drop
rate beats the rules it replaces, and never sits in the safety, consent or privacy path (section 3 keeps the band, minor,
household-name and no-article gates deterministic and before it). Rule 1 bars a word rule or classifier on open-ended
wording in the turn; this classifies pixels inside a tool's implementation after the model chose the tool, so it does not
touch routing, but the same shadow-first discipline applies. Rule 0: it can only remove tiles, so it never loosens an age
gate; the first veto still goes to adults only, because that is where the owner's word covers a change in what is seen.
No rule conflict; the backlog already holds IMG-VISION-BENCH-01, IMG-VISION-SHADOW-01 and IMG-VISION-VETO-01 for exactly
this, and section 3 reuses those rows.

### 2.2 Image-embedding similarity to the subject's lead image

The same model's image tower embeds the Wikipedia lead image (P18, already fetched as `leadImage`) and the first few
depicts files; each candidate's cosine to that prototype is a second score. For things it says "this looks like the
pictures the article chose" and separates the Xbox from its controller, the watch from the phone, the ruins from the
station, with no text at all. For a person it would compare faces, which is an identity check the org rules refuse; so
thing subjects only, never a person subject, and `kind`-independent since the branch comes from Wikidata (2.3).

Rules: the same as 2.1 (it is the same model), plus the explicit "never a person-subject similarity" from
IMG-VISION-SHADOW-01. It is cheap once 2.1 exists (one extra embedding per tile, already computed). Weakness: a product's
packaging and a plush of a character embed close to the real thing, so it orders well and vetoes badly alone; in section 3
it orders, and vetoes only when 2.1 agrees.

### 2.3 Wikidata type constraints

The resolver already fetches `claims` for the subject (every wbgetentities response in both captures carries P31; 89 and
55 claims respectively). Today those claims gate only the minor and media checks. The expected class should come from
P31/P279 (and P105 taxon rank for animals, Q5 for a human), never from the model's `kind` argument, and drive: the class
prompt of 2.1 ("a photo of a game console", "a photo of a mountain", "a photo of a red panda"), the branch (human: face
rules and no similarity; taxon: animal prompts; media: poster or still; place: exterior or landscape; product: product
photo), and a closed table of near-miss negatives per class (console: controller, box, game case, screenshot; place: station,
airport, signage, map; person: building, plaque, grave, statue, crowd; food: ingredients, menu, packaging; team: stadium
exterior, crowd, crest).

Rules: a closed table over a third-party structured source is exactly what rule 1 allows; it needs no model and no
shadow. Alone it adds nothing (the wrong tiles are already in the right class by text); its value is making 2.1 precise
and making `kind` irrelevant to correctness. No conflict.

### 2.4 Fewer but certain tiles

Show three tiles (today's `CORE_TILES`) and fill to five only when the evidence is strong. With source precision 0.92,
three independent tiles give 0.78 clean questions against 0.66 for five: a real gain, not the bar. Its proper form is
not a lower ceiling but a confidence-ordered gallery: the lead image first, then tiles both named and depicted, then
depicted or category only, and the visible count follows how many tiles the vision check said yes to. This is already
what rule 6's "failed tool never fails the answer" wants when the judge is unavailable: three ordered-by-metadata tiles.

Rules: none touched. On its own it trades recall of tiles (the "proper amount") for precision and would make the owner's
first goal worse on questions where five right pictures exist; so it is a fallback shape and the shadow's ordering, not
the design.

### 2.5 A recall backstop

Two shapes. (a) A pipeline-side backstop: when the model answered a who-is or what-is question without calling
`show_images`, a text embedding score over the user's words triggers the picture lookup anyway. Rule 1 allows exactly one
embedding rescue, for search (text with no tool call and a score above threshold, admin can switch it off); a second
rescue for pictures is a rule change, so this note reports it and does not design it: if IMGQ-09's few-shot change cannot
reach 0.80 on the held-out split, the choice between a rule change (a picture rescue beside the search rescue) and
accepting the ceiling is the owner's. (b) A tool-side backstop with no rule issue: when the model does call the tool and
the Commons path yields fewer than three tiles for an adult thing subject, search already fills; for a person subject
search is barred and nothing fills, which IMG-PIPE-BENCH-01 measures. Nothing here changes.

### 2.6 Face count for person subjects

The private-person leak and the group-portrait junk are both "more than one face". YuNet (OpenCV model zoo, Apache-2.0,
about 230 KB ONNX, runs inside the `opencv-js` build the dedupe already loads) counts faces; for a person subject a tile
with more than two faces, or with no face at least a tenth of the frame, goes last and, after measurement, out. IMGQ-06
holds this behind the owner's question 1 (a face model in the product); the learned-components rule bars it from being
what the privacy promise rests on, so the deterministic household-name and no-article gates stay the promise and the
face count is an extra restriction on top. Reported here as the one check that targets the private-person bar directly;
it stays IMGQ-06's item and the owner's call.

### 2.7 Rejected without a bench

A COCO detector or ImageNet classifier (closed label sets that do not contain "Xbox"); the chat model reading tiles
(Qwen3-VL-8B is a 15 s round trip per tile on this hardware and holds the chat slot); any wrong-person or identity check;
a sixth cycle of metadata rules; a Commons upload-date or uploader heuristic (not a subject signal).

## 3. Recommendation

Stop adding metadata rules now: the next rule costs more right tiles than it saves (1.1) and cannot reach the bar (1.3).
Build one picture judge, shadow it, measure it on the sealed set, then promote it, and retire the metadata rules it makes
redundant. The judge is 2.1 plus 2.2 driven by 2.3, with 2.4 as its ordering and its unavailable-fallback. Expected
end state: the relevance module keeps the deterministic gates (band, minor, household name, no article, personal and
stock hosts, non-photo property, restriction) and a short name match, and the judge decides what fills the frame.

### 3.1 Order of work

1. **Freeze.** No new vocabulary list or veto in `relevance.ts` until the bench in item 2 reports (a backlog note, not
   code). Each existing veto gets a counter if it lacks one (org rule: a rule needs a counter and a row).
2. **Offline bench (IMG-VISION-BENCH-01, as filed, with the inputs below).** Fetch the labelled tiles of the IMGQ-08
   captures as pixels (about 1,100 Commons thumbnails at a person's pace, 1 per second, into git-ignored scratch; the
   replay bench today uses synthetic pixels so this is the first time the labels meet real images) and score them with the
   four models of 2.1 through plain ONNX Runtime in a scratch script. Fix the prompts, the class table and the thresholds
   on the tuning capture only. Report per model: catch rate on wrong and private tiles, false drops on right tiles with
   Wilson 95 percent intervals, unknown rate, ms per tile on CPU for this Mac and for the 8 GB engine box, and the same
   numbers with the lead-image similarity added. Pick the model by false drops at a fixed 70 percent catch, then by speed.
3. **Stack capability `picture-judge`** (stack repo; small M): ONNX Runtime, the chosen model pinned by revision and
   sha256 with the licence recorded, a request that takes image bytes plus text prompts and returns scores, a CPU default,
   and the privacy row. Tested like `embeddings`.
4. **Home shadow (IMG-VISION-SHADOW-01, as filed):** after the relevance vetoes, for every surviving tile, the judge's
   class score, subject score, negatives, and lead similarity (things only) are logged as numbers with a
   `picture_judge:<yes|no|unknown>` counter; nothing dropped, ordered or gated; off when the Stack lacks the role; skipped
   past the fetch deadline (rule 6).
5. **Sealed measurement** (section 3.2) on the IMGQ-11 set.
6. **Promotion (IMG-VISION-VETO-01, as filed, needs the owner's word):** ordering for every band (ordering changes nothing
   a gate decided), veto for adults; teen and child veto after a second sealed run on child-band questions. Visible count:
   the lead image plus every judged-yes tile up to the ceiling, minimum three ordered tiles when the judge is unavailable.
7. **Retire:** each metadata veto whose counter shows no unique catch (a tile the judge would not also have caught) over
   the sealed run and two weekly reports is deleted, with its lists; the `relevance.ts` header changes from "nothing is
   learned" to the measured truth.

### 3.2 Pre-registered measurement

Set: the IMGQ-11 sealed subjects (`data-scratch/chat-ab/imgq-11-2026-10-12/subjects.json`, sha256
`6ef26bcc...eb25`, 60 or more subjects), labelled by its builder, never seen by the tuning in item 2. The bench
is the captured-replay form (`answer-images-replay.ts` with real tile bytes from the IMGQ-11 capture), paired per
subject: arm A is today's pipeline, arm B is today's pipeline plus the judge as a veto and ordering. Because the judge is
deterministic on fixed bytes, repeats cover the live variation: three fresh live captures of the sealed set on three
different days at a person's pace, each replayed through both arms; the statistic is the share of subjects with a
wrong-subject tile visible, paired bootstrap 95 percent interval on the A minus B difference, with the tile-level false
drop rate and the mean visible count beside it. The thresholds, prompts and class table are committed before the first
sealed capture, with the sha256 of that commit in the done report.

Pass marks (all must hold):

- wrong-subject tile visible on at most 2.5 percent of subjects in arm B (the 1-in-40 bar), and the paired A minus B
  interval excludes zero;
- private person visible: 0 in every repeat;
- right tiles dropped by the judge: at most 2 percent of arm A's right visible tiles, upper 95 percent bound at most 4 percent;
- mean visible count on subjects where arm A showed pictures drops by no more than 0.5 tile, and no subject that showed
  pictures in A shows none in B;
- judge time: p50 under 150 ms and p95 under 400 ms per tile on CPU on the engine box; the share of turns where the
  judge missed the deadline under 5 percent;
- unknown rate under 10 percent (unknown keeps the tile).

Fail: the design is closed with its numbers in `docs/dev.md`; the fallback shape of 2.4 (three confidence-ordered tiles)
is measured next, alone, by the same protocol.

### 3.3 Buildable items

Each S or small M, own worktree, commit only, and the gate's scope line in the done report.

- **IMGQ-12a (S, bench, Sonnet reads the numbers):** fetch the IMGQ-08 labelled tiles as pixels into scratch at a
  person's pace; score with the four models through ONNX Runtime in a scratch script; the table of section 3.1 item 2 in
  `docs/dev.md`. Accept: every labelled tile scored or listed as unavailable; intervals shown; prompts, class table and
  thresholds written to a scratch `PREREG.md` with its sha256 before IMGQ-12e. Supersedes the inputs line of
  IMG-VISION-BENCH-01, nothing else.
- **IMGQ-12b (S):** the Wikidata class table: P31/P279/P105/Q5 to expected class, branch and near-miss negatives, in one
  file beside the resolver, read by the shadow and the bench; `kind` no longer reaches any decision. Accept: a unit test
  per branch with a fixture entity; the replay bench's trace names the class for every subject.
- **IMGQ-12c (small M, stack repo):** the `picture-judge` role (ONNX Runtime, pinned model, licence recorded, privacy
  row, CPU default). Accept: the role answers the Stack's health and a request with a bundled test image; the Stack's suite
  covers a missing or corrupt model file with the two-part error copy.
- **IMGQ-12d (S):** the Home shadow (section 3.1 item 4). Accept: counters and numbers only in the log; a test proves a
  tile is never dropped, a deadline skip is counted, and a missing role is silent.
- **IMGQ-12e (S, after three sealed captures):** the sealed measurement of 3.2, as a `docs/dev.md` table with the
  pre-registration sha256. Accept: the six pass marks each answered with a number.
- **IMGQ-12f (S, needs the owner's word):** promotion per section 3.1 item 6, the visible-count rule, and the first
  retirement pass of 3.1 item 7. Accept: the counters of every retired veto in the commit body; the header of
  `relevance.ts` updated; review medium (a learned component beside a privacy promise).
- **IMGQ-12g (S, after IMGQ-09 reports):** if offer recall on the held-out split stays under 0.80, a one-page decision for
  the owner: a picture rescue beside rule 1's search rescue (rule change) or accept the ceiling. Accept: a form through
  the question wizard, not prose.

IMGQ-06 (face count) stays as filed; IMGQ-12a reports the person-presence numbers it needs as a side table.

## 4. What this note could not verify

- No vision model was run. ONNX Runtime, torch and transformers are not installed on this Mac and no CLIP-family model is
  in the local Hugging Face cache; running the bench meant a multi-gigabyte install and a model download, not a quick
  offline check, so it is IMGQ-12a. The IMGQ-08 labels have no saved pixels (the replay bench feeds synthetic images),
  and the 217 real tiles under the IMGQ-11 capture are the sealed set and were not opened.
- Model speeds: the only measured figure on file is CLIP ViT-B/32 at 77 to 115 ms per image on an M4 Pro, from the category
  report; nothing is measured on the 8 GB engine box. Sizes are published parameter counts; the fp16 figures are rounded.
- Licences: CLIP (MIT), SigLIP 2 (Apache-2.0) and TinyCLIP (MIT) are as published; MobileCLIP's model terms need a read
  before any pin. SigLIP 2 through transformers.js is unverified; plain ONNX Runtime is the assumed path.
- The per-tile precision table counts a file under every source that returned it; a file in both category and depicts is
  counted twice, and the search column covers adult thing subjects only (search never runs for a person).
- Position of the wrong tile within the gallery was not captured, so the gain of "fewer but certain" is computed from
  independence, not measured.
- IMGQ-09's result and the IMGQ-11 labels did not exist when this was written; section 3.2 assumes IMGQ-11 lands its
  labels keyed by file page like IMGQ-08's.

## Supersedes

Nothing. It extends IMG-VISION-BENCH-01 (inputs: the IMGQ-08 labelled tiles as pixels, four candidate models),
IMG-VISION-SHADOW-01 and IMG-VISION-VETO-01 (the pass marks of 3.2 replace the category report's five thresholds when
the two differ: the 1-in-40 bar is the owner's and is stricter) and leaves IMGQ-06, IMGQ-09 and IMGQ-11 as they are.
`relevance.ts`'s header ("nothing reads pixels or faces; nothing is learned") stays true until IMGQ-12f.
