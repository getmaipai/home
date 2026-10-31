# Delivery pipeline: change, land, test, ship

Dev tier. How a change goes from an edit to the live hub on the Mac Studio, who owns each step, what it costs, and what to do when a step fails. Built 2026-10-24 and 2026-10-25. It replaces the per-session gate, the gate stamps and the tag-first release for Home; repos without a lander (stack, commons, bot, `.github`) still use the old flow described in the org `docs/VERIFICATION.md`.

## 1. Why it exists

Measured over 2026-10-17 to 2026-10-24, before this design:

| Measure | Value |
|---|---|
| Commits on `main` per day | 36 to 142 |
| Gate runs in 7 days | 2009, 57.7 hours of wall clock (8.2 hours a day) |
| Full gate, wall time | median 6.3 min, 90th percentile 10.5 min |
| Gate runs that were red | 419 of 714 |
| Wait for the machine-wide gate lock | up to 22 min |
| Most-edited files (conflict magnets) | `docs/BACKLOG.md` 177, `CHANGELOG.md` 101, `docs/api/openapi.json` 77, pins and generated files |
| Releases blocked by a development hub on 8787 | 3 on 2026-10-23 |

The suite itself costs minutes of CPU, not hours. The time went to every session running its own gate behind one lock, stamps that went stale on every edit, a release with five moving parts, and sessions sharing a main checkout, a port and a lock. The goals set by the owner:

1. See a change at once, in a seeded app.
2. Land without waiting, queuing or conflicts, across many sessions.
3. Ship to the live hub fast, with a way back.

Where it ended up (measured on the Studio):

| Step | Time |
|---|---|
| See a change (dev preview) | 1 to 3 s |
| Land on `main` | average 54 s, median 48 s, 10 to 127 s (32 landings, 2 bounced) |
| Ship to the live hub | 156 s (first ship, with a first-time mirror clone) |
| Full test suite after landing, on a quiet machine | 203 s |
| Same suite while other jobs were running | 4 to 35 min |

## 2. The idea in three rules

1. **Sessions only edit, look, commit and push.** One process on the machine, the lander, owns `main`. A session never waits for another and never holds a machine-wide lock.
2. **Landing runs a 15 to 60 second static check, not the tests.** Tests run once after landing, on the exact `main` commit, by one watcher. A red names the commit that caused it. Shipping waits for the watcher's green mark, or the owner says so explicitly.
3. **One heavy process at a time, and nobody hand-edits the files everyone conflicts on.** Backlog status lines, regenerated files and pins are written by the lander or `pin.sh`.
   Heavy runs (RUN-GUARD-01, 2026-10-30): `gate-lock.sh heavy <name> -- <cmd>` allows two at once machine-wide, waits (at most 15 minutes, with a plain message) while load is over 20 or free memory is under 25%, runs at background priority (`taskpolicy -b`), and stops its own process group by group id if it passes a memory cap. `wt.sh check` wraps the beside-tests, `--pre` and the gate this way; `MAIPAI_HEAVY=0` turns it off. The default cap is 8 GB; the full gate's measured peak was 3.0 GB (2026-10-30, through the a11y step), so the gate runs under it with headroom. `wt.sh reap` also runs `gate-lock.sh reap` (RELIABILITY-PREVENT-09): it stops only a process group that a finished heavy run recorded and left behind, by its recorded group id, and only lists a process over 12 GB or a `data-test/run-*` leftover in a worktree or scratchpad (pid, age, size, worktree) for a person to decide.

## 3. The flow

