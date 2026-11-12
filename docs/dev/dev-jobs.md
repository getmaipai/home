# Dev job launcher and lease broker (HOST-LAUNCH-01, -02, -03)

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

## Lease broker: `bash scripts/jobs/lease.sh`

For heavy work (video, images, big test runs): `lease.sh run --class dev --kind video -- <command>` takes a lease, runs the command
through the launcher, releases. Or `acquire --pid <long-lived pid>` / `release <id>` / `check <id>` / `status` / `mode`.

- **Classes.** `family` is an end-user request: it is never queued behind development work. `dev` is a session: dev sessions queue
  first come, first served among themselves (slots per `MAIPAI_DEV_LEASE_SLOTS`, default 1). Chat-first never applies between two
  dev sessions.
- **Mode** is `MAIPAI_DEV_MODE`, else the output of `scripts/mode.sh status` when that script exists (DIRECT or GATED), else the file
  `jobs/mode`, else gated (the safe reading).
  - **Direct** (nobody on the hub, changes run first): a dev lease may take the whole machine (`--whole-machine`). While it does, family
    requests are refused and a maintenance flag file is written, so chat shows the one line "Chat is unavailable while the system
    upgrades." (below).
  - **Gated** (the family is on the hub, changes are checked first): dev work yields. A dev lease waits while a family lease is held or
    queued, a whole-machine lease is refused (exit 3), and a held dev lease is told to yield (`check` exits 10) when a family
    request arrives.
- A lease is released when its holder pid is gone or its time (`--ttl`, 4 h) is up, so a crashed session never blocks the queue.
- Not built yet: the hub does not call `family` leases for turns. Until it does, `family` is the API and the tests; gated mode keeps
  dev work polite only toward leases someone registered.

## The end-user line: "Chat is unavailable while the system upgrades."

A whole-machine lease writes `local-app/maintenance.json` (`{"until": <epoch seconds>}`) in the hub's data directory (or the path in
`MAIPAI_MAINTENANCE_FLAG`). `backend/src/lib/maintenanceFlag.ts` reads it; the chat row in `roleHealth` becomes unavailable with cause
`upgrading`; `failureCopy.ts` supplies the line for every age band. It rides the existing health snapshot, composer line and Send hold
(RULES S6): no new surface. A flag past its `until` is ignored, so a crashed writer cannot leave chat off. The line never uses memory
or RAM words. (It contains the word "unavailable" by the owner's wording, so it is not in the resource-word scan's cause list.)
