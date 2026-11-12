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

1. **Sessions edit, look, commit and push.** One process on the machine, the lander, owns `main`. Session checks may wait for a heavy slot; they do not run unlimited pre-checks in parallel.
2. **Landing runs a 15 to 60 second static check, not the tests.** Tests run once after landing, on the exact `main` commit, by one watcher. A red names the commit that caused it. Shipping waits for the watcher's green mark, or the owner says so explicitly.
3. **Heavy work uses shared slots, and nobody hand-edits the files everyone conflicts on.** Backlog status lines, regenerated files and pins are written by the lander or `pin.sh`.
   Heavy runs use `gate-lock.sh heavy <name> -- <cmd>` (section 19): three machine-wide slots, oldest waiter first, background priority (`taskpolicy -b`), a bounded 120 s load delay, a hard wait below 25% free memory, and a 3600 s maximum wait. The default memory cap is 8 GB; the guard stops the run's process group if it exceeds the cap. The lander and watcher set `GATE_HEAVY_HELD=1` when they already own the guarded run. `wt.sh reap` also runs `gate-lock.sh reap` (RELIABILITY-PREVENT-09): it stops only a process group that a finished heavy run recorded and left behind, by its recorded group id, and only lists a process over 12 GB or a `data-test/run-*` leftover in a worktree or scratchpad (pid, age, size, worktree) for a person to decide.

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
                                             move the landed main (refs/pipeline/main)
                                             backup batch (every 5 min) ---> origin/main
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
| `scripts/land.sh` | A session's landing command: pushes the branch, keeps one newest queued request per branch, waits up to 3600 s for the verdict. |
| `scripts/lander.sh` | The lander: takes the newest request per branch, processes them oldest first, runs every landing step, writes notes. |
| `scripts/watcher.sh` | The watcher: runs the suite on `main`, classifies, bisects, files issues, writes green marks. |
| `scripts/pipeline.sh` | `status`, `start`, `stop`, `install-service`, `uninstall-service` for the two daemons; also `wait`, `sweep`, `outbox` and `stack on|off|status`. |
| `scripts/ship.sh` | Promote a landed commit to the live hub; `--tag` cuts the release. It does nothing when that commit is already live and the hub answers (a repeat install can break a working hub: 2026-10-27); a hub that is not answering is still repaired, and `--reinstall` forces it. |
| `scripts/maipai-promote`, `scripts/install-promote.sh` | The one root helper and its one-time setup. |
| `scripts/install.sh --commit <sha>` | Installs a commit of `main` from a root-owned mirror, recorded as the label `sha-<first 7>`. |
| `scripts/pin.sh` | One command to bump a commons, Stack or bot pin and land it. |
| `scripts/gate/shardTests.ts` | The test sharder: splits a workspace's test files across worker processes by measured seconds. |
| `scripts/gate/test-timings.json`, `flakes.json` | Measured seconds per test file; the lists of serial and bench-only files. |
| `scripts/runTemp.ts` | Per-process temp roots, with a sweep of leftovers from killed runs. |
| `scripts/wt.sh` (and the org `standards/bin/wt.sh`) | Worktree start, run (Codex), done; `land` always runs `land.sh` (section 22). |
| `scripts/rush-ship.sh`, `scripts/ship-now.sh` | The owner's fast path: `land.sh --express`, then `ship.sh` of the exact landed commit (section 22). |
| `scripts/nightly-stable.sh` | Moves `stable`, the last version to pass the required checks (section 22). Schedule off by default. |
| `scripts/nightly.sh` | The nightly job around `nightly-stable.sh`: host-guard gate, dated report, `run-now`, the 04:00 LaunchAgent (section 24). |
| `scripts/nightly-fixer.sh` | Unattended fix proposal after a failed nightly run; off by default, budget-capped (section 25). |
| `scripts/mode.sh`, `scripts/lib/mode.sh` | The one switch between DIRECT and GATED mode (section 23). Unset keeps today's pipeline. |
| `scripts/hooks/guard-shared.sh` | PreToolUse guardrail against a session's push to main and its restarts of shared services (section 22). |
| `scripts/landingHarness.ts`, `scripts/measure-commit-hooks.sh` | Acceptance harness on scratch repositories; per-step timing of git and commit hooks. |

## 4a. Where state lives

All under `<main checkout>/data-scratch/` (git-ignored), unless noted.

| Path | Holds |
|---|---|
| `land/queue/<milliseconds>-<branch>.json` | A landing request: branch, sha, worktree, session, note, backlog items. `queue/bad/` holds unreadable ones. Only the newest queued request per branch is active. |
| `land/notes/<branch>.json` and `.md` | The verdict for a branch: landed or bounced, the reason, the last 40 lines of the check output. |
| `land/landings.jsonl`, `lander.log`, `lander.pid` | Every landing and bounce with seconds; the daemon's log and pid. |
| `watch/runs.jsonl` | One line per suite run: sha, result (`green`, `flaky`, `red`), seconds, failing files, culprit. |
| `watch/green/<sha>` | Empty marker: the suite passed on that commit. `ship.sh` checks it. |
| `watch/reds/<sha>.md` | A red note: failing files, culprit commit, last 60 lines of output. |
| `watch/flake-issues.json`, `watcher.log`, `watcher.pid` | Files already reported as repeat flakes; the log; the pid. |
| `ship/shipped.jsonl`, `ship/<time>-<sha7>.log` | Every ship and its result; the promote helper's output. |
| `ship/ship.lock.d/` | The ship lock (`pid`, `what`): one ship at a time. A second `ship.sh` waits up to `MAIPAI_SHIP_LOCK_WAIT` seconds (900), atomically renames and removes a stale lock whose pid is gone; a pid-less lock older than 120 seconds is stale too. It then re-reads the live tag and does nothing when the live hub already includes its commit. Before stopping anything it waits up to `MAIPAI_SHIP_QUIET_WAIT` seconds (180) for running engine jobs (`/stack/v1/jobs`), then installs anyway and says what it interrupted. |
| `pipeline-bin/lander.sh`, `watcher.sh` | The copies of the two scripts the daemons actually run (section 8). |
| Outside the repo | warm checkouts `../home-lander` and `../home-watcher`; `/usr/local/maipai-home-src.git` (root-owned mirror); `/usr/local/libexec/maipai-promote` and its sudoers line; `~/Library/LaunchAgents/com.maipai.lander.plist` and `.watcher.plist`. |

## 5. Seeing a change

`bun run dev` in your worktree runs the backend with `bun run --hot` and Vite with hot module reload, with no build. A frontend edit shows in about a second, a backend edit restarts the hub in one to three seconds.

- **Data:** `data/dev/hub`, a throwaway directory seeded once through `seed.ts` (Sage the owner, Marlow a teen, Nova a child, tours off). A marker file `data/dev/seeded` is written only after the seeder exits 0, so a start that died half way is replaced, not mistaken for a seeded one. `dev.sh reseed` starts fresh.
- **News content:** with the dev Home running, `cd backend` then `MAIPAI_DATA_DIR=../data/dev/hub MAIPAI_BACKUP_DIR=../data/dev/hub/backups MAIPAI_KEYSTORE_BACKEND=file MAIPAI_TEST_ALLOW_MULTIPLE_HUBS=1 MAIPAI_HUB_LOCK_PATH=../data/dev/hub.lock bun scripts/seed-news-review.ts` seeds 16 invented stories with pictures, turns the News shelf on and enables the News package (its smoke test can fail offline); open `/apps/news` as Sage.
- **Ports:** the backend port is 8800 plus a number from the worktree path; the app is that port plus 1000. A start probes forward through the 100 slots for a free pair and remembers it in `data/dev/port`. The main checkout would use 8787, but nothing previews there (section 12).
- **Exposure:** the dev hub listens on loopback only (`MAIPAI_LAN_EXPOSURE=loopback`, an environment override that the installed hub never sets).
- **Engine:** the real Stack on `127.0.0.1:8770` is used when it answers; `--no-stack` and `--stack <url>` override.
- **Workbench (optional):** `bun run workbench` (`dev.sh start --workbench`) is the same hot-reload hub kept up between releases: data in `data/dev/workbench` seeded once and kept across stops, fixed ports 8780 and 9780 (`MAIPAI_WORKBENCH_PORT` or `--port` changes them), no idle stop, a tailnet-only `tailscale serve` address checked before it is printed, and a status note saying it is not the family hub. The backend gets `MAIPAI_WORKBENCH=1`, which leaves `WORKBENCH_SKIPPED_JOBS` (`backend/src/lib/scheduler.ts`: model warming, shows, companion life, engine updates, Home Assistant device schedules, the certificate renewal and update check) pending. It refuses ports 3000 and 8787 and any data directory under `/usr/local/maipai-home`. `bun run workbench:stop` stops it and removes its `tailscale serve` entry.
- **Rules for looking:** open the page yourself with the built-in browser, pick the seeded person, read the console when a page is blank, check desktop and phone width, then give the owner the URL. Home's `AGENTS.md`, "Previewing a change", has the steps. Never preview on the live hub (`localhost:3000`).

## 6. Landing

`bash scripts/land.sh [--detach] [--timeout SECONDS] [--done ITEM-ID]... [--note "..."] [--queue-anyway]` (and `bash scripts/land.sh wait` to wait on an earlier `--detach`) from a `wt/*` worktree with a clean tracked tree.

**In the session:** refuse on a dirty tree, a branch with no commit over `origin/main`, or no running lander (exit 3, with the command to start it; `--queue-anyway` skips that). Push the branch, replace any earlier queued request for that branch, write a millisecond-named request, print `queued ... position N`, then wait for the matching verdict (default 3600 s). It prints `waiting: position N of M` every minute. A commit already on `origin/main` is success, regardless of an older note. Exit codes: 0 landed, 1 bounced, 2 timed out.

