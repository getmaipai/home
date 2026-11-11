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
| `scripts/wt.sh` (and the org `standards/bin/wt.sh`) | Worktree start, run (Codex), done; `land` hands off to `land.sh`. |

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
8. Push `main` (fast-forward, up to three rebase retries; a re-check only if main's change overlaps the branch's files). Delete the remote branch. Write the note and a `landings.jsonl` line.
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
- **Self-healing (SELFHEAL-01, 2026-11-11).** Two landers (this machine's and another machine's) push to one GitHub main, so a landing here can still be unpushed when GitHub moves on. The lander no longer waits for a person: it parks the landed-but-unpushed tip on `wt/outbox-parked-<time>`, follows GitHub's main (compare-and-swap, so a landing in flight is never rewound), and puts every landing that never reached GitHub back in the queue, in order, with the backlog items it named (`land/done-items/`). Each is rebased and checked on the new main like any landing; a conflict bounces with the usual reason in `land.sh wait`. It heals at most `MAIPAI_LAND_SELFHEAL_MAX` (3) times in `MAIPAI_LAND_SELFHEAL_WINDOW_SECONDS` (1800); past that it stays `STUCK` and says so, and `MAIPAI_LAND_SELFHEAL=0` turns it off. `pipeline.sh status` says `GitHub main: in sync (the lander healed a divergence itself: ...)` for a day after a heal, and `lander.log` has a `SELF-HEALED` line. The manual `reset-to-github` stays for the stuck case.
- **Seeing it.** `pipeline.sh status` prints `GitHub main: in sync`, or `GitHub main: main is ahead of GitHub by N commits (oldest M min), push retrying (try K, next in Ns, last error: ...)`, or the `STUCK` line above. `where.sh` says `GitHub main: NOT YET` for a landed commit the outbox has not pushed. `ship.sh` refuses such a commit with that reason (a hub install pins what GitHub has) and ships any commit that is on GitHub's main. `pipeline.sh wait <sha>` returns once the commit is on the pipeline's main.
- **Proof, test and live.** `scripts/landerOutbox.test.ts` and `scripts/landerHang.test.ts` take GitHub away in four ways (a push that fails, a push that hangs ten minutes, a remote that does not exist, a main that moved on its own) and show that entries keep landing, the status line says how far ahead main is, a later flush pushes everything in order without a force flag, and a diverged main stops loudly and recovers through `outbox reset-to-github`. A scan of `ps` (arguments and environment) during six real pushes, and of `lander.log` and `watcher.log`, found the token nowhere.
- **New worktrees.** The `wt.sh` wrapper moves a freshly started worktree (no commits, no edits) forward to the pipeline's main when GitHub lags and prints a plain notice, so a new session sees everything that already landed. `wt.sh done` and the sweep still judge "landed" against GitHub's main, which can only keep a worktree a few minutes longer.

## When a picture, video, song or download fails on the live hub

Run `bash scripts/why-failed.sh` on the computer that runs the Stack. It lists the Stack's failed jobs from the last day with their plain reason, then the last worker failures from `stack.log` (`image.worker_failed`: the exception type, the frames where it happened and, for a missing module or file, the name). The Stack never logs a prompt, so these lines are safe to paste into a report. The Stack forgets its job list when it restarts, so run it before shipping.
