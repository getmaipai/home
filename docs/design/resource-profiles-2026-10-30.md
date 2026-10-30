# Resource profiles and priorities: who gets squeezed, who goes first, when a switch may happen (2026-10-30)

Status: proposed, not decided, not built. Extends [resource-tiers-2026-10-27.md](resource-tiers-2026-10-27.md) (tiers, Max lease, Reduced) and
[memory-management-2026-10-25.md](memory-management-2026-10-25.md) (rules Q1 to Q8). Owner's ask (Jesse, 2026-10-30): when a feature
needs more, the other categories shift to lower tiers or switch off (making a companion video: pictures High, video Max, chat Reduced); every user
feature follows this by itself, with the small indicator showing queued or disabled; fairness by queueing; and a smarter rule than round robin, with
admin-set priorities and a chat rule like "chat mode only changes when nobody else chatted in the last minute".

## 1. What the 2026-10-27 design already does, and the three gaps

Already there: the tiers and their memory caps (section 2), Reduced for chat only while a Max job runs (2a), one heavy slot, Max drain and window (T1 to T3),
person-level fairness and aging (Q3, Q5, T4), the indicator through the existing job card, busy line and Status row (section 8, rule S6).

| Gap | Today | This note |
|---|---|---|
| G1. Only the lead job has a tier | A Max job reduces chat when its peak does not fit; pictures just queue. No "pictures High while video is Max". | Section 3: a **profile** is a tier for every category, computed from the lead job. |
| G2. Priority is fixed code | Q2: chat, pictures, video, rest. Round robin by person inside a class. | Section 4: an admin-editable **priority list** with weights, aging and fair share, chat pinnable to strict first. |
| G3. No rule about *when* a switch may happen | Reduced engages after any in-flight chat turn finishes. Another person who chatted a second ago still gets swapped under them. | Section 5: a **quiet window** and cooldowns (hysteresis) before any downshift of a category other people are using. |

## 2. Research: how others do it

