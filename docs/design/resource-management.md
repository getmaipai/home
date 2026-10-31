# Resource management: the as-built reference

Status: current as of 2026-10-31 (Home v0.2.162, Stack 3e7b65a). This page says what the memory, load and safeguard system
does today and where each rule lives, so a session builds from one place. [RULES.md](RULES.md) is the authority; this page
adds no rule and changes none. The eight older notes below stay as history. Where the code and a hard rule or an
owner-decided note differ, the code is the defect, not a supersession, and the difference is listed under "Open".

The goal, in the owner's words: the system keeps running without crashing and does the best it can with the resources it has,
so people feel it is faster, steadier and better than the services they compare it to. Chat first, always.

## 1. The layers

| Layer | Owner | What it does | Where |
|---|---|---|---|
| Memory reader | Stack | Every 5 s: total, available, wired, compressor, swap, kernel pressure level, per-process footprint | `lib/memory/darwin.ts` |
| Watchdog ladder | Stack | WARN and CRITICAL steps on the whole computer's memory (section 3); two samples to enter, six to clear | `lib/memoryWatchdog.ts`, `memoryState.ts` |
| Governor | Stack | One ledger of loaded items (class reserved, warm or burst, with a peak); admits what fits the budget and the free memory minus the tier margin; evicts idle items in a fixed order; one runaway watch per engine | `lib/governor.ts` |
| Heavy gate | Stack | Pauses the worker of a running job while a chat, voice or vision request is in flight; bounded | `lib/heavyGate.ts` |
| Supervisor | Stack | Starts, drains, restarts and retires one process per role; every stop carries a cause; self-heal retries a crashed role | `lib/supervisor.ts`, `selfHeal.ts` |
| Job queues | Stack | One queue per kind, one job in flight per kind; a job waits on the governor | `lib/jobs.ts` |
| Process registry | Stack | Remembers every process the Stack started, so a survivor of a finished job is found and stopped | `lib/ownedProcesses.ts` |
| Sweeps | Stack | Temp files, old results, abandoned downloads and voice clips, every 10 minutes | `lib/sweeps.ts` |
| Household queue | Home | Scores waiting jobs, one running job per person, the Max window, the quiet window; writes the reason on every job record | `lib/jobs/householdQueue.ts` |
| Live fit | Home | For a Boost or Max job: walks the profile table down one step at a time to make room, asks when the lead drops | `lib/jobs/liveFit.ts`, `admissionFit.ts` |
| Hardware table | Home, from the Stack | The numbers live fit reasons from, read from the Stack's budget route | `lib/jobs/profileSource.ts`, `stackHardware.ts` |
| Tiers and copy | Home | Reduced, Standard, Boost, Max per slot; one table of card lines per state | `lib/tiers.ts`, `lib/jobQueueCopy.ts` |

Chat is never queued, paused or cancelled by any of this. Its protection is the heavy gate for GPU time and the reserved class
for memory; the admin pause in `middleware/chatPauseGate.ts` is a separate switch.

## 2. Rules, one table