**In the lander, newest request per branch, oldest request first:** superseded requests are logged as `superseded`; requests for commits already on `origin/main` are reported as `landed (already on main)`. The lander sets `GATE_HEAVY_HELD=1` for its checks so they do not wait for a session slot.

1. Fetch; the branch on origin must be at the requested sha, else bounce.
2. Rebase onto `origin/main`. A conflict bounces with the conflicting files named; the session rebases in its own worktree and lands again.
3. Reinstall dependencies in `backend` and `frontend` when their `node_modules` was not installed from the package files in the tree (install stamp, see "Dependencies in the warm checkouts"). Each stamp hashes that workspace's `package.json` plus the workspace root `package.json` and `bun.lock`, so root overrides and lock changes trigger reinstall.
4. Run the generators (settings registry, API docs, elements adoption, code map). Changes are committed as `Generated: ...` by the lander, so sessions never commit them.
   The generators import backend code that opens `<dataDir>/hub.db` and refuses a schema newer than the build, so each landing runs them with a private `MAIPAI_DATA_DIR` (`.gen-settings.XXXXXX/data` under the lander data directory, mode 0700, next to the scratch `MAIPAI_COMMONS_DIR`). The warm checkout's own `data/hub.db` is never opened: on 2026-11-02 a branch carrying schema 111 stamped it and every later landing at 110 bounced with `SchemaTooNewError`. The scratch directory is removed on success and on a bounce; any `.gen-settings.*` older than a day (a killed lander) is swept at the start of the next landing. `check.sh` gives its own generator runs the same private directory. `MAIPAI_LAND_GENERATE_CMD` receives the same `MAIPAI_DATA_DIR`.
5. For each `--done ITEM-ID`, flip the open `- [ ] **ITEM:` line in `docs/BACKLOG.md` to done with the date and sha, committed by the lander. An unknown id bounces.
6. Static check: `scripts/check.sh --pre` (typecheck of backend, scripts and frontend, UI rules, secrets scan, PII wordlist, drift checks) plus eslint. A bounce names the failed stage, for example `static check failed at pre: frontend typecheck`.
7. **Safety surface (T2):** if the branch touches a path in `WT_T2_GLOBS` (read from `scripts/wt.sh`; since AUDIT-GATE-01, 2026-11-06, it names real files: `docs/design/RULES.md`, the gate and delivery scripts (`check.sh`, `wt.sh`, `lander.sh`, `watcher.sh`, `ship.sh`), the sign-in, session, TOTP, passkey, API key, secret, credential, adult lock and Quick Connect files, consent, child, safety and age-band files, the turn safety node and tool gates, and `backend/src/db/migrations/*`; before that it listed directories that do not exist, so no auth change ran the full gate), also run the backend and frontend suites through the sharder; glob matching disables shell pathname expansion so newly added migration files match. If the T2 list cannot be read, the lander logs a warning and treats every changed file as T2. A failure bounces with the failing files. Other AUDIT-GATE-01 fixes: the install stamp hashes the workspace root `package.json` and `bun.lock` (the only lockfile); the watcher refuses to mark a sha green when it could not check it out and logs that once per sha; `pin.sh` runs its digest under `pipefail` and refuses the empty-file SHA-256; a stale ship lock is taken over atomically by rename, and a lock with no usable pid older than 120 s counts as stale.
8. Move the landed main (`refs/pipeline/main`, compare-and-swap) and write the note and a `landings.jsonl` line. GitHub gets it from the next backup batch (section 22); an express landing pushes before it answers.
9. Fast-forward the main checkout to `origin/main` when it is clean, unlocked and on `main`, so scripts there stay current. The hook that blocks sessions from changing that checkout does not apply to the daemon.

No gate stamp is needed for a T1 commit when the repo has `scripts/land.sh`: the commit hook in the maipai plugin (0.11.x) lets it through. T2 commits still need their stamp and review.

## 7. Testing after landing: the watcher

The watcher runs the whole suite on the newest `origin/main` in its own checkout and answers one question: is main green, and if not, which commit broke it. Each leg has its own process group and 1500 s watchdog; a timed-out leg is `stalled`, advances last-run, and creates no red, issue or bisect.

- **Waits briefly before a run:** quiet means no landing queued, the CPU used by our own work (bun, node, codex, tsc, vite, eslint, the Stack) under 200% (two cores), and at least 40 GB free memory. The quiet wait is capped at 300 s. A lander-busy condition counts only during the first 120 s. The whole-machine load average is not used as a quiet test.
- **Checks out before testing:** after detaching at the selected main SHA, the watcher verifies `HEAD` equals that SHA. A checkout failure is logged and skipped, so a previous tree cannot be marked green for the requested commit.
- **Repeat flake reports:** the issue body is written to a temporary file and passed with `--body-file`; the file is recorded in `flake-issues.json` only after issue creation succeeds.
- **Takes the machine gate lock** around the suite only (released before the reruns and the bisect), so it never overlaps a full `check.sh` gate from another repo and never holds the lock for hours.
- **Runs three legs, one after another** (memory-safe): scripts, backend, frontend, each through `shardTests.ts`. A failing leg does not stop the next. A leg that dies without an exit status counts as failed (137).
- **Classifies:** reruns wait once before the pass, then each failing file is rerun alone under `nice 10`, up to `MAIPAI_WATCH_RERUNS`. Passing on any rerun makes the run `flaky` (counted green, with the files named); failing every time makes it `red`.
- **Red:** the bisect has a 600 s budget, tests at most four newest-first candidates and reruns each file once per candidate. It considers only files failing every isolated rerun. If the budget ends first, it records no culprit and `unknown (bisect budget spent)`. A confirmed culprit is written to `reds/<sha>.md`, and a GitHub issue is filed or updated (`Watcher: main red at <sha7>: <file>`).
- **Repeat flakes:** a file flaky in three runs within seven days is reported once as an issue, so it gets moved to the serial or bench list with its cause.
- **Green** writes `green/<sha>`, which is what `ship.sh` looks for.
- `bash scripts/pipeline.sh status` prints the `main:` line (green, flaky, red with culprit); `land.sh` prints it before queueing and warns when the branch touches a failing file.

## 8. The daemons

The lander and watcher run as user LaunchAgents (`pipeline.sh install-service --load`): started at login, restarted if they exit, logs in `land/lander.log` and `watch/watcher.log`. They run copies of their own scripts, taken from `origin/main` into `data-scratch/pipeline-bin/`, never a checkout's files, because the lander rewrites its own checkout while it runs and the main checkout is not something sessions can update. Between requests each daemon refreshes its copy (at most once a minute) and `exec`s the new one, so landing a change to `lander.sh` or `watcher.sh` updates the running daemon without a restart. `pipeline.sh status` says whether each daemon's code is current. The helper libraries the scripts source (every `scripts/lib/*.sh`: `deps.sh`, `gitnet.sh`) are snapshotted the same way, into the same directory: `lander.sh` and `watcher.sh` copy all of them from `origin/main` (temp file, then rename) at startup before sourcing any, so a new script never runs against an older helper (LIBS-REFRESH-01). The lander repeats the copy every refresh and restarts when any helper changed; the watcher does the same. When `origin/main` cannot be read, the copies already there stay in use. A stop is graceful: the watcher finishes the run in hand first, which can take a few minutes.

To restart by hand use a copy of `pipeline.sh` taken from `origin/main` (`git show origin/main:scripts/pipeline.sh`): the main checkout's own copy can be old and will relaunch old daemons.

## 9. Shipping

`bash scripts/ship.sh [sha|main] [--before-green] [--tag] [--dry-run]`, only when the owner says so in that turn.

**Run it on the Mac Studio only.** The live hub is marked by `/usr/local/maipai-home.live-hub`, beside the install directory so promotion cannot remove it. Create it once on the Studio with `sudo touch /usr/local/maipai-home.live-hub`. `ship.sh` also accepts the old `/usr/local/maipai-home/.live-hub` marker during migration. Any other Mac (the MacBook also holds a `com.maipai.home` install, so a launchd check cannot tell them apart) refuses with "this Mac is not marked as the live hub". From the MacBook, release with `localrelease` (`ssh studio-release`): the Studio's release-only key runs `scripts/release-home.sh`, which tags `origin/main` and installs the tag. It accepts a live `sha-<7>` label as long as that commit is on `origin/main`. On 2026-10-25 a session ran `ship.sh` on the MacBook; only the data guard stopped it.

1. The sha must be on `origin/main`, and the watcher must have written `green/<sha>`, or `--before-green` is given (recorded in `shipped.jsonl`).
2. Stop any development Home started from the main checkout.
3. Record the live tag, the migration count and the `app refused` count in the launchd log.
4. `sudo -n /usr/local/libexec/maipai-promote <sha>`: the root helper refreshes the mirror, refuses a commit that is not on `main`, extracts that commit's own `install.sh` and runs it with `--commit`. The installer snapshots the data first, swaps the source, builds, restarts the service and records `sha-<first 7>` in `.installed-tag`, the old tag in `.previous-tag`.
5. Health, polled for up to 90 s: web page 200, Stack health ok, migrations not fewer, no new `app refused`, the installed label equal to the sha.
   The installer stops the hub, then saves a copy of `data/` before it upgrades, and the hub stays stopped until the copy ends. The copy excludes the single `SNAPSHOT_SKIP_DIRS` list: `data/reference`, `data/models`, `data/deno`, `data/sidecars`, `data/cache`, `data/tmp`, `data/engines` and `data/logs`. It logs `Skipped in the data copy (downloaded again when needed): ...`; rollback restores each excluded folder from the data set aside and logs, for example, `Kept reference from the newer data`. See section 19 for the measured 120 GB copy incident and fix.
