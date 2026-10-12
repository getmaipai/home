# ROUTER-BUILD-02: how chat decides to search (design and pre-registered pass marks)

Date: 2026-10-12. Status: design only. No engine run, no code, no default changed. Rescue stays off for everyone until a
bench under this plan passes. Rules cited are `docs/design/RULES.md` (rule 0, rule 1) and
`docs/RULES-AND-LEARNED-COMPONENTS.md` in `.github`.

## 1. Where we stand (measured, all adult, written)

| Fact | Number | Source |
|---|---|---|
| Plain model recency recall (searched when it should) | 33.3% [23.3, 43.3] | `data-scratch/chat-ab/router-build-01i/` |
| Current head (LR over nomic, threshold 0.67474) with rescue | 86.7% [80.0, 93.3], paired +53.3 [41.1, 64.4] | same |
| Floor | 0.91, lower bound of the interval; NOT met | same |
| Stable false searches | 2.2% plain, 2.2% rescue | same |
| no_tool false searches | 1.1% plain, 0.0% rescue | same |
| Held-out slice (6 rows x 3 reps) | rescue 72.2% [55.6, 88.9] | same |
| Live probe, one rep, 10 recency, 5 stable | forced 7/10 and 0/5; median total 12.0 s vs 7.9 s plain; first word 6.9 s vs 1.9 s | `data-scratch/chat-ab/router-build-02-live0/` |
| Offline, fresh 72 rows, raw concat, tuned | recall 80.6%, stable 1/20, no_tool 1/16 (the RAW-01 "0 false, 96% recall" did not carry over) | `data-scratch/chat-ab/router-heldout-06/REPORT.md` |
| 9B asked "SEARCH or NO_SEARCH" with no tools, bare prompt | recall 16.7%, false 0% | `data-scratch/chat-ab/search-recency-02/REPORT.md` (arm 0) |
| Description sentence on the tool (in rules) | +13.3 points [0.6, 26.1], weak | same (arm 1) |

Reading: the head works but is under the floor, and its 0.91 target was set on small cells that came from one authoring pass.
Three things limit what we know: the held-out rows are few (6 per cell), they share an author with the tune rows, and the
interval is over rows, not over question families. The 9B asked bare is a poor decider, but nobody has tried it with the same
conversation context the chat sees, a few worked examples, and a prompt tuned on a dev split. This plan fixes the evidence
first, then compares the deciders on equal terms.

## 2. Position every decider takes

