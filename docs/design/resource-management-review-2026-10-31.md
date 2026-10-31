# Resource management review: load balancing, safeguards and memory (2026-10-31)

Status: review, not a design. Nothing here changes a rule. Owner's ask (Jesse, 2026-10-31): review what the dynamic model
load balancing, safeguard and memory management system is, how it is meant to work and how it is coded; decide whether it
needs a better design or fixes; the goal is a system that never crashes and gets the most speed, quality and stability out
of the machine, so that people leave thinking it is better than the hosted chat services.

Evidence: the Stack code at `16f9684` (`backend/src/lib/governor.ts`, `memoryWatchdog.ts`, `memoryState.ts`,
`heavyGate.ts`, `admission.ts`, `jobs.ts`, `supervisor.ts`), the Home code at `3ef6d6717` (`backend/src/lib/jobs/*`,
`lib/tiers.ts`, `lib/resourceGovernor.ts`, the picture, video and music job files), the eight design notes listed in
section 2, the live hub's Stack log (`/usr/local/maipai-home/stack/data/logs/stack.log`, 2026-10-17 to 2026-10-31,
13,909 lines) and the live `GET /stack/v1/memory` and `/stack/v1/hardware/budget` readings taken on 2026-10-31 at 04:01 UTC.

## 1. Answer

1. **The design is sound and most of it is built.** Three layers do the right jobs: the Stack governor admits by memory and
   evicts idle models in a class order; the watchdog reads the whole machine every 5 s and steps down a ladder; the heavy
   gate stops a picture, video or music worker while a chat or voice request runs. Home orders jobs by person and class and
   says what is happening on the job card. In two weeks of live log there is no out-of-memory crash and no job lost to a
   kernel kill.