6. On any failure: `maipai-promote --rollback` (the installer's own rollback to the previous tag and its data copy), then the same health check. The installer writes `.previous-tag` as soon as the data copy exists, so a ship that dies part way rolls back to the version that was live before it. `ship.sh` refuses up front, changing nothing, when the session has no desktop login (launchd gui domain), the cause of "Bootstrap failed: 5". The outcome is one line in `ship/shipped.jsonl`.
7. `--tag` cuts the next `vX.Y.Z` at the live commit, pushes it and publishes the GitHub release, with notes from the CHANGELOG section if one exists, otherwise one line per landed commit since the previous tag. A local tag that already exists is named with its commit and the command to remove it; it is never deleted for you.

The live hub reports a `sha-` label, not a release tag. The in-app update check treats an unparseable tag as "not newer", so nothing nags. Other households install tagged releases as before.

**Trust:** root never installs from a file a normal user can write. The only input to the helper is a hex string, the commit must be an ancestor of `main` in a root-owned bare mirror (`/usr/local/maipai-home-src.git`, which the helper refuses to use if it is not owned by root or has group- or user-writable files), and the installer it runs comes from that same commit. The sudoers rule is one line for `maipai-promote` and the older one for `maipai-install`; `install-promote.sh` (run once with sudo) writes the first and checks it with `visudo`.

## 10. Pins

`bash scripts/pin.sh commons <pkg>-vX.Y.Z | stack <sha> | bot <version> [--no-land] [--dry-run]` edits every file the pin lives in (both `package.json` files, the archive digests in `install.sh` and `maipai-engine`, `STACK_TAG` in both and `shared/diskPlan.json`, `botReleasePin.json`), runs `bun install --force`, commits and lands. Pin bumps were 17% of all commits and each used to be a hand edit across several files.

**A Stack pin that changes what the Stack returns lands after the Home change that reads it (ADULT-LOCK-03, 2026-11-02).** Stack `cbd93b3` (ADULT-LOCK-04) redacts every adult job unless Home sends the full-view headers; Home sends them since the ADULT-LOCK-03 commit. Pin a Stack at or after `cbd93b3` only when that commit is on `main` and was proved against the real Stack (docs/dev/adult-lock.md, "The Stack's full view"). The order for any such change: Stack lands on its `main`, Home's reading side lands and is proved against it, then `bash scripts/pin.sh stack <sha>` as its own commit, then (with Jesse's word) `bash scripts/ship.sh`. A live hub whose Stack is newer than its Home would show adult clips as failed.