All candidates sit where the existing rescue sits (rule 1's one exception): on a written adult turn, when the model returned
text with no tool call, the decider says SEARCH or NO_SEARCH; on SEARCH the engine's query writer writes the query and the call
passes the same policy checks as a model call. A decider never cancels a model call, never runs on a spoken turn, and never sits
in the safety, consent, privacy or credentials path. Child and teen profiles stay capped at shadow (a decision is logged as a
number, no text, and changes nothing). The adult-only bench below measures the gain; the minors check is a count (section 6, M5).
Every decider fails open (no search forced) on timeout, error or a pin mismatch.

## 3. Candidates

| Id | Decider | What is tuned, and on what | In rules today? |
|---|---|---|---|
| A | The shipped head (raw concat features, LR, threshold 0.67474) | Nothing. Baseline. | Yes (rule 1 exception: embedding score) |
| B | A decision pass with the local 9B: one short generation, answer `SEARCH` or `NO_SEARCH`, thinking off, max 3 tokens | Prompt text, 4 to 8 worked examples, context window (last 2 turns, same as the chat sees); chosen on the dev pool only. Two placements: B1 on the chat model (port 8771 role), B2 on the second 9B (port 8773, no embeddings). Same weights, so B2 is only a latency and slot check, not a different model. | Needs a ruling (see below) |
| C | A small tuned classifier on the existing nomic vectors: 3-class (recency, stable, no_tool) multinomial; candidates: LR C-sweep, calibrated linear SVM, 1-hidden-layer MLP (64). Decide SEARCH when P(recency) is at or above a threshold. | Model type, regularisation and threshold by family-grouped nested CV on the dev pool (section 5). More and better labels (section 4). Same embeddings, so no new dependency. | Yes (embedding score), if it ships as a new pinned weights release |
| D | Combination: C scores first. Above the high threshold, SEARCH. Below the low threshold, NO_SEARCH. In the band between, ask B. | The two thresholds, chosen on the dev pool so the band holds at most 25% of turns (so B is called on a quarter of turns, not all). | Needs a ruling (contains B) |

Why these four: they answer the open questions in `data-scratch/second-opinion/search-and-pictures-brief.md` (is the
embedder the weak link, is the training signal the weak link, would a model-in-the-loop pass do better) and they include the
adviser's suggestions: a decision pass with the existing 9B, a small supervised classifier, three-class labels, the same
conversation context for the decision pass, question-family resampling, and a latency budget set before the run. The adviser's
output is untrusted; each suggestion is adopted only as a candidate to be measured. Not carried: a prompt that forces search
for time words (a word list; rule 1) and any hosted model (PRIVACY: local models only).

Rules reading, for the architect. Rule 1 names "an embedding score" as the one allowed signal. A 9B decision pass (B, D) is
not an embedding score, and a decider that forces a tool call overrides `tool_choice: "auto"`. It is the model itself judging,
which is closer to "the model decides" than a head trained on phrasings, and it is never a labeler or a judge (the
"model judge is a trend line, never a gate" rule is about scoring benches). Still, rule 1's text does not cover it, so B and D
are measured here as ceilings beside the best in-rules arm (A, C), per the owner's rule of 2026-10-11 (rules never hide the
right design). If B or D is the only arm that clears the marks, the outcome is NEEDS-RULE-CHANGE, taken to Jesse, or to the
data-backed delegation of 2026-10-11 (architect verdict first; commit carries
`Owner-approved: 2026-10-11 (data-backed delegation)`; numbers in the body). Search routing is not on the never-delegated
list (child and teen protections, the output gate, consent, privacy, credentials), and none of those change.

## 4. Labels and how noise is controlled

Label rule (`RULES-AND-LEARNED-COMPONENTS.md`): labels come from people, or from a frontier model over roster-based synthetic
data only; never from household transcripts, never from a small local model. So:

- Source: new synthetic adult prompts authored by a Claude session (Sonnet or Opus, not the session that tunes), persona names
  from the roster only, no household data. Three classes, as the existing sets: `recency` (needs a live search),
  `stable` (stable fact, answer from memory), `no_tool` (chat, math, household, memory). A fourth tag `boundary` is allowed at
  authoring for rows the author thinks are genuinely arguable (the "CEO of Apple" kind).
- Size: development pool about 1,100 rows (the existing 300 in `search-recency-04-labels.json`, 72 in
  `search-recency-06-heldout.json`, the 120 KS-BENCH-01 rows and 12 follow-ups, plus about 600 new, roughly 200 per class,
  20% follow-ups with a prior pair). Lock box (single use, section 5): 150 recency, 100 stable, 100 no_tool families, 20%
  follow-ups, authored by a different pass than the dev rows, never shown to the tuner.
