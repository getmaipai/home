# Chat memory yields to generators (2026-10-27)

Owner-approved: Jesse, 2026-10-27 (chat), for video jobs only. Edits RULES.md rule 4 (chat turn, "The window is the model's real context").

## Why

On 2026-10-27 the Qwen3.8-27B chat model held 37.9 GB (the Stack had admitted it for 29.9 GB). A "detailed" video job (46 GB
peak plus a 10.2 GB reserve) waited for memory that never freed, while nobody else used the computer. The resource order is
chat, then pictures, then video, and "queue, never raw errors". A video that cannot start because chat holds idle memory
breaks the second half of that.

## Design

1. The Stack already bounds what chat holds (the host prompt cache, one slot, eight recurrent snapshots) and admits it for
   everything it uses (Stack `086b5fb`).
2. When a video job is held for memory and chat is idle, the Stack frees chat's host caches first. If that is not enough,
   it restarts chat once at a smaller context, never below 32768 tokens, and restores the full context when the job ends.
   Idle residents that are not reserved (voice out, the judge) are unloaded first, in resource order.
3. Home needs no change for a smaller window: history is sized from the engine's reported per-slot context (rule 4), and
   folding into the rolling summary already happens at checkpoints. A conversation never fails or loses history because the
   window shrank.
4. The waiting job says "Waiting for memory" and why, never "You are next" (Home `c73ba6c1a`).

## Supersedes

- `memory-management-2026-10-25.md`, the class table (section 4.1): chat "never evicted for a job" now has one exception, a
  restart at a smaller context while a video job is held, restored afterwards. Chat is still never evicted.
- `memory-management-2026-10-25.md`, the budget paragraph: "pictures never shrink the chat context" stays true; only a held
  video job may.
- `resource-tiers-2026-10-27.md`, section 5.1: "its context never breaks" stays true for the conversation (history is
  re-sized, nothing is lost); the engine's window may be smaller during a held video job.

- `resource-tiers-2026-10-27.md`, the line that says a generator tier never shrinks chat's window: it holds for pictures and
  songs; a held video job is the one exception.

## Not in this note

The five-layer long-term memory in the 2026-10-27 chat review (summaries, facts, search, transcripts) is an audit of what Home
already keeps, not a build; it needs its own note.