A pin that lands without its tag worktree makes the watcher red on unrelated tests (2026-10-27: `scripts/uiRulesPrecommit.test.ts` failed with "Cannot find module '@maipai/ui/tests/...'" because `main` pinned `ui-v0.5.396` and `../commons-tags/ui-ui-v0.5.396` did not exist on this machine, so the watcher's install left no kit). Fix it by creating the worktree, not by shipping over the red: `bash ../commons/scripts/ensure-tag.sh ui ui-vX.Y.Z` (or `spec spec-vX.Y.Z`); the watcher's next run repairs its own install, because a failed install leaves no install stamp (below). `wt.sh start` prints the same fix when it cannot create a tag worktree.

Self-healing installs (DEPS-SELFHEAL-01, 2026-11-02): the lander and the watcher install through `install_deps` in `scripts/lib/deps.sh` (kept fresh in the pipeline bin like `gitnet.sh`). Before `bun install` it reads each `file:.../commons-tags/<workspace>-<tag>` dependency, and when that folder is missing it fetches the commons tags (bounded) and runs the commons repo's `scripts/ensure-tag.sh` itself, so a landed pin bump no longer leaves the warm checkouts without the tag worktrees. A failed install, or one that leaves a dangling `node_modules/@maipai` link, deletes that one `node_modules` folder and tries once more. The settings generator now writes only where `MAIPAI_COMMONS_DIR` points, never into the shared commons checkout. If a tag truly does not exist, the bounce names it; push the tag in commons, then run `bash <commons>/scripts/ensure-tag.sh <workspace> <tag>`.

**Dependencies in the warm checkouts (INSTALL-STAMP-01, 2026-11-02).** The lander (`home-lander`, and the main checkout after a fast-forward) and the watcher (`home-watcher`) decide whether to install from what `node_modules` was installed from, never from git history. After every successful `install_deps`, `scripts/lib/deps.sh` writes `node_modules/.maipai-install-stamp` holding the sha256 of that directory's `package.json` and `bun.lock`, and it deletes the stamp before starting an install, so a failed or interrupted install is never trusted. Before each landing's static check, each watcher run and each main-checkout fast-forward, `deps_current` compares the stamp with the files in the tree about to be used; a missing, corrupted or different stamp means `bun install --frozen-lockfile --force` (bounded by `MAIPAI_LAND_INSTALL_SECONDS` / `MAIPAI_WATCH_INSTALL_SECONDS`, 600 s). Why: a bounced landing (rebase conflict, failed check) leaves the warm checkout's HEAD on the failed branch tip, so the old "diff `prev_sha` against the rebased sha" test saw no package change on the retry and `frontend/node_modules/@maipai/ui` stayed at the old tag, failing `pre: frontend typecheck` on every retry until someone ran `bun install --force` by hand (observed twice on 2026-11-02). A checkout installed before this change has no stamp, so its first landing or run does one forced install per directory. Nobody needs to run `bun install` in a warm checkout by hand.

## 11. Agents and the test environment

- **Codex runs** use `scripts/wt.sh run codex <brief>`, which starts `codex exec -s workspace-write` in the worktree's own tmux session and sets `MAIPAI_TEST_NO_PORTS=1`. That switch makes the backend test setup skip its port probe and serve `port: 0` test servers in-process, so a sandbox that forbids binding ports can still run backend tests. The default path is unchanged. A test that needs a real listener for a child process fails there by design.
- **Dispatcher rule:** the session reads each diff, runs the tests (including the ones the sandbox cannot), commits by file name and lands. Codex never commits.
- **Cheap hashing in tests:** `backend/tests/preload.ts` lowers Argon2id to its cheapest cost in the test process only (`MAIPAI_TEST_REAL_HASH=1` restores production cost, and `secret.test.ts` sets it). Hashing was 72% of the time of the heaviest backend files; memory.test.ts went from 18.6 s to 2.6 s. No production code changed.
- **Temp directories:** every test process gets `maipai-run-<pid>-<random>` and removes it on exit; a run killed hard leaves it behind, so each new run first deletes such directories older than two hours whose pid is gone.

## 12. What was retired, and why

| Retired | Why |
|---|---|
| Per-session full gate and the 4-hour gate stamp (T1) | 2009 runs in a week, stamps invalidated by any edit. Landing runs the static check; tests run once after. |
| The machine-wide gate lock for Home landings | One runner, nothing to lock. The lock remains for repos without a lander, for T2 stamps and for the watcher's suite. Session `--pre` checks use the heavy slots; the lander holds `GATE_HEAVY_HELD=1` so its own check never waits. |
| The background "main gate" that `wt.sh land` started | It ran a full gate in a stale checkout, went red on its own errors and competed with the watcher. The watcher replaced it. |
| Port leases and a preview on 8787 (`bun start` and `bun restart` still run the local app from `scripts/app.sh`, but nothing previews there) | A development hub there blocked the installer three times. Preview is per worktree. A shared "main preview" on 8787 was in the first design and is not built. |
| `scripts/release-home.sh` for this Mac | Superseded by `ship.sh`. It remains for installing a tag. |

## 13. Operations

| Situation | What to do |
|---|---|
| Is it healthy? | `bash scripts/pipeline.sh status`: lander, watcher, code current, `main:`, queued branches, last landings. A stalled watcher is shown as `main: stalled at ...`. |
| `land.sh` says the lander is not running | `bash scripts/pipeline.sh start`, or check `launchctl list \| grep maipai`; `install-service --load` if the agents are missing. |
| A landing bounced | Read the note it printed (or `land/notes/<branch>.md`) for the named failing stage. Fix and land again. Rebase conflict: rebase in your worktree. A duplicate request for a landed commit is reported as landed even if an older note says bounced. |
| `main:` is red | `watch/reds/<sha>.md` names the culprit and the failing files. Fix forward; nothing is reverted automatically. |
| A ship failed | It rolled back and said so. Read `ship/<time>-<sha7>.log`; the hub is on the previous tag. |
| Daemon runs old code | `pipeline.sh status` says "older than origin/main": restart it with the `pipeline.sh` from `origin/main` (section 8). |
| Queue deeper than 5 or the watcher says `stalled`, and nobody is using the app | `bash scripts/pipeline.sh stack off` stops the Stack (its chat engine holds about 32 GB), which frees memory and CPU for landings and the watcher. Bring it back with `stack on` before a ship's post-checks, an eval or a chat check, and say so in the session that needs it. `stack status` shows which. The owner's call whenever the family is using the hub. |
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
| "Busy" means our own CPU, not load average | The Mac's load average reads about 20 with an idle CPU; the heavy slots treat a high load as a 120 s delay, never a bar. |
| Red needs three failed isolated reruns | One failed rerun under load blamed an innocent commit and filed a false issue. |
| Daemons run copies from `origin/main` | A checkout under a running script, or an out-of-date main checkout, runs the wrong code. |
| A ship label `sha-<7>`, tags cut afterwards | The live hub should run a commit that was already tested; the tag becomes a label for what is live. |
| Root helper takes a sha from a root-owned mirror | Root must never run code a normal user can write. |
| Test-only cheap hash and in-process test servers live in the test setup | No production change for a test speed-up; both are off by default in production and by an explicit variable in tests. |

## 16. Known limits and open items

- Several test files that share process-wide state still flake when many workers run; the watcher reports them, and moving each to the serial list with its cause is routine work. For repeat flakes, the watcher writes the issue body to a temp file, passes its path to `gh --body-file`, and records the file as reported only when filing succeeds.
- The org repo's own `wt.sh` tests are timing-sensitive and fail when the machine is busy; landing org changes needs a quiet moment.
- A change reaches the live hub only through `ship.sh`; `ship.sh` does not reuse a build from the watcher, so a ship rebuilds (about 2.5 minutes).
- Other sessions on old worktrees still use the old path until they rebase onto a base that has `scripts/land.sh`.
- `check.sh --pre` slot control applies only to fresh worktrees. A worktree created before PRE-SLOT-01 keeps its old `check.sh` until it is rebased or recreated.
- Spotlight indexes `node_modules` in every worktree; `mds_stores` used 50% CPU for 17 h while indexing about 80 worktrees. Excluding the `wt/` folder in System Settings, Spotlight, Search Privacy is a manual step for the owner.
- The retired `home-main-gate` worktree was removed on 2026-10-31.
- `scripts/main-gate.sh` and its test, `studio-claude.sh`, `publish-docs.sh`, `leftovers.sh`, `preview-demo.ts` and `screenshotCompanions.ts` were deleted on 2026-11-06 (AUDIT-GATE-01): nothing referenced them. `docs/dev.md` keeps the history of the main-gate loop.
- The shared main preview on 8787 from the first design was not built.
- Issue 231: an embedding that finishes after a person is erased still writes onto the erased memory (found while making backend tests runnable without sockets).

## 17. Slow hub diagnostics

The backend logs requests over 700 ms with their matched route pattern and samples event-loop lag every five seconds; windows over 200 ms p99 or 1,000 ms max include active scheduler and background work. Owners can read current lag and the last 50 slow request lines at `GET /api/performance/perf`.

## 18. History

Designed and built 2026-10-24 to 2026-10-25 in one session, with Codex writing the code and the session writing briefs, reading diffs, running the tests it could not hand off, and landing. First landing through the lander: 2026-10-24. First ship through `ship.sh`: `sha-1e8aa28`, 156 s, followed by `v0.2.124` cut at that commit. Incidents on the way, each fixed and recorded above: a stale local tag blocking the first tag; the lander's first bounce on a scripts type error; a main-gate red from its own stale checkout; an out-of-memory from three parallel test legs; and a watcher that waited its full 30 minutes because it judged "busy" by load average.

## 19. Fixes of 2026-10-31

### Measurements

On the 18-core Studio, load average reached 70 to 100 with 0% CPU idle. Ten `tsc --noEmit` and 14 `check.sh --pre` processes ran at once across sessions. `mds_stores` (Spotlight) used 50% CPU for 17 h indexing about 80 worktrees.

In the last 6 h, landings had a 525 s median, 957 s p90 and 1295 s maximum, against the 54 s average design goal. The queue reached 18 requests, with one landing every 13 to 17 minutes. Twenty of 29 bounces were `static check failed`; one was `lint:ui-rules` timing out at Bun's 5 s default under load.

`land.sh` gave up after 900 s. Sessions queued the same branch again; the second request bounced with `branch not on origin` and overwrote the landed note. There were 17 such false bounces in 72 h.

The watcher had 178 red runs of 217 in 72 h, each with a different failing set from load-induced timeouts. One backend leg ran 5 h 38 min with no test process. A red bisect could rerun up to 10 files three times at each of eight candidates, with a 30 min quiet wait before each rerun; the machine gate lock was held by the watcher for 5.7 h.

`gate-lock.sh heavy` waited for load under 20, a value this Mac reads with an idle CPU, and gave up after 900 s. Sessions reported that they "waited because it is busy" and never resumed.

On 2026-10-30, one ship spent 3194 s in `tar` and ended with `Terminated: 15`. Its pre-upgrade data copy walked 120 GB of `data/`, including 119 GB in `data/reference`.

### Changes

Each fix landed as its own commit:

1. **LAND-QUEUE-01** (`scripts/land.sh`, `scripts/lander.sh`, `scripts/pipeline.sh`). There is one active request per branch. `land.sh` replaces an earlier queued request for that branch; the lander processes only the newest request per branch and logs `superseded`. A commit already on `origin/main` is reported `landed (already on main)` and `land.sh wait` treats it as landed regardless of the note. The default wait is 3600 s and prints `waiting: position N of M` every minute. Static-check bounces name the stage, for example `static check failed at pre: frontend typecheck`. The lander no longer logs `queue empty`. It exports `GATE_HEAVY_HELD=1` so its checks never wait for a session slot. `pipeline.sh status` lists queued branches and shows `main: stalled at ...`. Queue files use millisecond names.
2. **WATCH-BOUND-01** (`scripts/watcher.sh`). `MAIPAI_WATCH_QUIET_MAX_SECONDS` is 300, down from 1800; `lander busy` counts only for the first `MAIPAI_WATCH_LANDER_BUSY_SECONDS` (120). Each leg runs in its own process group under a `MAIPAI_WATCH_LEG_MAX_SECONDS` (1500) watchdog. A timed-out leg records `stalled`, advances last-run, and creates no red note, issue or bisect. Reruns wait once before the pass, not before every attempt, and run under `nice 10`. The bisect has `MAIPAI_WATCH_BISECT_MAX_SECONDS` (600), at most `MAIPAI_WATCH_BISECT_CANDIDATES` (4, newest first), and `MAIPAI_WATCH_BISECT_RERUNS` (1) per file. It uses only files that failed every isolated rerun. If its budget expires, it records a null culprit and `unknown (bisect budget spent)`.
3. **PRE-SLOT-01** (`scripts/check.sh`, `scripts/tests/wtFixtures.ts`, `scripts/gate/flakes.json`). `check.sh --pre` re-executes through `gate-lock.sh heavy` unless `GATE_HEAVY_HELD` is set. Session pre-checks queue for machine-wide slots instead of running many typechecks at once; lander and watcher checks carry the held flag. The `wt.sh` test fixture gives each run its own slot state through a scratch `XDG_STATE_HOME` and its own limits. `wtLandGate.test.ts` and `wtLifecycle.test.ts` move to the scripts bench lane because they start real worktrees, git fetches, tmux and the heavy wrapper. They missed timeouts in each watcher run while passing alone. `check.sh --bench` now has a scripts leg. Worktrees created before this change keep the old `check.sh` until rebased, so the effect grows as sessions start fresh worktrees.
4. **RUN-GUARD-02** (`getmaipai/.github` standards `bin/gate-lock.sh`). `GATE_HEAVY_SLOTS` is 3, up from 2. `GATE_HEAVY_MAX_LOAD` defaults to three times the core count (54 on the Studio); it adds a bounded delay of `GATE_HEAVY_LOAD_WAIT_SECONDS` (120), not a threshold that blocks work. Low free memory remains a hard wait. Waiters are recorded under `heavy-waiters/` and start oldest first; every 60 s the message says how many are ahead. `GATE_HEAVY_MAX_WAIT_SECONDS` is 3600, up from 900.
5. **SHIP-BACKUP-02** (`scripts/install.sh`). The pre-upgrade data copy skips `data/reference`, `data/models`, `data/deno`, `data/sidecars`, `data/cache`, `data/tmp`, `data/engines` and `data/logs`, from one `SNAPSHOT_SKIP_DIRS` list. Ship logs `Skipped in the data copy (downloaded again when needed): ...`. Rollback moves each skipped folder back from the data set aside and logs, for example, `Kept reference from the newer data`.

## 20. Hung operations: GITNET-01 (2026-11-01)

**What happened.** One `git push` from the lander, over ssh with the deploy key, stalled mid-transfer (`git-receive-pack` waiting on the network, no CPU). The lander runs one queue entry at a time in one process, so for 37 minutes nothing landed, the status page still said "running", and the only fix was to stop that one ssh process by pid. Every remote git call and every long step in these scripts could do the same.

**Cause measured on this Mac.** Outbound port 22 to `github.com` is dropped some of the time: a plain TCP connect to `github.com:22` timed out three times in a row (8 s limit each) while `github.com:443` and `ssh.github.com:443` connected at once, and `ssh -T` over port 22 had answered in 0.25 s three times minutes earlier. Five `git push --dry-run` tries per setting with the deploy key: over port 22, 1 of 5 succeeded (0.5 s) and the rest hit the 20 s connect limit; a second run over port 22 gave 0 of 5 (all 25 s limits). Through `ssh.github.com:443` (host key alias `github.com`), 5 of 5 succeeded in 0.5 s. `https` pushes took 0.3 s each, 5 of 5. The interface reports IPv4 only, and `-o AddressFamily=inet` did not help (2 of 5 and 0 of 5 against 1 of 5 and 0 of 5), so it is not used. The earlier stall was a connection that opened and then stopped moving, which a connect limit cannot catch; that is why the wall clock exists too.

**What the scripts do now** (`scripts/lib/gitnet.sh`, sourced by `lander.sh`, `watcher.sh`, `land.sh`, `ship.sh`, `pipeline.sh` and the `wt.sh` wrapper; no repo or global git config is touched, everything is per process):

- `gitnet_env` builds `GIT_SSH_COMMAND` from the repo's own `core.sshCommand` (the deploy key) plus `-F` to a small generated ssh config that sends `github.com` through `ssh.github.com:443` and sets `ConnectTimeout 15`, `ServerAliveInterval 10`, `ServerAliveCountMax 3` and `BatchMode`. Other hosts and the user's own `~/.ssh/config` still apply, and `BatchMode` is set for `github.com` only. It also sets `GIT_HTTP_LOW_SPEED_LIMIT/TIME` so a stalled https transfer aborts after 30 s. The ssh command is exported only by the scripts that work in this repo (`lander.sh`, `watcher.sh`, `land.sh`, `ship.sh`, `pipeline.sh`): a deploy key is valid for one repo, so the `wt.sh` wrapper exports the https limits alone and leaves each repo's own `core.sshCommand` in charge.
- `gitnet <git args>` runs git under `bounded_run` (90 s per try, 3 tries, retried only after a timeout or a connection-class error, never after a rejected push). `bounded_run <seconds> <label> <command>` puts the command in its own process group, kills only that group when the time is up (by the pid it started, never by a name pattern), writes one line to `land/stuck.log` (or `watch/stuck.log`) and returns 124. While it runs, `land/ops/<pid>.op` names it.
- The lander bounds every step: fetches and pushes through `gitnet`; `bun install` (600 s), file generation (600 s), the static check (900 s), the safety-surface tests (2400 s), the worktree sweep (600 s) and the worktree map (120 s) through `bounded_run`. A step that times out fails like any failure, and its output ends with `timed out after Ns: <step>`, which becomes the bounce reason.
- A network failure that survives the retries does not bounce the entry at once. It goes to the back of the queue with a growing pause (`MAIPAI_LAND_DEFER_SECONDS` 120, times the try number), the next entry runs, and after `MAIPAI_LAND_DEFER_MAX` (3) tries it bounces with the cause ("git push timed out; GitHub did not answer in time (gave up after 3 tries)"). One stalled connection no longer blocks the entries behind it.
- The lander writes `land/current-entry` (branch, start, phase, last phase change) at each phase. The helper is part of the daemon snapshot: the lander refreshes `data-scratch/pipeline-bin/gitnet.sh` from `origin/main` once a minute and restarts when it changes, the watcher reads the same copy.

**Seeing it.** `bash scripts/pipeline.sh status` prints `STUCK: lander <step> for N min (pid P, bound S s)` for any operation past its bound, `STUCK: lander on <branch> at '<phase>' for N min with no progress` when a landing phase has not changed in `MAIPAI_STUCK_PHASE_SECONDS` (3600), and `note: lander hung "<step>" (bound S s) and was stopped N min ago` for an hour after one was killed. A deferred entry shows `(GitHub did not answer; try N, next in Ns)` in the queue list. `status` itself no longer waits on the network: its fetch is bounded to 20 s and says when the `origin/main` line may be stale.

**Other hang classes checked.** The gate lock (`gate-lock.sh`) already judges a holder by `kill -0` on its recorded pid and has a wait cap, so a dead holder is reclaimed and a wait ends. `land.sh wait` and `pipeline.sh wait` have a timeout (default 3600 s). The watcher's legs have a watchdog (`MAIPAI_WATCH_LEG_MAX_SECONDS`) and its quiet wait is capped. Still without their own wall clock: the shared `wt.sh` in `getmaipai/.github` runs git calls of its own (they inherit the https limit from the environment; ssh stalls there are cut off only by each repo's own ssh settings, and `.github`, `commons` and `catalog` use https), and the bounded steps are limited by wall clock only, with no idle detection.