- Every row gets a `family` id: one information need ("weather for a place tomorrow", "result of last night's game", "price
  of a product", "release or update of software"). Paraphrases, follow-ups and template twins share a family. Existing rows
  are assigned a family in one Sonnet pass over the files (Haiku may gather candidate groupings; Sonnet decides).
- Blind second label: a different model pass (Opus, fresh context) sees only the prompt (and the prior pair) plus a one-page
  label card, and labels it. The report states the agreement rate and a confusion matrix against the author's label.
  Rows they disagree on, or that the author tagged `boundary`, are `contested`.
- Human spot check, sized now: Jesse labels 100 rows blind: 60 drawn at random from all new rows (dev and lock box in
  proportion) plus up to 40 contested rows. The ask goes to him as one short form (a sheet of 100 prompts, three buttons
  each) when the rows exist. Acceptance: at most 3 of the 60 random rows disagree with the final label (5%); more than 3
  and the whole set is relabelled by a stricter card and re-checked on a new 60 before use. A row Jesse disagrees with is
  corrected or dropped, never kept silently. The agreement numbers are quoted in the done report as the "disagreement rate
  against a human-labelled sample" the label rule asks for.
- Contested rows stay out of both the numerators and the denominators of every mark (decided now, before any score is seen),
  are capped at 10% of a set (more, and the set is rewritten), and are reported separately so nothing is hidden.
- No row is edited after a decider has scored it. A label fix after scoring creates a new row id and the old score stays in
  the log.

## 5. Evaluation design

Held-out by question family, not by row. Template twins and paraphrases are the main way the earlier splits flattered the head,
so:

1. **Dev pool** (about 1,100 rows) is split only by family: grouped 5-fold CV, repeated 3 times with different family shuffles.
   C is tuned here (model type, C, threshold), B is tuned here (prompt, examples, context), D's two thresholds are tuned here.
   Nothing about the lock box is read during tuning. The threshold is the one that keeps the stable-plus-no_tool false-search
   rate at or below 2% on out-of-fold predictions, then maximises recency recall.
2. **Freeze.** One configuration per arm is written to `data-scratch/chat-ab/router-build-02/PREREG.json` (weights file sha256,
   threshold(s), B prompt text sha256, the marks of section 6) and its sha256 is committed in a docs commit before the lock
   box runs. That commit is the pre-registration.
3. **Lock box**: authored, labelled and human-checked (section 4), stored under `data-scratch/` with its sha256 in the
   pre-registration. It is used for one evaluation per arm, then becomes dev data for the next round. A second look at the
   same lock box to "try a tweak" is a defect; a changed arm needs a new lock box.
4. **Stage 1, replay (cheap, answers which arms qualify).** Run the plain arm once over the lock box (3 repeats), recording the
   model's first-round outcome per row and repeat. A decider's effect at the rescue position is a function of the row, its
   context and "the model returned text with no tool call", so for each (row, repeat) where plain returned no tool call, each
   decider's SEARCH/NO_SEARCH is applied; recall counts a repeat as searched if plain searched or the decider fired on a
   no-call turn. A and C decisions are computed offline; B and D decisions are one engine call per (row, repeat).
   This is exact in expectation for recall and false-search rates (the rescue does not change the first-round sample) and
   cheap. It is not used for latency.
5. **Stage 2, end to end (confirms, measures latency).** Only for arms that pass stage 1 on M1 and M2: the real hub turn path
   (`runTurnNextStream`, throwaway data dir, `chat.search_assist=rescue` set there only, fixture search so nothing leaves the
   machine) against a same-session plain arm, 3 repeats, interleaved. At most two arms go to stage 2 (best in-rules and best
   overall).

Statistics: the unit is the family (rows inside a family and repeats inside a row are averaged first). Intervals are 95%
percentile intervals from a seeded cluster bootstrap over families (10,000 resamples), paired against plain on the same rows
where a difference is stated. At least 3 repeats everywhere. This is bench rule 13 (3 or more repeats, paired 95% intervals,
held-out split) with family resampling added.

## 6. Pre-registered pass marks (set now, before any lock-box number exists)

An arm passes only if every mark holds on the lock box, adult written turns, contested rows excluded.

- **M1 recall (primary).** End-to-end recency recall: lower bound of the family-bootstrap 95% interval is at least 0.91, AND the
  paired difference to plain has a lower bound above +20 points. Follow-up recency rows are reported separately and need a
  point estimate of at least 0.85. Each of the three repeats on its own has a point estimate of at least 0.88 (no repeat
  rescued by the others). With about 150 recency families, this needs a true recall near 0.96.
- **M2 false searches (ceiling).** A false search is any websearch on a `stable` or `no_tool` row. Candidate-caused false
  searches (the arm's rate minus plain's, paired) must have an upper bound of at most +3 points on each of stable and no_tool,
  and the arm's own rate must be at most 3% point estimate and at most 6% upper bound on each. no_tool follow-ups: at most 1 of
  about 30 rows.
- **M3 latency budget (milliseconds, same hardware, stage 2, fixture search).**
  - Decision overhead on a turn the decider does not act on: median at most 150 ms, p95 at most 400 ms. (Measured:
    embedding about 15 to 50 ms; bare B about 137 ms.)
  - A rescued turn, total time against the same row's plain repeat: median at most +4,500 ms, p95 at most +8,000 ms. (Measured:
    +1.8 s in the 01i bench, +4.1 s in the live probe, one rep.) First word on a rescued turn: median at most +5,500 ms.
  - All adult turns pooled: median total at most +600 ms over plain.
  - B and D count their decision call in all three lines. An arm that passes M1 and M2 and fails M3 is reported with the
    numbers; whether to accept the latency is Jesse's call.