| System | Idea | Verdict |
|---|---|---|
| [vLLM priority scheduling](https://docs.vllm.ai/en/v0.9.1/configuration/optimization.html) (see also [the hybrid real-time paper](https://arxiv.org/pdf/2504.09590)) | `--scheduling-policy priority`: each request carries a number, lower runs first; default is first come first served. Preemption evicts low priority work from the running set and recomputes it later. A 2026 feature request notes high priority waiting requests cannot displace running ones once the sequence cap is hit. The paper finds a static hybrid scheduler struggles as arrivals shift. | Adapted. Numeric priority per request is our priority list. Preemption by recompute is "yield, not kill" only when the job can resume; our video and song jobs cannot, so we preempt at **boundaries** (between chat turns, between jobs), never mid-step. |
| [Triton dynamic batcher priority levels](https://docs.nvidia.com/deeplearning/triton-inference-server/user-guide/docs/batcher.html) | N levels per model, level 1 first, higher levels bypass lower; a queue policy per level (max queue size, timeout, reject or delay). | Adopted. The priority list is levels with a per-level policy: timeout becomes "aging" (waits move a job up), reject is never used (Q1: nothing queued is refused). |
| [YARN Fair Scheduler and DRF](https://hadoop.apache.org/docs/r3.4.0/hadoop-yarn/hadoop-yarn-site/FairScheduler.html) | Weighted fair share across queues; Dominant Resource Fairness equalizes each user's largest share; preemption is **off by default** and only runs when cluster utilisation passes a threshold (0.8), on a timer. Early DRF preemption thrashed ([YARN-3453](https://issues.apache.org/jira/browse/YARN-3453)). | Adapted. Our one scarce resource is memory, so the "dominant share" is simply bytes held; fair share is bytes-seconds per person over a short window, not days. Preemption only when pressure exists, and a preemption round stops as soon as enough is freed (the YARN-3453 lesson). |
| [Kubernetes HPA stabilization window](https://www.kubernetes.dev/resources/keps/853/) | Scale **down** looks back over 5 minutes and takes the most conservative recommendation; scale **up** has no delay. The window should be at least as long as the thing takes to come back. | Adopted for G3. Asymmetric: going up is fast, going down waits. Our swap costs 20 to 60 s to reverse, so the quiet window must exceed that. |
| Already adopted in the memory note | Kubernetes QoS classes and priority, Slurm multifactor priority (age, fair share, size, QoS) and backfill, deficit round robin, Ollama and llama-swap keep-alive. | Stand. Slurm's multifactor score is the shape of section 4. |

Not found in this pass (say so rather than guess): NVIDIA MPS and CUDA stream priority are for CUDA GPUs and do not apply to the Mac Studio's unified memory.

## 3. Profiles: a table, one row per job kind and tier (G1)

**A job asks for a tier in its own category. A profile table says what every other category does while it runs.** (Owner, 2026-10-30: use an
editable table, not a general solver; a table is one definition an admin can read and change.)

| Lead job | Chat | Pictures | Video | Music | Stems and tools |
|---|---|---|---|---|---|
| Video Max (companion video) | Reduced | Boost (before the video loads) | Max | queued (`max_window`) | queued |
| Video Boost | Standard | Standard | Boost | queued | Standard |
| Picture Max | Standard | Max | queued | queued | queued |
| Chat Max (lease) | Max | queued | queued | queued | queued |

(Rows are the defaults for the Studio, filled by the evaluations of the tiers note section 14; one table per hardware class, section 4 of the tiers
note.) A cell is a tier, `queued` (waits with a reason) or `off`. Chat's cell is never `queued` or `off`: **chat is never paused or stopped, only
lowered to Reduced at the lowest** (owner, 2026-10-30), and voice never lowers below its current slot.

Rules:

- **P1. The table is validated, not solved.** On save, each row is checked: the lead job's peak plus the resident models of the other cells fits the
  hardware class's budget (the governor's `fits_ever` figures). A row that does not fit cannot be saved, with the numbers. A job whose kind and tier have
  no row runs at Standard beside everything or is not offered at that tier.
- **P2. Stages.** A row may list stages (pictures, then video), each with its own cells, so chat returns to Standard between stages only if the quiet
  window and cooldown (section 5) allow it; otherwise it stays Reduced to the end of the job (no thrash).
- **P3. Nothing is lost.** A forced stop stays the watchdog-CRITICAL case of T5. A lowered category's work in flight finishes first (drain) or pauses at a boundary.
- **P4. Age and surface gates run first** and no profile loosens them; a minor's categories stay at their ceilings (RULES.md rule 8). Reduced chat for a minor keeps the no-tools fail-safe.
- **P5. Admins can pin a cell** ("chat never below Standard"); a row that needs the pinned cell lowered cannot be used, and the job is not offered at that tier, with the reason.
- **P6. Admin-editable per row,** through the Priorities panel (section 7); defaults ship in the settings spec.

## 4. Priorities that are not round robin (G2)

Replace the fixed Q2 order with a score the admin tunes. Round robin by person stays only as the tie-breaker.

**Score for a waiting job = class weight + aging + fair-share credit + admin boost** (Slurm's shape, with weights admins can read in one screen).

| Term | Default | Meaning |
|---|---|---|
| Class weight | chat 1000 (strict), pictures 60, video 40, music 30, stems and tools 20, background and benches 5 | The admin drags categories in a list; the app turns the order into weights. |
| Aging | +1 per minute waiting, capped at the next class's weight gap | Q5, smoothed (no jump); nothing waits forever. |
| Fair-share credit | + up to 20 for a person who has used the least memory-seconds in the last hour | DRF/Slurm fair share, short horizon. A person making their sixth video in a row scores lower than someone's first picture. |
| Admin boost | 0, set per job by an admin ("go next") | One-off. |

- **R1. Strict chat.** Chat and voice are strict priority, never scored: they preempt at a boundary, always. The admin cannot lower this (it is the 2026-10-21 owner ruling). An admin can pin *more* categories as strict (for example "pictures strict over video").
- **R2. Ties and equals** go to the person who has waited longest without a running job (Q3).
- **R3. Backfill and the flex band stand** (Q4, Q8).
- **R4. Per-level policy** (Triton): each class has `max_wait_before_aging`, `max_concurrent_per_person` (default one heavy job per person, ISOLATION-03) and `daily_cap` (child caps, unchanged).
- **R5. Explainable.** Every card can answer "why is mine not first": the reason line names the one term that decided it ("Ahead of you: a picture (pictures go first)", "Ahead of you: another person's video (fair share)").
- **R6. The scheduler is a pure function**, so a simulator can replay a day of jobs and prove: chat never waits; no job waits more than its class bound; nobody starves; one person cannot take more than their fair share while others wait.

## 5. When a switch may happen: quiet window and cooldowns (G3)

Chat is shared. Switching chat to Reduced under someone who is mid-conversation is the worst surprise in the design. So switches that lower a category other people use are gated.

- **S1. Quiet window.** A downshift of chat (to Reduced) starts only when **no other person** has sent or received a chat or voice turn in the last `quiet_seconds` (default 60, admin-editable, minimum 20 because a swap takes 20 to 60 s) and no turn is in flight. The requester's own chat does not block their job; it just finishes first.
- **S2. The wait is bounded and visible, and chat is never paused (owner, 2026-10-30).** The job sits queued with the line "Waiting for a quiet moment in chat" (cause `quiet_wait`). After `quiet_max_wait` (default 10 minutes) the swap goes ahead at the next turn boundary: chat keeps answering, on the Reduced model, and every signed-in person sees the one Reduced line. No turn is killed or delayed. An admin can set `quiet_max_wait` to "never" so the job keeps waiting instead.
- **S3. Asymmetric like HPA.** Downshift needs the quiet window. Upshift (back to Standard) happens as soon as the window ends and a turn boundary is reached; there is no delay for restoring service.
- **S4. Anti-flap cooldown.** After chat is restored, it will not be lowered again for `cooldown_seconds` (default 300) unless the next job's profile is the same window (consecutive jobs chain inside one window: chat stays Reduced between them if the next job starts within the cooldown, instead of swapping back and forth).
- **S5. Someone starts chatting while Reduced is on.** They get Reduced chat and the one-line notice; the job continues (a mid-job swap back would cost 20 to 60 s and break S4). The heavy gate pauses the job for each turn if the admin chose "pause for chat" in the profile, else it does not. This is the only place a person is on Reduced without a quiet window, and the notice says so.
- **S6. The same shape for every category,** not just chat: lowering pictures or music for a video waits for that category's own quiet window (default 0 for background categories, since nobody is mid-conversation with them, and the running job always finishes first).

## 6. What people see (reuse, no new surface)

Rule S6 of RULES.md: feed the existing status row. Additions are reasons and copy only.

- Per category state text in the existing Status row (TIER-HOME-03; a kit Element as shipped, no new element, banner or poll) while a profile is active: `Chat: Reduced · Pictures: Boost · Video: Max · Music: waiting`. Only admins receive the full profile, from an admin-only field on the existing health snapshot; the Status page everyone sees shows each viewer their own rows only (rule 6a) and the Reduced chat line.
- New reasons (all queued/disabled states, never errors): `quiet_wait` ("Waiting for a quiet moment in chat"), `profile_lowered` ("Music is waiting for a big job"), `fair_share` ("Waiting your turn: others went first"), plus the existing `tier_reduced`, `max_window`, `mode_change`.
- The queue explanation follows R5.

## 7. Settings (admin, one panel)

Resources > Priorities: the ordered category list (drag), per-class aging and per-person limits, strict toggles, `quiet_seconds`, `quiet_max_wait` with the wait-or-proceed choice, `cooldown_seconds`, pins ("never lower"), and Reduced on or off. All declared once in the settings spec (no other copies), defaults as in this note.

## 8. Build slices (proposed backlog rows, evaluations first)

| Row | Slice | Done when |
|---|---|---|
| TIER-PRIO-01 | Pure `scoreJobs` and profile-table validator modules plus a day-replay simulator | Property tests for R6 and P1 pass; the section 3 table validates for the Studio |
| TIER-PRIO-02 | Priority and policy settings spec, defaults, admin panel | One definition; the panel edits the list and the quiet window |
| TIER-PRIO-03 | Quiet window and cooldown in Home's household queue (S1 to S6; only Home knows who chatted, the Stack's governor sees no person) | Test: a second person chats at second 50, the swap waits; at 61 it proceeds |
| TIER-PRIO-04 | Profile on the job record and window, phased stages (P2) | Companion video runs end to end on a scratch Stack with chat Reduced, pictures Boost |
| TIER-PRIO-05 | Status row text, new reasons, copy table | Screenshots opened and judged, both widths |
| TIER-PRIO-06 | Per-class policy (R4), fair-share credit, explainable reasons; replaces the Q3 and Q5 fairness that TIER-HOME-01 builds | Replay shows a heavy user does not block a first-time user |

Order: 01 first (no Stack needed), then 02 and 03, then 04 to 06. Depends on TIER-* rows for the tiers themselves.

## 8a. Reuse check

Prebuilt check (2026-10-30): p-queue (MIT, priority and `setPriority`, no per-person fairness), pg-boss (needs Postgres), BullMQ (needs Redis, per-group concurrency is paid) would each be a second queue beside the persisted household queue; oMLX (engine pool, least-recently-used eviction, idle timeout, pinning, memory cap) and llama-swap (MIT, swap matrix, idle timeout, pause and unload endpoints, no priority) are model-loading mechanics, not policy, and oMLX is already a gated candidate for the Stack (memory notes). None knows people, ages or tiers, so the policy stays ours. Considered and rejected: a scheduling library (vLLM, Triton and YARN are servers or clusters, not embeddable, and chat rule 11 allows only our own tested Stack components to run models); a second queue (org principle 1). Built on what exists: the profile table is validated against the TIER-STACK-01 resolver and Stack `lib/governor.ts` figures; `scoreJobs` replaces the ordering inside `backend/src/lib/jobs/householdQueue.ts`, not a new queue; the quiet window lives in that Home queue. The Priorities panel is drawn as data by `SettingsShell` (rule S4). If the spec or kit has no reorderable-list control, rule 9(c) applies: a kit change lands in `commons` first (own worktree; Jesse says yes to any tag). Shipped kit controls checked first in TIER-PRIO-02.

## 9. Rules check

Rule 8 (minors): profiles never raise a minor above their ceilings and Reduced chat keeps the fail-safe for minors. Age and surface gates first. Status reuse (S6): no new surface. Chat strict priority is the 2026-10-21 ruling. No limit destroys work: S2 goes ahead after 10 minutes at a turn boundary, with chat still answering on Reduced. No privacy impact: all signals (who chatted in the last minute) are in-memory counters inside Home, never stored or shown by name to others.

## 10. Decided and open

Decided (Jesse, 2026-10-30): the profile table replaces the solver; the names stay Reduced, Standard, Boost, Max; chat is never paused, only lowered to Reduced, and a waiting job goes ahead after 10 minutes.

Open: quiet window default 60 s (admin-editable); strict categories beyond chat: none by default.

## Supersedes

Changes these decided rules (the older notes get a pointer when this lands):

- `memory-management-2026-10-25.md` Q2 (fixed class order) becomes the section 4 score, chat and voice staying strict first.
- Q3 (round robin by person) becomes the tie-breaker (R2).
- Q5 (aging moves up one class, once) becomes smooth aging, +1 per minute, capped at the next class's gap.
- `resource-tiers-2026-10-27.md` section 7.2 ("Q2 stands") is replaced by section 4 here.
- Tiers section 2a rule 1 (Reduced only when a Max job does not fit) widens: the profile table may lower categories for any lead job (section 3).
- Tiers section 2a rule 2 ("no setting that turns a category to Reduced") changes: an admin edits the profile table, whose chat cell may be Reduced. A person still cannot choose Reduced.
- Tiers section 2a ("ends when the Max job ends") widens: P2 and S4 keep chat Reduced across stages and chained jobs inside one window.
- Tiers section 2a rule 6 (wait for the in-flight turn, then swap) adds the quiet window (S1), and a waiting job goes ahead after 10 minutes (S2), where the tiers note waited.
- Tiers section 7 T1 (Standard jobs of different categories may run together if they fit) is overridden by a profile row that queues a category (for example Video Boost queues music).
- Tiers section 7 T6 (Standard jobs that fit run during a Chat Max lease) is overridden by the Chat Max row, which queues pictures, video and music.
- TIER-HOME-01's fairness rules (T4 b, c) are replaced by TIER-PRIO-06.