## 21. https first, GitHub behind the landing: GITNET-02 and OUTBOX-01 (2026-11-01)

**The token path was never used by the pipeline.** In the home checkouts `git remote get-url origin` is https but `git remote get-url --push origin` is `git@github.com:getmaipai/home.git`, and `data-scratch/bin/https-git.env` only rewrites the `git@github-jessewebdotcom:` alias. So every push, the lander's included, went over ssh with the deploy key and the port that drops. `git`'s `url.<base>.insteadOf` rewrites the push URL too (checked with `git remote get-url --push origin`).

**GITNET-02, https first.** `gitnet_env` now also calls `gitnet_https_env`, which appends to the caller's `GIT_CONFIG_*` entries (per process, no repo or global config touched): `git@github.com:`, `ssh://git@github.com/` and the `git@github-jessewebdotcom:` alias are rewritten to `https://github.com/`, and the credential helpers are tried in order: `gh auth git-credential`, `osxkeychain`, then the token file (`~/.config/maipai/gh-token`, read by the helper when git asks; the token is never in an argument or in the environment). `gitnet` makes the first try over https with a 30 s bound (`GITNET_HTTPS_TIMEOUT`). A refused login (`Authentication failed`, `could not read Username`, 401/403) is retried at once over the ssh path of section 20, and a timeout moves the next try there; either way https is skipped for `GITNET_HTTPS_BAD_SECONDS` (600) through `<state>/https-bad-until`. A rejected push (`fetch first`) is returned as it is. `GITNET_TRANSPORT=ssh` turns https off. Measured here, five `git push --dry-run` each: https through gh 0.39 to 0.45 s, through the token file 0.30 to 0.39 s, through the keychain 0.36 to 0.39 s (15 of 15); the ssh path through port 443 0.51 to 0.57 s (5 of 5); plain ssh on port 22 0.51 s four times and then one failure after 18 s.

**OUTBOX-01, GitHub behind the landing.** Jesse's rule (2026-11-01): the GitHub step must never stop anyone from seeing results on main, testing and carrying on with dev. A landing is therefore complete when the change is fast-forwarded onto the pipeline's own main and verified there; getting it to GitHub is a separate, retried job.

- **The pipeline's main** is the ref `refs/pipeline/main`, shared by every worktree of the repo (`git fetch` never touches it). `pipeline_main_sha` (in `scripts/lib/gitnet.sh`) is that ref while it descends from `origin/main`, otherwise `origin/main`; `pipeline_main_state` says `sync`, `ahead N` (landed commits GitHub has not got yet), `diverged` or `unknown`. Only the lander moves the ref, by compare-and-swap, so a flush running in the background can never rewind a newer landing.
- **Landing.** The lander fetches (a failed fetch is a log line, not a failure), rebases the branch onto the pipeline's main, runs the same checks, moves the ref, writes the note, and then kicks the outbox. The branch commit is read from the repository (every worktree shares one object store), so `land.sh` pushes the branch to GitHub as a one-try backup and a failure only prints a note. The main checkout, the watcher's tests and the next landing all follow the pipeline's main.
- **The outbox** (`lander.sh outbox status|flush|reset-to-github`, state in `land/outbox/`). It fetches, then pushes the tip with `git push origin <sha>:refs/heads/main`: fast-forward only, never forced, in order because the tip carries every commit before it. A failure waits 30 s, then 60, 120 and so on up to 15 minutes (`MAIPAI_LAND_OUTBOX_BASE_SECONDS`, `MAIPAI_LAND_OUTBOX_MAX_SECONDS`); the daemon runs the flush in the background and one at a time, so the next entry starts at once. After a push the landed branches are deleted on GitHub (best effort) and finished worktrees are swept.
- **Diverged.** If GitHub's main gets a commit the landed main does not contain (someone pushed to it directly), the outbox stops, writes one `STUCK` line to `lander.log`, and the lander holds queued entries (it does not bounce them). `bash scripts/pipeline.sh outbox reset-to-github` parks the landed-but-unpushed commits on a `wt/outbox-parked-<time>` branch, makes the pipeline's main follow GitHub, and the held entries land again; the parked branch can be landed with `land.sh` from a worktree. Nothing is ever force-pushed.
- **Seeing it.** `pipeline.sh status` prints `GitHub main: in sync`, or `GitHub main: main is ahead of GitHub by N commits (oldest M min), push retrying (try K, next in Ns, last error: ...)`, or the `STUCK` line above. `where.sh` says `GitHub main: NOT YET` for a landed commit the outbox has not pushed. `ship.sh` refuses such a commit with that reason (a hub install pins what GitHub has) and ships any commit that is on GitHub's main. `pipeline.sh wait <sha>` returns once the commit is on the pipeline's main.
- **Proof, test and live.** `scripts/landerOutbox.test.ts` and `scripts/landerHang.test.ts` take GitHub away in four ways (a push that fails, a push that hangs ten minutes, a remote that does not exist, a main that moved on its own) and show that entries keep landing, the status line says how far ahead main is, a later flush pushes everything in order without a force flag, and a diverged main stops loudly and recovers through `outbox reset-to-github`. A scan of `ps` (arguments and environment) during six real pushes, and of `lander.log` and `watcher.log`, found the token nowhere.
- **New worktrees.** The `wt.sh` wrapper moves a freshly started worktree (no commits, no edits) forward to the pipeline's main when GitHub lags and prints a plain notice, so a new session sees everything that already landed. `wt.sh done` and the sweep still judge "landed" against GitHub's main, which can only keep a worktree a few minutes longer.

## When a picture, video, song or download fails on the live hub

Run `bash scripts/why-failed.sh` on the computer that runs the Stack. It lists the Stack's failed jobs from the last day with their plain reason, then the last worker failures from `stack.log` (`image.worker_failed`: the exception type, the frames where it happened and, for a missing module or file, the name). The Stack never logs a prompt, so these lines are safe to paste into a report. The Stack forgets its job list when it restarts, so run it before shipping.

## 22. One writer, the express lane, batched backup and `stable` (SINGLE-WRITER-01, 2026-11-12)