2. **In practice the system is costing chat speed, which is the thing people feel most.** On 2026-10-29 the governor's own
   runaway watch restarted the chat engine 87 times (one restart every 7 minutes while it ran), and the video context
   shrink restarted it 11 more times in two days. Every restart empties the prompt cache, so the next reply takes about
   10 s to its first word instead of under a second. This is the open issue "Chat goes slow again every ten minutes"
   (getmaipai/home#262); the cause was unknown there and is named here (section 4, F1).
3. **It does not need a new design. It needs four things:** the three restart causes fixed (F1 to F3); one ledger instead
   of two (F4); the half-wired Home pieces finished or deleted (F6); and a running measurement that proves the goals on the
   live hub (F11). Section 5 orders the work; the first item alone removes the slowdown people notice.
4. **The eight design notes should become one spec.** They contradict each other in places (section 4, F10), and a session
   that builds from the wrong one will undo a decision.

## 2. What the system is and how it is meant to work

| Layer | Owner | What it does | Where |
|---|---|---|---|
| Memory reader | Stack | Every 5 s: total, available, wired, compressor, swap, kernel pressure level, per-process footprint | `lib/memory/darwin.ts` |
| Watchdog ladder | Stack | WARN (pressure 2, or available under reserve plus 4 GB): unload idle workers and idle voice, refuse new generative work. CRITICAL (pressure 4, swap growing 1 GB in 30 s, or under 3 GB): cancel queued then running jobs (video first), evict the judge, restart chat after 60 s. Two samples to enter, six to clear | `lib/memoryWatchdog.ts`, `memoryState.ts` |
| Governor | Stack | One ledger of loaded items with a class (reserved, warm, burst) and a peak; admits when the loaded sum fits the budget and free memory minus a tier margin (20 GB on 128 GB) stays positive; `fitsEver` refuses at once what can never fit; a FIFO queue of 4; evicts idle warm and burst items in a fixed order when the head needs room; one 4 GB flex band for one picture; a runaway watch that restarts a resident whose memory passes its post-load reading times 1.3 plus 500 MB | `lib/governor.ts` |
| Heavy gate | Stack | Counts chat, coding, vision, router, stt and tts requests in flight; SIGSTOPs the worker of the running job while any is in flight, SIGCONT 4 s after the last; bounded at 10 minutes, then 60 s of running; the coding engine yields the same way with a 20 to 120 s bound | `lib/heavyGate.ts` |
| Supervisor | Stack | Starts, drains, restarts and retires one process per role; the post-load check measures the footprint; self-heal retries a crashed role up to 5 times; the chat context shrink for a held video job | `lib/supervisor.ts`, `selfHeal.ts` |
| Job queues | Stack | One FIFO per kind (image, video, music, tools), one job in flight per kind, 4 waiting, `queue_full` past that; a job waits on the governor's promise with no deadline; the watchdog cancels with code `no_memory` | `lib/jobs.ts` |
| Household queue | Home | Scores waiting jobs (class weight, aging, fair share, admin boost), one running job per person, one Boost or Max job at a time, the Max window and drain; writes `position`, estimate and the reason a number rose on every job record; hands the Stack at most one not-yet-started job per kind | `lib/jobs/householdQueue.ts`, `jobScore.ts` |
| Live fit | Home | For a Boost or Max job: walks the profile table one step down at a time (lower other categories, then supporting cells, then the lead tier), asks the person when the lead drops below the pick, may quit listed apps | `lib/jobs/liveFit.ts`, `admissionFit.ts`, `closeApps.ts` |
| Tiers | Home | Reduced, Standard, Boost, Max per slot, clamped by age band, guest, Max grant and switched-off slots | `lib/tiers.ts` |
| Copy | Home | One table of card lines per state and reason, adult and child | `lib/jobQueueCopy.ts` |
| Re-queue | Home | A Stack cancel with code `no_memory` re-queues the job at the head of its class twice, then fails it with the low-memory line | the three `jobs.ts` files |

Chat is never queued, paused or cancelled by any of this (the admin pause in `middleware/chatPauseGate.ts` is a separate
switch). Its protection is the heavy gate for GPU time and the reserved class for memory.

The design notes, in the order they supersede each other: [isolation-2026-10-18.md](isolation-2026-10-18.md) (the heavy
gate, measured), [memory-management-2026-10-25.md](memory-management-2026-10-25.md) (classes, Q1 to Q8, the copy),
[DESIGN-chat-memory-yields-to-generators-2026-10-27.md](DESIGN-chat-memory-yields-to-generators-2026-10-27.md) (the
context shrink), [resource-tiers-2026-10-27.md](resource-tiers-2026-10-27.md) (tiers, Max window),
[resource-profiles-2026-10-30.md](resource-profiles-2026-10-30.md) (profile table, score, quiet window),
[making-space-2026-10-30.md](making-space-2026-10-30.md) (reclaim ladder, presets),
[auto-close-apps-2026-10-30.md](auto-close-apps-2026-10-30.md) and
[tier-families-and-options-2026-10-30.md](tier-families-and-options-2026-10-30.md).

## 3. What the live hub shows

Readings on 2026-10-31 (Mac Studio, 128 GB, shared with build sessions):

| Reading | Value |
|---|---|
| Watchdog level | normal since 03:08 (the Stack's last start); kernel pressure level 1 |
| Ledger | reserved 31.4 GB (chat 19.4 estimated, judge 5.5, tts 4.5, stt 1.8, embed 0.2); warm 0; burst 0; budget 108.8 GB; margin 20 GB; free 43.6 GB |
| Other programs | 31.6 GB outside the Stack (build sessions, Claude); the watchdog logs this as `memory.dev-load` and touches nothing |
| Heavy gate | 648 pauses, 646 resumes, 37 forced resumes (all the coding engine's 20 s bound), 0 paused now |
| Watchdog actions, two weeks | unload-idle 38, evict-judge 17, cancel-running 5, reap-orphan 6; 59 critical-level log lines |
| Chat engine restarts | 2026-10-28: 39 (no cause field yet). 2026-10-29: 87 `governor-runaway`, 27 `unspecified`, 5 `video-window-shrink`, 4 `video-window-restore`. 2026-10-30: 19 `unspecified`, 6 shrink, 2 restore. 2026-10-31: 3 `unspecified` |
| Runaway restarts, time the engine ran before each | 88 restarts; shortest 60 s, median 422 s, longest 2,063 s |
| Self-heal | 16 crashes, 10 healed, 1 give-up (chat, 2026-10-26, five starts failed on `failed to create context`) |
| Engine start failures | 3 on 2026-10-27: `invalid argument: --cache-ram-mb` (the pinned engine did not know the flag) |

The restart column is the review's main finding. The queue, the gate and the watchdog work; the chat engine does not stay up.

## 4. Findings, ranked

### F1. The governor's runaway watch restarts the chat engine for using the memory it was given (critical)

`governor.ts` lines 650 to 673: every poll compares the process's resident size with `peakBaselineBytes * 1.3 + 500 MB`,
where the baseline is the post-load reading (`supervisor.ts` line 1573, `refreshMeasuredPeak`). Three readings over the
limit and the role is restarted, with no cooldown and no health item first. The post-load reading of a chat engine is
taken right after one short probe, before the key-value cache has grown and, for a memory-mapped engine, before the
weights have been paged in. A long conversation then pushes the resident size past 1.3 times that reading, and the
engine is restarted while it is healthy. The log shows 87 such restarts of chat on 2026-10-29 at a median run of 7
minutes, and 2 of the voice engine. Every restart drops the prompt cache (issue #262 measured 10.5 s to the first word
after one) and takes the engine offline for the load time.

The watch was written for a leaking worker. It has never caught one; it has only restarted the engine the whole design
exists to protect ("reserved: never evicted for a job").

Addendum, 2026-10-31: two Stack commits already narrowed the trigger for the Splash engine (`2b0646a` on 2026-10-28 and
`af6f00e` on 2026-10-29: a memory-mapped engine's post-load reading no longer arms the watch), which is why the restarts
stopped after 10-29; the live hub's Stack (`3e11721`) carries both. RESOURCE-FIX-01 (Stack `6a36b64`, landed 2026-10-31)
removes the restart for every reserved role and engine: the governor records a `Kept` decision and raises
`resident-memory-grew.<role>` instead. Home's Stack pin and the hub do not have it yet.

Fix: a reserved role is never restarted by the runaway watch. A sustained rise raises the existing `memory-pressure-warn`
health item with the numbers, and only the watchdog's CRITICAL branch (60 s of critical) restarts chat, as the design
says. The limit for the roles that keep the watch (jit workers) should be the admitted peak plus headroom, not a fraction
of an early reading.

### F2. The video context shrink restarts chat twice per clip (high)

The 2026-10-27 note lets a held video job restart chat at a smaller context and restore it after. The log shows 11
shrinks and 6 restores in two days, each a full engine restart with the prompt cache lost, and a shrink that is not
followed by a restore (5 of 11) leaves chat at the smaller window. The note's condition is "chat is idle"; the code does
not wait for the quiet window the 2026-10-30 profiles note added (S1, 60 s with nobody else chatting), because that
window is not wired (F6).

Fix: shrink only after the eviction ladder (idle warm and burst items, voice out, the judge) was not enough, only when
nobody has chatted for the quiet window, and restore at the next quiet moment rather than at job end; prewarm
`chat_hello` after each, as slice 11 of the memory note intended. Count shrinks on the Status page so a day with ten of
them is visible.

### F3. 49 chat restarts in three days have no recorded cause (high)

`engine.retired` with cause `unspecified`: 27 on 10-29, 19 on 10-30, 3 on 10-31. Issue #262 asked for exactly this: name
the route. Until every caller of `recycleRole` passes a cause, the next slowdown cannot be diagnosed from the log.

### F4. Two ledgers with different numbers (high)

Home carries its own hardware table, `lib/jobs/profileSource.ts` `STUDIO_HARDWARE` (budget 116.8 GB, chat Standard 19 GB,
video Boost 46 GB), hard-coded for this one machine and used for every household. The live governor reports budget
108.8 GB and reserved 31.4 GB. The live-fit ladder therefore reasons from numbers the Stack does not agree with, and on a
64 GB Mac it reasons from the Studio's. The memory note's goal 6 ("one definition in one place") and platform principle 1
are broken by this file. The chat item itself is an estimate (`measured: false`, 19.4 GB) because the Splash engine has no
dry run; its real resident size was 14.8 GB at the reading.

Fix: the Stack publishes the per-slot peaks it has measured (it already stores them through `recordMeasuredFootprint`)
on the budget route, and Home's profile table reads them; `STUDIO_HARDWARE` goes. A slot with no measurement is "not
fitted" on the card, as the file's own comment says.

### F5. The watchdog is tuned for a dedicated hub and runs on a shared one (medium)

Three rules fire on this machine for reasons that are not the household's:

- `chat_paged_out`: any rise in the machine-wide `Swapouts` counter while chat is loaded enters WARN on the first sample
  (`memoryWatchdog.ts` line 93). With 31 GB of build sessions beside the hub, a swapout anywhere pauses picture and video
  work for at least 30 s (six clear samples). The rule should read the chat process's own pageouts, or need two samples.
- WARN unloads the voice engine after 60 s idle (`defaultUnloadIdleWorkers`, line 153). The next spoken reply pays a 4.5 GB
  reload. ISOLATION-05 (keep voice and the judge for 5 minutes after a conversation) is still open; the log shows
  38 idle unloads and 17 judge evictions.
- CRITICAL restarts chat after 60 s even when the pressure comes from another program. The design calls this the last
  line of defence, which is right; it should at least check that the Stack's own processes are a majority of what is held
  before it restarts the one engine people are talking to.

### F6. Half-wired pieces in Home (medium)

Found by reading every caller:

- The quiet window and cooldown (`decideDownshift`, `mayRestoreNow`, `quietSecondsFor`, `DEFAULT_QUIET` in
  `householdQueue.ts` lines 199 to 234) have no production caller. The chat in-flight counter is fed
  (`trackChatLease`) and never read. The 2026-10-30 rule "chat is only lowered when nobody else chatted in the last
  minute" is not enforced.
- `admit()` returns `holds` (`heavy_slot`, `max_drain`, `max_window`, `fairness_wait`); `releaseHouseholdQueue` keeps only
  `.start`. A held job shows the generic queue line, and two of the four hold names have no copy.
- `lib/resourceGovernor.ts` (Home's own memory_pressure reader and chat restart) is reachable only from the retired
  local-supervisor path; STACK16-G-chat already lists it for deletion. `requeueAfterCritical` is dead; the re-queue is
  written inline three times.
- The Stack's `queue_full` (a fifth job of one kind) reaches a person as a failed picture (`pictures/jobStore.ts` line
  70), although Home never hands the Stack more than one unstarted job per kind. The copy should be the queued line.
- The picture queue card (`routes/pictures.ts` lines 49 to 54) has its own English strings beside the copy table.
- `lastFit` in `householdQueue.ts` grows by one entry per Boost or Max job and is never trimmed.

### F7. The governor's shape invites races (medium)

- `startGovernor` is called once per spawned process (`supervisor.ts` line 1870) and once for the Stack itself. Each call
  starts its own 5 s poll loop, and every loop runs the whole body: it overwrites `freeMemoryBytes` and `pressure`,
  settles the queue head and starts evictions. With chat, judge, embed, stt and tts loaded there are six loops mutating
  one module-level ledger. The `evicting` flag keeps two loops from unloading the same item, but two loops can settle the
  same head within one tick, and the eviction loop reads `freeMemoryBytes` that another loop just inflated.
- `forgetLoadedItem` and the unload paths add `item.peakBytes` to `freeMemoryBytes` (lines 340, 694, 718, 756) before the
  operating system has reclaimed anything; the next poll overwrites it. In the 5 s between, an admission can pass on
  memory that is not free. The watchdog gate (`admissionVerdict`, real numbers, 2 s freshness) is what catches this, which
  means the two safety checks are not redundant but load-bearing in a way nothing documents.
- `evictionRank` orders candidates by `id.includes("tool")`, `includes("edit")`, `includes("coding")` (lines 270 to 276).
  It works today; a renamed role silently changes the order.
- The governor queue is one FIFO for engine loads and generator jobs (`admission.ts`, `jobs.ts`), and both `release` and
  the poll stop at the first entry that cannot be admitted. A vision or look load for a chat turn that arrives while a
  video waits for memory waits behind it, and a fifth entry of any kind is refused as "The governor queue is full". The
  reserved class should bypass the queue: an engine load for an interactive role is admitted or refused at once.

### F8. The heavy gate works and one design note now says it is wrong (low, decide)

`heavyGate.ts` paused workers 648 times with no stuck worker (every pause ended; the 37 forced resumes are the coding
engine's 20 s bound). The making-space note of 2026-10-30 rejects SIGSTOP ("the memory stays allocated; macOS may
compress or swap those pages") and prefers unload and reload. Both are true: a stopped 44 GB video worker holds its memory
through a long voice session, and an unload would cost the clip its progress. The gate is the right tool for a 4 s to
10 minute pause; the note should say so instead of rejecting it, and the open risk (a paused worker's pages being
compressed) should be measured once in the bench lane (ISOLATION-06's harness) rather than argued.

### F9. The job that cannot start is explained; the engine that cannot start is not (low)

Three chat start failures on 2026-10-27 were `invalid argument: --cache-ram-mb`, a flag the pinned engine build does not
know, and the 2026-10-26 give-up was `failed to create context` five times in a row. Both reached people as "chat is not
ready". Self-heal retries the same launch five times; a start that fails on an argument should stop after one try and
raise a health item that names the flag and the pin.

### F10. Eight notes, no current spec (medium)

The rules that run today are spread over eight notes with supersede chains, and they disagree:

- Q2 fixed class order (memory note) against the score table (profiles note); the code runs the score.
- Q7 "no cap on the line" (memory note) against the Stack's 4 per kind, which still refuses as `queue_full` (F6).
- SIGSTOP measured and built (isolation note) against SIGSTOP rejected (making-space note), see F8.
- "Chat never evicted" (memory note) against the context shrink (2026-10-27 note) against "chat is never paused, only
  lowered to Reduced" (profiles note); a restart at a smaller window is a pause of 20 to 60 s for whoever is chatting.
- The 180 s `no_memory` deadline is removed in code and still described in the isolation note's inventory.

A single `resource-management.md` with the state machine of section 5 of the memory note, one rules table and one
numbers table, marked as the authority, would let a session build from one place. The eight notes stay as history.

### F12. One busy chat request freezes the watchdog (high)

`memoryWatchdog.ts` line 246: a tick that is still running makes the next tick return at once, and the loop schedules
the next sample only after the current one settles. At WARN the tick awaits `unloadIdleWorkers`, which awaits
`unloadRole`, which awaits `retire`, and `retire` (`supervisor.ts` line 1896) waits for the process's active requests to
reach zero with no timeout. A chat request may run for 10 minutes. So at the moment memory is tight and someone is
chatting, the watchdog stops sampling, the ladder stops stepping and orphans are not reaped until the reply ends. The
unload should be started and not awaited, as the governor already does for its own evictions.

### F13. Two rules break "chat first" on small Macs (high)

- The watchdog's CRITICAL step "evict the judge" calls `unloadRole("judge")`, and `processRoleFor` (`supervisor.ts`
  line 165) maps the judge to chat on a machine whose tier has no judge binding (p16, `profiles.ts`). On a 16 GB Mac,
  the machine most likely to reach CRITICAL, the step unloads the chat engine and logs "the judge role was unloaded".
- `canAdmit` (`governor.ts` line 375) refuses every request while the governor's pressure is not normal, chat included,
  and an engine start waits only 15 s for admission (`supervisor.ts` line 243). Pressure caused by another program
  therefore stops the chat engine from starting at all, where the watchdog gate (`memoryState.ts` line 88) deliberately
  leaves chat unguarded. The reserved class should be admitted under WARN; only CRITICAL holds it.
- `recycleRole` leaves the role in `loading` with no process and nothing starts it until the next request. After the
  watchdog's or the runaway watch's restart, the next person's turn pays the whole load plus the prefill, which is the
  10 s first word of issue #262 and may be the "gone for a minute with nothing in the logs" of issue #253.

### F14. Smaller defects in the Stack found by reading (medium, one brief)

- The eviction completion deletes the ledger entry by object identity (`governor.ts` lines 694, 718, 756) while
  `admit` reuses that object for a same-id request (line 430); an unload in flight when a new request arrives removes the
  new engine from the ledger. The comment at line 99 promises token scoping; only `release` has it.
- `waitForAdmission` never clears its give-up timer (`admission.ts` line 73); it withdraws by id, so a later same-id
  request can be settled "Withdrawn." up to 15 s after the first was admitted.
- The kernel-critical generator abort (`governor.ts` line 677) calls an `abort` option no caller passes, then logs that
  a generator was aborted.
- Self-heal counts a governor memory refusal as a crash (`selfHeal.ts` line 260); five refusals in 30 minutes open the
  breaker and chat stays down until a person acts.
- `inFlight` is set before admission (`jobs.ts` line 283), so a job still waiting for memory is reported as running: the
  self-heal blocker thinks a picture is using the GPU, and the CRITICAL cancel reaches jobs that never started.
- Warm-up plans against the OS cap because the Metal cap probe is not awaited (`daemon.ts` line 61).
- `largestAdmittedContext` (`fitPlan.ts` line 267) walks down in 512-token steps from the model's maximum and spawns
  `gguf-parser` at each step; from 262,144 tokens that is up to 496 spawns per start.
- Dead code: `pauseAll` and `resumeAll` and every "The Stack is paused" branch, `admissionWaitMs`, `pressurePolls`,
  `governorReasonFor`, `queuePosition`.

### F11. Nothing proves the goals on the live hub (medium)

The counters exist (`/stack/v1/memory`: pauses, forced resumes, evictions, queue depth; `engine.retired` with cause) and
nothing reads them over time. The bench slices that would show the numbers (memory note slices 10 and 13, ISOLATION-06's
thresholds, TIER-BENCH-01) have not been run. PERF-ALERT-01 (the hub notices slow replies) is open. The 87 restarts of
10-29 were visible in the log for two days and nobody was told.

## 5. What to do, in order

| # | Repo | Change | Done when |
|---|---|---|---|
| 1 | Stack | F1: the runaway watch never restarts a reserved role; it raises the warn health item with the numbers; jit workers keep the watch with the admitted peak plus headroom as the limit | Test: a chat item whose process grows to 3 times its post-load reading is not restarted; the item is raised. Live: 24 h with zero `governor-runaway` restarts of chat |
| 2 | Stack | F3: every `recycleRole` caller passes a cause; `unspecified` becomes a test failure | `grep unspecified` on the live log is empty after a day |
| 3 | Stack | F2: the shrink runs only after the eviction ladder and only in a quiet window; restore at the next quiet moment; `chat_hello` after both; count on the Status page | Test with a scripted video hold; live: shrinks per day shown |
| 4 | Stack and Home | F4: the budget route publishes measured per-slot peaks; Home's profile table reads them; `STUDIO_HARDWARE` deleted | A 64 GB fixture gets its own numbers; the Studio numbers match the live ledger |
| 5 | Home | F6: wire the quiet window into `releaseHouseholdQueue` (or delete it with the setting), show `holds` through the copy table, delete `resourceGovernor.ts` and `requeueAfterCritical`, map `queue_full` to the queued line, move the picture card strings into the copy table, trim `lastFit` | Tests beside each file; no dead export |
| 6 | Stack | F5: `chat_paged_out` from the chat process's own pageouts or two samples; voice and judge kept 5 minutes after a conversation (ISOLATION-05); CRITICAL chat restart only when the Stack's own processes hold the majority | Watchdog tests with a dev-load fixture |
| 6a | Stack | F12 and F13: the watchdog starts unloads without awaiting them; the judge step never resolves to chat; reserved roles are admitted under WARN; a recycled role is started again at once | Watchdog tests with a 10-minute busy request and a p16 fixture; a restart is followed by a start without a request |
| 7 | Stack | F7 and F14: one governor poll loop; per-process watches register with it instead of starting their own; reserved loads bypass the FIFO; eviction order by class and role, not by id substring; token-scoped eviction completion; the give-up timer cleared; refusals not counted as crashes; `inFlight` set after admission; dead code removed | Governor tests: two watches, one poll; a vision load is admitted while a video waits; the identity and timer races pinned |
| 8 | Stack and Home | F11: a daily resource line for admins on the Status page from the existing counters (chat restarts by cause, pauses, forced resumes, evictions, re-queues, p50 first-token time from the canary); the bench slices run once and their numbers recorded | The Status row shows yesterday's numbers; the bench report is in `data-scratch/reports` |
| 9 | Home | F10: `docs/design/resource-management.md` as the one authority; the eight notes get a pointer | Architect verdict; INDEX updated |

Items 1 to 3 are each one Codex brief of one to three files with a failing test first. Item 1 is the one that changes what
people feel.

## 6. Where this leaves the goal

The chat engine runs at about 24 tokens per second with a 1.6 s first token when its cache is warm (isolation note,
section 2), and the heavy gate keeps that speed while a clip renders. What people notice is the first word. A warm prefix
gives it in under a second; a restart gives it in 10 s. So the resource system's whole contribution to "faster than the
hosted services" is to keep three things true: the chat engine is never restarted except by an admin or a real emergency,
no job takes its GPU time, and the voice engine is warm when someone speaks. Today the second holds, the first does not
(F1, F2, F3) and the third is weak (F5). After items 1 to 3 and 6, measure for a week (item 8); the next speed lever after
that is the engine itself (the chat throughput note's draft model and batching), not this system.

## Rules check

No rule changes. Chat rule 4 (the window is the model's real context): F2 keeps the shrink an exception, bounded by the
quiet window. Rule 11 (only the Stack's own tested components run models): nothing new is adopted. S6: item 8 feeds the
existing Status row; no new surface. Rule 6a: the resource line carries counts, never a person or a prompt. Owner rulings
of 2026-10-21 (chat first, never kill by broad pattern) and 2026-10-30 (chat is never paused, only lowered) stand; F1 and
F2 bring the code closer to them.
