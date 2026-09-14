# Session B: lane 13, the phenomenon sheet and the reference distributions (2026-09-14)

Work order from the coordinating session. Bench datasets and docs
only, all under `backend/scripts/bench/datasets/` (your lane 12
directory) and `docs/`; nothing under `backend/src/` (Session A is in
ACT-01 there and in `turnEngine.ts`, `turnContext.ts`,
`memoryJudge.ts`, `utteranceShape.ts`, the new `turnSignal.ts`, and
the bench runner and fixture). Same protocol as lane 12: gate in your
own throwaway worktree, atomic stage-and-commit, only my "clear" ends
a hold, nothing from the live household in any file, and everything
produced from the public datasets stays in the ignored data folders
except derived numbers and id manifests. Commit this file with item 1.

## 1. The phenomenon review sheet (S-M)

EVAL-07's mining half (the program file's "EVAL-07" section, the
outside review folded in) needs about 200 reviewed fragments across
20 to 25 phenomena before anyone writes scenarios, and the review is a
person's job (Jesse or a design session), not a model's. Build the
tool that makes that review cheap, with no model at all: the public
datasets already carry the labels. `mine.ts` in your datasets
directory takes the loaded internal form and selects fragments
deterministically (seeded) per phenomenon from the labels that exist:
DailyDialog's act and emotion labels (a question after an inform, an
emotional disclosure and its reply, a directive, a closing, a
backchannel); Taskmaster-1's corrections and confirmations ("no, I
meant", "actually", a slot restated); CCPE-M's preference statements
and preference changes; QuAC's elliptical follow-ups and unanswerable
questions; LoCoMo's temporal and multi-session questions; LongMemEval's
knowledge-update and abstention questions. Each fragment is the two
to four turns around the phenomenon, with the source, the ids and the
labels. Output: a review sheet, `data-scratch/eval/review-sheet.md`
(ignored; never committed), 200 fragments across the phenomenon list
in the program file (aim for eight to ten each, fewer where a dataset
has none), each with a checkbox line for the reviewer (keep, skip,
note) and an empty "rewrite as" line; and a committed
`phenomena.json` naming each phenomenon, its sources, and the label
rule that selects it, so the sheet is reproducible. Do not write
scenarios; do not use a model. Acceptance: unit tests on the selection
rules against the loaders' embedded samples; the sheet generated live
from the downloaded files and its counts per phenomenon reported to
me (not the fragments; they are dataset text); a design note in
`docs/dev/session-b.md` naming the review procedure (Jesse marks the
sheet, a design session turns "keep" fragments into scenarios with
roster names in the fixture's shape).

## 2. The reference distributions, reproducible (S)

The design note (dev.md section 12) quotes DailyDialog's act and
emotion distribution and the transition table ("a question back after
an inform 43 percent") as the reference for what a person does next,
computed by hand once. Make it reproducible: `reference.ts` computes,
from the loader, the act distribution, the emotion distribution, and
the act-to-next-act and emotion-to-next-act transition tables on
DailyDialog's training split, and writes them to a committed
`reference/dailydialog.json` (derived numbers only, with the dataset
version and checksum recorded inside); a unit test pins the numbers to
the note's figures within one percentage point and fails if the
dataset or loader changes them. Add the child-length baselines the
design names (child two sentences and 40 words, teen two and 55) as a
second committed reference file only if a public source supports
them; otherwise record in the note that they are the design's own
figures with no public reference yet.

## Out of scope

Anything under `backend/src/`; the bench runner and fixture (Session
A is in them for ACT-01); scenario writing; any model call.