- **M4 no side regression.** Stable and no_tool call-shape pass rate: paired difference lower bound at least -10 points on
  each (the 01i run showed -8.9 [-17.1, -0.6] on no_tool for the current head, from other-tool shapes, so this mark is
  deliberately not tighter than what the shipped head already does without explanation; the cause is to be traced in the
  done report).
- **M5 minors and safety.** On the existing minor rows (`search-recency-07-minor-ext.json`, `-heldout.json`) and on spoken rows:
  0 decider activations (a counter, not a judgment), and a unit test per arm that a timeout, error or pin mismatch forces no
  search. Shadow logging for minors records a number only.
- **M6 privacy.** No new outbound connection; the decider and its weights are local; the 9B sees only what the chat turn already
  sees. Checked by the architect and by `PRIVACY.md`.

Decision rule: take the in-rules arm (A or C) with the best M1 if it passes everything. If only B or D passes, report to the
architect as NEEDS-RULE-CHANGE with the numbers beside the best in-rules arm; the rule change is Jesse's, or the data-backed
delegation. If several pass, the cheaper in latency and the simpler wins; ties go to the in-rules arm. If nothing passes
M1, the result is "rescue stays off; embeddings and a bare decision pass are not enough", and the next levers are the tool
description (arm 1, in rules) and a better model, not a router. A failing result is a finished result.

## 7. Engine time per arm and sequencing

One slot per engine; every run holds `data-scratch/lane-locks/engine-8771.lock` for its whole duration (it covers 8771 and
8773 because the bench takes chat from 8773 and embeddings from 8771). Benches never overlap; the lock was held by another
session when this plan was written, so a run starts only after that lock is clear. Estimates use the 01h and 01i timings
(adult plain about 4.7 s median total, rescued recency about 6.1 s, forced up to 12 s live).

| Step | Arm | Rows x repeats | Engine time |
|---|---|---|---|
| Label, family, C training, C and D threshold search | A, C | offline, CPU only (llama-cpp-python embeddings, no server) | 0 |
| Tune B prompt and examples on the dev pool | B | about 1,100 rows x 3 prompt variants x 0.4 s | about 25 min |
| Stage 1 plain over the lock box | plain | 350 x 3 = 1,050 runs x about 5 s | about 90 min |
| Stage 1 decisions for B and D | B, D | 1,050 decisions x 0.4 s, twice | about 15 min |
| Stage 1 for A and C | A, C | offline | 0 |
| Stage 2 end to end, the winner (plain interleaved) | one arm | 1,050 x 2 runs, rescued turns slower | about 3 h |
| Stage 2 second arm, only if one in-rules and one out-of-rules arm both qualify | second arm | same | about 3 h more |

Total: about 2 h 10 min for the selection stages and about 3 h per stage 2 arm, so 5 to 8 hours of engine time over separate
sessions (the bench resumes by row id; the plain arm is shared). A 3-row dry run (about 2 minutes) under the lock confirms the
dataset flag works before the long run.

