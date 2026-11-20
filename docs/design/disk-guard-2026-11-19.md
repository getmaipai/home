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
| Dev-job orphan reaper, `data-scratch/` | Dev servers only | Product must never touch dev folders |

Missing model file: not yet checked in readiness (to be confirmed by DISK-GUARD-05's first step; the row says what it finds).

**Verdict: PORT.** The memory watchdog (Stack) and `checkDiskFull` plus the Repairs list (Home) are the mechanisms; disk joins them.
No second status system, no second cleaner. Tidy stays the one model cleaner; the repair only lists and calls it.

## 2. Design

**Watching.** The Stack owns model and engine files: a new `lib/diskState.ts` mirrors `memoryState.ts`: samples free and total bytes of
each volume the Stack writes to (models, engines, outputs), keeps the level with hysteresis, exposes `lowDiskRefusal()` and
`diskAdmission(needBytes)`. The sampler rides the existing watchdog tick (no new timer). Home keeps `checkDiskFull`, now with two
levels, for its own volumes (data folder, backups, Library) plus the Stack's reading (`/stack/v1/disk`, additive).
The host guard stays as is: a root daemon with no say over product files; it only gains a one-line disk reading on the Status row
(DISK-GUARD-06, optional).

**Levels, one definition.** Warning when free space is under the larger of 30 GB and 10 percent of the volume; critical under the
larger of 10 GB and 3 percent. Stricter of bytes and share, so a small drive and a 2 TB drive both warn early enough. Reason: the
largest single install is about 80 GB and a long video render writes tens of GB, so 3 percent of 1.8 TB (54 GB) is where one more big
job can fail; 2 GB (the current floor) is a state where the database cannot write. Clears at 1 percent above the line (hysteresis). The
numbers live in `commons/spec` as one function `diskLevels(totalBytes)` plus the Settings keys `storage.warn_free_gb` and the existing
`storage.critical_free_gb` as overrides (0 = use the rule); Stack and Home both call it. `critical_free_gb` default changes from 2 to 0.

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
3. Old failed job outputs: older than 7 days, only outputs of failed or cancelled jobs.
Never the Library, backups, or anything a person made. The repair sums reclaimable bytes first; if it cannot reach the warning line it says so and names what is biggest.

**Missing files.** A slot's model path that is gone from disk shows as "needs repair" with a Reinstall action, found by the same
sampler tick (a stat of each selected slot's files), instead of a job failing later. This also guards the exact incident: a deleted
file in use.

**Dev machine.** The product never deletes outside its own data and models folders. A separate `scripts/disk-report.sh` (read only,
no deletes) lists the biggest folders: checkouts' `data-scratch/`, `~/video-bench`, Hugging Face caches, the Library, models. Developer tool, not product.

**Safety and privacy.** Nothing leaves the home; no gate, rating or audience change; adults-only paths are unaffected; the reading is local statfs.

## 3. Supersedes

Replaces `checkDiskFull`'s single 2 GB test (same job, same issue key, same `diskIsLow()` call sites, now level-aware). Reuses:
`memoryState`/watchdog pattern, `lowMemoryRefusal` call sites, disk plan numbers, tidy, issues + fix handlers, admin Status row. New
code: `diskState.ts` (Stack), a spec function, a repair list route in Home. A second cleaner and a second status surface were rejected.

## 4. Open and decided without asking

- Thresholds above are proposed defaults, adjustable per household; no automatic deletion at any level (the owner's rule on deleting is respected: only on the admin's tap). Decided.
- Order: spec (commons), Stack, Home, then the dev script.
