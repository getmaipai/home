# Work order: MANIFEST-REFUSAL-01 (fixes #166)

Coordinator: Fable (session home-codex-01), 2026-09-26. Lane: one Claude
agent, Sonnet floor (the item closes an issue and changes a trace
shape). Issue: https://github.com/getmaipai/home/issues/166, read the
coordinator's comment on it first; it is the diagnosis, and the issue
body's own "suspected root cause" (the resolver) is wrong.

## Ready check, before any work

First line of your final report names the model your own system prompt
names. If it is not Sonnet or stronger, stop before touching anything
and report `ready-mismatch: <model>`. Second line: the worktree path
and branch you are on.

## Who you are and what you own

You are the MANIFEST-REFUSAL-01 lane. You own, and nobody else touches
while you hold the claim `data-scratch/claims/MANIFEST-REFUSAL-01.claim`:

- `backend/src/lib/turnMachine/nodes/policy.ts`
- `backend/src/lib/turnMachine/nodes/answer.ts`
- `backend/src/lib/turnMachine/contract.ts` (the `PolicyDecision` union
  only)
- `backend/src/lib/plugins.ts` (`loadManifestOnly()` only)
- `backend/tests/turnMachine/policy.test.ts`,
  `backend/tests/turnMachine/answer.test.ts`, `backend/tests/plugins.test.ts`
- `AGENTS.md` ("Pinning" paragraph, one added sentence)
- `docs/BACKLOG.md` (one new item line), `docs/dev.md` (one appended
  landing section), `CHANGELOG.md` (one line under Unreleased, if that
  section exists)

