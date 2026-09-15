# Session B handoff (2026-09-14, night)

For the fresh Session B that picks up the next lane from the
coordinator (`getmaipai-39`, Fable). Everything on `main` is readable
there; this note holds only what a fresh session cannot read from
`main`: the lanes this session ran today with their landed hashes, the
working protocol as it actually ran (not the plan, what happened),
known under-load flakes, the two open findings (ACT-02, EVAL-07) with
their next steps, and where this session's logs sit. Last landed
commit: `17ba2ec` (ACT-02).

## Lanes run today, landed

1. **Lane 12 item 3** - the bench fixture's eleven missing expectation
   kinds (signal, plan, moves, subjects, and the rest). `b940000`.
2. **Lane 12 item 4 - EVAL-07's dataset half.** The registry
   (`backend/scripts/bench/datasets/registry.json`, a `verify` command,
   a `download` command), the internal form, loaders for
   LongMemEval-cleaned, LoCoMo, DailyDialog, and the coherence review's
   own 40-per-type LongMemEval sample. `a977110`, a small follow-up fix
   `383b250`.
3. **Lane 13 item 1** - the phenomenon-mining tool (`mine.ts`, ~200
   fragments across 23 phenomena from Taskmaster-1/CCPE-M/QuAC plus
   DailyDialog/LoCoMo/LongMemEval) writing
   `data-scratch/eval/review-sheet.md` for a person to mark
   keep/skip/rewrite. `b828819`. **Still waiting on a person's review**;
   nothing reads the marked-up sheet back yet.
4. **Lane 13 item 2** - DailyDialog's own act/emotion distributions and
   transition tables, committed to `reference/dailydialog.json`.
   `aea3c81`.
5. **Lane 14 items 1-2 - EVAL-07's memory replay.** Baseline v0 built,
   killed five times before it produced a clean run (the real cause was
   the Claude Code harness's own background-task monitor misreading
   normal machine memory state as pressure, not macOS killing anything -
   full account and the fix below, under "Baseline v0"). `3e10506`
   (item 1), `fa72246`/`dce7975`/`920bb44`/`f9639a0`/`8d5eef5`/`b3bfd41`
   (item 2, the last of these is the real 35-question run).
6. **getmaipai/home#119** - the Confirm control for an inferred entity.
   `f16f5ad`.
7. **Lane 15** - notifications "Dismiss all" and multi-select, plus a
   `docs/api/openapi.json` regen the check caught and a new
   `--notifications-review` screenshot mode. `a22ef53`, `c02d465`,
   `0997476`.
8. **Lane 16 - ACT-02's training half.** Three multinomial heads
   trained (act, stance, emotion) over the nomic embedding; validated
   against DailyDialog's human labels and the bench fixture: **none of
   the three ships** (act -4.4 points against the stated 5-point
   margin, emotion -10.1 on neutral-vs-not, stance has no independent
   human validation yet). `17ba2ec`. Full numbers and next steps below.

Also landed this session, earlier in the day, unrelated to a numbered
lane: `1808908` (screenshot pipeline port/data-dir collisions between
concurrent runs).

## The protocol, as it actually ran

