# Dev job launcher and the dev checkout (HOST-LAUNCH-01, -02, -03, DEV-CHECKOUT-01)

Why: on 2026-11-12 many dev sessions ran tests at once, a leaking file-event daemon ate 66 GB, tests hung for an hour and nothing
said who started what. The host guard (root, `docs/design/host-guard-2026-11-03.md`) protects the machine. This is the layer
under it that dev sessions use. Both tools run as the user, never root, and keep their state in `~/.local/state/maipai/jobs`
(`MAIPAI_JOBS_DIR` moves it). Code: `scripts/jobs/` (`lib.ts`, `job.ts`, `lease.ts`; tests beside them).

## Job launcher: `bash scripts/jobs/job.sh`

Every dev test, build and temporary server runs through it:

```bash
bash scripts/jobs/job.sh run --type test --session <name> -- bun test
bash scripts/jobs/job.sh run --type server --lifetime 8h -- bun run dev
bash scripts/jobs/job.sh list | audit [n] | orphans [--stop]
```

- **Group ownership.** The command runs as its own process group. When it ends, stops or times out, every worker it left is
  stopped (audit `workers-cleaned`). Ctrl-C or a TERM to the launcher stops the group too.
- **Timeouts per type.** test 15 min, build 10 min, other 30 min (`--timeout 20m` changes one run). A job past its limit is stopped
  after its output tail and process tree are saved to `jobs/<id>.capture.txt`, and the launcher prints `UNFINISHED ... This is not a
  pass` and exits 124. A job that never starts exits 75 the same way. Nothing the watchdog ends is ever reported as a pass.
- **Servers have a lifetime.** `--type server` refuses to start without `--lifetime` (30m, 8h, 2d). At the end it is stopped
  (exit 143, `STOPPED`). The workbench hub is the one long-lived server; give it a long lifetime on purpose.
- **CPU saturation, progress-aware.** Load is read per core. High load while every running job still makes progress (CPU or output in
  the last two minutes) lowers the concurrency limit to half; high load while a running job is not progressing holds new launches.
  Waiting launches say why on stderr, and give up (exit 75) after `MAIPAI_JOBS_WAIT_S` (30 min).
- **Memory.** On memory pressure level 2 or more, or the host guard's dev-shed flag (the one definition is `scripts/lib/hostmem.sh`),
  every job pauses (SIGSTOP to its group), a capture is written, and the pause ends when pressure clears. Only the job that is the
  largest running job and has grown more than 256 MB since it started is stopped, by its recorded pid group. A job over
  `--max-rss-mb` (24 GB default) is stopped regardless. A pause longer than 15 min ends as UNFINISHED.
- **Disk and churn.** Free disk under 5 GB holds new launches and warns in the audit; more than 20,000 files changed under the
  worktree since the job started warns in the audit. These never kill a job.
- **Audit.** `jobs/audit.jsonl`, one line per action: time, session, command, worktree, trigger, action (launch-deferred, launched,
  paused, resumed, captured-and-stopped, workers-cleaned, orphan-stopped, finished and more). `job.sh audit` shows the tail.
- **Orphans.** `orphans` lists servers whose worktree folder is gone: ones the launcher recorded, and unrecorded dev servers found
  by their working folder. `orphans --stop` stops only recorded ones whose pid still runs the recorded command. Anything else is
  listed and left alone.

## The dev checkout: one book, like a library (DEV-CHECKOUT-01, 2026-11-12)

Why: on 2026-11-12 development fought itself for memory (four dev hubs, a 61.5 GB video job, swap at 14.9 of 16 GB), and a budget, a
reserve and per-hub caps made it worse (the Stack kept 24 GB back while dev tooling held 1.3 GB, and a clip waited for room that was
free). Owner ruling: one checkout, like a library book. Those mechanisms are gone (no dev budget, no `dev-load.json`, no
`MAIPAI_DEV_BUDGET_GB`, no per-hub caps, no cold restarts, no Stack reserve).

- **One book:** the dev machine (dev hubs, test runs, builds, engine jobs a dev session starts). One session holds it and has all of
  it; one session's several jobs share it (a hub is a backend and a Vite). Everyone else waits in a first come, first served queue,
  except Jesse's own work (`--owner` or `MAIPAI_CHECKOUT_OWNER=1`: his clips, manual tests started from the app), which goes first.
  Nobody kills anybody.
- **Taken automatically, no way around it:** everything run through `scripts/jobs/job.sh` takes the checkout first and returns it when
  the job ends: `dev.sh` (backend and Vite, `--type server`, 24 h, workbench 30 d), `bash scripts/wt.sh check`, every `shardTests.ts`
  run (`--type test`, 90 min), and `lease.sh run` (engine jobs: `lease.sh run --kind video -- <command>`). A job started inside a
  checked-out job (`MAIPAI_CHECKOUT_ID`) shares it. The watcher and lander sessions are exempt (`MAIPAI_CHECKOUT_EXEMPT`, default
  `home-watcher,home-lander`): they are the pipeline, not a dev session. Plain code edits and single unit tests do not need it.
  `MAIPAI_JOBS_OFF=1` or `MAIPAI_CHECKOUT=off` skips it. `dev.sh start` refuses at once when another session holds the book (it cannot
  wait in front of a person) and names the holder; run it again when it is returned.
