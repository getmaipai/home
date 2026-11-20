# Disk guard: the hub notices a filling disk, says so, refuses work that would fill it, and offers safe fixes (2026-11-19)

Owner request 2026-11-19: the hub's Mac reached 98 percent full (47 GB free of 1.8 TB) and nothing warned anyone; a cleanup then
deleted a model file the live hub was using. Extend the resource guard to handle disk. Governing: RULES S6 (status reaches a person
through existing surfaces), `docs/PLATFORM.md` principles 1 and 4 (one definition, one place), the owner's "no resource words" rule.

## 1. What exists (searched 2026-11-19, both repos)

| Area | What it does today | Gap |
|---|---|---|
| Home `lib/storage.ts` `diskUsage()` | statfs of the data folder: total and free bytes | Only the data volume |
| Home `checkDiskFull()` (core job `storage.check_disk_full`, hourly) | Clears previews, then raises Repairs item `storage/disk_full` (error) under `storage.critical_free_gb`, default **2 GB** | **Why 47 GB free went unnoticed**: one absolute floor of 2 GB, no warning level, no share, no fix action, no Stack volumes |
| Home `diskIsLow()` | Background savers skip writes under the same 2 GB | Same floor |
| Home install preflight (`installPreflight.ts`, `diskPlan.ts`) | Plan size + 20 percent + peak temp against free space of each volume, at install and setup | Install time only; not jobs; not while running |
| Home Library trash and retention, `packageCache.ts` sweeps, previews | Delete safely by their own rules | Not offered together as a fix |
| Stack `diskPlan.ts`, `diskPlanMeasured.json`, `installPlan.ts` | What each install costs | Plan only; engine and model pulls read no free space |
| Stack `tidy.ts` (`planTidy`/`runTidy`, route in `routes/components.ts`, run by `sweeps.ts`) | Removes superseded models, orphan folders and partial downloads after a grace period, with guards (loaded roles, successor ready) | Never run for disk pressure; no listing for an admin tap |
| Stack `memoryState.ts` + `memoryWatchdog.ts` | Levels normal/warn/critical with hysteresis; `admissionVerdict`; `lowMemoryRefusal()` called by image, video and music generation with a plain line | **The pattern to extend.** Reads no disk |
| Host guard daemon (`scripts/studio/host-guard`) | Root probe every 60 s of lookup, service start, Metal and memory; writes `status.json`, `memory.json` that Home folds into the admin Status row (`lib/hostGuard.ts`) | Reads no disk |
| Admin surfaces | Issues/Repairs list (`lib/issues.ts`, `raiseIssue`, `registerFixHandler`, `fixIssue`), notifications, admin Status row | Reuse all; add none |
| Commons core `diskSpace()` and `diskFacts` (`core/src/hardware.ts`, DATA-LOCATION-00d) | `bavail * bsize` and total of the filesystem a path is on | **The one reader**: Home's `diskUsage()` and `packageCache.ts`'s `freeDiskBytes()` (two more `statfsSync` copies) fold into it |
| Dev-job orphan reaper, `data-scratch/` | Dev servers only | Product must never touch dev folders |

