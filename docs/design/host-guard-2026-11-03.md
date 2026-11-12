# Host guard: the Mac keeps itself healthy and recovers without a person (2026-11-03, revision 2)

Owner request 2026-11-03: the Mac Studio has needed a hard power cycle every 3 to 5 days. Find the cause, prevent it, and build the
prevention into the app (Home and the Stack), not as a one-off script on one machine. Governing rules: RULES.md S6 (status reaches
the person through the existing surfaces), the Stack resource-management design (R1 to R4 and the F1 review), GPU-HEALTH-01, and
`docs/PLATFORM.md` principles 1 and 4 (one definition, one place).

Revision 2 answers the architect's verdict of 2026-11-03 (REJECTED on process: no Supersedes section, no reuse check). Section 3 is
the Supersedes list, section 4 the reuse check.

## 1. What happened (evidence, 2026-10-26 to 2026-11-04)

Reboots of the Studio: Oct 16, 18, 23, 26, 30 and Nov 3 (every 2 to 5 days; the last three at 3, 4 and 4.2 days of uptime).
Three incidents (Oct 26, Oct 30, Nov 3) have one shape. Each is recorded by the session that lived it; the Nov 3 one is also in the logs.

- **The Metal shader compiler becomes unreachable.** Every engine that starts fresh fails with `Unable to reach MTLCompilerService`
  (the Stack's `METAL_COMPILER_SENTENCE`). Engines started earlier keep running, so the machine looks healthy until chat restarts.
  Nov 3: first failure 03:00:47, then 414 failed starts until the hard reset at 18:16; chat was down from 12:08 (the restart of the
  chat engine could not start it again).
- **The user lookup service stops answering** (Nov 3 certain; Oct 26 likely: `ps` said "sysmond service not found", the keychain
  and `gh` broke). launchd then logs `getpwuid(501) ... does not exist` for service spawns, including `MTLCompilerService` itself and
  `mdworker`, and `sudo`, `shutdown`, `launchctl reboot`, System Events restart and Codex launch all fail. No non-root way back exists.
- **Chat engine memory.** Splash chat (1.4.1, context 131072, `--idle-release off`, no `--max-memory` in chat mode) measured with `footprint`:
  49 to 53 GB on a fresh boot (GPU memory, "IOAccelerator"), **101 GB two hours later on an idle Mac** (2026-11-03 22:31; the resident size was
  25 GB; `proc_pid_rusage` `ri_phys_footprint` reads 103.7 GB, so the figure is available to the Stack). macOS reports gave 77 to 91 GB on Oct 30
  and 102 GB on Nov 3. At the same moment the Stack's own ledger (`/stack/v1/memory`) showed 11.9 GB then 24.6 GB for that process:
  the Stack's reading under-counts. Why is open (HOST-GUARD-04 finds out; `lib/memory/darwin.ts` takes `max(resident, ri_phys_footprint)` and
  falls back to `ps rss`). Splash issue incoai/splash#644 (open, 1.5.0) documents the KV prefix-cache pool filling to the engine quota and
  `--idle-release` freeing weights only. On Nov 3 at 02:51 the Stack saw memory critical (23 GB available, swap 8.8 GB). On Oct 26 memory was
  94% free, so memory alone does not explain every incident.
- **Not proven:** why the lookup service failed. It logs nothing before failing and the root logs were not readable. This design does
  not claim a cause; it makes the next occurrence recoverable and captured.
- Other load seen: Spotlight indexing 80 to 276 worktrees (indexing on the data volume was turned off on 2026-11-03), parallel `bun install`
  and checks (already bounded by the heavy slots, `docs/dev/delivery-pipeline.md`).

## 2. Design

Four parts. Each feeds an existing mechanism; none adds a status surface (RULES S6).

### 2.1 The host guard daemon (a root LaunchDaemon, installed by the host-tune item `host-guard`)