```
 session worktree                    this Mac, always on (launchd)                 live hub
 ----------------                    ------------------------------                ---------
 bun run dev   (see it)
 git commit    (by file name)
 land.sh  ---- push branch --->  queue ---> LANDER (warm checkout ../home-lander)
                                             rebase on main
                                             generate files, mark backlog items
                                             static check (T2: also tests)
                                             push main  -------------------> origin/main
                                             delete branch, write note
                                                                |
                                         WATCHER (warm checkout ../home-watcher)
                                             wait for a quiet machine
                                             suite on main: scripts, backend, frontend
                                             green  -> data-scratch/watch/green/<sha>
                                             red    -> culprit, note, GitHub issue
                                                                |
 ship.sh  ---- needs green (or --before-green) --> maipai-promote (root) ----> sha-<7> label,
                                             health check, rollback on failure   data snapshot first
 ship.sh --tag  ----> next vX.Y.Z at the live commit, GitHub release
```

## 4. Components

| File | Role |
|---|---|
| `scripts/dev.sh`, `scripts/seed.ts` | `bun run dev`: seeded hot-reload Home per worktree. `seed.ts` is the one demo-household seeder, shared with the chat smoke. |
| `scripts/land.sh` | A session's landing command: pushes the branch, queues a request, waits for the verdict. |
| `scripts/lander.sh` | The lander: takes requests oldest first, runs every landing step, writes notes. |
| `scripts/watcher.sh` | The watcher: runs the suite on `main`, classifies, bisects, files issues, writes green marks. |
| `scripts/pipeline.sh` | `status`, `start`, `stop`, `install-service`, `uninstall-service` for the two daemons. |
| `scripts/ship.sh` | Promote a landed commit to the live hub; `--tag` cuts the release. It does nothing when that commit is already live and the hub answers (a repeat install can break a working hub: 2026-10-27); a hub that is not answering is still repaired, and `--reinstall` forces it. |
| `scripts/maipai-promote`, `scripts/install-promote.sh` | The one root helper and its one-time setup. |
| `scripts/install.sh --commit <sha>` | Installs a commit of `main` from a root-owned mirror, recorded as the label `sha-<first 7>`. |
| `scripts/pin.sh` | One command to bump a commons, Stack or bot pin and land it. |
| `scripts/gate/shardTests.ts` | The test sharder: splits a workspace's test files across worker processes by measured seconds. |
| `scripts/gate/test-timings.json`, `flakes.json` | Measured seconds per test file; the lists of serial and bench-only files. |
| `scripts/runTemp.ts` | Per-process temp roots, with a sweep of leftovers from killed runs. |
| `scripts/wt.sh` (and the org `standards/bin/wt.sh`) | Worktree start, run (Codex), done; `land` hands off to `land.sh`. |

## 4a. Where state lives

All under `<main checkout>/data-scratch/` (git-ignored), unless noted.

| Path | Holds |
|---|---|
| `land/queue/<time>-<branch>.json` | A landing request: branch, sha, worktree, session, note, backlog items. `queue/bad/` holds unreadable ones. |
| `land/notes/<branch>.json` and `.md` | The verdict for a branch: landed or bounced, the reason, the last 40 lines of the check output. |
| `land/landings.jsonl`, `lander.log`, `lander.pid` | Every landing and bounce with seconds; the daemon's log and pid. |
| `watch/runs.jsonl` | One line per suite run: sha, result (`green`, `flaky`, `red`), seconds, failing files, culprit. |
| `watch/green/<sha>` | Empty marker: the suite passed on that commit. `ship.sh` checks it. |
| `watch/reds/<sha>.md` | A red note: failing files, culprit commit, last 60 lines of output. |
| `watch/flake-issues.json`, `watcher.log`, `watcher.pid` | Files already reported as repeat flakes; the log; the pid. |
| `ship/shipped.jsonl`, `ship/<time>-<sha7>.log` | Every ship and its result; the promote helper's output. |
| `ship/ship.lock.d/` | The ship lock (`pid`, `what`): one ship at a time. A second `ship.sh` waits up to `MAIPAI_SHIP_LOCK_WAIT` seconds (900), clears a lock whose pid is gone, then re-reads the live tag and does nothing when the live hub already includes its commit. Before stopping anything it waits up to `MAIPAI_SHIP_QUIET_WAIT` seconds (180) for running engine jobs (`/stack/v1/jobs`), then installs anyway and says what it interrupted. |
| `pipeline-bin/lander.sh`, `watcher.sh` | The copies of the two scripts the daemons actually run (section 8). |
| Outside the repo | warm checkouts `../home-lander` and `../home-watcher`; `/usr/local/maipai-home-src.git` (root-owned mirror); `/usr/local/libexec/maipai-promote` and its sudoers line; `~/Library/LaunchAgents/com.maipai.lander.plist` and `.watcher.plist`. |

