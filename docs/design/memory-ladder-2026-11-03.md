# The memory ladder: the running job goes last (MEM-LADDER-01, MEM-RETRY-01)

Status (2026-11-03): decided by the owner, built on the Stack worktree and in Home, not yet on `main`. Items: MEM-LADDER-01 (Stack
watchdog) and MEM-RETRY-01 (Home restarts a video the watchdog stopped). Amends
[resource-management.md](resource-management.md) R6, adds R14 and R15, and extends [resource-tiers-2026-10-27.md](resource-tiers-2026-10-27.md).

## Why

On 2026-11-03 the watchdog went critical (41 GB available, 10 GB reserve) while nobody was chatting, cancelled the running video and
evicted the judge six seconds later. The person saw "I couldn't make that video. The job stopped before it finished." Owner's
ruling (Jesse, 2026-11-03): "its supposed to smartly allocate resources depending on demand. yes chat is priority but no one was
chatting and I would have expected it to put chat in reduced mode."

## Decision

1. At CRITICAL the Stack gives up the running job last. One step per round, in order: unload idle workers and the idle voice engine;
   evict the idle judge; put chat on Reduced only when nobody has used chat, speech or voice for 2 minutes and the newest raw reading
   (without the ladder's hysteresis) is still critical; wait 10 s after any step that freed memory and re-read; only if the raw reading is
   still critical, cancel the running job (video first, then the rest as before; a song or a tool job after a video, by the existing order).
2. A chat turn in flight wins. Reduced is not entered, or its swap answers `waiting` and is tried once more; the job is the one that yields.
3. Reduced is one state with holders: Home (`POST /stack/v1/tiers/reduced`), the Max window and the watchdog. A leave, or the 30 minute
   lease cap, drops only its own holder (Home's and the Max window's holds expire without renewal; the watchdog's hold ends by its restore, after
   the level has been `normal` for a minute with no turn running). Chat returns to the full model when no holder is left.
4. The code `memory_cancelled` is for video only (state `cancelled`, or `failed` for a Max clip). Pictures and songs keep `no_memory` on a
   `cancelled` job and their existing restart (`pictures/jobs.ts`, `music/jobs.ts`); they are not changed here.
5. Home restarts a stopped video by itself with the same stored body (seed, level, words, audience, styles, adult mark and lock), at most
   twice (`requeueAfterCritical`). While the Stack still refuses new work with `no_memory` the job waits (`holdMaxAfterMemoryRefusal`), it
   does not fail. A person's Stop is never retried. After the third stop the card shows the plain failure with Try again; a child's card shows the child line.
6. What a person sees: the job card and the Create feed say "Your video stopped for a moment so chat could keep going. It will start again by itself."
   (child: "Your video will start again by itself."); the composer shows its existing Reduced line, because
   `roleHealth` reads the Stack's own `reduced_chat`. No banner, toast or poll is added (S6). No line says memory, RAM, swap or room.
7. A chat turn that arrives while the watchdog's swap runs waits for the chat role to start, the same path as a swap the Max window starts;
   a swap the watchdog starts shows through the Stack's role-state feed (cause `mode_change`), where a swap Home starts also shows "One moment" from `activeTransition`; both are existing composer lines. Not separately tested here (open item below).
8. The admin's Reduced switch (`engines.chat.tier.reduced`, default off) governs Home's Max window only. The watchdog's Reduced at CRITICAL is a safety step and does not read it; an admin who wants chat never to simplify turns the watchdog off (`stack.memory.watchdog`).

## Reuse check

The existing Reduced swap (`enterReducedChat`, `controlReducedChat`), `requeueAfterCritical`, `holdMaxAfterMemoryRefusal`, the
`JOB_QUEUE_COPY` table, `phaseLabel` and the composer's `tier_reduced` line. One new pure function, `criticalStep`.

## Rules check

Rule 0 (age and surface gates): the restart re-sends the stored audience and adult flags and the finished-clip check still runs. Rule 4: the Reduced
swap keeps the full context window. Rule 8 and tier rule 5: a minor's floor is Home's, each turn's budget follows the running model. S6: status through the
job record and the existing composer line. Owner rule on resource words: the lines above.

## Supersedes

- resource-management.md R6, old text "Chat is never shrunk or restarted for another program's memory": chat is still never restarted for another
  program's memory, but an idle chat may go to Reduced at CRITICAL whatever holds the memory (a swap, not a restart; a person chatting never loses the full model).
- resource-tiers-2026-10-27.md section 2a rules 1 and 2 (Reduced is engaged only when a Max job needs it and is Home's, set by the Max window): the watchdog is now a second holder (item 3).
- resource-tiers-2026-10-27.md old item 7 ("a candidate, not part of this note's scope") and T5's "the existing low-memory failure line".
- memory-management-2026-10-25.md section 4.1 ("reserved class never shrunk for a job"), which the tier note already relaxed for Max jobs: extended to watchdog CRITICAL, idle chat only.
- isolation-2026-10-18.md line 38, the CRITICAL order "cancel the running heavy job (video first), evict the judge": cancel now comes last (item 1).

## Open

- A test of a turn arriving mid-swap (item 7).
- `requeued_memory` is a shared reason; its new words say "your video" and only video reaches it today. Reword per kind when pictures or songs adopt it.