## 8. Exact command lines

All paths are on the engine box's checkout of `/Users/jessetorres/Developer/github.com/getmaipai/home` (name the machine in the
brief: the Mac that holds the bench worktree, with the engine reached over its loopback tunnel to ports 8771 and 8773, as the
01h run did). The pieces that do not exist yet are marked NEW; they are built in the next item (ROUTER-BUILD-03, S each, Codex),
not here.

Offline, no engine (dev pool CV, C and D tuning, freeze):

```
cd /Users/jessetorres/Developer/github.com/getmaipai/home
data-scratch/chat-ab/search-recency-04/.venv/bin/python backend/scripts/bench/router_build_02_dev.py --out data-scratch/chat-ab/router-build-02/dev
```
(NEW: family-grouped nested CV for LR, SVM and MLP, threshold search at the 2% ceiling, writes the C weights manifest and the
D thresholds, and `PREREG.json`.)

B prompt tuning on the dev pool (holds the engine lock):

```
cd /Users/jessetorres/Developer/github.com/getmaipai/home/backend
MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:8773 bun run scripts/bench/routerBuild02Decide.ts --rows dev --variants 3 --out ../data-scratch/chat-ab/router-build-02/b-dev
```
(NEW. Context is the last two turns, thinking off, the same chat template as the product.)

Stage 1, plain over the lock box:

```
cd /Users/jessetorres/Developer/github.com/getmaipai/home/backend
MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:8773 MAIPAI_SR_EMBED_URL=http://127.0.0.1:8771 MAIPAI_KS_OUT=/Users/jessetorres/Developer/github.com/getmaipai/home/data-scratch/chat-ab/router-build-02/stage1-plain MAIPAI_SR_DATASET=/Users/jessetorres/Developer/github.com/getmaipai/home/data-scratch/chat-ab/router-build-02/lockbox.json bun run scripts/bench/search-recency-02.ts --arms plain --bands adult --reps 3 --fresh
```

Stage 1 replay and marks (NEW script; reads the plain results, the PREREG decisions, prints M1 and M2 with family-bootstrap
intervals, and refuses to run if the lock box sha256 differs from `PREREG.json`):

```
cd /Users/jessetorres/Developer/github.com/getmaipai/home/backend
bun run scripts/bench/routerBuild02Replay.ts --plain ../data-scratch/chat-ab/router-build-02/stage1-plain/results.json --prereg ../data-scratch/chat-ab/router-build-02/PREREG.json --floor 0.91
```

Stage 2, C (the production path, `assist_rescue` loads the candidate weights):

```
cd /Users/jessetorres/Developer/github.com/getmaipai/home/backend
MAIPAI_LLAMA_SERVER_URL=http://127.0.0.1:8773 MAIPAI_SR_EMBED_URL=http://127.0.0.1:8771 MAIPAI_SR_WEIGHTS=/Users/jessetorres/Developer/github.com/getmaipai/home/data-scratch/chat-ab/router-build-02/dev/c-manifest.json MAIPAI_KS_OUT=/Users/jessetorres/Developer/github.com/getmaipai/home/data-scratch/chat-ab/router-build-02/stage2-c MAIPAI_SR_DATASET=/Users/jessetorres/Developer/github.com/getmaipai/home/data-scratch/chat-ab/router-build-02/lockbox.json bun run scripts/bench/search-recency-02.ts --arms plain,assist_rescue --bands adult --reps 3 --fresh
```

Stage 2 for B or D needs a `decider` arm in `search-recency-02.ts` (NEW) that calls the decision pass at the rescue position
and then takes the same forced-query path as `assist_rescue`; the command is the one above with `--arms plain,decider` and
`MAIPAI_SR_DECIDER=B` or `D`. Summaries come from `--summarize` and `scripts/bench/searchRescueRecall.ts`, then the family-
bootstrap report. Each bench run records the engine build, the model file and a sanitized hardware line (no hostnames).

## Supersedes

Nothing.

## 9. What this item does not do

