# One sticky-tier lease for every feature that degrades others (2026-11-22)

Owner brief, 2026-11-22: a tier that makes other people's work slower or held (Max coding, Max chat, Boost, a long video run) is one shared mechanism, not a Code feature. The creator gets a calm, honest experience; the people queued behind get one too. Written after a read-only review of the lease, queue and coding-turn code (paths below). Everything here is one definition (platform principle 1): Code, Chat, video, pictures and music are clients of it.

## 1. What exists and what is new

| Piece | State |
|---|---|
| Engine swap and idle release for Max chat (`backend/src/lib/chatLease.ts`, `chatLeaseRuntime.ts`, `routes/aiTiers.ts`) | Built. Grace is a fixed 3 minutes; any person's chat turn renews it; `tick()` cannot see waiters; `pinned` (admins) has a 4-hour idle cap and no UI |
| Household queue, holds, copy (`lib/jobs/householdQueue.ts`, `lib/jobQueueCopy.ts`) | Built. `max_chat` jobs are held whatever their score; a running Boost turn holds other Boost jobs (`heavy_slot`) up to 30 minutes. The state names `held_coding` and `paused` exist but nothing sets or acts on them |
| Code turn takes its tier at submit (`lib/codingTurns.ts` `startTurn`) | Built. Chat's `maxChat.ts` `confirm()` takes the lease before Send (differs) |
| Composer notice line (Chat: `chatThreadSlots.tsx`, `useChatAvailability.ts`; Code: a plain span) | Chat built, Code stub, one action only |
| Engagement signal, waiter-aware grace, holder-only renewal, wait estimates, Pause, multi-action line, a lease for categories beyond chat and coding | New |

## 2. The rule (one policy, `lib/tierLease/policy.ts`)

A degrading tier is held only while its holder has a job running or queued on it, or acted within the grace. The grace is long while the lease holds nobody's job and **zero once a job is held** (owner, 2026-11-22: nobody sits waiting on an idle timer). Only the holder renews it. It ends only between jobs. Every take, including a wake, is a queue job and never preempts.

- **Degrading is defined by holds, not tier names.** A tier counts when its lease makes the queue hold or reduce another job (`max_chat` holds, `heavy_slot`, chat on its simpler model). Boost counts. Standard holds nobody and needs none of this.
- **Nothing switches before submit.** Choosing a degrading tier shows the line (section 5); the lease is taken when the person sends. Chat's `confirm()` moves to submit.
- **Released while idle and someone waits:** released at once. The only wait left is the model swap, shown with its measured time. A key pressed in the last 10 seconds is finished first (the one protection).
- **Nobody waiting:** held through the grace (defaults: coding 10 minutes, media 2 minutes, set per client). The first keystroke or attachment wakes it (`touch`). No tab-presence tracking; a closed tab simply stops renewing.
- **Running turn or job:** never cut off. The holder is offered Keep going, Use a lower tier (at the next step), and Pause (at the next safe step; state kept; Resume is a queue job). A yield gives the holder aging priority back after the waiting job.
- **Batches:** a unit is one scene, one video, one test run, one turn. The lease can be yielded at a unit boundary; the line says "Pausing after this scene so a picture can run." Waiver: the existing `pinned`, now with a visible switch for admins, per person or per session.
- **Pinned waits are bounded.** Behind a pinned lease a waiter gets a wait estimate, and after 10 minutes is offered Standard now or to keep waiting.

## 3. Signals (the policy reads only these)

`holder_jobs` (queue: running or queued on this lease), `waiters` (queue: jobs held by this lease, counts and kinds only, rule 6a), `last_engaged_at` (set by `POST /api/tier-leases/:key/touch` from the composer, once per 10 seconds at most), `pinned`, and `remainingSeconds` (new on every job record, so the queue can say how long). `typicalSeconds: 120` on coding jobs without a remaining time is the gap that leaves waiters without numbers today.

## 4. Where it lives (not in a feature)

- Backend: `lib/tierLease/` (policy, registry of lease keys, API `routes/tierLeases.ts`: view, touch, yield, pause, resume, release). `chatLease.ts` stays as the engine-swap driver for the chat key; the policy decides, the driver swaps. Queue integration in `householdQueue.ts`. Words in `lib/tierLeaseCopy.ts` (reason codes, one short sentence about 40 characters, adult and child forms, as `jobQueueCopy.ts`).
- Frontend: `frontend/src/shell/tierLease/` holds `useTierLease(key)`, `TierLeaseNotice` (the one look, reusing Chat's LED dot, tooltip and Repairs link) and a notice value that carries a list of actions. Chat, Code and the media apps mount it; a feature adds only its own lines (Code: sandbox, network, git connection) beside it, through the same value type.

## 5. The two experiences (all in the notice line under the composer)

Holder: "Max switches off when you stop. It comes back when you type, about 40 seconds." Someone waits: "1 picture is waiting. It runs after this step, about 2 min." with **Keep going**, **Use a lower tier**, **Pause**. Paused: "Paused so a picture can run. Resume". Released while idle: "Max was released for a picture. It switches back when you type." A notification when they are on another page. Waiter: "Waiting for a coding job to finish, about 2 minutes." with, when pinned and past 10 minutes, **Use Standard now**.

## 6. Rules compliance (architect objections, 2026-11-22)

- **Rule 6a:** every line, queue entry and the admin view carries kinds and counts per lease key only, never a person, a title or an id next to activity. A per-person pin is listed in Settings' existing people list, not in an activity view. A locked or adult-only job is counted as "a job"; a child waiter reads the child form.
- **S6 (no new status surface):** the notice line is a new row of the S6 table (data source `tierLease`) and the away-notification is one type declared in `lib/notificationTypes.ts`, both added in TIER-LEASE-04.
- **Grants:** "Use a lower tier" and "Use Standard now" go through the existing tier grants and can only lower. `touch`, `pause`, `resume`, `yield` and `release` check the caller is the holder; only an admin sets or clears a pin.

## 7. Decisions recorded

Release at once when idle and someone waits (owner, 2026-11-22). Boost follows the same rule, and a pinned lease gives waiters a bounded wait: both are the review's recommendation, taken when the owner said "build out" on 2026-11-22 without answering those two questions. Either can be reversed in one row.

## 8. Build order

TIER-LEASE-01 to 07 in `docs/BACKLOG.md`. CODE-UX-09 to 11 become the Code client of them.
