# Work order: SEARCH-SHAPE-01 (fixes #168)

Coordinator: Fable (session home-codex-01), 2026-09-26. Lane: one Claude
agent, Sonnet floor (closes an issue; changes what the model is told on
every searched turn). Issue: https://github.com/getmaipai/home/issues/168,
which carries the diagnosis and the decision. Related: #156 (the fix
this one corrects), #169 (empty snippets, not this item).

## Ready check, before any work

First line of your final report names the model your own system prompt
names. If it is not Sonnet or stronger, stop and report
`ready-mismatch: <model>`. Second line: the worktree path and branch.

## Who you are and what you own

You are the SEARCH-SHAPE-01 lane. You own, while you hold the claim
`data-scratch/claims/SEARCH-SHAPE-01.claim`:

- `backend/src/lib/composer.ts`: `phrasingInstruction()` only
  (lines 919-932 on `main` at 61b9225f)
- `backend/tests/turnMachine/turnNext.test.ts`: the `#156` describe
  block only (lines 1280-1330), plus one new test beside it
- `docs/BACKLOG.md` (one new item line), `docs/dev.md` (one appended
  landing section), `CHANGELOG.md` (one line under Unreleased, if that
  section exists)

Forbidden: everything else, including `nodes/model.ts` (the
`searchResultCount` it computes at lines 605-610 stays as it is and
still feeds the item cap), the bench scripts, the fixture, every
manifest, and the hub on port 8787 (never restart it). Another lane,
MANIFEST-REFUSAL-01, is landing tonight in `../home-166` on
`policy.ts`, `answer.ts`, `contract.ts`, `plugins.ts` and their tests;
it does not touch your files, but it appends to `docs/dev.md`,
`docs/BACKLOG.md` and `CHANGELOG.md` too, so expect a rebase before
your fast-forward. Other live claims (PEOPLE-GRID-01, PROJECT-START-01,
CORRECTION-02, MEM-ELIG-01) are in `data-scratch/claims/`; none owns
your files. Uncommitted changes you did not make in a file you own:
stop and report, never finish or revert them.

## Setup