No engine run, no enabling of rescue, no change to defaults, `answerImages`, or the `chat.search_assist` help text. No new
outbound connection. Minors stay capped at shadow whatever the result. The next steps after approval: author and double-label
the rows, ask Jesse for the 100-row spot check, build the NEW scripts, run the offline stage, commit `PREREG.json`'s hash, then
take the engine lock.

## 10. Pre-registration (ROUTER-BUILD-04, 2026-10-12)

The dev stage ran before any lock-box number exists. This section is the freeze: the lock box may now run, once per arm.

- `data-scratch/chat-ab/router-build-02/PREREG.json` sha256: `83b3c218ec88beb06c6ec7d800ea7f0283e16830380131c57c16eae20f251e78`
- Lock box (`data-scratch/chat-ab/router-build-03/lockbox.json`, sealed, not opened by this item) sha256: `21430c8ca0ce7d6259c4b0cc481b62934ffd6fd3be96bb9fb1ce6d7e5a425d9d`
- A: shipped head, weights sha256 `0f592c19a0e1d1921e30a4ee5a59a6a0c7e5c19acffc28e5ae85198a161b0ede`, threshold 0.674744.
- C: logistic regression (C=10) on the nomic vectors, weights sha256 `e97cb1e97d2f9b200ad033749fdcf2d47d148b0408d4ab5f1a4d89854b213468`, threshold 0.604421.
- B: prompt variant 2, prompt sha256 `1ecc27ff1ff5a195034ad5f8ba5fd93a0be03b4d545427050856e55860e41a0d`.
- D: C scores, SEARCH at or above 0.9035, NO_SEARCH below 0.0247, B between (band 25.0% of dev rows).

Label provenance: Jesse's 100-row spot check found 2 disagreements (`rb3-dev-recency-0438`, `-0439`, world-record questions). Both are
dev rows, relabelled `stable` in `dev.json` before any scoring; they stay contested (author tagged boundary), so they sit outside the marks.

Dev results (1,033 adult non-contested rows, 383 families; family bootstrap 95% intervals, 2,000 resamples; A and B have no
held-out fold, C and D use out-of-fold scores; B is one repeat; A's weights saw some older dev rows, so its dev number is optimistic):

| Arm | Recall | Follow-up recall | False stable | False no_tool |
|---|---|---|---|---|
| A | 89.3% [85.2, 93.3] | 92.3% | 1.1% [0.0, 3.2] | 1.0% [0.0, 2.9] |
| C | 95.1% [91.6, 98.1] | 97.6% | 1.2% [0.0, 3.3] | 1.2% [0.3, 2.8] |
| B (v2) | 98.2% [96.5, 99.5] | 96.0% | 2.3% [0.7, 4.8] | 0.8% [0.1, 1.9] |
| D | 99.7% [99.2, 100] | 97.6% | 1.2% [0.1, 3.6] | 0.5% [0.0, 1.2] |

Nested family-grouped CV, recall at the 2% ceiling: LR 94.6%, MLP 93.5%, SVM 93.0%. B answered something other than SEARCH or
NO_SEARCH (counted as NO_SEARCH, fail open) on about 10% of rows, almost all stable and no_tool; B's latency on the bench was a
median 173 ms, p95 233 ms. B and D contain the 9B decision pass and need an architect ruling (rule 1) if they are the only arms that clear the marks.

Addendum (ROUTER-BUILD-05, registered before any lock box number exists, no arm has been run): `PREREG.json` compares each arm only
to plain, so B or D could not be shown to beat C. `data-scratch/chat-ab/router-build-02/PREREG-ADDENDUM.json` sha256
`bab3bcbd6404e083502c58af815a40c8721ea6b446e39696b5a89b29366122ae` adds paired family cluster-bootstrap intervals for B minus C and
D minus C recall (10,000 resamples, seed 1, 95%); the pass line is a lower bound above 0, and the arm must still pass M1, M2 and M3
on its own. `PREREG.json` is unchanged (sha256 above).
