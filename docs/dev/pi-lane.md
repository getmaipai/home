# pi-lane: the local coder

`pi-lane` runs the Pi coding agent on one decided task against the household's own coding model (`maipai-coder-max`, on the hub's `/code/v1`). It adds guards for the failures we measured. It never commits and never runs a git write, so you read the diff, run the checks and commit by file name yourself. The method the model follows is in [local-coder-method.md](local-coder-method.md).

Use it for small decided tasks: one to about six files and a test that can fail. `local-lane dispatch` (OpenCode) stays as the fallback and for the `standard` and `boost` tiers. The Max model stays loaded for 10 minutes or more after the last answer, so batch Max tasks.

```
pi-lane status
pi-lane run --worktree <abs path> --brief <abs file> --test "cd backend && bun test ./tests/x.test.ts" \
            --edit backend/src/x.ts --detach --name <slug>
pi-lane status <slug>
```

Use absolute paths. Pass `--known-red PATTERN` for tests that already fail at baseline and are not part of the task. Pass `--edit` and `--new` to limit the files Pi may change.

## Verdicts

| Verdict | Meaning | What you do |
|---|---|---|
| `DONE` | Tests green, no new type errors. | Read the diff, run the gate, commit. |
| `RESIDUAL` | No new failures, but tests that were red before the run are still red. Exit code 0. | Declare them with `--known-red` next time. |
| `FAILED` | A check is red, or Pi edited a test or a file outside the list. | Read the receipt, adjust the brief, rerun. |
| `HUNG`, `TIMEOUT` | No activity for 5 minutes (one retry first), or the wall-clock cap. | Split the task smaller. |
| `REFUSED` | Preflight stopped it: missing file, a listed file already changed, a test command that matches nothing, a test that already passes. | Fix what the message says. |
| `BLOCKED` | The environment is wrong (stale packages, a missing file in a pinned package). | Fix the pin or the install. Do not retry the model. |

## Check the lockfile before a run

Most failed replays in the benchmark were environment problems, not model failures: a worktree whose `node_modules` did not match the lockfile, or a test run from the wrong folder.

1. In the worktree, run `bun install --frozen-lockfile` in `backend/` and in `frontend/`. A pinned `@maipai/*` package that points at a tag you do not have installed is the usual cause of a mismatch (see [PINNING.md](../PINNING.md)).
2. Write the test command so it runs from the right folder (`cd backend && bun test ./tests/x.test.ts`). With bun, a path without `./` can match no files.
3. Run the test once and confirm it fails for the reason the brief describes.

pi-lane does steps 1 and 3 itself before the baseline (`bun install --frozen-lockfile`, then one run of the acceptance command), and ends a run it cannot repair as `BLOCKED`. Doing them first still saves a 5 minute round trip. Never change a lockfile or `package.json` to make a run pass.

## What the guards do

- Preflight records the failing test names and the type-error set before Pi starts. Only new failures and new type errors count.
- A hook blocks git writes, edits outside the allowed list, edits to existing tests, and the first source edit before the acceptance command has run. After every edit it runs `tsc` (new errors only) and the per-file checks. In `frontend/` it adds `bun run lint:ui-rules`.
- Shell writes (`sed -i`, `tee`, redirects, heredocs) are blocked, so files change only through the edit tools and the checks run. Bash stays available so Pi can run tests.
- A watchdog kills a quiet process tree and retries once. A 503 from a cold model is retried for about 3 minutes.
- After a red check Pi gets the failure text back in the same session (up to 2 repairs), then one self-audit round that restates each requested change against the diff.
- A test or fixture the brief tells Pi to create or update is allowed even though it looks like a test file.
- A loop guard blocks the third identical tool call in a row.

## Settings that are off by default

| Setting | Effect | Status |
|---|---|---|
| `rtk` | Compacts command output (a 1.75 MB test log became 81 characters; one heavy run took 394 s instead of 764 s) | On |
| `PI_LANE_SAMPLING=qwen` | Temperature 0.6, top_p 0.95, top_k 20 | Off until an A/B shows a benefit |
| `PI_LANE_THINKING=low` | Lower thinking level | Off until an A/B shows a benefit |
| `--ext fork,context-kit` | Opt-in Pi extensions | Off until an A/B shows a benefit |

## Lessons from the benchmark

1. A brief with two parts gets half done. The self-audit round exists for that.
2. A test that is already green at the start gives nothing to prove, so preflight refuses it.
3. The first request after a quiet spell returns a fast 503 while the big model loads, so the lane retries.
4. A test command that matches no files makes the model waste steps and move its test to a wrong folder, so preflight validates the command and tells the model the form that works.
5. A baseline test that was already red makes every run look failed, so scoring compares against the baseline.
6. Judge by the diff plus the tests, not the tests alone. One run had correct code and a verdict of FAILED because of a baseline failure.
