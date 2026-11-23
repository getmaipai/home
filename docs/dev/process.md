# Process sheet: run these, do not read the scripts

The exact commands for one change, start to landed. Full design of the pipeline: [delivery-pipeline.md](delivery-pipeline.md). What each
script is for: [../../scripts/INDEX.md](../../scripts/INDEX.md). Where code lives: [module-map.md](module-map.md); recipes: [recipes.md](recipes.md).

## Traps first
- On the Studio, source `data-scratch/bin/https-git.env` of the main checkout before any git, `wt.sh`, tag or push command (SSH to GitHub hangs).
- Judge `check.sh` and `verify.sh` by the exit code and their last line only; the output is long.
- Never write a sleep loop. Wait with `bash scripts/land.sh wait` or `bash scripts/pipeline.sh wait <SHA|queue-empty|main-green|branch B>`.
- Commit by file name, never `git add -A`. Hooks run on commit and can reject it: read the one-line reason.
- Never preview on 3000 (the live hub) or 8787 (the main checkout). Never run `ship.sh` without Jesse's word in that turn.
- `main: red` in `pipeline.sh status` can be older than your change; check the culprit sha before assuming it is yours.

## 1. Start (6 to 8 s)
- `bash scripts/wt.sh start <name>` makes the worktree and branch; `bash scripts/wt.sh port` leases an 88xx port.
- `bash scripts/fresh-check.sh` prints one line. STALE (over 20 commits or 12 h behind main): start a new worktree.
- Two failures: a missing `scripts/wt.sh` means a stale checkout (fetch, fast-forward `main`, start again); "worktree lock held" means another gate runs in this tree, wait for it.

## 2. Edit and look
- Backend: `cd backend && bun test <file>`. Frontend: `cd frontend && bun test <file>`.
- UI: `bun run dev` from the worktree (`bash scripts/dev.sh url` prints links, `bun run dev:stop` stops it). Open it, sign in as Sage, screenshot desktop and phone width.
- One failure: a start refused because another session holds the dev checkout names the holder; retry when it is returned.

## 3. Check
- `bash scripts/test-changed.sh` runs only the tests that cover your changed files (a few seconds); `--list` shows them.
- `bash scripts/verify.sh code|ui|docs` is the one command: typecheck, changed-file tests, `check.sh --pre` (or `--docs`). Log: `data-scratch/runs/verify-<mode>.log`.
- Full gate `bash scripts/check.sh` takes the machine-wide lock and is for risky surfaces (auth, credentials, migrations, `RULES.md`, `check.sh`, `wt.sh`).
- Two failures: "settings registry stale against spec" means a key is missing from the pinned spec (list it in `scripts/settings-ahead-of-spec.json` or pin the new tag); a code-map or scripts-index drift means run `python3 scripts/code-map.py` or `python3 scripts/make-scripts-index.py` and commit the file.

## 4. Commit and land
- `git add <files>` then `git commit`. Name the verify mode and the backlog item in the message.
- `bash scripts/land.sh --done ITEM-01` pushes to the lander's queue and waits for the verdict; it prints `landed-sha`. `--detach` then `land.sh wait` runs it in the background.
- The lander rebases, runs the generators, the 15 s static check and (safety surface) the T2 tests, then moves main; GitHub gets it from the next backup batch.
- Two failures: a rebase conflict bounces with the files named (rebase in your worktree, land again); "lander is not running" (exit 3) means `bash scripts/pipeline.sh start`.

## 5. After landing
- `bash scripts/where.sh [sha]` says whether the change is local, on GitHub main, in a tag, and live; `bash scripts/pipeline.sh status` shows the queue and the watcher's verdict.
- `bash scripts/wt.sh done` removes the worktree and stops its dev hub.
- Shipping to the live hub (`ship.sh`, `rush-ship.sh`) only on Jesse's word; see the `ship-home` skill.

## Background and long runs
Heavy jobs (tests, builds, temporary servers) go through `bash scripts/jobs/job.sh run ...`; see [dev-jobs.md](dev-jobs.md). Do not poll them: wait for the exit.