| # | Rule | Enforced in |
|---|---|---|
| R1 | A reserved role (chat, judge, router, embed, stt, tts, wakeword) is never restarted or evicted for memory it grew into; it is kept and reported once (`resident-memory-grew.<role>`) | governor runaway watch |
| R2 | A reserved request is admitted under WARN pressure and refused only under CRITICAL; warm and burst wait under WARN | governor `canAdmit` |
| R3 | A reserved engine load queues ahead of generator jobs and is never refused for a full queue | governor queue |
| R4 | Every engine stop, unload and restart names a cause from one list (`RetireCause`); the log never says unspecified | supervisor |
| R5 | A temporary memory refusal (the 15 s start wait, a full queue, an unreadable reading) waits and retries; it does not count toward the self-heal breaker | selfHeal, admission |
| R6 | Chat is never shrunk or restarted for another program's memory; CRITICAL restarts chat only when the Stack's own processes hold more than the rest of the computer, and a restart is followed by a start | watchdog |
| R7 | Voice and the judge are kept five minutes after a conversation at WARN; CRITICAL may still evict the judge, never chat standing in for it | watchdog |
| R8 | The video context shrink of chat happens only after the reclaim ladder is empty and chat, voice and listening have been quiet (the request's `quiet_seconds`, 60 s when absent), restores at the next quiet moment, warms chat after both, and is counted on the memory report | governor, supervisor |
| R9 | A finished job leaves no child process: workers stop as process trees, an idle worker stays on the ledger until it exits so a waiting job can evict it | worker modules, governor |
| R10 | The watchdog signals only a process in the owned registry whose job finished and which survived the tree stop, after two sightings and a start-time and command re-check, TERM then KILL after 5 s; anything else seen below the Stack is only counted | watchdog, `ownedProcesses.ts` |
| R11 | Temp files and caches a job wrote are removed on done, fail and cancel, and swept again on a timer and when the temp folder passes 2 GB | sweeps, watchdog |
| R12 | Home's live fit reads its hardware table from the Stack; a slot without a verified peak is not fitted | `profileSource.ts` |
| R13 | A held or waiting job shows its own reason on its card; a full Stack line leaves the job queued, never failed | household queue, copy table |

Minors: the clamp of a child or teen to Standard and the Max grant live in [resource-tiers-2026-10-27.md](resource-tiers-2026-10-27.md) (rule 0 of RULES.md applies); no rule here raises a ceiling.

## 3. The numbers

| Number | Value | Where it is set |
|---|---|---|
| Sample interval | 5 s | memory reader |
| WARN | kernel pressure 2, or available memory under the reserve plus 4 GB; chat paged-out needs two rising swapout samples | watchdog |
| CRITICAL | kernel pressure 4, swap growing 1 GB in 30 s, or under 3 GB available; chat restart after 60 s | watchdog |
| Steps to enter and clear | 2 and 6 samples | watchdog |
| Tier margin on 128 GB | 20 GB | governor |
| Budget | the memory cap the Stack reports on `GET /stack/v1/hardware/budget` | governor |
| Queue | 4 waiting non-reserved entries per Stack; reserved entries up to 16 | governor |
| Runaway watch | 1.3 times the post-load reading plus 500 MB for three polls | governor |
| Voice and judge keep | 5 minutes | watchdog |
| Idle worker stop | picture and video 10 min, music 5 min, stems 1 min, picture tools 2 min | worker modules |
| Survivor and stray probe | two sightings, 60 s old | watchdog |
| Unaccounted memory | above 4 GB for 2 minutes unloads idle workers; clears under 2 GB | watchdog |
| Sweeps | start, every 10 min, and over 2 GB in the temp folder; partial downloads 7 days, voice clips 1 day | sweeps |
| Quiet window | 60 s default, 20 s minimum, from the Performance settings | household queue |

The per-slot peaks come from the Stack's tier catalog and are published on the budget route (`slots`); Home keeps no copy.

## 4. Where to look when something is slow

1. The Status page health rows (RULES S6): `resident-memory-grew.*`, `stray-process`, `memory-unaccounted`, `disk-temp-grew`.
2. `GET /stack/v1/memory`: the ladder level, the ledger, `stack.unaccounted_bytes`, `stack.unregistered`, `stack.tmp_bytes`,
   `video_window` (shrinks and restores), `watchdog.survivors_stopped`.
3. The Stack log, one line per event: `engine.retired` (with `cause`), `chat.window`, `process.survivor`, `memory.action`,
   `memory.unaccounted`, `sweep.done`.
4. `bun run bench:recapture --stack <url> --kind picture|video|music` in the Stack checkout: processes, Stack bytes,
   unaccounted bytes and temp bytes before and after one real job.

## 5. Open

| Item | State |
|---|---|
| One governor tick instead of one loop per process | The bodies run one at a time (done), which removes the race. Merging the loops is a refactor of option ownership, not only of `busy`: the Stack's own loop and each process loop pass different global options (`unload`, `busy`, the chat shrink and restore hooks), and the supervisor's `busy` closure answers for its own process only, so a shared tick first needs one global configuration. Deferred; the payoff is fewer redundant polls |
| SIGSTOP pause of a running worker | Built and measured in the isolation note; the making-space note lists it as rejected. The code uses it. Owner to rule |
| The 30-60 s a context shrink costs the person chatting | R8 limits when it happens; "chat is never paused" and the shrink still disagree. Owner to rule |
| When the full chat window comes back | RULES.md rule 4 restores it when the video job ends; R8 restores it at the next quiet moment, which can be later. Rule 4 wins unless the owner rules otherwise: the code follows R8 today, so this is a code difference to settle |
| A daily resource line for admins | Built: the Stack serves `GET /stack/v1/memory/daily` (restarts by cause, stops, pauses, watchdog actions, shrinks, survivors, sweeps, from the log lines, which now carry `at`), and the Status page's admin memory block shows yesterday's line. Not counted: evictions by the governor, re-queues and first-token time (no log event yet) |
| Chat engine first-token time under load | No measured week yet on the hub; the daily line has no first-token figure |
| Search sidecar and Splash server in the owned registry | Registered (10f); confirm on the hub that `stack.unregistered` reads 0 after the next ship |

## 6. The older notes, in the order they supersede each other

[isolation-2026-10-18.md](isolation-2026-10-18.md), [memory-management-2026-10-25.md](memory-management-2026-10-25.md),
[DESIGN-chat-memory-yields-to-generators-2026-10-27.md](DESIGN-chat-memory-yields-to-generators-2026-10-27.md),
[resource-tiers-2026-10-27.md](resource-tiers-2026-10-27.md), [resource-profiles-2026-10-30.md](resource-profiles-2026-10-30.md),
[making-space-2026-10-30.md](making-space-2026-10-30.md), [auto-close-apps-2026-10-30.md](auto-close-apps-2026-10-30.md),
[tier-families-and-options-2026-10-30.md](tier-families-and-options-2026-10-30.md). The findings behind the changes of
2026-10-31 are in [resource-management-review-2026-10-31.md](resource-management-review-2026-10-31.md).

## 7. Supersedes

Nothing. This page restates, in one place, what the code does; it replaces no passage of the notes above. Where a note and
the code disagree (the `no_memory` deadline of the isolation note's inventory, the fixed class order of the memory note
against the scoring of the profiles note, the 4-per-kind "queue full" against "no cap on the line"), the code is the current
behaviour and the disagreement is recorded here and in the review, not decided here.
