# CEILING-GAP-01: which line of the real written prompt carries the
# ceiling gap

Lane: codex-b, worktree `~/Developer/github.com/getmaipai/home-codex-2`.
Model floor: Codex, low reasoning (a bench-stage addition following an
established pattern, no design judgment).

## Ready handshake

Report ready (model, checkout, branch, "ready for CEILING-GAP-01"), wait
for "start".

## Why

`home/docs/BACKLOG.md`'s `CEILING-GAP-01` entry (search for it) and
`home/docs/dev.md`'s "EVAL-03 design pass" section (read it for context
on where this finding came from -- it's the parked "ceiling gap"
finding, moved out of EVAL-03 since it's a prompt-composition cost
question, not a voice/steering question). Short version: an isolated
measurement of the written prompt's own ceiling came out higher
(0.51x/0.53x of some baseline) than the real, fully-composed prompt
measures in production (0.30x/0.26x) -- something in the real prompt's
composition (the tool block? the profile and roster lines?
`identityLine`'s own wording?) is costing more than the isolated
measurement accounts for, and nobody has measured which. This item
measures it. It makes no production code change.

## Files you own

`~/Developer/github.com/getmaipai/home-codex-2` (your worktree, sync
first per usual):
- `backend/scripts/bench/parity-bisect4-stages.ts` (extend it -- do not
  create a new file; the design note explicitly says to build "one more
  stage in this file's own shape")
- `home/docs/dev.md` (append your results table, don't touch anything
  else in the file)

Nothing else. No production code (`persona.ts`, `llm.ts`, prompt
composition) changes in this item -- it is pure measurement.

## Setup

`cd ~/Developer/github.com/getmaipai/home-codex-2 && git status`
(confirm clean) `&& git fetch origin && git merge --ff-only origin/main`
(this repo's `docs/BACKLOG.md`/`docs/dev.md` already carry the design
note and this item's own entry once you've synced).

## Steps

1. Read `backend/scripts/bench/parity-bisect4-stages.ts` and
   `backend/scripts/bench/parity-bisect4.ts` in full -- these are your
   patterns to mirror exactly (same runner shape, same table format,
   same seed handling). Also read `home/docs/dev.md`'s
   "PARITY-BISECT-04: arms e and f, and the ruling" section (search for
   it) for the table format your own results should match.
2. Build four arms, all going through the real `contextToMessages()`
   (the actual production prompt-assembly function, not a hand-rolled
   copy of it):
   - Arm 1: the shipped shape, unchanged (the baseline for this bench).
   - Arm 2: the same, but with `tools` withheld from the call.
   - Arm 3: the same, but with the profile and roster lines withheld.
   - Arm 4: the same, but with `identityLine` replaced by the exact
     identity sentence the original isolated-ceiling measurement used
     (find that original measurement in `dev.md` -- it's referenced
     from the EVAL-03 design note or the "written prompt on tier 1"
     section -- and use its identity line verbatim, not a
     paraphrase).
3. Run five seeds per arm, both the prompt-cache question and the
   benchmarking-words question (mirror exactly how `parity-bisect4.ts`
   or `parity-bisect4-stages.ts` already runs both of these -- if
   you're unsure what "both questions" means precisely, re-read the
   existing bisect scripts until it's clear from their own code, don't
   guess).
4. Record, per arm: whatever `parity-bisect4-stages.ts`'s own table
   already records for its arms (mirror its exact metric set, don't
   invent new ones).
5. Write the results as one table in `home/docs/dev.md`, appended after
   the existing EVAL-03 design pass section (a new dated subsection,
   matching that file's own style), naming which arm recovers the most
   of the gap between the isolated ceiling and the shipped measurement,
   and stating explicitly whether this confirms or corrects the
   2026-09-23 record's own attribution of the gap to the tool block
   (read that 2026-09-23 record in dev.md first, cite it, and say
   plainly whether your new numbers agree with it or not).

## Acceptance evidence

- The four-arm table in `dev.md`, real numbers (not placeholders),
  five seeds per arm as specified.
- No production file touched -- confirm this yourself in your own done
  report (`git diff --stat` should show only the bench script and
  `dev.md`).

## Exit checks

- `bash scripts/check.sh` green, scope noted (this should be a
  backend-scoped or docs-adjacent diff -- report which scope it picks
  and whether that's what you'd expect given the files touched).
- Code review at `low` effort (a bench script, not production logic)
  with an explicit target (`main...HEAD`).
- One commit, staged by name.
- Push once green.

## Reporting

Ready, then wait for start. Done: commit hash, check.sh pass line, the
table itself (paste it in your report, not just "see dev.md"), and your
plain-language verdict on which arm carries the gap. Blocked: exact
error. Question: only if `contextToMessages()`'s actual call signature
doesn't let you withhold `tools` or the profile/roster lines the way
described -- if the real function doesn't support that shape of
ablation cleanly, say so rather than forcing something hacky in to make
it work.