**Why.** On 2026-11-11 and 11-12 the lander was STUCK twice because `rush-ship.sh` pushed straight to GitHub's main while the lander's own main held a landed commit GitHub did not have: two writers to one branch. Five branches were held until someone ran `outbox reset-to-github`. Separately, `wt.sh land` was a second writer too: the shared script hands off to `land.sh` only when that file is executable, and in this repo it is mode 644, so it fell through to its own `git push origin HEAD:main`.

Saving, editing and session previews never wait for integration, backup or release checks.

**One writer.** The lander is the only process that moves main: `refs/pipeline/main` here, and `refs/heads/main` on GitHub through its outbox. Nothing else in this repo pushes main: `rush-ship.sh` and `ship-now.sh` call `land.sh --express`, and the `wt.sh` wrapper sends `land` to `land.sh` itself. When GitHub's main has commits the landed main lacks, an express entry is refused before any push with the repair (`bash scripts/pipeline.sh outbox reset-to-github`, which parks the landed-but-unpushed commits on a `wt/outbox-parked-*` branch), and a normal entry is held as before. Nothing is ever force-pushed.

**The express lane** (`bash scripts/land.sh --express`, only on the owner's explicit word; a timeout never selects it). The request is queued as `0-<ms>-<branch>.json`. Fairness, chosen only between landing transactions (one entry's fetch, rebase, generate, check, ref move and push run to their end, a clean bounce or an "unfinished" cap before the next entry is chosen, so nothing else changes the landed main or the rebased candidate while it is validated):

- an express entry goes ahead of queued normal entries,
- at most two express entries in a row while a normal entry waits (`MAIPAI_LAND_EXPRESS_MAX_RUN`, 2),
- a normal entry that has waited 10 minutes goes next regardless (`MAIPAI_LAND_NORMAL_MAX_WAIT`, 600 s),
- requests for one branch coalesce to the newest.