## 5. Seeing a change

`bun run dev` in your worktree runs the backend with `bun run --hot` and Vite with hot module reload, with no build. A frontend edit shows in about a second, a backend edit restarts the hub in one to three seconds.

- **Data:** `data/dev/hub`, a throwaway directory seeded once through `seed.ts` (Sage the owner, Marlow a teen, Nova a child, tours off). A marker file `data/dev/seeded` is written only after the seeder exits 0, so a start that died half way is replaced, not mistaken for a seeded one. `dev.sh reseed` starts fresh.
- **News content:** with the dev Home running, `cd backend` then `MAIPAI_DATA_DIR=../data/dev/hub MAIPAI_BACKUP_DIR=../data/dev/hub/backups MAIPAI_KEYSTORE_BACKEND=file MAIPAI_TEST_ALLOW_MULTIPLE_HUBS=1 MAIPAI_HUB_LOCK_PATH=../data/dev/hub.lock bun scripts/seed-news-review.ts` seeds 16 invented stories with pictures, turns the News shelf on and enables the News package (its smoke test can fail offline); open `/apps/news` as Sage.
- **Ports:** the backend port is 8800 plus a number from the worktree path; the app is that port plus 1000. A start probes forward through the 100 slots for a free pair and remembers it in `data/dev/port`. The main checkout would use 8787, but nothing previews there (section 12).
- **Exposure:** the dev hub listens on loopback only (`MAIPAI_LAN_EXPOSURE=loopback`, an environment override that the installed hub never sets).
- **Engine:** the real Stack on `127.0.0.1:8770` is used when it answers; `--no-stack` and `--stack <url>` override.
- **Rules for looking:** open the page yourself with the built-in browser, pick the seeded person, read the console when a page is blank, check desktop and phone width, then give the owner the URL. Home's `AGENTS.md`, "Previewing a change", has the steps. Never preview on the live hub (`localhost:3000`).

## 6. Landing

`bash scripts/land.sh [--detach] [--done ITEM-ID]... [--note "..."] [--queue-anyway]` from a `wt/*` worktree with a clean tracked tree.

**In the session:** refuse on a dirty tree, a branch with no commit over `origin/main`, or no running lander (exit 3, with the command to start it; `--queue-anyway` skips that). Push the branch, write a request, print `queued ... position N`, then wait for the note (default 900 s). Exit codes: 0 landed, 1 bounced, 2 timed out.

**In the lander, per request, oldest first:**

1. Fetch; the branch on origin must be at the requested sha, else bounce.
2. Rebase onto `origin/main`. A conflict bounces with the conflicting files named; the session rebases in its own worktree and lands again.
3. Reinstall dependencies only if `package.json` or `bun.lock` changed.
4. Run the generators (settings registry, API docs, elements adoption, code map). Changes are committed as `Generated: ...` by the lander, so sessions never commit them.
5. For each `--done ITEM-ID`, flip the open `- [ ] **ITEM:` line in `docs/BACKLOG.md` to done with the date and sha, committed by the lander. An unknown id bounces.
6. Static check: `scripts/check.sh --pre` (typecheck of backend, scripts and frontend, UI rules, secrets scan, PII wordlist, drift checks) plus eslint. About 15 to 40 seconds.
7. **Safety surface (T2):** if the branch touches a path in `WT_T2_GLOBS` (read from `scripts/wt.sh`: `RULES.md`, auth, credentials, consent, child and teen gates, migrations), also run the backend and frontend suites through the sharder; a failure bounces with the failing files.
8. Push `main` (fast-forward, up to three rebase retries; a re-check only if main's change overlaps the branch's files). Delete the remote branch. Write the note and a `landings.jsonl` line.
9. Fast-forward the main checkout to `origin/main` when it is clean, unlocked and on `main`, so scripts there stay current. The hook that blocks sessions from changing that checkout does not apply to the daemon.

