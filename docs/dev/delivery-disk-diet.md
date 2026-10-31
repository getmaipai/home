# Delivery pipeline disk diet (design, 2026-10-31)

Status: approved by the owner to build, 2026-10-31. Goal: cut disk reads and writes on the build machine so landing is
faster and many sessions can work at once. Companion to [delivery-pipeline.md](delivery-pipeline.md).

## The problem, measured

- The machine runs at 0 percent idle CPU, two thirds of it system time: file and process churn, not computation.
- 235 entries sit under `wt/`; each worktree holds two `node_modules` trees of about 100k files, written by a fresh
  `bun install` in `wt.sh start`, again in the lander's warm checkout, and again by the full gate.
- About 40 sessions each run sleep-and-check loops, repo-wide greps, and `git status` over those trees. The Claude app
  also re-reads every session file and every worktree's session note every few seconds.
- Finished worktrees are never removed while their session is open, so the file count only grows.

## Principles

1. Write a dependency tree once; every worktree clones it (APFS copy on write), never reinstalls it.
2. A finished worktree is removed by the pipeline, not by the session that owned it.
3. A waiter sleeps (blocked read, zero disk) and the lander wakes it; nobody polls.
4. One small state map answers "who is where"; nobody walks 235 trees to find out.
5. Only the machine's own checkouts (main, lander, watcher) pay for the git file-system monitor.

## Supersedes

- DISK-REMOVE-01 replaces the 4 hour age gate in `wt.sh reap` for branches already on `origin/main` only (RELIABILITY-PREVENT-09
  and delivery-pipeline.md sections 4a and 19 keep their rules for unlanded work).
- DISK-WAIT-01 replaces the 1 second polling loop in `land.sh` (LAND-QUEUE-01, delivery-pipeline.md sections 6 and 19); the
  queue order, the replace-earlier-request rule and the timeout stay.
- DISK-DEPS-01 replaces the per-worktree `bun install --frozen-lockfile` in `wt.sh start` (delivery-pipeline.md section 4)
  and the lander's warm-checkout install when the hash matches; a changed lockfile still runs a real install.
- DISK-MAP-01 adds a file; nothing is superseded.

## Reuse check (prebuilt options considered)

| Item | Prebuilt option | Why it is not enough |
|---|---|---|
| DISK-DEPS-01 | bun's global cache with its default `clonefile` backend | Already in use (cache is 2 GB). It saves download and unpacking, but every install still resolves, verifies and creates about 100k entries per tree. The golden clone is one `cp -cR`. Keep it only if a timed A/B on this machine shows the clone beats a warm-cache `bun install`; the acceptance test records both numbers. |
| DISK-DEPS-01 | pnpm store or symlinked `node_modules` | Rejected: a package manager migration, and tsc and Vite resolve through symlinks. |
| DISK-REMOVE-01 | `git worktree prune`, `wt.sh reap` | Prune only forgets deleted folders; reap exists but demands 4 hours of age and a dead session, so landed trees stay. We reuse reap's liveness checks and only add the landed-branch rule. |
| DISK-WAIT-01 | `flock` (absent on macOS), `shlock` (polls), `fswatch` (third-party, one watcher process per waiter), `lockf` | A FIFO is built into the OS, costs no process while blocked, and carries the event text. The lander already is the single owner of order. |
| DISK-MAP-01 | `git worktree list --porcelain`, the existing session JSON files | Both exist and are what the scans walk today. They carry no liveness or landed state, and reading 235 session files is the cost being removed. The map is a derived cache of those, rebuilt from them if deleted. |

## Changes, in build order

### DISK-DEPS-01 shared dependency clones
`data-scratch/deps/<hash>/{backend,frontend}/node_modules` is built once per hash of `package.json` plus `bun.lock` of that
workspace. `wt.sh start`, the lander's warm checkout and `check.sh` call one helper, `scripts/deps-clone.sh <dir>`:
hash matches then `cp -cR` the golden tree into place (clonefile, no data blocks copied); no match then `bun install
--frozen-lockfile`, and the result is cloned back into the store. Commons pins are `file:` dependencies, so the hash also
includes the pinned tag names in `package.json`. Old hashes are deleted when no worktree package file references them.
Acceptance: a second worktree on the same lockfile starts with no `bun install` and `du` shows no new data blocks;
`tsc` and `bun test` pass in the clone.

### DISK-REMOVE-01 the pipeline removes landed worktrees
After each landing, the lander (or `pipeline.sh sweep`, run by the lander once per cycle) removes a worktree when all hold:
its branch tip is an ancestor of `origin/main`, the tree is clean apart from ignored files, no process has the path as its
working directory, and nothing wrote in it for 10 minutes. Then `git worktree remove`, `git branch -d`, delete the session
and port files. It never uses `--force`; anything it cannot prove finished is listed in `reaped.md`. This replaces the 4 hour
age gate in `wt.sh reap` for landed branches only.

### DISK-WAIT-01 sleep, do not poll
`pipeline.sh wait <landed SHA | queue-empty | main-green | my-turn>` registers a FIFO under `data-scratch/land/waiters/<pid>`
and blocks on a read. The lander writes one line to each matching waiter on every state change. `land.sh` uses the same
call in place of its 1 second loop. Dead waiters (pid gone) are removed by the lander. A session never writes `sleep` loops
for a landing; `AGENTS.md` says so. Turn order stays the queue order; the lander is the only script that decides it.

### DISK-MAP-01 one state map, cheap git
`data-scratch/state/worktrees.json` is written atomically by `wt.sh start`, `land`, `done` and by the lander sweep:
path, branch, session, state (working, queued, landed, kept), last heartbeat. `wt.sh reap`, status panes and scripts read it
instead of walking trees. `core.fsmonitor=true` and `core.untrackedCache=true` are set on the main, lander and watcher
checkouts only, after a measurement of daemon memory and CPU.

### Later, measured first
- Scratch (`TMPDIR`, tsc build info, Vite cache) on a RAM disk for gate runs: keep only if a timed A/B beats the SSD.
- Batching two or three queued branches into one static check, with one-at-a-time fallback on failure.

## What not to do
A pnpm migration, symlinked shared `node_modules` (tsc and Vite resolve through symlinks), or speculative parallel testing:
all add risk for no disk saving beyond the clone approach.

## Rollout
Each change is its own landing, in the order above, behind a test that can fail. The lander and watcher pick up new
scripts themselves. Roll back by reverting the commit; the deps store and state map are caches and safe to delete.