- **Own worktree and branch, always** (`git worktree add ../home-<name>
  -b b/<branch> origin/main`), never the shared checkout. The one
  incident today: the shared `home` checkout carried a dirty,
  uncommitted hunk on `docs/plans/session-b-lane-12-2026-09-13.md` that
  turned out to be stale content from before this session adopted the
  worktree-per-lane discipline, unrelated to the lane in progress -
  saved a copy of the diff to this session's own scratchpad, then `git
  checkout --` restored the shared tree rather than committing
  unrelated content on my own initiative. It later became a real,
  intentionally-committed work order (`699993c`) once someone else
  picked it up - confirms "stale, restore it" was the right call over
  guessing and discarding.
- **Atomic commits**: `git status` first, stage exactly the named
  files (`git add <file>`, never `-A`/`.`  blindly), `git diff --cached
  --stat` confirming only mine, one bare `git commit`, `git show --stat
  HEAD` after. The `require-review-before-commit` hook wants a
  `code-review` skill run (medium effort, the worktree path as its
  explicit target) within 30 minutes of the commit attempt - it denied
  a commit once tonight because the first review had run over an hour
  earlier; ran a fresh one against the actual staged diff and it went
  through. Two rounds of review on lane 16 found seven real bugs total
  (see "ACT-02" below for the most important one) - both were worth
  running; do not skip the second pass just because the first already
  ran once on an earlier version of the diff.
- **The gate starts only on the coordinator's "gate"**, said once
  another session's gate or engine-spawning run has cleared - this
  session waited on that word twice tonight (once genuinely, once
  because the coordinator's own belief that a peer's push had landed
  turned out to be wrong; asked "where are you" after 50 minutes of
  silent waiting rather than assuming - flag a stalled wait sooner than
  that next time, not after a direct status check forces it). Gate in
  the lane's own worktree (`bash scripts/check.sh`, no throwaway
  worktree needed for a solo lane); say **"gate ended" the moment
  `check.sh` itself finishes green**, before the merge - it unblocks
  whoever is queued behind, and the merge/push is a separate, slower
  step after. **A full `bun test` run (not just the one new test file)
  is gate-class**, the same load on the machine as `check.sh` - ask
  before running it standalone between passes, the same as a gate; this
  session ran one without asking once and was corrected.
- **The hold-and-clear rule for an engine-spawning run**: ask the
  coordinator before the first engine call, name the log path once it
  starts, run fully detached (`nohup ... & disown`, output to a real
  log file in the scratchpad - never piped through `tail` inside a
  command the harness might auto-background, which produces an empty,
  unreadable output file until the whole pipeline exits), watched via a
  `Monitor` on the log, never a foreground wait. Report the log path
  when it starts and again the moment it ends. A gate and an
  engine-spawning run never overlap on this Mac; the coordinator clears
  each start.
- **Land by fast-forward merge, never in the shared checkout while
  another session has anything staged there.** Tonight: Session A had
  ASK-01 staged (uncommitted) in the shared `home` checkout at the same
  moment this lane was ready to merge, including an overlapping
  `docs/BACKLOG.md` hunk - reported it rather than merging, and the
  coordinator did the fast-forward from a separate, clean worktree
  instead. After landing: remove the lane's own worktree
  (`git worktree remove`) and delete its local branch
  (`git branch -d`); leave any git-ignored scratch output where it sits
  (a review sheet under `data-scratch/`, for instance) since it is
  outside the worktree's own tracked tree and survives the removal
  automatically.
- Never a household memory record, chat quote, or fact about Jesse or
  his family in any repo file, issue, or commit message - persona-
  roster names and defect classes only.

## Known flakes under load

- `frontend/src/shell/NotificationBell.test.tsx`, "Dismiss all sends
  `{ all: true }`...": timed out at 5104ms against a 5000ms limit
  during a full `check.sh` run tonight; passes clean in isolation
  (4.68s). Confirmed a load-related flake, not a regression, and
  unrelated to anything this session touched.
- Per the coordinator: the `resourceGovernor` timing tests flake under
  another session's load on this machine and pass alone. Rerun quiet
  before reporting a real failure on either of these two suites.

## ACT-02 finding: what the next attempt actually needs

Full numbers, confusion matrices and the per-head breakdown are in
`docs/dev.md`, "Session B, lane 16: ACT-02's training half" - this is
only the summary and what changes for a next attempt, reconciled with
the coordinator before landing:

- **Act.** The head's own failure is concentrated exactly on
  inform-versus-commissive, the distinction it was built for (720
  true-commissive DailyDialog turns, only 36 correctly composed). The
  4B-labeled training corpus (Taskmaster-1, CCPE-M, the bench fixture,
  synthetic roster dialogues - none of it human-labeled) is not enough
  signal; the next attempt needs real human act labels in the training
  set. DailyDialog's own training split carries them but is CC
  BY-NC-SA - whether a derivative trained weight could ship is an org
  licensing call, not a lane-16 one. The alternative is a different,
  license-clean source of human act labels, not just a bigger
  4B-labeled corpus.
- **Emotion.** Not a tuning problem - GoEmotions (short written
  social-media comments) does not represent the hub's actual domain
  (spoken household turns) closely enough for the learned weights to
  transfer (neutral recall collapses to 1.3% out of domain against a
  much healthier-looking 38.7% on GoEmotions' own held-out split).
  GoEmotions alone cannot be the training set for spoken-dialogue
  emotion; the next attempt needs a source in the right domain.
- **Stance.** No independent human-labeled source exists at corpus
  scale (DailyDialog carries no stance labels). The 500-turn review
  sheet this lane's own script writes -
  `data-scratch/eval/turn-signal-review-sheet.md` (git-ignored) - is
  what the real validation number waits on; nothing reads it back yet.
  A person needs to work through it (mark each row agree, or disagree
  on the act/stance/both) before that number exists.
- The training script itself
  (`backend/scripts/train/turn-signal-heads.ts` and its module files
  under the same directory) is reusable as written for a retry with a
  different corpus - only the corpus/data source needs to change, not
  the training/calibration/evaluation machinery. Re-running it needs
  the same coordinator clearance and detached-run discipline as this
  time (it spawns its own chat and embed engines, ~80 minutes end to
  end at 6,000 training turns).

## EVAL-07 state

**Baseline v0** (detached, 2026-09-14T16:44:56Z - 2026-09-14T19:07:46Z,
2h23m, seed 20260914, 35 questions, `replay-per-question.ts`): 35/35
completed, 0 non-zero exits.

| Type | Correct | n | Accuracy |
|---|---|---|---|
| knowledge-update | 5 | 5 | 100.0% |
| multi-session | 0 | 5 | 0.0% |
| single-session-assistant | 4 | 5 | 80.0% |
| single-session-preference | 2 | 5 | 40.0% |
| single-session-user | 1 | 5 | 20.0% |
| temporal-reasoning | 1 | 5 | 20.0% |
| abstention (dedicated stratum) | 1 | 5 | 20.0% |
| **overall** | **14** | **35** | **40.0%** |

Full account (the five-kill diagnosis, the harness lesson, the log
path, per-row RSS figures): `docs/dev/session-b.md`, "Lane 14 item 2
follow-up 2". **Per-row failure read (defect / scorer / variance, per
the org's own rule) is still pending** - the coordinator's own pass,
not done in this lane.

**The per-question runner mode** (`backend/scripts/bench/datasets/
replay-per-question.ts`): one fresh OS process per question
(`bun run replay.ts --dataset ... --only <id>`), same seed and manifest
order, so the OS reclaims everything on each question's own exit. A
pre-spawn memory guard (`waitForMemory()`, `parseFreeMemoryMb()`) waits
for headroom before each spawn - cheap insurance, not the load-bearing
fix. The **harness-kill lesson**, worth carrying to every future
engine-spawning run: this machine's free memory sits near ~90MB as its
own steady state whenever the 8B chat engine's mapped model pages are
touched (macOS reclaims mmap'd pages on demand, by design, not a real
shortage) - the Claude Code harness's own background-task monitor reads
that as danger and kills the *tracked* task, not the OS killing the
process. The fix is always the same: `nohup ... & disown` (confirmed
orphaned, `PPID 1`), watched via a `Monitor` on the log file, never a
foreground wait.

**The phenomenon review sheet** (`data-scratch/eval/review-sheet.md`,
git-ignored, ~200 fragments across 23 phenomena, lane 13 item 1 above):
waiting on a person to mark keep/skip/rewrite. Nothing downstream reads
it yet - the rewrite into bench scenarios is scoped for after CHAT-16.

## Where this session's logs and scripts sit

This session's scratchpad:
`/private/tmp/claude-501/-Users-jessetorres-Developer-github-com-getmaipai/1e709218-4920-4a77-b905-2f778de00638/scratchpad`.
Holds `lane16-turn-signal-heads-run2.log` (the successful ACT-02
training run this handoff's numbers come from; `-run.log` without the
`2` is the killed first attempt, kept for reference), `lane16-check.log`
and `lane16-check2.log` (the first, flaky-red and second, clean
`check.sh` runs), a handful of `issue-*.md` draft write-ups from
earlier in the day, and diff/patch files from mid-session recovery
work (`session-b-lane-12-uncommitted-diff-2026-09-14.patch` is the
saved copy of the stale hunk mentioned above). A fresh session gets its
own scratchpad; nothing here needs to move unless a report asks for a
specific log.