No gate stamp is needed for a T1 commit when the repo has `scripts/land.sh`: the commit hook in the maipai plugin (0.11.x) lets it through. T2 commits still need their stamp and review.

## 7. Testing after landing: the watcher

The watcher runs the whole suite on the newest `origin/main` in its own checkout and answers one question: is main green, and if not, which commit broke it.

- **Waits for a quiet machine** before a run: no landing queued, the CPU used by our own work (bun, node, codex, tsc, vite, eslint, the Stack) under 200% (two cores), and at least 40 GB of free memory. It gives up waiting after 30 minutes and runs anyway. The whole machine's load average is not used: on the Studio it sits near 20 with an idle CPU.
- **Takes the machine gate lock** around the run, so it never overlaps a full `check.sh` gate from another repo.
- **Runs three legs, one after another** (memory-safe): scripts, backend, frontend, each through `shardTests.ts`. A failing leg does not stop the next. A leg that dies without an exit status counts as failed (137).
- **Classifies:** each failing file is rerun alone up to three times (`MAIPAI_WATCH_RERUNS`). Passing on any rerun makes the run `flaky` (counted green, with the files named); failing every time makes it `red`.
- **Red:** bisects the first-parent commits since the last green by rerunning only the failing files at each, writes `reds/<sha>.md` with the culprit, and files or updates a GitHub issue (`Watcher: main red at <sha7>: <file>`).
- **Repeat flakes:** a file flaky in three runs within seven days is reported once as an issue, so it gets moved to the serial or bench list with its cause.
- **Green** writes `green/<sha>`, which is what `ship.sh` looks for.
- `bash scripts/pipeline.sh status` prints the `main:` line (green, flaky, red with culprit); `land.sh` prints it before queueing and warns when the branch touches a failing file.

## 8. The daemons

The lander and watcher run as user LaunchAgents (`pipeline.sh install-service --load`): started at login, restarted if they exit, logs in `land/lander.log` and `watch/watcher.log`. They run copies of their own scripts, taken from `origin/main` into `data-scratch/pipeline-bin/`, never a checkout's files, because the lander rewrites its own checkout while it runs and the main checkout is not something sessions can update. Between requests each daemon refreshes its copy (at most once a minute) and `exec`s the new one, so landing a change to `lander.sh` or `watcher.sh` updates the running daemon without a restart. `pipeline.sh status` says whether each daemon's code is current. A stop is graceful: the watcher finishes the run in hand first, which can take a few minutes.

To restart by hand use a copy of `pipeline.sh` taken from `origin/main` (`git show origin/main:scripts/pipeline.sh`): the main checkout's own copy can be old and will relaunch old daemons.

## 9. Shipping

`bash scripts/ship.sh [sha|main] [--before-green] [--tag] [--dry-run]`, only when the owner says so in that turn.

**Run it on the Mac Studio only.** The live hub is marked by `/usr/local/maipai-home.live-hub`, beside the install directory so promotion cannot remove it. Create it once on the Studio with `sudo touch /usr/local/maipai-home.live-hub`. `ship.sh` also accepts the old `/usr/local/maipai-home/.live-hub` marker during migration. Any other Mac (the MacBook also holds a `com.maipai.home` install, so a launchd check cannot tell them apart) refuses with "this Mac is not marked as the live hub". From the MacBook, release with `localrelease` (`ssh studio-release`): the Studio's release-only key runs `scripts/release-home.sh`, which tags `origin/main` and installs the tag. It accepts a live `sha-<7>` label as long as that commit is on `origin/main`. On 2026-10-25 a session ran `ship.sh` on the MacBook; only the data guard stopped it.