Sibling worktree, never under `home/.claude/worktrees/` (the Agent
tool's own isolation nests there and breaks the `file:../../commons-
tags/...` pins). From the main checkout:

```
git -C /Users/jessetorres/Developer/github.com/getmaipai/home fetch origin main
git -C /Users/jessetorres/Developer/github.com/getmaipai/home worktree add ../home-168 -b issue-168 origin/main
```

Then `bun install` in `../home-168/backend` (plain; pins unchanged).
No server. The scripted tests use the test DB through `tests/reset-db`
and the fake SearXNG in `scripts/bench/conversationRunner.ts`.

## The state you inherit (read, verified by the coordinator)

- `phrasingInstruction(surfaceClass, utterance, searchResultCount)`
  (`composer.ts:919-932`) builds the post-search phrasing round's
  instruction: an "Answer this question of mine ... in one to three
  sentences" (spoken) or "... structured where it helps" (written)
  line, three lines on facts and contradictions, and, when
  `searchResultCount > 0`, the line added by da37d88d (#156,
  2026-09-25): "For a search-results list, show at most N numbered
  items, choosing the most relevant. Keep the whole list under 140
  words. Use one concise sentence of at most 15 words total per item,
  counting its number and any title. Prioritize each result's key
  point over extra detail, and omit raw URLs." N is
  `Math.min(searchResultCount, 7)`.
- The model reads that as the answer's format. Live on 2026-09-26,
  "is the unabomber alive" (`turn-b01plmod74`) and "was the unabomber
  subject to experimental things while at college"
  (`turn-dbyu1niupc`) each came back as seven numbered one-liners on
  the resident `qwen3-8b-instruct-q4-k-m`. Both turns had eight rows.
- #156's own case was a request for a list (museum posters); its
  measurements (dev.md "#156: the measured search-list budget", line
  27798) show the truncation was fixed by bounding the reply, and a
  bounded list reply finished at 128 to 157 tokens under the unchanged
  608-token cap. The word bound is what matters; the list format was
  incidental to that case.
- The #156 regression (`turnNext.test.ts:1280-1330`) drives
  `runTurnNext` with a stubbed engine: the stub returns the seven-item
  `completeReply` only when the instruction contains "at most 7
  numbered items", "under 140 words" and "at most 15 words total per
  item", otherwise a truncated `oldCapReply`; it then asserts those
  three substrings, `max_tokens` 608, and the complete reply.
- `TurnExpectation.mustNotContain` in the bench fixture is a regex on
  the reply; you are not adding fixture rows (the live bench needs a
  judge engine that is not running tonight).

## Decisions (made; do not reopen)

1. **Bound, do not format.** Replace the line at `composer.ts:930`
   with exactly this, keeping `itemLimit` as the cap:
   `Keep the reply under 140 words and omit raw URLs. Answer the
   question first, in the shape it calls for. Only when I asked for
   the results themselves, list at most ${itemLimit} of them, one
   sentence of at most 15 words each.`
   The shape clause already in the first line ("in one to three
   sentences" / "structured where it helps") decides prose or list.
   Nothing else in the function changes; `searchResultCount` keeps
   feeding the cap.
2. **The #156 test guards the bound, not the list.** Its stub returns
   `completeReply` when the instruction contains "under 140 words" and
   "at most 7 of them"; the three `toContain` assertions become "under
   140 words", "at most 7 of them" and `not.toContain("numbered")`.
   `max_tokens` 608 and the complete-reply assertions stay.
3. **A new scripted test in these words:** "a searched yes-or-no
   question is told to answer in sentences and never told to number
   the results". Same shape as the #156 test (a stub that calls
   `websearch` once with a query the fake SearXNG answers with rows,
   say "reply truncation seven rows fixture", then captures the
   phrasing request), utterance "is the person in the fixture still
   alive", surface "chat"; asserts the instruction contains "in one
   to three sentences" and "under 140 words" and does not contain
   "numbered".
4. **Live evidence without a judge.** Repeat the #156 section's own
   measurement method: a direct A/B against the household chat engine
   already running on its loopback port (find it with
   `ps -eo command | grep "[l]lama-server" | grep -o -- "--port [0-9]*"`;
   the chat engine serves `qwen3-8b-instruct-q4-k-m.gguf`), posting
   the phrasing round's messages (the two real questions above, the
   eight rows each turn stored in `conversation_turns.outcomes` in the
   live hub database, read with `sqlite3 -readonly` from
   `/Users/jessetorres/Developer/github.com/getmaipai/home/data/hub.db`,
   the old instruction and the new one) with `max_tokens` 608. Never
   start, stop or restart an engine; if the engine does not answer,
   record that and skip. Ten lines of `bun -e` in the scratchpad, not a
   file in the repo. Paste the four replies in dev.md, trimmed to their
   first two lines each. Pass: both new-instruction replies open with a
   sentence, not "1.". Note the hub's own turns on 8787 are still the
   old instruction until Jesse restarts it; say so in the report.

## Steps, in order

1. Setup. Read the cited lines, not the whole files.
2. Write the new test (Decision 3) and change the #156 test (Decision
   2); run `bun test tests/turnMachine/turnNext.test.ts -t "#156"` and
   `-t "yes-or-no"` in `backend/`: both must fail on the old
   instruction. Say so in the report.
3. Decision 1. Both tests green.
4. Decision 4, the live A/B, while the gate runs.
5. Docs in the same commit: the BACKLOG item below; a dev.md section
   "SEARCH-SHAPE-01 landed: bound the searched reply, do not format it
   (2026-09-26)" with the cause in three sentences, the new
   instruction verbatim, and the A/B replies; the CHANGELOG line.
6. BACKLOG item, in "## The chat rebuild (2026-09-22)" directly after
   ENGINE-CONTRACT-02 (or after MANIFEST-REFUSAL-01 if it landed first),
   ticked in the same commit with the status line "committed with
   live verification still outstanding: Jesse asks the two #168
   questions on 8787 after restarting it":
   `- [x] **SEARCH-SHAPE-01: a searched question is answered in the
   shape it calls for, under the #156 bound** (S, Sonnet, 2026-09-26;
   fixes #168, dev.md "SEARCH-SHAPE-01 landed").` then one line each
   for objective, files, mirror (the #156 test), the two tests by name,
   out of scope (#169's empty snippets, the bench fixture, any change
   to the 608 cap or the plan budget), exit (`bash scripts/check.sh`).
7. Gate: `bash scripts/check.sh` from the worktree root, in the
   background with the tool timeout raised. Before it,
   `pgrep -f '[s]cripts/check.sh|[b]un test|[v]ite build'` must print
   nothing (the MANIFEST-REFUSAL-01 lane may be gating); otherwise wait
   in a capped loop (10 s between checks, 60 at most, then report). The
   A/B measures reply text, not time, so it may run beside the gate.
   A failure in a test your diff did not touch, with a port or memory
   error, is rerun once alone; a second is reported, never fixed
   forward.
8. Review, started while the gate runs: `code-review` at **medium**,
   reason: the instruction every searched turn sends to the model.
   Target `main...HEAD` in `../home-168`; read the path and branch the
   review reports before acting on a finding. One pass; fix hunks get
   a `low` re-review of those hunks only; no third pass.
9. Commit: `git status`, stage each file by name, `git diff --cached
   --stat`, one bare `git commit`. Title: `Fix #168: bound the searched
   reply instead of formatting it as a numbered list`. End the body
   with the attribution line this session's system reminder gives.
   `git show --stat HEAD` before reporting.
10. Land: `git fetch origin main`; rebase `issue-168` onto
    `origin/main` (it will have moved); resolve the docs appends by
    keeping both lanes' sections; if the rebase touched anything, gate
    again on the new tip. Then `git -C ../home merge --ff-only
    issue-168`, `git -C ../home push origin main`, `git -C ../home
    worktree remove ../home-168`, `git -C ../home branch -d issue-168`,
    delete `data-scratch/claims/SEARCH-SHAPE-01.claim`. A failed push
    is reported as blocked, never forced.

## Acceptance evidence

- Both tests exist under the names above, were red before Decision 1
  (say so), and are green after.
- The gate's first line (scope) and final result.
- The review's level, wall time, pass count, each finding's
  disposition.
- The A/B: engine port used, the four trimmed replies, pass or skip
  with the reason.
- `git show --stat HEAD` on `main` after the fast-forward, and the
  push result.
- The hub on 8787 was not restarted by you; the live check on it is
  Jesse's and is named as outstanding in the tick.

## Reporting contract

Final report, in order: the model line and the worktree line; `done
SEARCH-SHAPE-01` or `blocked SEARCH-SHAPE-01`; then each acceptance
bullet answered. On blocked: the exact failing assertion or error
pasted, what you tried, your guess at the class (environment, unclear
requirement, reasoning). A question you cannot answer from this order
and the cited code: stop and ask it in the report. Low context: say
what is in the tree and what is left, commit nothing, stop.
