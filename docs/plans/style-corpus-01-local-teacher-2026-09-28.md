# STYLE-CORPUS-01b: point the voice-rewrite teacher at the household's own local 27B model, not Anthropic

## Why

Jesse decided tonight (2026-09-28): no Anthropic API key, ever - that stays
permanent, not a one-night gap. `backend/scripts/voice/corpus.ts` (landed
`ad62a1fb`, "built, not yet accepted" per `docs/BACKLOG.md`) currently calls
`anthropic.messages.create()` with `claude-haiku-4-5` as the rewrite
"teacher" that turns the local 8B chat model's plain answer into a
companion's voice. That call is the one thing standing between "built" and
"accepted" - it needs a credential that will never exist here.

The household already runs a genuinely bigger local model for exactly this
kind of "smarter model helps a smaller one" role: Qwen3.8-27B, served by
`maipai-chat.service` on the `maipai-home` laptop
(`192.0.2.52:8791`, OpenAI-compatible `/v1/chat/completions`, confirmed
live tonight after fixing an eGPU binding issue - see the coordinator's own
session for that history, not relevant to this item). Using it instead:
keeps the whole pipeline local (matches the product's own "nothing leaves
your house" promise better than a permanent cloud dependency ever would),
and is a natural extension of a judgment call the original build already
flagged in `docs/dev.md` ("the rewrite model is Claude Haiku 4.5, not a
bigger model" - now: a bigger model, but the household's own).

This is a code change to an already-built script, not a new design pass:
EVAL-03's own design pass (the LoRA-adapter mechanism) is untouched by this;
only the corpus-generation teacher model changes.

## Files you own

`~/Developer/github.com/getmaipai/home` (work in an isolated worktree,
`isolation: worktree`):
- `backend/scripts/voice/corpus.ts`
- `backend/tests/voiceCorpus.test.ts` (only if the swap changes anything the
  existing 17 tests assert on - most of them test pure functions untouched
  by this change; read the file first to confirm before touching it)
- `backend/package.json` (drop the `@anthropic-ai/sdk` dependency if this
  change removes its last use in the repo - grep first, don't assume)
- `docs/BACKLOG.md`'s `STYLE-CORPUS-01` row
- `docs/dev.md` (append, don't rewrite, the existing STYLE-CORPUS-01
  sections)

Nothing else.

## Steps

1. Read `backend/scripts/voice/corpus.ts` in full, especially the `run()`
   function's per-companion loop (~line 592 onward) and the
   `MissingCredentialError` class and its one throw site (~line 616-630).
   This is the exact code to change.
2. Replace the `Anthropic` client and its one call site
   (`anthropic.messages.create(...)`) with a plain `fetch()` (or the
   existing HTTP client pattern this codebase already uses elsewhere for a
   llama.cpp-compatible endpoint - check `backend/src/lib/llm.ts`'s own
   `complete()` for the house style, mirror it rather than inventing a new
   HTTP call shape) against an OpenAI-compatible `/v1/chat/completions`
   endpoint:
   - URL: `process.env.MAIPAI_VOICE_TEACHER_URL ?? "http://192.0.2.52:8791"`
     (an env var, not a hardcoded LAN address baked into the script -
     someone else's household will have a different one; document the
     default in a comment as "this household's local 27B lane", never as a
     general requirement).
   - Model: `"qwen38-27b"` (confirmed via `GET /v1/models` tonight), also
     overridable by env var for the same reason.
   - Request body: `{"model": ..., "messages": [{"role": "system",
     "content": rewriteSystem}, {"role": "user", "content": "Prompt: ...
     Neutral reply: ... Rewrite this reply now, following the brief
     exactly."}], "max_tokens": 1024}` - same system/user split the
     Anthropic call already used, just reshaped for chat-completions.
   - Response: `response.choices[0].message.content`, trimmed, same as the
     old `block.text.trim()`.
3. Replace `MissingCredentialError`'s one throw site with the equivalent
   "teacher unreachable" case: a fetch that fails outright (connection
   refused, timeout) or returns a non-2xx status. Keep the class (rename if
   the "Credential" name no longer fits - `TeacherUnreachableError` reads
   better) and keep the exact same guarantee the 2026-09-28 review already
   fixed: thrown once, caught once at the top of `main()`, so the isolated
   `MAIPAI_DATA_DIR` scratch directory is always cleaned up in the
   `finally`. Do not reintroduce the old bug (a `process.exit()` mid-loop
   that skips cleanup).
4. **This laptop's eGPU has a documented history of dropping mid-session**
   (`~/Developer/gitea/homelab/docs/hosts/maipai-home.md`, "the drop-off-
   the-bus investigation" - not this repo, read it for context only, never
   edit it). A run generating ~600 rows across 4 companions is hundreds of
   calls to this endpoint; if the link drops partway through, the honest
   behavior is: catch that failure the same way as any other teacher
   failure (log it, do not silently retry forever), and make sure whatever
   progress was made before the drop is not silently discarded - if the
   script doesn't already checkpoint progress to disk per companion as it
   goes (check: does it write each companion's corpus incrementally, or
   only at the very end?), add that now, since redoing 600 already-good
   rows because row 601 hit a dead GPU would be wasteful and is a real risk
   tonight specifically. Do not add retry/backoff logic beyond what
   already exists elsewhere in this file for the chat engine calls - mirror
   whatever pattern is already there, don't invent a new one.
5. Update `docs/BACKLOG.md`'s `STYLE-CORPUS-01` row: remove the "blocked on
   Jesse making an ANTHROPIC_API_KEY... available" line, replace with
   whatever the real outcome of running this for real turns out to be (see
   Steps 6-7).
6. Actually run the corpus builder for real this time
   (`bun run backend/scripts/voice/corpus.ts` or however it's invoked -
   check `backend/package.json` for the actual script name) against all
   four bundled companions, now that the teacher endpoint is live. Record
   the real drop rate per companion in `docs/dev.md` (the acceptance
   criterion this item has always had: "four corpora built, drop rates
   under 20 percent each"). Commit the 20-row sample fixtures per companion
   under `backend/scripts/voice/fixtures/` as the item always specified -
   remove any placeholder/empty files a prior smoke-test run left behind
   first (check `git status` for stray files before committing).
7. If a drop rate comes in at or over 20%: that is a finding about the
   brief (per the item's own acceptance text: "a higher rate is a finding
   about the brief, reported, never a relaxed validator"), not something to
   quietly work around. Report it plainly in dev.md and in your done
   report; do not touch the validator's thresholds to make numbers pass.
8. If the eGPU drops mid-run despite step 4's checkpointing: stop, report
   the real state (which companions completed, which didn't, the exact
   error), and do not mark the item accepted with a partial or padded
   corpus. A partial result with an honest status beats a fabricated
   complete one.

## Acceptance evidence

- The real corpora built for all four companions (or an honest partial
  report per step 8), with real drop rates in `docs/dev.md`.
- The 20-row sample fixtures committed per companion.
- `docs/BACKLOG.md`'s row updated to reflect the actual outcome (accepted,
  or still open with the real blocker named if the eGPU dropped mid-run).
- The existing 17 tests in `voiceCorpus.test.ts` still pass (most are
  unaffected; confirm, don't assume).

## Exit checks

- `bash scripts/check.sh` green, scope noted.
- Code review at low effort (a scoped HTTP-client swap plus a real data
  run, not new logic shape) with an explicit target (`main...HEAD` in your
  worktree).
- One commit for the code change, staged by name. The doc updates
  (BACKLOG.md, dev.md, fixtures) can be the same commit or a follow-up -
  your call, but state which in the done report.
- Push once green.

## Reporting

Ready, then wait for start. Done: commit hash(es), check.sh pass line, the
real drop rates per companion, whether all four completed or the eGPU
interrupted it (and where). Blocked: exact error - if the teacher endpoint
is unreachable when you start, confirm with `curl -sf -m 5
http://192.0.2.52:8791/health` before reporting blocked, since this
laptop's eGPU is known to be flaky and may need another wake cycle (ask the
coordinator, don't try to SSH into laptop infrastructure yourself - that's
homelab access, out of scope for this item). Question: only if the
chat-completions request/response shape genuinely doesn't match what's
documented above once you try it for real.