1. The sha must be on `origin/main`, and the watcher must have written `green/<sha>`, or `--before-green` is given (recorded in `shipped.jsonl`).
2. Stop any development Home started from the main checkout.
3. Record the live tag, the migration count and the `app refused` count in the launchd log.
4. `sudo -n /usr/local/libexec/maipai-promote <sha>`: the root helper refreshes the mirror, refuses a commit that is not on `main`, extracts that commit's own `install.sh` and runs it with `--commit`. The installer snapshots the data first, swaps the source, builds, restarts the service and records `sha-<first 7>` in `.installed-tag`, the old tag in `.previous-tag`.
5. Health, polled for up to 90 s: web page 200, Stack health ok, migrations not fewer, no new `app refused`, the installed label equal to the sha.
   The installer stops the hub, then saves a copy of `data/` before it upgrades, and the hub stays stopped until the copy ends. That copy skips any file over 512 MB (`MAIPAI_SNAPSHOT_SKIP_MIN`): offline books and downloaded models are already compressed and can be downloaded again, and a rollback puts them back from the data it set aside (the list is `excluded.txt` beside the copy). `ship.sh` also refuses, before anything is stopped, when the files the copy would still hold total more than 5 GB (`MAIPAI_SHIP_MAX_COPY_BYTES`), so a new kind of large data cannot hold a release for an hour again (2026-10-30, a 127 GB Wikipedia). `--allow-big-copy` overrides it, only when the owner accepts the wait.