Source of truth: `scripts/studio/host-guard/` (script, installer, tests). Installed to `/usr/local/libexec/maipai-host-guard`
with `com.maipai.host-guard` (every 60 s), the same pattern as `com.maipai.wired-limit` in `host-tune.sh`.

- **Two config files, trust split.** `/var/db/maipai-host-guard/config.json` is root-owned (written by the installer, changed only by a
  host-tune re-apply with the administrator prompt): the owner account name and uid, Home's data directory. `/var/db/maipai-host-guard/tuning.json`
  is written by Home and holds only `mode` and the thresholds; the daemon clamps every value to a fixed range (`hard_minutes` 2 to 30,
  `metal_minutes` 5 to 120, `max_reboots_per_12h` 0 to 3, `mode` one of off, dry, live) and ignores anything else. A root process never takes an
  account, a path or a command from a file the user can write.
- **Probes (each with a timeout):** the owner's lookup (`dscl` and `id`); a service start in the owner's session (`launchctl asuser`
  plus `sudo -u`); one Metal shader compile through the same compiler service the engines use. The Stack exposes no stable Metal canary
  result to read (GPU-HEALTH-01's canary is an engine-restart request path), so the daemon runs the compile itself; the shader text is the Stack's
  `hostProbe.ts` text, kept equal by the HOST-GUARD-01 test that compares the two files. Probes run in their own process group with a timeout, and a
  probe that cannot run (the owner has no login session, or a sudoers file is broken) is skipped, never counted as a failure.
- **Trigger:** lookup or service start failing for `hard_minutes` (default 3). Metal failing for `metal_minutes` (default 10) **and** a
  quiet moment: no chat turn or job in flight (read from the Stack ledger's queue depth and the chat role's busy state), waiting at most 30
  more minutes, since with only Metal failing the running engines still answer.
- **On trigger:** capture once per episode, then reboot gracefully; a forced reboot follows after 150 s if shutdown stalls.
- **Capture contents (RULES 6a):** `ps -o pid,ppid,etime,pcpu,rss,state,comm` (no arguments), `top`, `vm_stat`, `memory_pressure`, `footprint` of the engines,
  the owner's lookup output, `launchctl print` heads, `spindump` of the lookup service, `log show` limited by predicate to launchd, opendirectoryd, MTLCompilerService
  and kernel errors, and one `sysdiagnose`. The folder is root-only (0700), is not read or shown by Home or the Stack, and is deleted after 14 days.
- **Guards:** nothing for 15 minutes after boot; no reboot while a ship or install runs (up to 45 minutes); at most
  `max_reboots_per_12h` (default 2); a reboot writes `last-reboot.txt` (reason, capture folder name).
- **Output:** `status.json` (world-readable, schema version 1) after every pass.

Why a root daemon: root can still reboot when the owner's lookup fails; every other path fails (section 1).

### 2.2 Install and settings through the existing host-tune path

A new host-tune item `host-guard` (mode consent, needs an administrator) next to `wired-limit`: `detect` reports installed, mode and last
status; `apply` installs the daemon and writes `config.json`; `revert` removes it. It appears in the setup wizard's host step and in Settings,
Performance (`HostTuneStep.tsx`, `HostTuneSettings.tsx`); nothing new in the UI. The tunables are Settings keys declared **first** in
commons `spec/settings/keys.json` with their spec copy fields (S5, `docs/SETTINGS.md`): `host.guard.mode`, `host.guard.hard_minutes`,
`host.guard.metal_minutes`, `host.guard.max_reboots_per_12h`. Home writes `tuning.json` when a key changes; no administrator prompt per change.

### 2.3 Status through the existing surfaces

- **Whole-system health:** one row, "This Mac's self-check", on the Status page. Its data source is the component health list, synced the way
  `lib/stackHealthSync.ts` syncs the Stack's (a `hostGuard` health source that reads `status.json`; ok, watching, restarting itself, off). It does not
  go through `statusBoard.ts` (notes and maintenance only).
- **Needs fixing:** a Repairs item through `raiseIssue`, raised by that same health sync when it sees the guard off or in dry mode on a Mac that has had a
  host incident, or a reboot refused at the limit. No timer of its own (S6). A guard reboot resolves GPU-HEALTH-01's Repairs item
  ("graphics compiler is not responding"); the sync resolves it on the first healthy pass after the reboot.
- **Needs an admin:** a notification type `host-guard-restarted` ("The Mac restarted itself because <reason>"), declared in
  `lib/notificationTypes.ts`, raised once on the first Home start after a guard reboot (reads `last-reboot.txt`), audience admins.
- **Chat during any engine restart** shows its starting state through `roleHealth` (the S6 row "The AI or chat is not ready"); the Stack reports a host fault in its
  health list, which Status and Repairs already read.
- Copy follows STYLE.md: what happened, then the next step. No resource words for non-admins.

### 2.4 The Stack stops the cause it can see (separate repo `getmaipai/stack`)

- **Count the real size (HOST-GUARD-04).** Find why the ledger showed 11.9 and 24.6 GB for a process whose `ri_phys_footprint` is 103.7 GB
  (the FFI read, the fallback to `ps rss`, or the process chosen), fix it, and add a test from a recorded sample. The ledger, governor and watchdog then see an engine's true size.
- **Cap at launch (HOST-GUARD-05).** Splash chat gets `--max-memory` in every mode (today only coding mode). The value holds the cache for the **full reported context**
  (RULES.md rule 4: chat is never launched with a smaller context than the machine can hold): the admitted peak the governor already records
  (the default headroom is 12 GB; `recordMeasuredFootprint` runs only for engines that do not map their weights, so Splash may have none: HOST-GUARD-05 establishes the peak from the corrected HOST-GUARD-04 figure over a warm session, not from the early post-load reading that F1 showed is wrong for chat, and a test proves the cap never falls below the full-context need) plus the Settings headroom
  `stack.engines.chat.max_memory_headroom_gb`. This bounds the KV pool in #644 without restarting anything, so R1 holds.
- **Report when a restart is refused.** If a restart is refused (rate limit), the existing `resident-memory-grew.chat` is raised once with its Restart engine action.
- **Ceiling and maintenance restarts (on, by the owner's 2026-11-04 ruling).** Past `memory_ceiling_factor` (default 1.15) times the cap for two looks, or after
  `maintenance_restart_hours` (default 12), the watchdog restarts the chat engine in a quiet window, only after the Metal check passes, rate limited, with their own `RetireCause`s
  (`memory-ceiling`, `maintenance-restart`). This is where the design departs from R1 (section 3).
- **SPLASH-DISK-01** (open) already asks why Splash's footprint stayed 77 to 91 GB idle. HOST-GUARD-04 and -05 take the footprint half; disk writes stay in that row.

### 2.5 Memory probe and bounded self-repair (revision 3, 2026-11-12; HOST-GUARD-07, -08, -09)

What happened: on 2026-11-12 `fseventsd` (the macOS file-event daemon) reached 66 GB, 63 GB of it compressed or swapped, with a 3.4 GB
resident size. Its `vmmap` shows the growth in Malloc Small: about 128 KB leaked per "Resolve user group list" call (libsystem_info),
about 100 calls a second while the lander's safety tests ran. Kernel pressure stayed at level 2 for hours. Every guard that reads
resident size missed it, the sharder paused with no deadline until the lander killed it, and the Stack moved chat to the small model.
A leak is only freed by restarting the daemon, which needs root, so the guard does it, within fixed bounds.

- **Probe (every pass, after the reboot decision, bounded):** kernel pressure level, free percent, swap used and total, compressor
  size, the five biggest processes by footprint with compressed size (`top -stats pid,command,mem,cmprs`), the daemon's footprint and
  its growth in MB a minute (same pid), and, as a diagnostic only, "Resolve user group list" lines a minute and the MB they leak
  (x 0.125). Written to `memory.json` (0644) with a one-line admin summary, and one row a pass to `memory.csv` (also landings and
  ships in the last hour when `config.json` names a `dev_data` folder; only timestamps are read).
- **Allowlist (code only):** `capture-fseventsd`, `restart-fseventsd`, `dev-shed`. Each has a trigger, a hold time, a cooldown and a
  daily cap. Repair mode (`repair.json`, root-owned, default `live`) can be `dry` (log only) or `off`; the kill switch file
  `<data_dir>/host-guard/OFF` turns every action off. Decisions go to `repair-audit.log` (counts and reasons).
- **Triggers:** restart when the daemon's footprint is at or above 16 GB (`fsevents_compressed_gb`), or when it grows 20 MB a minute or
  more for 5 minutes and is above 2 GB; at most once per 6 hours and twice a day; never during a ship or install. `dev-shed` when the
  kernel pressure level is 2 or more for 20 minutes; refreshed while it lasts, cleared after 5 calm minutes.
- **Evidence first:** `capture-fseventsd` runs when the daemon first crosses a trigger (once per 6 hours, 3 a day): `vmmap -summary`,
  the full `vmmap`, 6 hours of the daemon's log, 2 hours of `mds` and the FSEvents subsystem, `footprint`, `top`, a 15 s `fs_usage`
  sample reduced at once to counts per process and per path bucket (a worktree folder name, node_modules, .git or a broad area), open
  files per process, the `/dev/fsevents` clients, swap and `vm_stat`, `launchctl print`, and landing and ship timestamps. Each step has
  a hard limit. Raw output stays in `fsevents-captures/<stamp>/` (root-only, last 3, 300 MB cap); `fsevents-digest.json` (0644) holds
  counts only. A restart needs a complete capture from the last 30 minutes; above 40 GB (`emergency_gb`) a 60 s capture runs and the
  restart goes ahead even if it is incomplete.
- **After a restart:** the guard checks the daemon came back small, records before and after sizes, sets the notice "Chat is slower for
  a few minutes while the system tidies up." in `memory.json` for 10 minutes, and writes `fsevents-restarted`. It touches no user
  process. Each dev hub's watch loop (`scripts/dev.sh`) reads that file and restarts its own hub in full, which rereads every file from
  disk, so an edit made during the restart window is picked up.
- **Readers (development side):** `scripts/lib/hostmem.sh` says no (exit 75, one plain line) under pressure level 2 or a fresh
  `dev-shed` flag; `ship.sh`, the full and frontend `check.sh` gates, the lander's safety tests (the entry is held and retried) and the
  watcher (the tick is skipped) read it. The sharder sheds to one worker under pressure, and after 300 s exits 75 "deferred
  (memory)", which is never a pass and never a failure of the branch. `sourceThrottleCap` in the sharder is the hook for a later source
  throttle (a worker cap while the lookup rate is high), off until `MAIPAI_GATE_SOURCE_THROTTLE` is set.
- **Status:** the admin Status row adds the memory summary under pressure, paused development work or a repair in the last hour.
  People never see memory wording; the end-user status reason (STATUS-REASON-01) is not built yet and will read `notice`.

Not tested without root: the real `launchctl kickstart`, `vmmap` and `fs_usage` on a root daemon, and `top` as root. The tests run the
real script with every tool replaced by a fake (`scripts/hostGuardMemory.test.ts`).

## 3. Supersedes

- **resource-management.md R1** ("a reserved role is never restarted or evicted for memory it grew into"): **lifted for the chat role only by the owner's
  ruling of 2026-11-04** ("turn on guards to kill restart whatever"). The Stack may restart chat past its memory ceiling (two looks, quiet, Metal check passes, at most one
  per hour and four per day) and every `maintenance_restart_hours` (default 12; 0 turns it off) in a quiet window. R1 holds for every other reserved role.
- **Coding-mode-only `--max-memory`** (`supervisor.ts` around line 1486, `docs/dev/coding-mode.md` line 36): chat mode now also passes it (rule 4 wording above).
- **`lib/memory/darwin.ts` process figure**: corrected after HOST-GUARD-04 finds the cause; the `max(resident, footprint)` rule stays unless the finding says otherwise.
- **The one-off `/usr/local/libexec/maipai-watchdog`** installed on the Studio on 2026-11-03: removed by the HOST-GUARD-01 installer.
- **GPU-HEALTH-01** ("restart only our own engines through SELFHEAL-01's `requestEngineRestart`" when the canary fails): unchanged. The guard never restarts engines; it reboots the Mac.

## 4. Reuse check

- **macOS restart after a freeze** (`systemsetup -setrestartfreeze on`): covers a kernel hang only; every incident here left the kernel running. Not enough alone.
- **A maintained watchdog (`monit` and similar):** not shipped with macOS, would be a new dependency to download and pin (RELEASES-AND-DEPENDENCIES.md), and would still need our two probes and the capture. Dismissed.
- **The `power` host-tune item (`autorestart`):** restarts after a power loss only. Kept as the cold-start half (the Mac comes back to a logged-in desktop).
- **Reused:** `host-tune.sh`'s consent-mode LaunchDaemon pattern (`com.maipai.wired-limit`), the Stack's `hostProbe.ts` Metal compile and GPU-HEALTH-01's canary, `stackHealthSync.ts`'s sync path,
  `raiseIssue`, the notification type registry, `HostTuneStep` and `HostTuneSettings`. Smart plug: none installed and the owner is away; it stays a possible second layer.

## 5. Rules check

- S6: every signal uses the health list and Status page, Repairs and Notifications; no banner, dot or poll of its own.
- Privacy: nothing leaves the Mac; the capture is root-only (0700), never read or displayed by Home or the Stack, deleted after 14 days. The `ps` listing has no arguments (6a); the one `sysdiagnose` does collect process arguments and unfiltered logs, which is why the folder stays root-only and outside every Home surface.
- Credentials: the installer needs an administrator once, through the platform's own prompt; no password is stored or read.
- Risky surface: a root daemon that reboots the Mac. Needs full `check.sh`, `code-review` at medium and the architect verdict; the live proof forces a failure on the daemon in dry mode and runs a
  timed pass in live mode with the test seams, never a real power cut.

## 6. Slices (each a backlog row)

1. **HOST-GUARD-00** (commons, first) the four Settings keys in `spec/settings/keys.json` with copy fields, tagged.
2. **HOST-GUARD-01** the daemon source, installer, the two config files and tests.
3. **HOST-GUARD-02** the host-tune item `host-guard`, `tuning.json` writer, wizard and Settings surfaces.
4. **HOST-GUARD-03** health source, Status row, Repairs item and the restart notification.
5. **HOST-GUARD-04** (Stack) find and fix the under-counted process memory; test from a recorded sample.
6. **HOST-GUARD-05** (Stack) `--max-memory` for chat in every mode from the admitted peak plus headroom; the optional maintenance restart.
7. **HOST-GUARD-06** the live proof on the Studio: install, forced failures in dry mode with the Status row read, a night of real probes, and the Splash size over a day with the cap.

## 7. Already done on 2026-11-03 (before this design, on the Studio only)

A one-off version of 2.1 is installed on the Studio (mode live) and Spotlight indexing on the data volume is off. HOST-GUARD-01 replaces the one-off.

## 8. Open

- Whether the cause of the lookup failure is the Mac's own bug is unproven; the capture exists to settle it.
- A planned Mac reboot every 2 to 3 days is the owner's choice; not part of this design.
- Splash 1.4.1 against 1.5.x: #644 is reported on 1.5.0; the cap makes 1.4.1 safe regardless.