Forbidden: everything else. In particular `machine.ts`, `model.ts`,
`packageResolve.ts`, `paths.ts`, any manifest under `backend/packages/`,
the commons spec, and the hub on port 8787 (never restart it; that is
Jesse's call, see the issue).

Three other lanes are live on this repo right now (PEOPLE-GRID-01,
PROJECT-START-01, CORRECTION-02/MEM-ELIG-01, claims in
`data-scratch/claims/`). None of them owns your files. If you find
uncommitted changes in a file you own that you did not make, stop and
report; do not finish or revert them.

## Setup

Work in a sibling worktree, never under `home/.claude/worktrees/` (the
Agent tool's own worktree isolation nests there and breaks the
`file:../../commons-tags/...` pins; see the PEOPLE-GRID-01 claim for
the precedent). From the main checkout:

```
git -C /Users/jessetorres/Developer/github.com/getmaipai/home fetch origin main
git -C /Users/jessetorres/Developer/github.com/getmaipai/home worktree add ../home-166 -b issue-166 origin/main
```

Then `bun install` in `../home-166/backend` (plain install; the pins
are unchanged). No server, no engine, no port: every check in this
item is a deterministic `bun:test` run and the gate. Tests use the
test DB through `tests/reset-db`.

## The state you inherit (read, verified by the coordinator)

- `loadManifestOnly()` (`backend/src/lib/plugins.ts:121`) returns
  `{ok:false, status:404}` when the manifest file is absent or
  unreadable, and `{ok:false, status:400, error:"package <id>'s
  manifest failed validation: <zod message>"}` when the file parses but
  `PackageManifest.safeParse` rejects it. The schema is `.strict()`
  (commons `spec/gen/ts/manifest.ts:224`), so an unknown key is a
  validation failure.
- `policyNode` (`backend/src/lib/turnMachine/nodes/policy.ts:211-216`)
  treats every `!loaded.ok` the same: `noteRefusal("unknown_tool",
  call.tool)` and a decision `{allow:false, reason:"unknown_tool"}`.
  `loaded.error` and `loaded.status` are dropped. The node outcome
  (`policy.ts:262`) is `{ok:false, code, arg}`; `NodeOutcome`
  (`contract.ts:249`) already allows an optional `message` on the
  `ok:false` variant, added by GENFAIL-01 for the model node's engine
  text, with the GROUND-01 rule that it is never a household member's
  words and is length-bounded before it lands (`nodes/model.ts` does
  the bounding for its own message; find that and reuse the same bound).
- `PolicyDecision` (`contract.ts:72-74`) lists the refusal reasons;
  `PolicyRefusedReason` in `answer.ts:23` is derived from it, and
  `policyRefusalLine()` (`answer.ts:71-76`) maps `unknown_tool`,
  `ungrounded_args` and `context_tool_in_policy` to the one honesty
  line "I don't actually have that in this conversation, so I won't
  guess." `machine.ts:471` builds the `policy_refused` answer input.
- What happened live on 2026-09-26: the hub process booted at 16:18
  with spec-v0.1.38 in memory; INCOGNITO-04 (0887c077, 17:16) added an
  `incognito` key to every bundled manifest; the mtime-keyed cache
  re-read them; v0.1.38 rejects the key; every tool became
  `unknown_tool` with no diagnostic anywhere, and the household saw the
  honesty line. Proven: parsing the live websearch manifest with the
  v0.1.38 schema fails with `unrecognized_keys: incognito`.
- Tests: `backend/tests/turnMachine/policy.test.ts` unit-tests
  `argsGrounded()` directly and loads the real websearch manifest;
  nothing drives `policyNode` itself yet. `backend/tests/
  packageResolve.test.ts:16-27` shows how a test installs a package by
  inserting a `packageInstalls` row (`resetDb()` in `beforeEach`);
  `installedPackageVersionDir(id, version)` from `@/lib/paths` is where
  such an install's files live, so a test can write a manifest there.
  `__resetPackageCachesForTests()` (`plugins.ts:98`) clears the caches.
  `backend/tests/turnMachine/answer.test.ts:10-11` shows the minimal
  `STATE`/`SIGNAL` fixture for calling a node directly.
- Logging convention in `backend/src/lib`: `console.warn` with a
  bracketed tag (`[conversation]`, `[background]`); there is no logger
  module.

## Decisions (made; do not reopen)

1. **Split the reason.** `PolicyDecision` gains `"manifest_invalid"`.
   `policyNode` maps loader `status: 400` to `manifest_invalid` and
   everything else (`404`, an invalid id) stays `unknown_tool`. The
   node outcome for a `manifest_invalid` refusal carries `message:
   loaded.error` (bounded the way model.ts bounds its engine message);
   `unknown_tool` keeps `code` and `arg` only, as today. Additive
   change to a persisted trace shape, no field removed.
2. **Log it once.** `loadManifestOnly()` emits one `console.warn(
   "[packages] <id>: manifest failed validation: <zod message>")` per
   (id, mtime) on the 400 path, and one `[packages] <id>: manifest.json
   is unreadable` on the parse-failure path. A 404 (no such package,
   the common case when a model invents a tool name) logs nothing.
   Keep the once-per-mtime memory in a small map beside
   `manifestCache`; it must not change the cache's own behavior.
3. **Copy.** `policyRefusalLine("manifest_invalid")` returns
   `"I can't do that right now. Something on my end isn't working."`
   `unknown_tool` keeps the honesty line (GROUND-01's ruling stands: a
   tool the model invented is refused without guessing).
4. **Process note.** One sentence appended to AGENTS.md's "Pinning"
   paragraph: a change to a bundled manifest or to the spec pin is not
   live on 8787 until the hub restarts, because the running process
   re-reads edited manifests against the schema it booted with, and the
   done report for such a change says whether the restart happened.

## Steps, in order

1. Setup above. Read the cited lines, not the whole files.
2. Write the three regression tests first, red, in these words:
   - policy.test.ts: "a package whose manifest fails validation is
     refused as manifest_invalid with the validation message in the
     trace, and a package that does not exist stays unknown_tool with
     no message". Drive `policyNode` directly with a minimal
     `TurnState` (an adult actor, empty context, one `websearch`-shaped
     call for `test-pkg`), after inserting a `packageInstalls` row for
     `test-pkg` and writing a manifest with one unrecognized key
     (`"incognito_typo": true` on an otherwise valid copy of
     `backend/packages/websearch/manifest.json`) into
     `installedPackageVersionDir("test-pkg", "1.0.0")`. Assert the
     entry's `decision.reason`, the outcome's `code`, `arg` and that
     `message` names the offending key. Second case: `no-such-pkg`
     gives `unknown_tool` and `message` undefined. Clean up the temp
     dir and call `__resetPackageCachesForTests()` in `afterEach`.
   - answer.test.ts: "a manifest_invalid refusal says something on my
     end isn't working, never the honesty line", and the existing
     `unknown_tool` line is unchanged (add that assertion if no test
     pins it today).
   - plugins.test.ts: "a manifest that fails validation is warned about
     once per change, not once per read": `spyOn(console, "warn")`,
     load the same broken manifest twice, expect one call; touch the
     file (rewrite it), load again, expect two.
3. Make the four changes in Decisions 1 to 3. Docs in the same commit:
   the AGENTS.md sentence (Decision 4); the BACKLOG item (below); a
   short landing section appended to `docs/dev.md` titled
   "MANIFEST-REFUSAL-01 landed: a broken manifest is diagnosable
   (2026-09-26)" with the root cause in three sentences and the trace
   shape change; a CHANGELOG "Fixed" line if the file has an
   Unreleased section.
4. BACKLOG item, placed in "## The chat rebuild (2026-09-22)" directly
   after ENGINE-CONTRACT-02, ticked in the same commit, status line
   "verified at <hash>":
   `- [x] **MANIFEST-REFUSAL-01: a manifest that stops validating is
   diagnosable, not an unknown tool** (S, Sonnet, 2026-09-26; fixes
   #166, dev.md "MANIFEST-REFUSAL-01 landed").` then one line each for
   objective, files, mirror (packageResolve.test.ts's install fixture),
   the three tests by their names above, out of scope (the resolver,
   a hub self-restart, any manifest content), exit (`bash
   scripts/check.sh`).
5. Gate: `bash scripts/check.sh` from the worktree root, in the
   background with the tool timeout raised (it is a four-minute backend
   gate). Before starting it, `pgrep -f '[s]cripts/check.sh|[b]un
   test|[v]ite build'` must print nothing; otherwise wait in a capped
   loop (10 s between checks, 60 checks at most, then report). It
   should choose backend scope; the first line says which and why.
   A failure in a test your diff did not touch, with a port or memory
   error, is rerun once alone; a second one is reported, never fixed
   forward.
6. Review, started while the gate runs: `code-review` at **medium**,
   reason: a persisted trace shape and a policy guard. Target
   `main...HEAD` in `../home-166` explicitly, and read the path and
   branch the review reports before acting on any finding; a review of
   another path is discarded and rerun once with the target. One pass;
   fix hunks get a `low` re-review of those hunks only; no third pass.
7. Commit: `git status`, then stage each file by name, `git diff
   --cached --stat`, then one bare `git commit`. Title: `Fix #166:
   a manifest that fails validation is refused as manifest_invalid,
   logged once, with its own line`. End the body with the attribution
   line this session's system reminder gives. `git show --stat HEAD`
   before reporting.
8. Land: `git fetch origin main`; rebase `issue-166` onto `origin/main`
   if it moved (other lanes are landing tonight); if the rebase touched
   anything, run the gate again on the new tip. Then from the main
   checkout: `git -C ../home merge --ff-only issue-166`, `git -C
   ../home push origin main`. Then `git -C ../home worktree remove
   ../home-166`, `git -C ../home branch -d issue-166`, and delete
   `data-scratch/claims/MANIFEST-REFUSAL-01.claim`. A push that fails is
   reported as blocked, not retried into a force.

## Acceptance evidence

- The three tests exist under the names above, were red before the
  change (say so), and are green after.
- The gate output's first line (scope) and its final result.
- The review's level, wall time, pass count, and each finding's
  disposition.
- `git show --stat HEAD` on `main` after the fast-forward, and the push
  result.
- The 8787 hub was not restarted by you (state it).

## Reporting contract

Your final report has, in order: the model line and the worktree line
(Ready check); `done MANIFEST-REFUSAL-01` or `blocked
MANIFEST-REFUSAL-01` as the next line; then the acceptance evidence
above, each bullet answered. On blocked: the exact failing assertion or
error pasted, what you tried, and your own guess at the class
(environment, unclear requirement, reasoning). On a question you cannot
answer from this order and the cited code: stop and ask it in the
report rather than guessing. If context runs low, say what is in the
tree and what is left, commit nothing, and stop.