6. On any failure: `maipai-promote --rollback` (the installer's own rollback to the previous tag and its data copy), then the same health check. The installer writes `.previous-tag` as soon as the data copy exists, so a ship that dies part way rolls back to the version that was live before it. `ship.sh` refuses up front, changing nothing, when the session has no desktop login (launchd gui domain), the cause of "Bootstrap failed: 5". The outcome is one line in `ship/shipped.jsonl`.
7. `--tag` cuts the next `vX.Y.Z` at the live commit, pushes it and publishes the GitHub release, with notes from the CHANGELOG section if one exists, otherwise one line per landed commit since the previous tag. A local tag that already exists is named with its commit and the command to remove it; it is never deleted for you.

The live hub reports a `sha-` label, not a release tag. The in-app update check treats an unparseable tag as "not newer", so nothing nags. Other households install tagged releases as before.

**Trust:** root never installs from a file a normal user can write. The only input to the helper is a hex string, the commit must be an ancestor of `main` in a root-owned bare mirror (`/usr/local/maipai-home-src.git`, which the helper refuses to use if it is not owned by root or has group- or user-writable files), and the installer it runs comes from that same commit. The sudoers rule is one line for `maipai-promote` and the older one for `maipai-install`; `install-promote.sh` (run once with sudo) writes the first and checks it with `visudo`.

## 10. Pins

`bash scripts/pin.sh commons <pkg>-vX.Y.Z | stack <sha> | bot <version> [--no-land] [--dry-run]` edits every file the pin lives in (both `package.json` files, the archive digests in `install.sh` and `maipai-engine`, `STACK_TAG` in both and `shared/diskPlan.json`, `botReleasePin.json`), runs `bun install --force`, commits and lands. Pin bumps were 17% of all commits and each used to be a hand edit across several files.

A pin that lands without its tag worktree makes the watcher red on unrelated tests (2026-10-27: `scripts/uiRulesPrecommit.test.ts` failed with "Cannot find module '@maipai/ui/tests/...'" because `main` pinned `ui-v0.5.396` and `../commons-tags/ui-ui-v0.5.396` did not exist on this machine, so the watcher's install left no kit). Fix it by creating the worktree, not by shipping over the red: `bash ../commons/scripts/ensure-tag.sh ui ui-vX.Y.Z` (or `spec spec-vX.Y.Z`), then repair the watcher's own install (`cd ../home-watcher/frontend && bun install --frozen-lockfile --force`; the watcher only reinstalls when a package file changes, so a link that dangled stays broken) and let the next landing re-run it. `wt.sh start` prints the same fix when it cannot create a tag worktree.

## 11. Agents and the test environment

- **Codex runs** use `scripts/wt.sh run codex <brief>`, which starts `codex exec -s workspace-write` in the worktree's own tmux session and sets `MAIPAI_TEST_NO_PORTS=1`. That switch makes the backend test setup skip its port probe and serve `port: 0` test servers in-process, so a sandbox that forbids binding ports can still run backend tests. The default path is unchanged. A test that needs a real listener for a child process fails there by design.
- **Dispatcher rule:** the session reads each diff, runs the tests (including the ones the sandbox cannot), commits by file name and lands. Codex never commits.
- **Cheap hashing in tests:** `backend/tests/preload.ts` lowers Argon2id to its cheapest cost in the test process only (`MAIPAI_TEST_REAL_HASH=1` restores production cost, and `secret.test.ts` sets it). Hashing was 72% of the time of the heaviest backend files; memory.test.ts went from 18.6 s to 2.6 s. No production code changed.
- **Temp directories:** every test process gets `maipai-run-<pid>-<random>` and removes it on exit; a run killed hard leaves it behind, so each new run first deletes such directories older than two hours whose pid is gone.

## 12. What was retired, and why

| Retired | Why |
|---|---|
| Per-session full gate and the 4-hour gate stamp (T1) | 2009 runs in a week, stamps invalidated by any edit. Landing runs the static check; tests run once after. |
| The machine-wide gate lock for Home landings | One runner, nothing to lock. The lock remains for repos without a lander, for T2 stamps and for the watcher's own run. |
| The background "main gate" that `wt.sh land` started | It ran a full gate in a stale checkout, went red on its own errors and competed with the watcher. The watcher replaced it. |
| Port leases, `bun start` and `bun restart` in the main checkout, a preview on 8787 | A development hub there blocked the installer three times. Preview is per worktree. A shared "main preview" on 8787 was in the first design and is not built. |
| `scripts/release-home.sh` for this Mac | Superseded by `ship.sh`. It remains for installing a tag. |

## 13. Operations

| Situation | What to do |
|---|---|
| Is it healthy? | `bash scripts/pipeline.sh status`: lander, watcher, code current, `main:`, queue, last landings. |
| `land.sh` says the lander is not running | `bash scripts/pipeline.sh start`, or check `launchctl list \| grep maipai`; `install-service --load` if the agents are missing. |
| A landing bounced | Read the note it printed (or `land/notes/<branch>.md`). Static check failure: fix and land again. Rebase conflict: rebase in your worktree. |
| `main:` is red | `watch/reds/<sha>.md` names the culprit and the failing files. Fix forward; nothing is reverted automatically. |
| A ship failed | It rolled back and said so. Read `ship/<time>-<sha7>.log`; the hub is on the previous tag. |
| Daemon runs old code | `pipeline.sh status` says "older than origin/main": restart it with the `pipeline.sh` from `origin/main` (section 8). |
| Leftover temp directories | They sweep themselves; a manual clean is safe for `maipai-run-*` directories older than two hours whose pid is gone. |

## 14. Test suite facts

Measured on the Studio (18 cores, 128 GB, the Stack's model holding about 35 GB):

- **Size:** 624 backend files (655 s of work), 303 frontend files (357 s), 39 scripts files (175 s).
- **A clean full run:** 203 s, run one leg after another, 6 flaky files rerun alone.
- **Worker counts:** the sharder allows up to cores minus 2, at most 16, bounded by a memory budget. The backend leg at 6 workers took 172 to 196 s and failed 1 run of 3 on shared state; at 8 workers 2 of 3 failed; at 12 workers 3 of 3 failed. More workers is not faster here: tests that share process-wide state collide. The watcher's defaults are 10 (backend), 12 (frontend), 8 (scripts), and the rerun rule absorbs the collisions; lower them if the reruns cost more than the extra workers save.
- **Outliers fixed:** `RailProfile.test.tsx` took 157 s and printed more than 10 GB when it failed (a regex name matched two menu items and every failure dumped the page); `benchSetup.test.ts` was one 49 to 70 s file, now three of 17 to 23 s; the four largest scripts test files were split by topic (scripts leg 99 s to 37 s).
- **A fail-fast run is not a timing:** the sharder stops at the first failing shard, so a short run can be a failed one. Measure with `--record`.
- **Do not run jobs beside a measurement.** Every 4 to 35 minute run in the record overlapped another heavy job.

## 15. Decisions, with the reason

| Decision | Reason |
|---|---|
| Landing is a static check, tests after | The suite is minutes of work; running it before every landing serialized the whole team. A red is found within one run and never reaches the live hub because shipping needs the green mark. |
| One lander, serial, in a warm checkout | Git lands serially anyway; a warm checkout makes each landing 30 to 60 seconds; no lock is needed. |
| The watcher runs legs sequentially and waits for free memory | Three parallel legs plus other jobs ran the machine out of memory (`ENOMEM`) on 2026-10-25. |
| "Busy" means our own CPU, not load average | The Mac's load average reads about 20 with an idle CPU; the whole-machine CPU includes the window server and screen sharing. |
| Red needs three failed isolated reruns | One failed rerun under load blamed an innocent commit and filed a false issue. |
| Daemons run copies from `origin/main` | A checkout under a running script, or an out-of-date main checkout, runs the wrong code. |
| A ship label `sha-<7>`, tags cut afterwards | The live hub should run a commit that was already tested; the tag becomes a label for what is live. |
| Root helper takes a sha from a root-owned mirror | Root must never run code a normal user can write. |
| Test-only cheap hash and in-process test servers live in the test setup | No production change for a test speed-up; both are off by default in production and by an explicit variable in tests. |

## 16. Known limits and open items

- Several test files that share process-wide state still flake when many workers run; the watcher reports them, and moving each to the serial list with its cause is routine work. The watcher's own "repeat flake" issue filing has a path bug (the issue body file is not found), so those issues are not created yet.
- The org repo's own `wt.sh` tests are timing-sensitive and fail when the machine is busy; landing org changes needs a quiet moment.
- A change reaches the live hub only through `ship.sh`; `ship.sh` does not reuse a build from the watcher, so a ship rebuilds (about 2.5 minutes).
- Other sessions on old worktrees still use the old path until they rebase onto a base that has `scripts/land.sh`.
- The shared main preview on 8787 from the first design was not built.
- Issue 231: an embedding that finishes after a person is erased still writes onto the erased memory (found while making backend tests runnable without sockets).

## 17. Slow hub diagnostics

The backend logs requests over 700 ms with their matched route pattern and samples event-loop lag every five seconds; windows over 200 ms p99 or 1,000 ms max include active scheduler and background work. Owners can read current lag and the last 50 slow request lines at `GET /api/performance/perf`.

## 18. History

Designed and built 2026-10-24 to 2026-10-25 in one session, with Codex writing the code and the session writing briefs, reading diffs, running the tests it could not hand off, and landing. First landing through the lander: 2026-10-24. First ship through `ship.sh`: `sha-1e8aa28`, 156 s, followed by `v0.2.124` cut at that commit. Incidents on the way, each fixed and recorded above: a stale local tag blocking the first tag; the lander's first bounce on a scripts type error; a main-gate red from its own stale checkout; an out-of-memory from three parallel test legs; and a watcher that waited its full 30 minutes because it judged "busy" by load average.

## When a picture, video, song or download fails on the live hub

Run `bash scripts/why-failed.sh` on the computer that runs the Stack. It lists the Stack's failed jobs from the last day with their plain reason, then the last worker failures from `stack.log` (`image.worker_failed`: the exception type, the frames where it happened and, for a missing module or file, the name). The Stack never logs a prompt, so these lines are safe to paste into a report. The Stack forgets its job list when it restarts, so run it before shipping.
