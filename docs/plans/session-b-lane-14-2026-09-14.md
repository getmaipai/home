# Session B: lane 14, the design note's figures, and EVAL-07's memory replay (2026-09-14)

Work order from the coordinating session. Bench datasets, bench
scripts you create, and docs; nothing under `backend/src/` and no
edits to `conversationRunner.ts`, `conversationLive.ts`,
`conversationFixture.ts` or `conversationScore.ts` (Session A owns
those on the engine items; if the replay needs a change there, ask me
and A makes it). Same protocol as lane 13: gate in your own throwaway
worktree, atomic stage-and-commit, only my "clear" ends a hold, the
raw datasets never enter the tracked tree. Commit this file with item
1.

## 1. The design note's transition figure (S, docs)

Your item 2 found that dev.md section 12 folds two measurements into
one sentence ("a question back after an inform 43 percent, after a
question 16"): the act-to-act transition is 11.4 percent and the
"next turn's text carries a question mark" measure is 16.3. Fix the
sentence in the note to name both numbers for what they are, cite
`reference/dailydialog.json` as their source, and touch nothing else
in the note. Doc-only commit, `git add -p` on dev.md (Session A has
hunks there).

## 2. EVAL-07 memory mode: the replay, built now, run on a quiet machine (M)

EVAL-07's replay (BACKLOG "EVAL-07", the program file's section with
the outside review folded in, the coherence review's sampling) is
queued on Session A after MEM-06, but it is bench infrastructure over
your loaders and it gives the whole queue a public baseline sooner.
Build it as `backend/scripts/bench/datasets/replay.ts`, new files
only, driving the engine through the same entry points the live bench
uses (read `conversationLive.ts` and `setup.ts` for the seeded
household, the ports, the pinned seed and prompt clock, and the
recording proxy; import, never edit).

Design, fixed:
- Ingestion is the memory path, not the chat path: each history
  session becomes a conversation on a seeded household member (the
  dataset's "user" is the person; the dataset's other speaker or
  assistant side is stored as the hub's reply text on the same turn
  row, never generated), the turns are written through the real turn
  store and the real judge runs on them (the 4B on the background
  engine), with the prompt clock set to the session's own timestamp
  so temporal questions mean something. No chat completion is spent
  on history.
- The question is asked once through the full engine as a live turn
  (the pinned seed, the prompt clock at the question's time), and the
  reply is scored by the dataset's own rule: LongMemEval's judged
  accuracy per question type with abstention and knowledge-update
  reported separately (use the persona judge or the 4B as the grader
  with the dataset's reference answer, and record which; the
  reference answer never enters the turn); LoCoMo's F1 against its
  answer with its evidence turn ids checked against what recall
  actually retrieved.
- Start with `longmemeval_oracle.json` (only the evidence sessions
  per question, so a history is a few sessions, and a full pass is
  under an hour), then the 230-id sample of the S set, then LoCoMo
  whole. The whole S set is out of scope (the review's finding).
- Output: a run header like the household bench's (commit, engine
  builds and models, seed, prompt clock, dataset version and
  checksum, sample manifest), per-question rows (id, type, expected,
  reply, verdict, recall hits), per-type totals, and the same
  `[bench-turn]` line shape so my manual read works the same way.
  Results go to your scratchpad and the numbers to
  `docs/dev/session-b.md`; nothing from the datasets is committed.

Acceptance: unit tests on the ingestion mapping and the scoring
against the loaders' embedded samples (no engine); a dry run that
ingests one oracle question's history and asks it, on my "clear" (it
uses the engines, so it is a hold for A like a seeded set); then the
first full oracle baseline, on a quiet machine I arrange, reported
per type with the log path so I read the failures. Do not tune
anything in the engine from what you see; findings go in the note.

## Out of scope

Anything under `backend/src/`; the runner, live, fixture and scorer
files; the phenomenon-to-scenario rewriting; training.