Missing model file: not yet checked in readiness (to be confirmed by DISK-GUARD-05's first step; the row says what it finds).

**Verdict: PORT.** The memory watchdog (Stack) and `checkDiskFull` plus the Repairs list (Home) are the mechanisms; disk joins them.
No second status system, no second cleaner. Tidy stays the one model cleaner; the repair only lists and calls it.

## 2. Design

**Watching.** The Stack owns model and engine files: a new `lib/diskState.ts` mirrors `memoryState.ts`: samples free and total bytes of
each volume the Stack writes to (models, engines, outputs), keeps the level with hysteresis, exposes `lowDiskRefusal()` and
`diskAdmission(needBytes)`. The sampler rides the existing watchdog tick (no new timer). Home keeps `checkDiskFull`, now with two
levels, for its own volumes (data folder, backups, Library) plus the Stack's reading (`/stack/v1/disk`, additive).
The host guard stays as is: a root daemon with no say over product files; it reads no disk; the admin Status row shows the same level Home computes (DISK-GUARD-06, which overlaps the open STATUS-RESOURCES-01 and cites it).

**Levels, one definition.** Warning when free space is under the larger of 30 GB and 10 percent of the volume; critical under the
larger of 10 GB and 3 percent. Stricter of bytes and share, so a small drive and a 2 TB drive both warn early enough. Reason: the
largest single install is about 80 GB and a long video render writes tens of GB, so 3 percent of 1.8 TB (54 GB) is where one more big
job can fail; 2 GB (the current floor) is a state where the database cannot write. Clears at 1 percent above the line (hysteresis). The
numbers live in `commons/spec` as two pure functions `diskLines(totalBytes, overrides)` and `diskLevel(free, total, previous, overrides)` (landed, `spec/stack/ts/disk-levels.ts`) plus the Settings keys `storage.warn_free_gb` and the existing
`storage.critical_free_gb` as overrides (0 = use the rule); Stack and Home both call it. `critical_free_gb` default changes from 2 to 0.

**How free space is read.** `statfs` of the folder being written to, `bavail * bsize` (Node `statfsSync`), never `df` figures from a
different mount and never Finder's "available" (it counts purgeable space a download cannot use). Checked 2026-11-20: `statfs` on the
data volume matched `diskutil info` "Container Free Space" (56.2 GB). Every volume the product writes to is read separately (APFS
volumes of one container share one number; the sampler dedupes by device). Measured 2026-11-19: free space fell from 47 GB to 15 GB
inside one hour while four sessions downloaded models, so the sampler runs every 60 s and refuses on the reading plus the job's own
declared need, not on the last reading alone.

**Behavior.**
- Warning: Repairs item "Storage is getting full" (warning severity) with the fix below; one notification to admins when it first appears.
- Critical: item becomes an error; new model and engine downloads, video, music and picture generation, and backups are refused with
  a plain line: "There is not enough room left on this computer for that. Free up space in Settings, then try again." No byte or
  memory words with people; an admin's Storage page already shows sizes in its own units (kept as is).
- Critical also reaches `lib/roleHealth.ts` as `cause: "disk"`, so the existing "Pictures and video are not ready" row disables the controls ahead of time, not only at submit.
- The warning's first appearance sends an admin notification of a new type declared in `lib/notificationTypes.ts` (`raiseIssue` notifies only on errors).
- Chat, voice, reminders and the database keep working; nothing the household owns is touched.

**Admission.** Before a download or a heavy job the Stack checks `free - need - margin >= critical line`: installs use the disk plan's
numbers; video, music and picture jobs declare a peak output estimate like they declare peak memory; backups use the last backup size.
Refused jobs say why and what to do; a job under the line waits no longer than a memory wait (it does not queue on disk, since disk
does not free itself).

**Fixes.** The Repairs item's fix links to the existing admin Storage page (a fix handler takes no arguments, so it cannot hold a pick list). The list lives there, built from shipped kit Elements (rule 9, no new panel): an admin sees each item and what it frees, one tap clears the selection:
1. Superseded models, orphan folders, partial downloads: the Stack's existing `planTidy`/`runTidy`, grace ignored only on the admin's tap, never a model a slot selects or a role has loaded. Tidy today only blocks a loaded role (`loadedRoleForModel`); DISK-GUARD-02 adds a "selected by a slot" guard first, since that is the incident. Reversible by reinstall.
2. Package cache, previews, temporary job folders: existing sweeps (`clearPackageCache`, `clearPreviews`).
3. Old failed job outputs: older than 7 days, only outputs of failed or cancelled jobs, shown as one row with a count and a size, never one by one (rule 6a).
Never the Library, backups, or anything a person made. The repair sums reclaimable bytes first; if it cannot reach the warning line it says so and names what is biggest.

**Never delete by "nothing has it open" (2026-11-19 incidents: a cleanup removed a model file the live hub reads through
`MAIPAI_H3_VIDEO_HOME`, a scratch folder set by environment override; another removed a folder a sibling had symlinked).** The
safe-to-clear list is built only from what the product itself owns and can prove unused by pointer: not selected by a slot, not
referenced by a record, not named by an environment override, not the target of a symlink. An item outside the product's own models, engines,
cache and job folders is never listed. Open-file checks are an extra guard, never the proof.

**Missing files.** Includes paths that come from environment overrides (such as `MAIPAI_H3_VIDEO_HOME`), not only Stack model records:
the sampler resolves each selected quality's real file paths the way the engine does and stats them, so "this quality's files are
gone" shows as needs repair with a plain fix (reinstall, or "point it at the files again" for an override). A slot's model path that is gone from disk shows as "needs repair" with a Reinstall action, found by the same
sampler tick (a stat of each selected slot's files), instead of a job failing later. This also guards the exact incident: a deleted
file in use.

**Dev machine.** The product never deletes outside its own data and models folders. A separate `scripts/disk-report.sh` (read only,
no deletes) lists the biggest folders and the symlinks that point into any folder before anyone removes it: checkouts' `data-scratch/`, `~/video-bench`, Hugging Face caches, the Library, models. Developer tool, not product.

**Safety and privacy.** Nothing leaves the home; no gate, rating or audience change; adults-only paths are unaffected; the reading is local statfs.

## 3. Supersedes

Replaces `checkDiskFull`'s single 2 GB test (same job, same issue key, same `diskIsLow()` call sites, now level-aware). Reuses:
`memoryState`/watchdog pattern, `lowMemoryRefusal` call sites, disk plan numbers, tidy, issues + fix handlers, admin Status row. New
code: `diskState.ts` (Stack), a spec function, a repair list route in Home. A second cleaner and a second status surface were rejected.

## 4. Open and decided without asking

- Thresholds above are proposed defaults, adjustable per household; no automatic deletion at any level (the owner's rule on deleting is respected: only on the admin's tap). Decided.
- Order: spec (commons), Stack, Home, then the dev script.

## 5. Amendments after the architect's verdict (2026-11-20, REJECTED then amended; where this section differs from earlier text, this section wins)

1. **Words per audience (S6).** A `disk` cause is added to `failureCopy` (the source of the "Pictures and video are not ready" notice, `makingNotice`) with variants for admin, adult, teen and child. Only admins are told to free up space; each non-admin audience gets its own wording (a non-admin adult is told to tell whoever looks after the hub; a teen and a child get a short "paused for now" line; never a size or resource word), with no size or resource words. The single line quoted in section 2 is the admin variant.
2. **One level, one item, typed (S6).** The Stack's `/stack/v1/disk` answer is the level per volume and Home uses it as is; Home never recomputes the Stack's volumes. Home's own check covers only Home's writes (Library, backups, podcasts, job outputs). There is one Repairs item per physical volume (`storage/disk_full` keyed by volume), never two for the same one. The Stack's refusal carries a typed `kind: "disk"`; `roleHealth` maps that kind to the `disk` cause, with no pattern-matching of the copy (the memory path's `/memory/i` is the debt not to repeat).
3. **Rule 6a.** Old failed job outputs are one row with a count and a size on the admin page. Model rows may be itemised (models are parts).
4. **Settings (E5).** The household's choice is stored once, by Home (`storage.warn_free_gb`, `storage.critical_free_gb`) and sent to the Stack; the Stack keeps no copy, so the two `stack.storage.warn_free_gb` and `stack.storage.critical_free_gb` settings added in the first pass are removed in DISK-GUARD-02 (`stack.storage.tidy_grace_hours` stays).
5. **Who answers "does it fit" (E7, E4).** The per-job peak output estimate lives in each model's pack, not in Home. Whether a download or job fits is the Stack's answer (`diskAdmission`); Home's critical check never gates Stack work. Backup admission reads the backup destination's volume, not the main one.
6. **Env-override paths.** The missing-file check calls each part's own path resolver, override included (`MAIPAI_H3_VIDEO_HOME` is read in the shared `video/videoGen.ts` and `video/swap.ts`, already E7 debt), and adds no new check that names a model. Home shows the Stack's "needs repair" state; Reinstall is a call to the Stack by part id. When a file came from an override folder, Reinstall installs into the managed folder and the repair says the override folder is outside what the product manages. Separate follow-up row DISK-GUARD-07: a live Stack reading production model files from a developer scratch folder is what let a cleanup delete a file in use.
7. **Safe-to-clear proof.** DISK-GUARD-04's acceptance: items come only from what the product owns and can prove unused by job records, tidy's guards and the Stack's class markers (DATA-LOCATION-03), never "no process has it open". The list goes into the existing `DataTable` on `StoragePage.tsx` (kit Elements as shipped, rule 9).
8. **One reader for free space.** A volume is keyed by its device (`stat.dev`); when Home's data folder is on a device the Stack reports, Home takes the Stack's level for that volume and raises no second item.  Commons core `diskSpace()` (`core/src/hardware.ts`, `bavail * bsize`) and Home's `diskUsage()` and `packageCache.freeDiskBytes()` both call it (keeping their no-statfs fallback); the Stack's `diskState.ts` calls `diskSpace` and writes no third. The reuse table also lists `diskSpace` and `diskFacts` (DATA-LOCATION-00d).
9. **Related rows.** INSTALL-DISK-01 (done; admission reuses its size table), DATA-LOCATION-01e (watches whole folders going missing; DISK-GUARD-05 mirrors its watch and issue pattern), DATA-LOCATION-03 (describe a folder before deleting), STATUS-RESOURCES-01 (open; DISK-GUARD-06 cites it). HOST-GUARD-04 and SPLASH-DISK-01 are separate work.
10. **Warning notification.** Its type in `lib/notificationTypes.ts` belongs to DISK-GUARD-03, not 06.
11. **Hub housekeeping (DISK-GUARD-08).** The shared worktree reaper (`cmd_reap`, `live_reason` in `.github/standards/bin/wt.sh`) keeps any worktree holding an ignored file outside a short list, so 339 worktrees took 426 GB under `getmaipai/wt/` (208 landed, clean and idle). It will remove a worktree whose branch is on origin/main, has no tracked or untracked changes, is idle and holds only known-disposable ignored content, archiving anything else small first. A risky surface: full gate and review.
