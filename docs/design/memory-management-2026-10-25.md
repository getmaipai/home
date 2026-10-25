# Household memory management: queue, never fail (2026-10-25)

Status: design note, nothing built. Item id MEMMGMT-2026-10-25. Updated the same day with the owner's answers (section 9) and the SSD research (section 10). Owner's ask (Jesse, 2026-10-25): a household-wide memory
management system for the Mac Studio (Apple M5 Max, 128 GB unified memory) that runs chat, pictures, video, voice and the other
workers. His example: a person asks for a picture, there is not enough memory, and the request is not failed; it is queued, worked
when memory frees, and the person is told. The pieces he named: telling the person plus a queue, system memory monitoring, model
monitoring with loading and unloading.

This is the memory budget note the resource priority ruling of 2026-10-21 said would be written. It builds on
[isolation-2026-10-18.md](isolation-2026-10-18.md) (chat and voice always win; the heavy gate is built), the
[reliability note](reliability-2026-10-17.md) items 4 and 7, the [image engine](image-engine-2026-10-17.md) section 7, the
[image bakeoff](image-model-bakeoff-2026-10-25.md) and the [coding mode](coding-mode-2026-10-22.md) note.

## 1. The problem and the goals, in plain words

One computer runs everything for the whole family. The chat model takes about 21 GB. A picture takes 19 GB more, an edit
another 18 GB, a video 44 GB, a song 33 GB, the coding model 23 GB or 85 GB. 128 GB sounds like a lot until two people want a
picture while a third is making a clip. Today the pieces that protect memory work, but each in its own way and with a failure at
the end: a video that waits more than 180 s for memory fails with `no_memory`, a song failed with "Paused: this computer is low
on memory" while benches ran beside the live engines (2026-10-21), and the Stack's governor refuses a start with a 503 that Home
turns into a red line.

Goals, in order:

1. **A request that fits the machine never fails for lack of memory.** It waits, and it starts by itself when memory frees.
2. **Chat and voice come first, then pictures, then video, then everything else** (owner's ruling, 2026-10-21). Chat never loses
   its context to a picture (RULES.md chat rule 4).
3. **The person always knows what is happening and what to do**: waiting, why, roughly how long, and how to cancel.
4. **Fair between people.** One person's burst of pictures does not hold the line for everyone else.
5. **A request that can never fit is refused at once, with numbers**, not after a wait.
6. **One definition in one place.** The Stack's governor stays the one admission decision; Home stays the one queue that knows
   people; the existing job cards and Status page carry every state (RULES.md S6). No second ledger, no new banner.

Not goals: GPU time fairness between two chats (measured fine in the isolation note), a schedule ("video only at night",
rejected there), and anything that changes a child's or teen's gates.

## 2. Research: what other systems do, and what we take

| System | Idea | Verdict | Why |
|---|---|---|---|
| [llama-swap](https://github.com/mostlygeek/llama-swap) ([guide](https://betterstack.com/community/guides/ai/llama-swap/)) | One proxy; the model named in a request is started on demand, another is stopped to make room, a per-model `ttl` in seconds unloads it idle, `groups` let several stay loaded together | Adapted | The Stack already does this (jit roles, `idleTtlSeconds` 600, `keepAliveSeconds` per request). We take the `groups` idea as the picture pool (section 4.3): the create and edit models are one group that loads together and is evicted as one. Not adopted as software (RULES.md chat rule 11: only our own tested Stack components run the models). |
| [Ollama](https://ollama.readthedocs.io/en/faq/) ([env vars](https://dev.to/threesevenths/ollama-environment-variables-362j)) | `keep_alive` 5 minutes per model, restarted on each request; `OLLAMA_MAX_LOADED_MODELS`; a request for an unloaded model unloads idle models and waits in a queue of 512 until it loads; a full queue is a 503 | Adapted | The "unload idle, then wait, never fail" order is exactly goal 1. We keep our idle window (10 minutes); the queue has no cap and the card shows the wait (Q7). Rejected: a fixed count of loaded models; our limit is bytes. |
| [LM Studio](https://lmstudio.ai/docs/app/api/ttl-and-auto-evict) | JIT loading with an idle TTL (60 minutes default), auto-evict of the last JIT model before loading the next, explicitly loaded models exempt from eviction | Adapted | "Explicitly loaded is exempt" becomes the reserved class (chat, voice, judge, embed are never evicted by a job). Rejected: a 60 minute TTL for picture models; the bakeoff's 10 minute default stands because pictures take chat's memory. |
| [vLLM sleep mode](https://docs.vllm.ai/en/stable/features/sleep_mode/) | Level 1 moves weights to CPU memory and drops the KV cache; level 2 discards weights too; `wake_up` restores | Rejected | On unified memory there is no "other" memory to sleep into. A model on disk in the file cache is our level 2: the bakeoff measured ERNIE reloading in 6 to 10 s from the page cache against 17 s cold, so unload and reload is cheap enough. |
| [Triton model control](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/user_guide/model_management.html) | EXPLICIT mode: nothing loads or unloads unless an API call says so; every load reports success or failure | Adopted | The governor is the only thing that loads or unloads a model; a worker never decides for itself. Already the Stack's shape; this note makes the eviction order explicit (section 4.3). |
| [Ray Serve](https://docs.ray.io/en/latest/serve/advanced-guides/performance.html) ([autoscaling](https://docs.ray.io/en/latest/serve/autoscaling-guide.html)) | `max_ongoing_requests` kept low on purpose so callers feel backpressure; the queue size is the scaling signal | Adapted | Backpressure stays a visible waiting state, never a dropped request. There is nothing to scale to on one Mac, so the signal drives eviction and messaging instead. |
| [Kubernetes QoS and priority](https://docs.coreweave.com/support/cks/articles/how-do-kubernetes-qos-classes-work) ([preemption](https://www.netdata.cloud/guides/kubernetes/kubernetes-priority-class-eviction/)) | Three classes (Guaranteed, Burstable, BestEffort); under pressure the kubelet evicts BestEffort first, then Burstable, then by priority; the scheduler preempts lower priority to place higher | Adopted | The three classes map one to one: reserved (chat, voice, judge, embed), warm (the picture pool, the coding model), burst (video, song, image tools, benches). Eviction runs burst, then warm, then never reserved. Preemption is "yield, not cancel" from the isolation note. |
| [Linux PSI and systemd-oomd](https://systemd.io/PRESSURE) ([LWN](https://lwn.net/Articles/763629/)) | Pressure is time stalled on reclaim, averaged over 10 s, 1 and 5 minutes; a daemon acts when pressure stays over a limit for a duration, before the kernel's OOM killer | Adapted | macOS has no PSI, but the same shape is already the Stack's watchdog ladder: a level enters after 2 samples and clears after 6 (hysteresis). We keep "act early, act on a sustained reading"; the victim order comes from the classes above, not from cgroups. |
| [macOS memory pressure](https://cs.iossec.tech/xnu/latest/source/doc/vm/memorystatus_notify.md) ([Chromium's monitor](https://chromium.googlesource.com/chromium/src/+/69b378ee1/base/memory/memory_pressure_monitor_mac.cc)) | `kern.memorystatus_vm_pressure_level` (0 normal, 1 warn, 2 urgent, 3 critical) and a `DISPATCH_SOURCE_TYPE_MEMORYPRESSURE` source; the kernel rests 25 s between notifications | Adopted (already) | The Stack's `memory/darwin.ts` reads this sysctl, `kern.memorystatus_level` and `host_statistics64` every 5 s. A dispatch source is rejected: 5 s polling is finer than the kernel's own 25 s rest. |
| [iogpu.wired_limit_mb](https://medium.com/@michael.hannecke/tuning-llama-cpp-on-apple-silicon-843f37a6c3dc) ([mlx-lm issue 883](https://github.com/ml-explore/mlx-lm/issues/883)) | Raise the GPU's wired-memory cap above the default (about 75 percent of RAM) to fit bigger models; unsupported by Apple, a kernel panic was reported when a wired KV cache grew unbounded | Rejected | The governor caps the model budget at the engine's recommended working set (116.8 GB here; the coding note measured about 111 GB usable). Raising the sysctl buys 10 GB and risks the whole machine; the family's hub does not run that way. |
| [MLX memory API](https://www.mintlify.com/ml-explore/mlx/api/memory) ([issue 3350](https://upd.dev/ml-explore/mlx/issues/3350)) | `set_memory_limit` (default 1.5 times the working set), `set_cache_limit`, `clear_cache`; the Metal buffer pool grows without bound in a long-running server unless the cache is cleared between requests | Adopted | Every MLX worker (picture, video, song) calls `clear_cache` after each job and sets a cache limit at start, so "resident" means the weights, not a stale buffer pool. The music note already saw this (a 25 GB resting worker peaking at 64 GB in a decode). |
| [Slurm](https://docs.icer.msu.edu/How_Jobs_are_Scheduled/) ([fair share](https://docs.ycrc.yale.edu/clusters-at-yale/job-scheduling/fairshare), [backfill](https://docs.rcac.purdue.edu/blog/2025/08/08/job-priority-and-scheduling/)) | Priority = age + fair share + size + QoS; backfill starts a small job early when it cannot delay the job at the head; reservations hold resources for a known future job; accurate size requests make backfill work | Adapted | Backfill becomes rule Q4 (a picture may start ahead of a waiting video when it fits beside it and the video is still waiting on something else). Aging becomes rule Q5 (a waiting video is not starved forever). Rejected: usage-based fair share across days; a family is not a cluster, round robin by person is enough. The chat model's set-aside is our one reservation. |
| [Deficit round robin](https://en.wikipedia.org/wiki/Deficit_round_robin) | Serve one item per person per round; a person who was skipped keeps credit | Adopted, simplified | Round robin by person with quantum one job (the isolation note's rule 6). Weights are all one; a child's daily cap is a separate gate, not a weight. |
| Queue UX ([Unblu](https://docs.unblu.com/en/docs/latest/knowledge-base/configuration/conversations/queue-status.html), [Haptik](https://docs.haptik.ai/set-up-queue-position-wait-time-messages), [Zendesk](https://support.zendesk.com/hc/en-us/articles/8945071149210-Displaying-the-estimated-wait-time-banner-in-messaging-conversations)) | Show position before a precise time; cap large numbers ("10+"); an estimate is an average of past jobs, not a countdown; a known wait feels shorter than an unknown one | Adopted | The card says why first, then "about N minutes" from measured per-kind times (the isolation note's estimate), and the position only when it is 2 or more. The line has no cap (Q7), so the card caps the shown position at "10+" as Haptik does. |

Rejected outright: a scheduler process of our own, a second ledger in Home, a new status surface, a time window for heavy
work, and any outside runner. Everything above lands as rules and small changes inside the governor, the watchdog, the job
records and the job cards that exist.

## 3. What exists today (the inventory this note extends)

Evidence: Stack `lib/governor.ts`, `lib/memoryWatchdog.ts`, `lib/memoryState.ts`, `lib/memory/darwin.ts`, `lib/heavyGate.ts`;
Home `lib/pictures/jobs.ts`, `lib/videos/jobs.ts`, `lib/failureCopy.ts`, `lib/roleHealth.ts`.

| Piece | Today | Where |
|---|---|---|
| Memory reading | every 5 s: `hw.memsize`, `kern.memorystatus_level`, `kern.memorystatus_vm_pressure_level`, `host_statistics64`, `vm.swapusage`; per-process footprint | Stack `memory/darwin.ts` |
| Watchdog ladder | WARN when available memory is under reserve plus 4 GB (clears at 8 GB); CRITICAL under 3 GB (clears at 5 GB) or swap growing 1 GB in 30 s; 2 samples to enter, 6 to clear; WARN refuses heavy work and unloads idle jit; CRITICAL cancels the running heavy job and evicts the judge; chat restarts after 60 s critical | Stack `memoryState.ts` `WatchdogRules`, `memoryWatchdog.ts` |
| Model budget | total minus 8 GB OS margin, capped at the Metal recommended working set (116.8 GB); tier working margin p128 20 GB, p64 12, p32 8, p16 4 | Stack `GovernorRules` |
| Admission | a request names a peak (measured, dry run, or file size times an engine multiplier); admitted when the loaded sum plus the peak fits the budget, free memory minus the peak stays above the margin, pressure is normal and no other generator runs; one generator at a time; queue of 4; a jit item can `yieldsToGenerators` | Stack `governor.ts` `canAdmit`, `admit` |
| Admission wait | a queued generator fails with `no_memory` after 180 s | `WatchdogRules.admissionWaitMs` |
| Measured peaks | the first run's process footprint replaces the provisional peak and is written back to the store | `refreshMeasuredPeak` |
| Idle unload | jit roles after 600 s; the picture worker's `generation.keep_warm_minutes` (10, named in the image engine note, not yet in the spec) | governor `idleTtlSeconds`, image worker |
| Chat first | the heavy gate pauses the running heavy worker (SIGSTOP) while any interactive request is in flight, resumes 4 s after the last; card line "Paused while chat is working" | Stack `heavyGate.ts` (ISOLATION-01, built) |
| Job records | `queued`, `running`, `done`, `failed`, `cancelled` with `phase`, `position`, `percent`, `stage_label`; a job belongs to a person and a conversation; one video per person; a child's daily caps | Home `lib/pictures/jobStore.ts`, `lib/videos/jobs.ts` |
| Copy | "Home is busy making another picture, video or song. It will start in a minute. You are number N in line."; "Paused: this computer is low on memory. Close big apps, or try again in a few minutes."; chat's low-memory line in `failureCopy.ts` | Home `videos/jobs.ts` `busyLine`, `failureCopy.ts` |
| Status | `/stack/v1/memory` (level, consumers, dev load, the isolation block); Home's Status page syncs the Stack's health list; chat readiness carries `cause: memory` | Stack `routes/memory.ts`; Home `stackHealthSync.ts`, `roleHealth.ts` |

The gap, in one sentence: admission and the watchdog are built and sound, but a request still fails on a timer, the eviction
order is implicit, nothing holds a household-wide queue that knows people, and the copy is three unrelated lines.

## 4. The design, piece by piece

### 4.1 Memory budget and ledger (Stack, the governor)

One ledger, in the governor, as today, with every loaded item tagged with a **class**:

| Class | Members | Rule |
|---|---|---|
| reserved | chat (with its picture projector; the DFlash draft is not live, see below), voice (stt, tts), the memory judge, embed, router | Set aside first at boot from the fit plan. Never evicted for a job. The watchdog's CRITICAL steps (judge eviction, chat restart after 60 s) stay as the last line of defence, unchanged. Voice and the judge are not unloaded within 5 minutes of a conversation (reliability item 7, ISOLATION-05). |
| warm | the picture pool (create model resident, edit model on demand), the coding model in Normal mode, vision | Loaded on first use, kept for the keep-warm window, evicted in order (4.3) when a job needs the room. |
| burst | video, song, image tools, the daily picture canary, benches and other sessions' processes (reported as dev load, not ours to evict) | One at a time household wide. Loaded for the job, unloaded after the keep-warm window. |

Budget arithmetic stays what `admissionRoomBytes` computes: the smaller of (model budget minus loaded) and (free memory minus
the tier margin). The chat set-aside is the reserved class's sum; a picture request is sized from the pool's measured peak and
the budget comes from what remains, so pictures never shrink the chat context (bakeoff section 4, RULES.md chat rule 4).

Numbers on the Studio today (coding note, 2026-10-22; bakeoff, 2026-10-25): reserved about 36 GB (chat 21.4 with the
projector, judge, embed, voice; no draft). The DFlash draft model (CHAT-TPS-02) is not live: it is faster only without the
picture projector (21 to 24 against 26 tokens per second with it), so Jesse decided on 2026-10-25 to keep the projector, run no
draft now, retest the draft at the next llama.cpp engine pin and enable it only if it is faster with pictures then. If it is
enabled, the reserved class grows by 2.2 GB (its measured resident cost) and nothing else here changes; picture pool 15.8 GB resting with both models loaded, 26 GB peak at 8-bit edits and 29 GB planned at bf16; video
44.1 GB; song 33 GB (a 64 GB decode peak was seen before the cache limit); coding model 23 GB. Budget 116.8 GB, working margin
20 GB.

### 4.2 System monitor and the pressure signal (Stack, the watchdog)

Unchanged in mechanism: the 5 s reader and the ladder. Two additions:

- **A `fits_ever` answer.** For a request, whether it could be admitted with every warm and burst item evicted and the reserved
  set still loaded: `peak <= budget - reserved` and `peak <= total - reserved - margin`. Home asks it at submit time, so a job
  that can never fit is refused in the same second (rule Q1), not after 180 s.
- **A `room_after_eviction` answer.** What the governor could free by evicting idle warm items, in order. It decides between
  "waiting for memory, Home is clearing room" and "waiting for memory, something else is using it" on the card (section 5).

The dev-load report (`memory.dev-load`, a single outside process over 40 GB or a sum over 30 GB) is the evidence behind the
second wording and reaches an admin through the Status page, never a person's card with a process name (RULES.md 6a).

### 4.3 Model registry: load, unload, keep warm, evict (Stack, the governor and the workers)

- **Load** only on a governor admission (Triton's explicit mode). The picture pool is one admission sized at its two-model peak
  (29 GB planned); inside it the worker loads the create model on the first picture and the edit model on the first edit
  (bakeoff section 4, slice 2 there). When the pool's peak does not fit but the create model alone does, the pool is admitted at
  one-model size and the worker swaps instead (6 to 17 s, absorbed by the queue), as the bakeoff decided.
- **Keep warm**: `generation.keep_warm_minutes` (10) for the pool, `coding.keep_warm_minutes` for the coder, `idleTtlSeconds`
  (10 minutes) for vision and the tools worker. The warm clock restarts on each job; a request for a warm item is instant.
- **Unload** when the clock runs out, or when evicted. Every MLX worker calls `clear_cache` after each job and sets a cache
  limit at start, so an idle worker holds only its weights (15.8 GB for the pool, not 26).
- **Eviction order**, when a request cannot be admitted and the governor can make room by unloading: (1) idle burst items
  (a finished video worker inside its keep-warm window), (2) idle image tools and vision, (3) the idle edit model alone (Klein,
  about 10 GB, it reloads in 6 to 12 s), (4) the idle coding model, (5) the whole picture pool, (6) a paused burst job is never
  evicted for another burst job (it would lose minutes of work; it keeps its slot), (7) never reserved. A warm item that is
  busy is not evicted; the request waits for it to finish. Eviction is for a request of a higher or equal class; a video (burst)
  never evicts the picture pool (warm) unless the pool is idle past 2 minutes (owner's answer 3, 2026-10-25).
- **Measured peaks** keep updating the record (`refreshMeasuredPeak`); the bakeoff's numbers are the seed, the machine's own
  runs replace them.

### 4.4 Admission control (Stack) and the household queue (Home)

Two layers, one decision each, as the isolation note set out: the Stack admits by memory and knows no people; Home orders by
person and class.

Rules, in order of precedence:

- **Q1. Refuse only what can never fit.** At submit, Home asks `fits_ever`. No: the job is refused with numbers (section 5 copy)
  and never queued. Yes: the job is queued and from here on never fails for memory. The 180 s `no_memory` deadline is removed
  for queued jobs; a queued job has no deadline, only the person's cancel.
- **Q2. Class order: chat, then pictures, then video, then everything else.** A chat or voice request is never queued (it is
  interactive; the heavy gate pauses heavy work for it). Among waiting jobs the head is the oldest picture, then the oldest video,
  then the oldest song or tool job, with Q3 inside each class.
- **Q3. Round robin by person inside a class.** The next job goes to the person who has waited longest without a running job;
  one running heavy job per person across kinds (ISOLATION-03). A child's daily cap and lane apply before queueing, unchanged.
- **Q4. Backfill.** A job lower in the order may start ahead of the head when it fits in the room the head cannot use yet (the
  head is waiting for chat to end or for another job of its kind) and its measured typical time (picture 8 to 44 s, edit 20 s)
  is shorter than the head's remaining wait. A video never backfills ahead of a picture.
- **Q5. Aging.** A job that has waited 10 minutes moves up one class, once (a video becomes picture-class, a song becomes
  video-class). This stops a steady stream of pictures from starving a clip forever. Chat is not a class a job can reach.
- **Q6. Start rule.** A job starts only when no interactive request is in flight (ISOLATION-02) and the watchdog level is
  normal; at WARN the queue holds, at CRITICAL the running burst job is cancelled by the watchdog and re-queued by Home at the
  head of its class (not failed; up to 2 re-queues, then failed with the low-memory line).
- **Q7. No cap on the line** (owner's answer 2, 2026-10-25). Home's household queue holds every fitting request; nobody is
  told the line is full. One person cannot hog it: Q3's round robin decides the order, and the card shows the honest wait. The
  Stack's 4 waiting per kind stays as a wire buffer only; Home hands the Stack the next job when a slot opens.
- **Q8. The flex band** (owner's answer 4). The 20 GB working margin stays a rule, not a dial, and may flex by at most 4 GB,
  down to 16 GB free, only for a picture-class job (the class right under chat), only while the watchdog level is normal, and
  only one job at a time. The borrowed 4 GB is given back when that job ends; no other admission happens while it is borrowed.
  The system never lets free memory fall under 16 GB by its own admission, and the watchdog's WARN (reserve plus 4 GB) and
  CRITICAL (3 GB) floors are untouched. Video, song and tool jobs never use the band.

### 4.5 User messaging and states

Every state reaches the person through the job's own card (RULES.md S6, "One job's progress"), the companion's Yours line
("1 working, 2 waiting") and, for the household picture, the Status page. The composer line under chat keeps its own memory
state (`failureCopy.ts` `memory`), unchanged. No banner, toast or dot is added.

The copy lives in one table, `lib/jobQueueCopy.ts` in Home (slice 6), keyed by state and reason, with an adult and a child
line, and the picture, video and song cards all read it. The lines are in section 6.

### 4.6 Failure and recovery

- **Stack restart while jobs wait.** Home's job rows are the queue (state `queued` in SQLite); on reconnect Home re-submits in
  Q2 and Q3 order. A job that was `running` and is gone from the Stack is re-queued once at the head of its class.
- **Watchdog cancel** (CRITICAL): the job is re-queued (Q6), the card says so, the Status page shows the level and the admin
  is told through the existing `engines.problem` notification.
- **Worker crash mid-job**: as today (the job fails with the kind of failure, the Repairs item is raised); not a memory state.
- **Paused by chat** for more than 10 minutes: the existing "Still waiting; it continues when the chat is quiet" line and the
  person's cancel; the forced resume after 10 minutes stays (ISOLATION-01).
- **Degraded memory reading** (the probe failed): the governor already refuses new admissions; the card says "waiting for
  memory" and the Status page shows the probe error to an admin.
- **Watchdog CRITICAL** also reaches an admin through the existing `engines.problem` notification type (`notificationTypes.ts`),
  fed from the Stack's health list; no new type.
- **Coding mode** (one occupant, the mode switch): while the mode is on, new picture, video and song requests are queued with
  reason `coding_mode` (the coding note's governor reason, its line "Pictures, videos and songs queue with a plain reason") and
  start by themselves when the mode is off; running ones finish or are cancelled by the admin; the reserved class is redefined by
  the mode's fit plan. Nothing here reaches into the mode switch; it reads the mode and holds the queue.

### 4.7 Observability and settings

- `GET /stack/v1/memory` gains a `ledger` block: bytes per class, each loaded item's class and idle seconds, the queue depth per
  class, and counters (evictions by reason, re-queues, refusals by `fits_ever`). Home's `stackHealthSync.ts` carries the level and
  the ledger totals to the Status page's whole-system row. Typed log events (`memory.evicted`, `queue.waited`, `queue.refused`)
  carry a kind, a class, bytes and seconds, never a person, prompt or id (RULES.md 6a).
- Settings, all existing: `generation.keep_warm_minutes` (declare ahead of spec with the picture pool slice),
  `coding.keep_warm_minutes`, `health.keep_warm`, `stack.memory.watchdog`, `stack.memory.reap_orphans`,
  `generation.kids_daily_pictures`, `generation.kids_daily_videos`. No new key. The working margin and the budget stay rules in
  `GovernorRules`, not settings (owner's answer 4: no dial; the 4 GB flex band of Q8 is a rule too).

## 5. The request's state machine

One table for a picture, a video, a song or an image tool job. The state is the Home job record's `state`; the reason is its
`phase`; the Stack's `stage_label` fills the card's second line while the job runs.

| From | Event | To | What the person sees |
|---|---|---|---|
| (new) | submitted; policy, age gate, daily cap pass | checking | nothing yet (under a second) |
| checking | `fits_ever` is no | refused | the cannot-fit line, with numbers (6.4) |
| checking | fits, room now, no chat in flight, no job of its kind running | starting | "Starting" (6.3) |
| checking | fits, but must wait | queued (reason: `chat`, `memory`, `turn`) | the queued line for that reason (6.1, 6.2) |
| checking | fits, but coding mode is on | queued (reason: `coding_mode`) | the coding-mode line (6.2) |
| queued | reason changes (chat ended, memory freed, a job finished, the mode is off) | queued (new reason) or starting | the line updates in place; no new card |
| queued | 10 minutes waiting | queued (aged one class) | the same line; the estimate shortens |
| queued | the person cancels | cancelled | "Cancelled" (existing) |
| starting | the model is loaded | working | the Stack's stage and percent (existing) |
| working | an interactive request starts | paused (reason: `chat`) | "Paused while chat is working" (existing) |
| paused (chat) | 4 s after the last interactive request | working | progress resumes |
| working or paused | watchdog CRITICAL | queued (reason: `memory`, re-queue 1 or 2) | the re-queued line (6.2) |
| working or paused | third watchdog cancel | failed | the low-memory failure line (existing) |
| working | finished | done | the picture, clip or song |
| working | worker error | failed | the kind of failure (existing) |
| any waiting or running state | Stack restart | queued (head of its class) | the queued line |

## 6. The words on the card

Plain words, what happened, then what to do. Adult and teen share a line; a child gets the short one. No times are promised
beyond "about"; the number comes from measured typical times (picture 8 to 44 s by model, edit 20 s, video 140 s, song from its
bench) plus the Stack's `eta_seconds` for the job ahead.

### 6.1 Queued behind chat or another job

- Behind chat: adult "Waiting for chat to finish. Your picture starts by itself after that." Child "Waiting for the chat to
  finish, then it's your turn."
- Behind another job: adult "Next after another video (about 2 minutes). You are number 2 in line." (the position only when it
  is 2 or more). Child "Someone else's picture is first. Yours is next, in about a minute."
- Still waiting after 10 minutes: adult "Still waiting. It starts when the computer is free, or tap Cancel." Child "Still
  waiting. It will start soon."

### 6.2 Waiting for memory

- Home is making room: adult "Waiting for memory. Home is putting away another model (about 30 seconds)." Child "Making room,
  about half a minute."
- Something else holds the memory: adult "Waiting for memory. Something else on this computer is using it. Your picture starts
  as soon as there is room, or tap Cancel." Child "The computer is full right now. Your picture starts when there is room."
- Re-queued after a low-memory cancel: adult "The computer ran low on memory, so this video will start again from the beginning
  when there is room. Nothing to do." Child "The computer got too full. Your video will start again soon."

- Coding mode on: adult "Home is in coding mode. Your picture starts by itself when it is back to normal, or tap Cancel."
  Child "Home is busy with a big job. Your picture starts when it is done."

### 6.3 Started

- Adult "Starting. Loading the picture model (about 10 seconds)." then the Stack's own stage lines ("Drawing, 3 of 8").
- Child "Starting now."

### 6.4 Can never fit

- Adult "This video needs about 44 GB of memory and this computer has 32 GB for pictures and videos after chat. Try a shorter
  clip, or ask an admin to turn video off for this computer." (the two numbers from `fits_ever`; the next step names the kind's
  smaller option when one exists).
- Child "This computer can't make videos. Try a picture instead."
- Admin, on the Status page row: "Video needs 44 GB; 32 GB is free for jobs after the chat model. Choose a smaller video model or
  a smaller chat model in Settings."

## 7. Worked examples (Studio numbers)

Budget 116.8 GB; reserved 36 GB; working margin 20 GB; so the room for jobs with nothing else loaded is about 72 GB
(the smaller of 116.8 minus 36, and 128 minus 36 minus 20).

1. **Quiet evening, one picture.** Sage asks for a picture. Room 72 GB, the pool's planned peak 29 GB: admitted at once,
   `starting` for 6 to 17 s (ERNIE loads), `working` 22 s, done. The pool stays warm 10 minutes at 15.8 GB resting.
2. **Two people at once: create plus edit.** Sage asks for a picture while Marlow edits one. One pool admission (29 GB) covers
   both; the worker runs the create (ERNIE, 44 s measured with another job beside it) and the edit (Klein, 20 s) together.
   Neither waits; both cards show "Working". Ledger: reserved 36, warm 29 peak, 51 GB used; free about 77 GB.
3. **A video arrives during example 2.** Nova asks for a clip (44.1 GB). Memory says yes (36 plus 29 plus 44.1 is 109 under
   116.8; free 77 minus 44.1 leaves 33, over the 20 margin). Class order says pictures first and one burst job at a time: the
   clip is `queued`, reason `turn`, card "Next after two pictures (about 1 minute)". The pictures finish in 44 s, the clip starts.
   No eviction: the pool stays warm because the clip fits beside it.
4. **Memory tight: an outside bench holds 31 GB.** Same as 3 but a session's bench holds 31 GB. Free is now 77 minus 31, about
   46 GB; 46 minus 44.1 is under the 20 margin, so the clip cannot start. `room_after_eviction` says evicting the idle pool
   (15.8 GB) would give 62 GB free, enough. The governor waits for the pool's 2 minute idle grace, evicts it,
   starts the clip; card "Waiting for memory. Home is putting away another model (about 30 seconds)", then "Starting". If the
   bench held 50 GB instead, eviction would not be enough: card "Waiting for memory. Something else on this computer is using
   it", Status shows `memory.dev-load` to the admin, the clip waits with no deadline and the person's Cancel. When the bench ends
   the clip starts by itself.
5. **A chat turn while the clip renders.** Sage sends a long message. The heavy gate pauses the video worker (built); card
   "Paused while chat is working"; chat runs at 24 tokens per second; the clip resumes 4 s after the reply ends. Sage's next
   picture request is queued reason `turn` ("Next after a video (about 2 minutes)"); if 10 minutes pass it does not age
   above the clip because pictures are already the class above video; Q4 backfill lets it start if the clip is paused by chat
   and the pool fits beside the paused worker (36 plus 44.1 plus 29 is 109, under 116.8; free 128 minus 109 is 19, under the
   20 margin but inside the Q8 flex band, so the picture starts with 1 GB borrowed and gives it back when it ends; the 36 GB
   reserved figure has no draft model, and with the optional 2.2 GB draft on it would be 17 GB free, still inside the band).
   Editing stays at full quality (bf16, owner's answer 5): the band exists for exactly this mix, and when it is not enough (an
   edit beside a clip beside a larger chat model) the picture waits for the clip, which is accepted.
6. **Can never fit: a song on a p64 Mac.** Reserved 28 GB there, budget 56 GB (64 minus 8), margin 12: room 24 GB. A song's
   33 GB fails `fits_ever` at submit: the 6.4 line with 33 and 24. Nothing is queued.
7. **Watchdog CRITICAL during a clip.** Available memory drops under 3 GB (a runaway outside process). The watchdog cancels the
   clip (video first, as today) and evicts the judge. Home re-queues the clip at the head of the burst class, card
   "The computer ran low on memory, so this video will start again from the beginning when there is room." The level clears
   after 6 samples; the clip restarts. A third cancel fails it with the existing low-memory failure line.
8. **Coding mode on.** Jesse flips the mode. New picture, video and song requests are queued with reason `coding_mode` and the
   6.2 coding-mode line; the running clip finishes or the admin cancels it; the governor's reserved class becomes the mode's fit
   plan (the 122B at 85 GB plus voice and embed, about 91 GB). Chat's composer keeps its own `mode_change` line from
   `failureCopy.ts`. Flipping back restores the Normal reserved set and the queued jobs start in Q2 and Q3 order.

## 8. Rules check

- Chat rule 0 (age and surface gates): untouched. A child's daily cap, lane and content checks run before queueing; the
  child copy only says less. Chat rule 4: the reserved class is sized first and the chat engine's context never changes for a
  job. Chat rule 11: no outside runner; llama-swap, Ollama and LM Studio were read for ideas only. S6: every state rides the job
  card, the Yours line, the Status page, the composer line and the admin notification that already exist; the one new data item is
  the ledger block in `/stack/v1/memory`, which feeds the Status page's existing whole-system row. Rule 6a: ledger, logs and the
  Status page carry classes, bytes and counts, never a person or a prompt.
- Isolation note: relied on (pause not cancel, one heavy job per person, round robin, the Home credential), with one change
  named in Supersedes: a picture create and a picture edit may run together inside the one picture pool admission, so "one heavy
  job per household" becomes "one burst job (video, song, tools) per household, and one picture pool whose worker may run a
  create and an edit at once". Reliability item 7 and ISOLATION-02, -03, -05 and -06 become slices here with their original names.
- Coding mode note: followed (jobs queue with reason `coding_mode`, never refused).

## 9. The owner's answers (2026-10-25, closed)

Jesse answered the five open questions the same day; the earlier text was changed where named.

1. **Aging: yes.** A video that has waited 10 minutes moves up one class (Q5 unchanged).
2. **No cap on waiting requests, but no hogging.** The 8 per household and 2 per person caps and the "full line" refusal are
   gone (Q7 rewritten, the state table's full-line row removed). Round robin by person stays and the card shows the wait.
3. **Idle grace: 2 minutes** before the picture pool is evicted for a video (4.3 and example 4 now state it as a rule).
4. **No admin dial; the 20 GB margin flexes a little.** New rule Q8: a bounded 4 GB band, borrowed only by a picture-class job,
   one at a time, only at watchdog level normal, given back when the job ends; free memory never falls under 16 GB by the
   system's own admission, and the watchdog floors stay. 4.7 now says so.
5. **Accept the wait, keep full-quality editing.** No 4-bit editor on the Studio. Example 5 now shows the flex band covering
   that exact mix, and the wait when it does not.

## 10. The SSD as a cache and as extra memory (research, 2026-10-25)

Jesse asked whether the SSD can serve as a cache and as extra memory for the models, as people do elsewhere. Measured first,
then the table.

**This Studio's SSD, measured** (2 TB Apple Fabric SSD, 990 GB free, 300 GB of models in the Stack's store; a read-only test of
8 GiB from one bakeoff weights file, 64 MiB reads, run twice each, with the machine at load average 40):

| Read | Speed |
|---|---|
| Uncached (`F_NOCACHE`), straight from the SSD | 12.4 GB/s, both runs |
| From the page cache, single thread | 11.9 then 17.1 GB/s (bounded by one core's copy, not the disk) |
| Unified memory, for comparison (chat throughput note) | 614 GB/s on the M5 Max 40-core |

So the SSD reads at about one fiftieth of memory bandwidth, which matches the published 13.4 GB/s Blackmagic result for this
model ([Macworld review](https://www.macworld.com/article/3238319/mac-studio-m5-max-review.html), [Apple Wiki spec, up to 14.5 GB/s](https://theapplewiki.com/wiki/Mac_Studio_(M5_Max))).
Two consequences carry the whole section: a model's weights can be read back from the SSD in about a second per 12 GB (the
chat model's 19.65 GB file in 1.6 s, the ERNIE 8-bit weights in under a second), so the 6 to 17 s model loads measured in the
bakeoff are the loader's own work, not the disk; and a dense model that streams its weights per token would run at under one
token per second (19.65 GB per token at 12.4 GB/s is 0.6 tokens per second against 26 measured in memory). The same
`vm_stat` reading during the test showed 4.2 GB of swap in use and 850,080 pages ever swapped out on this machine, so paging
is already happening under the dev load, which is the thing goal 2 exists to stop.

| System | Idea | Verdict for this Studio | Why, with numbers |
|---|---|---|---|
| [Apple, LLM in a flash](https://arxiv.org/html/2312.11514v3) ([Apple ML](https://machinelearning.apple.com/research/efficient-large-language)) | Keep the weights in flash, load what a token needs, reuse recently active neurons (windowing), read big contiguous chunks (row-column bundling); up to twice the DRAM size at 4x to 20x over naive loading | Rejected for the chat model, noted for a future MoE | It works by reading a fraction of the weights per token, which needs sparse activation the dense Muse 30B does not have; and nothing beats the 50x bandwidth gap for a model that already fits. If a later chat model is a mixture of experts (chat throughput note, option 3), revisit. |
| [Flash-MoE](https://lilting.ch/en/articles/flash-moe-qwen35-397b-metal-inference) and mlx-flash ([oMLX issue 986](https://github.com/jundot/omlx/issues/986)) | Stream expert weights from the SSD per token; a 397B MoE on a 48 GB Mac at 4.4 tokens per second | Rejected | Same reason; 4.4 tokens per second is below the 24 tokens per second the household gets in memory, and the Stack runs only its own tested engines (chat rule 11). |
| [PowerInfer](https://arxiv.org/html/2312.12456v2) | Hot neurons on the GPU, cold ones on the CPU, chosen by a predictor; 11.69x over llama.cpp on a 4090 | Rejected | Made for a split GPU and CPU memory; unified memory has no second pool to spill to, and the engine is a fork of llama.cpp with its own kernels (rule 11). |
| [ZeRO-Infinity](https://arxiv.org/pdf/2104.07857) ([ISPASS study](https://utw10244.utweb.utexas.edu/pubs/Hanindhito_BandwidthCharacterization.pdf)) | Partition and overlap NVMe, CPU and GPU transfers; needs over 70 GB/s for parameters, hides the rest | Rejected | Training machinery for GPU clusters; a single 12.4 GB/s SSD cannot feed a 614 GB/s decode. |
| [llama.cpp mmap and `--load-mode`](https://github.com/ggml-org/llama.cpp/discussions/19883) ([mlock commit note](https://app.semanticdiff.com/gh/ggerganov/llama.cpp/commit/f963b63afa0e057cfb9eba4d88407c6a0850a0d8)) | Weights are memory mapped by default, so a cold start reads from the SSD and a warm one from the page cache; `mlock` pins them; macOS is "eager to start compressing" an unpinned model and then stalls to decompress | Adapted | The chat engine stays mmap, unpinned (the chat throughput note found 0 pageouts with the reserved set in memory). What protects it from compression and swap is the reserved class and the margin, not a lock. New: the watchdog treats a rising `Swapouts` counter while chat is loaded as WARN (slice 12), because a swapped chat model is the "20 to 0.5 tokens per second" cliff people report ([guide](https://mljourney.com/?p=4413)), and it is never allowed to happen on purpose (owner: never swap the chat model). |
| Ollama and LM Studio mmap of a model larger than RAM ([guide](https://insiderllm.com/guides/running-llms-mac-m-series/)) | Let the OS page weights in on demand so a model bigger than memory still runs | Rejected | A page per token at SSD speed; the `fits_ever` refusal (Q1) is the right answer for a model that does not fit, with the numbers on the card. |
| The page cache as the model cache (this note's measurement) | Unloaded weights stay in the file cache until memory is needed; a reload reads nothing from disk | Adopted | This is why eviction is cheap and why the eviction order can be aggressive: the edit model (about 10 GB on disk) reloads in 6 to 12 s, almost all of it loader time. One rule: the Stack never purges the file cache, and the bench that measures a cold load (`IMGGEN-BENCH-01`) says it forced one. Slice 13 measures the loader's share so the estimate on the card ("about 10 seconds") is honest. |
| llama.cpp slot save and restore ([tutorial](https://github.com/ggml-org/llama.cpp/discussions/13606), [commit](https://cdn04132025.gitlink.org.cn/replica/llama.cpp/commit/beea6e1b16e783a0886e78dec01002a8c00db24d)) | `--slot-save-path` plus `POST /slots/{id}?action=save` writes a slot's KV cache to a file and `restore` reads it back; loopback only, opt in, not automatic | Rejected | The chat model is never evicted, so the only use would be keeping the prefix across the watchdog's chat restart (60 s of CRITICAL). A slot file holds the slot's token ids and KV, so it would write a person's turn, a temporary chat and a robot's look sentence to disk, which RULES.md R1 and the temporary-chat design forbid even for a second. The prefix (2,890 tokens, 0.42 s first token warm against 3 to 5 s cold) is rebuilt in memory instead by the existing post-start suite (`chat_hello` first, on the one shared schedule of the reliability note), which already runs after any restart; slice 11 only makes the watchdog's restart count as one. Nothing is written. |
| [LMCache](https://arxiv.org/pdf/2510.09665) and vLLM KV offload ([docs](https://docs.lmcache.ai/getting_started/quickstart/offload_kv_cache)) | Keep KV caches of recurring prefixes in CPU memory and on local disk across requests; 2.3x to 14x throughput on long multi-turn traces (vendor numbers) | Rejected as software, idea covered | Needs vLLM and a GPU-CPU split. The idea, reuse of a recurring prefix, is already the engine's own prompt cache (`--cache-reuse 256`) and the prewarm `chat_hello`, which also covers the one restart case. |
| [MLX lazy loading and mflux `--low-ram`](https://upd.dev/ml-explore/mlx/issues/2878) ([mflux 0.16.5 notes](https://newreleases.io/project/github/filipstrand/mflux/release/v.0.16.5)) | MLX arrays are lazy, but `mx.load` has no streaming mode (an open request); mflux's low-ram mode and its cache cap trade speed for footprint | Adapted | The cache cap is slice 4 (already adopted). Low-ram mode is rejected on p128 (the pool fits) and is the right fallback for p32 and p16 tiers, where the image engine note already picks smaller models; no change here. |
| macOS compressed memory and swap ([box.co.uk](https://box.co.uk/blog/macbook-air-memory-usage-macos), [insiderllm](https://insiderllm.com/guides/running-llms-mac-m-series/)) | macOS compresses inactive pages before it swaps; yellow pressure is compression, red is swap; LLM speed collapses once weights swap | Adopted as a signal | Compression is already in the watchdog's reading (`kern.memorystatus_level`, the compressor pages). Swap growth is already a CRITICAL trigger (1 GB in 30 s). Slice 12 adds the chat-specific pageout rule above. Nothing is designed to use swap on purpose. |
| SSD wear ([mjtsai, 2026](https://mjtsai.com/blog/2026/03/06/how-long-will-my-macs-ssd-last/), [M1 reports](https://www.pcgamer.com/uk/apple-m1-macs-appear-to-be-chewing-through-their-ssds)) | Reads cost no wear; swap writes do (one 8 GB user saw about 1 TB a day); Apple does not publish the TBW | Adopted as a constraint | Everything above is read-only; the design writes nothing to the SSD and never uses swap as memory. Jesse's rule "never swap the chat model" is also the wear rule. |

What changes in the design because of this research: the eviction order of 4.3 stays aggressive (reload is cheap, the disk is
not the cost); a swapped-out chat model becomes a watchdog state (slice 12); the chat restart rebuilds its prefix in memory
through the existing post-start suite, with nothing written to disk (slice 11); the
card's "about 10 seconds" load estimate is measured as loader time, not disk time (slice 13). Nothing keeps a model on the
SSD "instead of unloading": unloading already is that, through the page cache. Weights are never streamed per token on a dense
model, and no engine outside the Stack's set is adopted.

## 11. Build slices (small; no backlog rows yet)

| # | Repo | Files | What | Test |
|---|---|---|---|---|
| 1 | Stack | `lib/governor.ts`, `tests/governor.test.ts` | `fitsEver(request)` and `roomAfterEviction()`; a queued generator has no 180 s deadline (`admissionWaitMs` applies only to a refused `fits_ever`) | never-fit refused at once; a fitting request waits 10 minutes and is admitted when memory frees |
| 2 | Stack | `lib/governor.ts`, `roles.ts`, `tests/governor.test.ts` | the class tag on requests and loaded items; the eviction order of 4.3 with the busy and grace rules | eviction picks the idle edit model before the pool, never reserved, never a busy item |
| 3 | Stack | image worker (`image-gen` worker script), `lib/imageGen.ts`, its test | the picture pool: one admission, create model resident, edit model on demand, one-model fallback (bakeoff slice 2) | both models load inside the window; a second edit does not reload; pool unloads after idle |
| 4 | Stack | the picture, video and song worker scripts | `clear_cache` after each job and a cache limit at start | resting footprint after a job is within 10 percent of the weights |
| 5 | Home | `lib/jobs/householdQueue.ts` (new), `lib/pictures/jobs.ts`, `lib/videos/jobs.ts` | the household queue: class order Q2, round robin Q3, backfill Q4, aging Q5, no cap Q7; one job per person; re-submit on reconnect (ISOLATION-03 extended) | two people interleave; a video ages after 10 minutes; a picture backfills a paused clip; a child's cap holds; one person's 20 requests do not delay another's first |
| 6 | Home | `lib/jobQueueCopy.ts` (new), `lib/videos/jobs.ts` (`busyLine` deleted), the song jobs file | the one copy table of section 6, read by every card | every state and reason has an adult and a child line; no em dash; the dad test by review |
| 7 | Home | `lib/pictures/jobs.ts`, `lib/videos/jobs.ts`, a test | re-queue on a watchdog cancel (Q6), twice, then fail | a cancelled job reappears queued at the head of its class |
| 8 | Stack and Home | `routes/memory.ts`; Home `lib/stackHealthSync.ts`, `StatusPage` data | the `ledger` block and its Status row | the Status page shows class totals and queue depth from a fixture |
| 9 | Stack | `routes/jobs.ts`, `lib/jobs.ts` | the start rule (ISOLATION-02): no admission while an interactive request is in flight; the watchdog's WARN holds the queue instead of cancelling it | a queued job is admitted after the 4 s tail, never during a request |
| 10 | Stack | `scripts/bench-isolation.ts` (ISOLATION-06's harness, bench lane) | examples 2, 3 and 4 added as scenarios to the isolation bench; no second harness | two pictures plus a clip; the clip waits then starts; no job fails |
| 11 | Stack and Home | `lib/supervisor.ts` (the restart it already reports), the Home code that turns a restart into the post-start suite, a test | the watchdog's chat restart is reported to Home as a restart like any other, so the one shared schedule's existing post-start suite runs once (`chat_hello` first, single flight, a person's turn still wins, the reliability note's scheduler untouched); no new prewarm caller, no slot save, nothing written | a scripted watchdog restart triggers the post-start suite once, with `chat_hello` first; the bench shows a first token under 1 s on the next turn |
| 12 | Stack | `lib/memoryWatchdog.ts`, `lib/memoryState.ts`, a test | the `Swapouts` counter rising while the chat role is loaded enters WARN at once (not after 2 samples); the ledger block reports `chat_paged_out: true` | a fixture with rising swapouts and a loaded chat role is WARN on the first sample |
| 13 | Stack | `scripts/bench-isolation.ts` (bench lane) | the reload bench: time to first picture after an eviction with the weights in the page cache against after a forced cold read; the loader's share becomes the card's load estimate | two numbers in the bench output; the card estimate is within 3 s of the warm number |
| 14 | Stack | `lib/governor.ts`, `tests/governor.test.ts` | the Q8 flex band: 4 GB, picture class only, level normal only, one borrower, returned on release | a picture is admitted at 19 GB free, a video is not; a second picture waits while the band is borrowed |

Order: 1, 2, 9 (the Stack stops failing and starts ordering), then 5 and 6 (people see the right words), then 14, 3, 4, 7, 8,
12, 11, 10, 13. Each is a Codex brief of 1 to 3 files with a failing test first.

## Supersedes

- `image-engine-2026-10-17.md` section 7, "A refusal is a plain 503 telling the person what to do ('pictures need 15 GB free;
  close the video job or wait')": a fitting request is queued and never refused for memory; only a never-fit request is
  refused, with the section 6.4 line.
- `isolation-2026-10-18.md` section 1's inventory line "a wait longer than 180 s fails as `no_memory`" and `WatchdogRules.admissionWaitMs`
  as a job deadline: the deadline applies only to a never-fit request (slice 1).
- The `busyLine` text in Home `lib/videos/jobs.ts` ("It will start in a minute") and the video `no_memory` failure line: replaced
  by the section 6 table (slice 6).
- `isolation-2026-10-18.md` section 3 rule 5, "One heavy job at a time per household (as today)": narrowed to one burst job
  (video, song, image tools) per household. The picture pool is one admission whose worker may run one create and one edit at
  the same time (the bakeoff measured 23 GB together and no slowdown, section 3 there). One heavy job per person across kinds
  stays.
- The resource priority memory note's "memory-budget-2026-10-21.md, to be written": this note is it.
- `isolation-2026-10-18.md` section 1's inventory line "Memory watchdog ladder ... 2 samples to enter": one addition, slice 12,
  a rising `Swapouts` counter while the chat role is loaded enters WARN on the first sample. Every other step of the ladder,
  the chat restart after 60 s of CRITICAL included, stays.
- `isolation-2026-10-18.md` section 1's "free memory minus the tier margin (20 GB on p128) stays above zero": the margin may
  flex by 4 GB for one picture-class job under rule Q8 (owner's answer 4); the 20 GB stays the rule for every other admission.
- `isolation-2026-10-18.md` section 1's "the fifth person gets 'a full line'": Home's household queue has no cap (owner's
  answer 2); the Stack's 4 per kind is a wire buffer Home feeds, never a refusal a person sees.

Nothing else in the isolation note's design, the bakeoff's decision, the coding mode note or any gate is superseded.

Reuse check: the governor stays the one admission decision (one definition, one place); Home's job rows stay the one queue
store; the job card, the Yours line, the Status page, the composer line, the admin notification and `failureCopy.ts` carry every
state (S6, no new surface); the heavy gate, round robin and one-per-person rules come from the isolation note unchanged; the
picture pool is the bakeoff's slice 2, not a second lifecycle; settings are the existing keys only.