So an express entry waits for the current lander operation (a running safety-surface test phase included) and delays other queued work. What it runs: rebase onto the landed main, the generators, the static check scoped to the changed workspaces (typechecks, UI rules, i18n, secrets, PII), the boot check of the exact rebased commit (`scripts/boot-check.sh`, `MAIPAI_LAND_BOOT_SECONDS` 180), no test suite. RULES.md is refused; a safety, auth or credential file is refused unless `MAIPAI_RUSH_SAFETY_OK=1` (the owner's word in that turn). Then the ref moves and the outbox pushes before `land.sh` answers; it prints `landed-sha: <sha>`, and `rush-ship.sh` ships exactly that commit. `land/boot-ok/<sha>` tells `ship.sh` the commit was already boot-checked. The note and `pipeline.sh status` label it "starts and typechecks on top of main (express: no tests run)", never "tested". Status shows `express queued behind <branch> (N s)` while a transaction runs and `express: <branch> landing, normal queue paused N s` while it lands.

**Results.** `landed`, `bounced`, or `unfinished`: a step that hit its time cap (`bounded_step` exit 124) is unfinished, never a pass, and the landed main does not move. `land.sh` exits 1 for both. A safety-test run that meets memory pressure is `held` with the reason "deferred (memory)" and retried by itself: the lander does not start the tests while `scripts/lib/hostmem.sh` says no (kernel pressure level 2, or the host guard's `dev-shed` flag), and the sharder exits 75 after 300 s of pressure. The watcher skips the tick the same way, and `ship.sh` and the full and frontend `check.sh` gates exit 75 before they start (HOST-GUARD-09; `MAIPAI_MEMORY_GATE=off` is the owner's override). Labels for a landing: "static check on top of main", "static check and safety-surface tests on top of main", or the express label above.

**Queue time and run time.** `landings.jsonl` and each note carry `requested_at`, `started_at`, `finished_at`, `queue_seconds`, `run_seconds`, `phases` (seconds per step: fetching origin, rebasing, installing dependencies, generating files, committing generated files, static check, safety-surface tests, boot check, landing on main, pushing to GitHub), `generated_files` (what the generators rewrote) and `express`. `pipeline.sh status` prints `waited Ns, ran Ns` per landing.

**Where the lander's time goes** (measured 2026-11-12 on the Studio, 11-05 median landing 28 s): git itself is under a second (commit 0.05 s, rebase 0.07 s, fetch 0.2 s, pre-push hook 0.04 s, dry-run push 0.6 s); the generators about 3 s (settings 1.3, API docs 1.5, adoption and code map 0.1 each); `check.sh --pre` about 18 s warm (secrets scan 4, i18n 4, typechecks 3 warm to 23 cold, schema chain 2, settings and API docs 1 each, UI rules 1, PII 1); eslint 0.7 s warm, 7 s cold. Removed duplicates (DUP-CHECK-01): the check no longer regenerates the settings registry, API docs and adoption file the landing just generated (`MAIPAI_PRE_GENERATED`, `MAIPAI_PRE_SETTINGS_FILE`), no longer runs its own fetch, and is scoped against the landed main it was rebased on (`MAIPAI_GATE_DIFF_BASE`), so a lagging GitHub main never widens it. A passing static check is remembered by (tree, base tree) in `land/check-ok/` and reused when the same pair comes back (CHECK-REUSE-01). `bash scripts/measure-commit-hooks.sh <worktree>` times each commit hook and git step on its own.

**Batched backup** (BATCH-BACKUP-01). The daemon no longer pushes after each landing. Every loop it pushes only when something is pending and the last push is at least `MAIPAI_LAND_BACKUP_SECONDS` (300) old, and then only the newest tip, fast-forward, one push per batch; nothing when there is nothing new. A graceful stop pushes what is pending. Before Home's main, the pins it names go first: a commons tag only this Mac has is pushed as that tag, a Stack commit no GitHub ref holds is pushed as the tag `home-pin-<sha>`; a pin that exists nowhere holds Home's push back with the reason (`outbox/last-error`). Checked pins are remembered in `outbox/pins-ok`. Express pushes at once. Nothing in the preview path touches the network or git.

**New sessions** start from the landed main: the `wt.sh start` wrapper moves a fresh worktree forward to `refs/pipeline/main` when GitHub's main lags (section 21), which with batching is the normal case for up to five minutes.

**`stable`** (STABLE-01): the last version to pass the required checks, not "known-good". `bash scripts/nightly-stable.sh run` (or `pipeline.sh nightly run`) picks one commit at its start, the newest integrated one, tests it with the full suite in `../home-watcher` under the watcher's checkout lock (`watch/checkout.lock.d`; the watcher skips a tick while the nightly holds it) and a wall clock (`MAIPAI_NIGHTLY_SECONDS` 5400), and only on a full pass fast-forwards the local `stable` ref and GitHub's `stable` branch (never forced). A failure or an unfinished run leaves `stable` and writes `data-scratch/nightly/<date>/report.md`, `latest.md`, `latest.json`. Commits between the last tested one and the chosen one are recorded in `nightly/untested.jsonl` as "untested (superseded)". New work lands during the run. The schedule is off: `pipeline.sh nightly install-service` writes `com.maipai.nightly.plist` (04:00) without loading it; `--load` needs the owner's word; `nightly off` is the kill switch. Gated promotion later ships `stable`, or an explicit owner override recorded with its own status, never as a pass.

**Guardrail, not a security boundary.** Every session runs as the owner's user, so a session that wants to can still restart the engine or push. The repo's `.claude/settings.json` adds deny rules (push to main, `launchctl bootout|bootstrap|kickstart|kill|load|unload|stop|remove`, `pipeline.sh stack on|off`) and the PreToolUse hook `scripts/hooks/guard-shared.sh`, which denies the same plus `maipai-promote` or `maipai-install` called directly (owner-approved 2026-11-12). The sanctioned paths are untouched: `ship.sh`, `ship-now.sh`, `rush-ship.sh`, the lander and the installer call these from inside their scripts, which the hook never sees. One owner-approved escape exists, for a rollback or a tag install only: `MAIPAI_OWNER_APPROVED=1 sudo -n /usr/local/libexec/maipai-promote --rollback` or `MAIPAI_OWNER_APPROVED=1 sudo -n maipai-install vX.Y.Z`, as that exact command with nothing chained. A session puts the flag in only after the owner said yes in the question wizard for that rollback or that tag. The root helpers are judged by the hook alone (a prefix deny rule cannot express the escape). Real ownership (a separate daemon user, a sudoers line for the ship daemon only) needs the owner's sudo and is not built.

**Proof.** `scripts/landerExpress.test.ts` (express lands, pushes and labels; a rush over an unpushed landed commit; GitHub ahead; a concurrent move requeues; RULES.md and safety refusals; express never starts while a transaction holds the tree; at most two in a row and the ten-minute rule; unfinished; check reuse; no push with nothing new; pins first; `wt.sh land` never reaches the shared push), `scripts/nightlyStable.test.ts`, `scripts/guardShared.test.ts`, and the bench-lane `scripts/landingHarness.test.ts`.

## 23. Direct and gated mode (MODE-01, 2026-11-12)

`bash scripts/mode.sh direct | gated | status` is the one switch. The state is one line in `data-scratch/mode` of the main checkout (`scripts/lib/mode.sh` is the only reader; `MAIPAI_MODE_FILE` moves it, `MAIPAI_MODE` overrides it for tests). With no file the mode is unset and every script behaves as it did before the switch. Status says `DIRECT: run first, checked after`, `GATED: checked first, then run`, or `mode: not set ...`; `pipeline.sh status` prints the same line. Switching changes no data and starts or stops no service; each script reads the file when it runs.

| | DIRECT: run first, checked after | GATED: checked first, then run |
|---|---|---|
| For | nobody on the hub, data disposable | the family is on the live hub |
| `land.sh` | waits for its verdict through the express lane (`--detach` and `wait` keep the normal lane) | normal lane only; `--express` is refused |
| Lander, safety-surface (T2) files | no tests hold the landing; the note says the nightly runs them | the safety-surface tests run before the landing, as today |
| `ship.sh` | before green is implied (the boot check still runs) | `--before-green` refused; needs a watcher green run or the commit inside `stable`; a safety-surface change ships only once `stable` holds it; the installer's pre-upgrade copy of `data/` is the backup |
| `rush-ship.sh`, `ship-now.sh` | allowed | refused with the way out |
| `dev.sh --workbench` | allowed | refused (`bun run dev` stays) |

Proof: `scripts/mode.test.ts`.

## 24. The nightly job (NIGHTLY-01, 2026-11-12)

`bash scripts/nightly.sh run-now | run | status | install-service [--load] | uninstall-service`. It wraps `nightly-stable.sh` (section 22): one fixed commit, the full suite in `../home-watcher`, `stable` ("last version to pass the required checks") moved only on a full pass, new work landing meanwhile.

- **Schedule: off by default.** `install-service` writes `com.maipai.nightly.plist` (04:00, background priority) and loads nothing; `--load` needs the owner's word. `run-now` is the testing entry and ignores the `data-scratch/nightly/OFF` switch; the scheduled `run` honours it.
- **Host guard gate.** `nightly-stable.sh run` calls `hostmem_gate` (`scripts/lib/hostmem.sh`) first. Under memory pressure it exits 75 having changed nothing; `nightly.sh` retries every 600 s (`MAIPAI_NIGHTLY_RETRY_SECONDS`) for up to 14400 s (`MAIPAI_NIGHTLY_DEFER_SECONDS`), so a 04:00 start still reports by 08:30. A night that never started is reported `DEFERRED`, never a pass.
- **Report.** Every run writes `data-scratch/reports/nightly-<date>.md`: PASSED, FAILED (with the failing test lines), UNFINISHED, DEFERRED, NOT STARTED or OFF, the commit tested, `stable` before and after, the untested (superseded) count, the log path and, when it ran, the fixer's result.
- **Fixer.** A FAILED run calls `scripts/nightly-fixer.sh` (off by default; section 25).

Proof: `scripts/nightly.test.ts`, `scripts/nightlyStable.test.ts`.

## 25. The nightly fixer (NIGHTLY-FIXER-01, 2026-11-12)

`scripts/nightly-fixer.sh init | status | run`. `nightly.sh` calls `run` after a FAILED run; the outcome goes into the night's report under "Fixer". **Off by default**: with no `data-scratch/nightly/fixer.conf` (or `enabled=0`) it does nothing. `init` writes the config with `enabled=0`; the owner turns it on.

| Config key | Default | Meaning |
|---|---|---|
| `enabled` | 0 | 1 turns the fixer on |
| `max_run_usd` | 5 | `claude --max-budget-usd` for one run |
| `max_total_usd` | 40 | the ledger `nightly/fixer-spend.jsonl` refuses a run when spend so far plus `max_run_usd` would pass it |
| `timeout_seconds` | 2400 | wall clock for the Claude run (the report is due by 08:30) |
| `model` | (session default) | optional `--model` |

It creates `wt/nightly-fix-<date>` in its own worktree at the tested commit, runs `claude -p` there (accept-edits mode, an allow list of read, edit, `bun test`, local git; a deny list of `git push`, `land.sh`, `ship.sh`, `rush-ship.sh`), commits what it left by file name, then judges the diff itself: it **rejects and deletes** the branch when the change touches `docs/design/RULES.md`, any T2 safety, auth or credential file (the globs in `scripts/wt.sh` at the tested commit), the check, gate, hook and lander and ship scripts, or modifies, renames or deletes an existing test (new test files are allowed). It then re-runs the failing test files in the worktree: green is `PROPOSED FIX`, still red is `DID NOT FIX` (branch kept to read). It never lands, ships or pushes; the owner or a session reads the diff and lands it with `bash scripts/land.sh`.

Proof: `scripts/nightlyFixer.test.ts` (off by default, budget flags and ledger, each rejection, new-test allowed, re-run red and green, nothing pushed).

## 26. Edit to live in about two minutes (DIRECT-FAST-01, 2026-11-12)

Measured on 2026-11-12 in direct mode for one tiny change: worktree start 294 s, edit and unit test 22 s, land 87 s, push to GitHub 17 s, `ship.sh --before-green` 131 s, total 560 s. Three pieces, each landed on its own, each measured before and after. The root helper `maipai-promote` is not changed (GitHub costs 11 to 17 s).

### 26.1 `wt.sh start`: 280 to 336 s down to 6 to 8 s (START-FAST-01, WARM-INSTALL-01)

The `bun install` was not the main cost. Tracing a start showed the reaper: the shared `cmd_start` runs `cmd_reap` first, which does a `find`, an `lsof` of every process and a `git status --ignored` for each old worktree. With 346 worktrees on disk, `wt.sh reap` alone took 301 s. Two changes:

1. **The reaper no longer sits in front of `start`** (`scripts/wt.sh`). The wrapper drops the one `  cmd_reap` line inside `cmd_start` from its temporary copy of the shared script (only when that removes exactly one line; otherwise start runs as shared and prints a note), then runs `wt.sh reap` once afterwards, detached, at `nice -n 10`, one at a time (`data-scratch/wt-reap.lock`, a lock older than 30 minutes is a dead run's). The reaper does what it did before, just not while a session waits. `MAIPAI_WT_START_REAP=1` restores the old order.
2. **A warm install per lockfile hash** (`scripts/lib/warm-install.sh`, `scripts/lib/wt-bun-shim/bun`). `wt.sh start` puts the shim first on `PATH`; only `bun install --frozen-lockfile` is routed through it. The hash covers `bun.lock`, the root, `backend` and `frontend` `package.json`, the bun version and the CPU. A miss runs the real install and then saves a clone of the finished `node_modules` (root, backend, frontend) under `data-scratch/warm-install/<hash>/`; a hit gives the new worktree a clone before the install runs. The clone is one `clonefile(2)` call on the directory (2.5 s for 238k files and 2.6 GB; `cp -c -R` file by file took 33 s). The real `bun install --frozen-lockfile` still runs afterwards and only verifies (4 s backend, 1 to 2 s frontend), so a stale clone cannot slip through. Fail safe: no clone, a failed clone, a different hash or a failed install leaves nothing partial and runs the normal install. The newest three hashes are kept (`MAIPAI_WARM_KEEP`); `MAIPAI_WARM_INSTALL=0` turns it off. No pre-made worktree pool: the measured start is already under 10 s.

| `wt.sh start` (machine busy, load average 6 to 10) | Seconds |
|---|---|
| Before (shared script as is, two runs) | 337, 288 |
| Warm store filled, reaper still in front | 314 (the install was 5 s of it) |
| After (reaper moved, warm hit, two runs) | 8, 6 |

Proof: `scripts/warmInstall.test.ts` (miss saves, hit clones and still verifies, another lockfile is another hash, clone failure falls back, failed install saves nothing, off switch and other bun commands untouched, keep limit) and `scripts/wtStartFast.test.ts` (start first then one background reaper, a live lock starts no second one, the old order on request, an unfitting shared script runs unchanged with a note).

### 26.2 Direct mode: `--detach` takes the express lane too (DIRECT-FAST-02)

`scripts/land.sh` took the express lane in direct mode only when it waited for its verdict. Now every landing in direct mode is queued express, `--detach` included (the request goes in at the front, the caller later runs `bash scripts/land.sh wait`); only `wait` itself has nothing to queue. An explicit `--express --detach` stays refused (a rush ship needs the landed commit). The lander's note still says "starts and typechecks on top of main (express: no tests run)", never "tested". Gated and unset modes are unchanged. Time: a detached landing no longer waits behind the normal queue or runs the 87 s check; it takes the same path as the waiting one.

Proof: `scripts/landerExpress.test.ts` ("DIRECT-FAST-02": direct queues an express record and lands with the express label; unset and gated queue normally; explicit `--express --detach` exits 2).

### 26.3 The installer: no Stack rebuild for an unchanged pin, no data copy in direct mode, a clock per phase (DIRECT-FAST-03)

`scripts/install.sh` is carried by each commit and runs as root through `maipai-promote`, which is not changed.

- **Stack rebuild skipped for an unchanged `STACK_TAG`** (measured by the owner at about 48 s for an unchanged pin). `setup_stack` writes `stack/.stack-tag` after a published build. The installer's main path now calls `setup_stack ... reuse`: when the marker equals `STACK_TAG` and the compiled binary is there, the fetch, Commons download and build are skipped and only the service step runs (register, start, wait for `/healthz`). The first install after this change has no marker and builds once. The wizard's "Try again" never reuses. `MAIPAI_REBUILD_STACK=1` forces a rebuild.
- **Data copy skipped in direct mode only.** The helper takes only a commit and sudo resets the environment, so `ship.sh` cannot pass a flag. In direct mode (never gated or unset) it writes a one-shot request, `~/.config/maipai/ship-direct` containing `<full sha> <epoch>`, just before the helper runs and deletes it right after. The installer (`direct_install_requested`) honors it only for that exact `--commit`, within 15 minutes, once (it deletes the file as it reads it), and only when the file belongs to `SUDO_USER`. It then skips `snapshot_data` and writes `.snapshot-skipped` with the tag it upgraded from, so a failed upgrade's rollback leaves the data as it is instead of restoring an older copy for that tag. `--skip-data-snapshot` does the same by hand. In gated mode no file is written and the copy is taken as before.
- **A clock per phase.** `phase` prints `[HH:MM:SS +Ns] phase: ...` at: stopped, data copy done, source replaced, tools ready, app built, preflight done, Stack step, Stack ready, Home answers, done. The ship log in `data-scratch/ship/` now shows where the minutes go.

Not measured live: nothing was shipped to the hub. The skipped work is the owner's measured 48 s Stack step plus the 870 MB data copy; the first live direct ship after this lands will show the phase clock and should be read against section 26's total.

Proof: `scripts/installHome.test.ts` ("direct-mode installer speedups": phase format, marker and binary rules, reuse versus build versus forced rebuild versus the wizard, the one-shot request in all its refusals, rollback after a skipped copy, the main path wiring) and `scripts/ship.test.ts` (direct writes the request for this commit, gated and unset write none, a stale file never reaches a non-direct install, the file is gone afterwards).

## 27. The live install, about 150 s toward 60 s (DIRECT-FAST-04, 2026-11-12)

Starting point: the phase clock of the last direct ship (sha-df9834e, a comment-only change), `data-scratch/ship/1794518164-df9834e.log`: source replaced +13 s, tools ready +68 s, app built +91 s, Stack ready +142 s, done +150 s. The root helper is not changed. Every skip below is decided by hash or probe and falls back to the full step; gated and unset modes install exactly as before (except the first item of 27.1, a plain bug).

### 27.1 Dependencies and Deno (DIRECT-FAST-04)

The 55 s between "source replaced" and "tools ready" was not a dependency install: it was `Installing Deno 2.9.7` downloading Deno again on every ship. The upgrade's `rsync --delete` excluded `/.bun` but not `/.deno`, so it deleted the Deno it had installed last time. Same cause for the root `node_modules` (2.6 GB, the hoisted workspace install: 7 s to remove): the rsync deleted it each ship and the build rebuilt it. Changes in `scripts/install.sh`:

- `rsync` now excludes `/.deno`, `/node_modules` and `/.deps-hash` (all modes: the Deno exclusion is a plain bug fix).
- **Kept dependencies, direct mode only.** `deps_hash` covers `bun.lock`, the root, backend and frontend `package.json`, the Bun version and the platform; `${root}/.deps-hash` holds the hash of the install that made the node_modules now on disk (written after a successful fresh install, removed before one). When the hash is equal and all three node_modules folders exist, `build_app` runs `bun install --frozen-lockfile` in `frontend` to verify them (1.3 to 1.6 s measured) instead of removing and reinstalling them (7.1 s remove, 7.7 s backend `--production`, 1.3 s frontend, 16 s together). A different hash, a missing folder, a failed verification, gated mode and a rollback all run the fresh install of 2026-10-30. The quarantine walk (`xattr -dr`, 5.6 to 6.3 s over the kept tree) skips `node_modules` when they are kept.
- One decision, `direct_install`, made once in `main`: `--skip-data-snapshot` or the one-shot request from `ship.sh` (section 26.3). It now also gates the kept dependencies, the fast build and the kept Stack. When the installer re-runs itself as the commit's own copy, the decision travels in `MAIPAI_INSTALL_DIRECT` and only that re-run honors it. The quarantine walk also skips `.deno`, `.bun` and `data` when dependencies are kept.

Expected: about 55 s (Deno) plus about 15 s (dependencies) off a direct ship, plus part of the 12 s source step (the 2.6 GB removal). Not timed live; the next real direct ship shows it in the phase clock.

Proof: `scripts/installHome.test.ts` "kept dependencies in direct installs": the hash follows exactly the lockfile, the three package files, the Bun version and the platform; reuse needs marker, equal hash and all folders; verified-in-place keeps the tree and skips the fresh install; a failed verification falls back; no reuse flag installs fresh; a failed fresh install leaves no hash; the quarantine walk; the rsync excludes and the direct-only wiring.

### 27.2 The frontend build (DIRECT-FAST-05)

"Building the app" took 23 s although `vite build` itself is about 1.5 s. The `build` script is `tsc --noEmit && vite build`: about 20 s of it is the type check. Measured here: `bun run build` 24.2 s, the new `bun run build:app` 3.5 and 4.7 s. `frontend/package.json` gains `build:app` (`bun run prebuild && vite build`: the same prebuild, the same vite build, no type check). A direct-mode install runs it, because the lander's static check type-checked the changed workspaces when the commit landed (a backend-only change that breaks a frontend type is therefore caught by the watcher or the nightly, after the install; this is the cost of direct mode); gated mode, a rollback and a source tree without the script keep the full `build`. A skip of the whole build for an unchanged input hash was weighed and dropped: 3.5 s is left, and `rsync --delete` would need its generated output (`dist`, `public/ort`) protected, a risk that is not worth 3.5 s.

Expected: about 20 s off a direct ship. Not timed live. Proof: `scripts/installHome.test.ts` (direct runs `build:app`, gated and a tree without the script run `build`, the repo script has the same prebuild and no `tsc`).

### 27.3 The Stack service stays up when nothing about it changed (DIRECT-FAST-06)

The "Stack step" took 51 s (+91 s to +142 s) although its own log line said the rebuild was skipped: the installer still stopped the Stack at the start of the upgrade, then `install_stack_service` ran `launchctl bootout`, a 2 s wait, `install-service` (a `launchctl bootstrap`) and the `/healthz` wait for the engine to start again. Chat dropped on every ship. The Stack's files are outside the tree the upgrade replaces (`/stack` is excluded from the rsync), so the stop was only ever needed for a rebuild or a changed service. Changes in `scripts/install.sh`:

- `stack_service_fp` hashes the service definition: the user, and the argv that registers it (data folder, port, Bun path, binary). `install_stack_service` writes it to `stack/.service-fp` after a start that answered `/healthz` and the settings write.
- `stack_keepable` is true when `STACK_TAG` equals the marker, the binary is there, the stored fingerprint equals the one for the current user, port and Bun path, and the Stack answers `/healthz` now (`MAIPAI_REBUILD_STACK=1` forces false).
- A direct upgrade that finds it keepable does not stop the Stack (`STACK_KEEP=yes`), and `setup_stack` then logs "leaving it running" and returns, provided it still answers; if it does not, the normal service install runs. Gated mode, rollbacks, a first install after this change (no fingerprint yet), a changed tag, Bun path, port or user all bounce the service as before.

Expected: the 51 s Stack step becomes about 0 s on an unchanged Stack, and chat stays up. The first direct ship after this lands bounces once to record the fingerprint. Not timed live.

Proof: `scripts/installHome.test.ts` "an unchanged Stack stays running": the fingerprint follows each input; `stack_keepable` for the same state and for each way it differs (no marker, no fingerprint, another fingerprint, another Bun path, not answering, forced rebuild, another tag, missing binary); `setup_stack` leaves an answering Stack alone and restarts a silent one; the main-path wiring.

### 27.4 Expected total

Direct ship, phase clock of sha-df9834e: 150 s. Deno 55 s and dependencies about 15 s (27.1), build 20 s (27.2), Stack 51 s (27.3) come to about 140 s off, which leaves the fixed part: mirror fetch, archive and rsync (12 s), the app helper build, the app start and the health checks. The first direct ship after these land is slower once (the fingerprint and the hash are recorded); read the next one.

### 27.5 No engine-job wait when the Stack stays up (DIRECT-FAST-07)

`ship.sh` waits up to 180 s for running engine jobs before an install, because the install used to restart the Stack service and drop them. Two measured real ships (75c7517, 20b2407) spent 180 s of a 334 s edit-to-live in that wait, although the Stack was no longer restarted (27.3). In direct mode `ship.sh` now asks the installer's own predicate, `stack_keepable`, read from the installer of the commit being shipped (`git show <sha>:scripts/install.sh`, sourced in a subshell; `MAIPAI_SHIP_STACK_STAYS_CMD` replaces the question in tests): same `STACK_TAG` build here, binary present, service definition unchanged, answering. When it says yes, `ship.sh` prints `the Stack stays running through this install; not waiting for engine jobs (N running)` and goes straight on. Gated and unset modes, a commit whose installer has no such function, and any failure of the question keep the full wait. Remaining risk: the installer asks the same question again when it runs; if the answer changed in between (the Stack stopped answering), the Stack is restarted with a job running, which the old wait would have avoided. Expected: 180 s off a direct ship that has a running engine job.

Proof: `scripts/ship.test.ts` "DIRECT-FAST-07": direct and stays means no wait; direct and restarts, direct with no installer to ask, gated and unset all wait.

### 27.6 The 44 s "tools ready" was a quarantine walk (DIRECT-FAST-08)

The second real ship (20b2407) showed kept dependencies working (`Dependencies are unchanged ... kept and verified`, 7 s build) yet 44 s between "source replaced" and "tools ready". That phase holds the port probe, Bun, Deno (present, silent), the dependency hash and `clear_quarantine_and_sign`, which ran `xattr -dr com.apple.quarantine` over the whole install root. The root holds `stack/` (637k files, 450 GB of models) and 13 `data.rolled-back-*` copies. Measured on the live root (a no-op attribute removal, nothing changed): `stack` 24 s, the rolled-back copies 15 s, together 39 s of the 44 s. A direct install now walks only the entries the release brings: it skips `stack`, `data`, `data.rolled-back-*`, `backups`, `received-backups`, `upgrade-backups`, `data-scratch`, `.bun`, `.deno` and `node_modules` (`INSTALL_QUARANTINE_LIGHT`, set from `direct_install`; the earlier `INSTALL_DEPS_REUSE` skip list is the same). Other installs walk the whole root as before. Expected: about 40 s off a direct ship; "tools ready" should read about 4 s after "source replaced".

Proof: `scripts/installHome.test.ts` "DIRECT-FAST-08": a direct walk visits exactly the release entries; a non-direct install walks the root once; the main-path wiring.