- **Return is automatic, never on the honour system:** the moment the holder's job ends; when the holder's process is gone (its session
  ended or crashed); or after 10 minutes with no activity (`lease.sh beat <id>`, or the job's processes using CPU;
  `MAIPAI_LEASE_IDLE_MIN`). A hub whose checkout was returned keeps running; its work is not killed.
- **A manual hold** (the holder waits for Jesse to test by hand): `lease.sh take --manual [--minutes 30] --what "..."`. It ignores
  idleness and the holder process, shows a timer, and returns by itself at the timer. `lease.sh extend <id> --owner-asked
  [--minutes 30]` only when Jesse says so in that turn.
- **Direct and gated:** in direct mode dev work runs. In gated mode a family turn in progress has priority: the checkout waits, a held
  one is told to yield (see "The hub's family turns" below).
- **Status:** the broker writes `jobs/dev-lease.json`; the admin Status row (the existing host row, RULES S6, no banner; family members
  never see it) reads it: holder, purpose, since when, a manual timer, who is next in line. It asks no one anything and offers no
  "stop the servers". `lease.sh status` prints the same facts.
- **Descendants:** `groupProcs` in `job.ts` counts a job's whole process tree (a process in its own group included), and a stop kills it.

- **Orphan reaper:** `job.sh reap [--dry-run]`, run by every hub's watcher every five minutes. It stops a `bun run --hot` (and its children)
  only when it runs in a worktree under `.claude/worktrees` or `wt/` that has a `data/dev` folder, no pid file there names it or the
  launcher that started it, no hub watcher runs, and that has held in a row for `MAIPAI_DEV_REAP_GRACE_MIN` (60) minutes. The live hub, the
  main checkout and anything else are never touched. One audit line (`orphan-stopped`) per stop; `jobs/dev-reaper.json` feeds one sentence
  on the admin "This Mac's self-check" Status row (`backend/src/lib/hostGuard.ts`, `withDevReaper`); no new banner, no memory words.
- **Preview default:** `dev.sh start` is the one shared workbench; `--own` is a private hub; see `AGENTS.md` "Previewing a change".

## Lease broker: `bash scripts/jobs/lease.sh`

The one implementation of the checkout. `lease.sh run [--kind K] [--what "text"] [--owner] -- <command>` takes it, runs the command
through the launcher, returns it. Also `take --manual`, `extend`, `acquire` / `release <id>` / `check <id>` / `beat <id>` / `status` / `mode`.

- **Classes.** `family` is an end-user request: it is never queued behind development work. `dev` is the checkout (one at a time).
- **Mode** is `MAIPAI_DEV_MODE`, else the output of `scripts/mode.sh status` when that script exists (DIRECT or GATED), else the file
  `jobs/mode`, else gated (the safe reading).
  - **Direct** (nobody on the hub, changes run first): a dev lease may take the whole machine (`--whole-machine`). While it does, family
    requests are refused and a maintenance flag file is written, so chat shows the one line "Chat is unavailable while the system
    upgrades." (below).
  - **Gated** (the family is on the hub, changes are checked first): dev work yields. A dev lease waits while a family lease is held or
    queued, a whole-machine lease is refused (exit 3), and a held dev lease is told to yield (`check` exits 10) when a family
    request arrives.
- **The hub's family turns.** Each chat turn (`turnMachine/turnNext.ts`, through `lib/familyActivity.ts` `trackFamilyTurn`) writes
  `local-app/family-active.json` in the hub's data directory (`{"active": n, "until": <epoch s>}`, refreshed every 20 s while a turn
  runs, 60 s claim; `MAIPAI_FAMILY_ACTIVITY` moves it). It is a file because the hub may run as root and the broker as the user. The
  broker reads it (the live install's `data/local-app` and `$MAIPAI_DATA_DIR`) as one synthetic family lease: in gated mode dev leases
  wait for it and held ones are told to yield. It never queues, caps or slows a turn, and a failed write is ignored. In direct mode it
  changes nothing.

## The end-user line: "Chat is unavailable while the system upgrades."

Two writers, one path rule (`MAIPAI_MAINTENANCE_FLAG`, else `$MAIPAI_DATA_DIR/local-app/maintenance.json`, else the live install's
`data/local-app/maintenance.json`; the hub's data directory is that same folder, so the hub reads what they write):

- **The installer** (`scripts/install.sh` `maintenance_flag_set` / `_clear`, run as root) writes the flag just before it starts Home
  (after any rollback restore) and clears it once Home and the Stack answer, or when the install fails. The flag carries its own end
  time (20 minutes), so a dead installer cannot leave chat off. While the hub is stopped nothing can be shown; the line covers the
  start-up stretch where the hub answers but chat is not ready.
- **A whole-machine dev lease** (`lease.sh`, as the user) writes it into the dev hub's data directory (workbench or the live
  install's when writable). If the place is not writable the broker audits `flag-not-written` and the lease still runs.

`backend/src/lib/maintenanceFlag.ts` reads it; the chat row in `roleHealth` becomes unavailable with cause
`upgrading`; `failureCopy.ts` supplies the line for every age band. It rides the existing health snapshot, composer line and Send hold
(RULES S6): no new surface. A flag past its `until` is ignored, so a crashed writer cannot leave chat off. The line never uses memory
or RAM words. (It contains the word "unavailable" by the owner's wording, so it is not in the resource-word scan's cause list.)
