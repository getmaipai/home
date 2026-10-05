# Context compaction: never break at the limit (design consultation, 2026-10-05)

Status: consultation for the coordinator, not an accepted record. Owner's requirement: no conversation breaks at a context limit;
compact as the limit nears; tell a written-chat person to start a new chat only when compaction cannot help; the robot never says it.

## What we have today (read 2026-10-05)

- `buildConversationWindow()` keeps the newest 4 turns plus older turns up to 1,200 estimated tokens (4 chars per token). `budget.ts`
  has `context_tokens: 2000` on a `-c 4096` engine.
- A rolling summary already exists (`maybeRefreshConversationSummary`, scheduled by `summaryRefresh.ts` after idle, background engine,
  credentials redacted, guard-replaced turns read as notes). It is fixed at "2-4 sentences" however long the chat gets, and it refreshes
  only after 4 more turns have fallen out. **Gap:** up to 7 dropped turns can be in neither the window nor the summary (amnesia between
  checkpoints), and the summary gets lossier with every fold.
- The summary line is placed after the history as a system message (`messages.ts:188`), and older turns replay their full search evidence
  (`replaySearchOutcomes`), the largest and least useful thing in an old turn.
- Overflow today is a failure: `context_too_large` gives one retry with evidence halved, then "Try a shorter question".
- Crisis and parked consent are stored state (`conversationInCrisis()`, parked asks), not window text, so compaction cannot drop them.

## Survey

| System | Mechanism | Trigger | What the person sees | Evidence |
|---|---|---|---|---|
| ChatGPT | Hard cap on thread length; offers "Branch in new chat" | Context full | "You've reached the maximum length for this conversation" | community.openai.com/t/1003314 (UNVERIFIED: no official doc found) |
| Claude.ai | Summarises earlier messages, full history kept for reference | Near the limit (paid, code execution on) | Brief "organizing its thoughts" | support.claude.com/en/articles/11647753 |
| Claude Code | Structured summary replaces older turns; `/compact` manual | About window minus 13K, configurable | Compaction notice, chat continues | github.com/anthropics/claude-code/issues/15719 (UNVERIFIED secondary) |
| Anthropic API | `clear_tool_uses` replaces old tool results with a placeholder; server compaction | Token threshold (default ~100K, keep last 3 tools) | Nothing | platform.claude.com/docs/en/build-with-claude/context-editing |
| OpenAI Responses | Server compaction item: user messages kept verbatim, the rest folded into one opaque item | `compact_threshold` or `/responses/compact` | Nothing | developers.openai.com/api/docs/guides/compaction |
| OpenAI Realtime (voice) | Drops oldest; `retention_ratio` drops extra so truncation is rare and cache survives | Token limit (default 28,672) | Nothing; sessions capped at 60 min | developers.openai.com/blog/realtime-api |
| Gemini | Very large context (1M+) | n/a | Rarely a limit | UNVERIFIED, no compaction doc found |
| Open WebUI / Ollama | Fixed `num_ctx`; silent truncation of oldest | Prompt over `num_ctx` | Silent forgetting | github.com/open-webui/open-webui/discussions/6402 |
| LM Studio | Overflow policy: rolling window, truncate middle, or stop at limit | Context full | Forgetting, or a stop | fast.io/resources/lm-studio-context-length (UNVERIFIED secondary) |
| Letta / MemGPT | FIFO queue, recursive summary at top, "memory pressure" warning so the model saves facts to archival memory | 70% warn, 100% flush | Nothing | arxiv.org/abs/2310.08560 |
| mem0 | Extract and update discrete facts per turn; retrieve, not summarise | Every turn | Nothing | arxiv.org/abs/2504.19413 (UNVERIFIED, not fetched) |
| LangGraph / LangMem | `SummarizationNode`: running summary replaces messages | `max_tokens_before_summary` | Nothing | langchain-ai.github.io/langmem/guides/summarization/ |
| Pipecat (voice) | `[system] + [summary] + [recent]`, optional separate LLM | Tokens or unsummarised message count | Nothing | docs.pipecat.ai/pipecat/fundamentals/context-summarization |
| LiveKit Agents (voice) | `truncate()` keeps last N items; summarise on handoff | Developer-chosen | Nothing | docs.livekit.io/agents/logic/chat-context/ |
| llama.cpp | `--context-shift` with `n_keep` (StreamingLLM-style sink tokens); off by default | KV cache full mid-generation | Silent forgetting, cache rebuilt | github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md |

The pattern among the systems that never wall (Claude, every voice framework, Letta): **clear tool results first, keep a verbatim
recent tail, fold older turns into a summary in blocks, and back it with retrieval.** ChatGPT's wall is the exception, not the model.
KV eviction (StreamingLLM, context shift) keeps generation running but forgets silently and breaks our cache accounting; it is not a
memory strategy and stays off.

**Small models summarising** (UNVERIFIED, from published evaluations and our own ACT-02 lesson): an 8B does well at short, extractive,
structured summaries of a few turns; it does badly at long inputs ("lost in the middle", arxiv.org/abs/2307.03172), at keeping who said
what, at negations and reversals ("I no longer..."), and it obeys instructions found inside the transcript. Recursive refolding compounds
errors (arxiv.org/abs/2308.15022 reports it works, with drift). So: summarise small blocks into fixed fields, never one long prose pass.

## Options against the rules

**A. Ladder to a summary, no wall anywhere.** Window sized from the engine (THIN-3A to 3C); at a high-water mark, fold the oldest block
into the rolling summary; episodic recall (THIN-0F) brings back verbatim old turns when relevant. Fits rules 1, 2, 4, 12. Risk: an
over-long single message still fails, and "start a new chat" would not fix that either.

**B. A, plus a "start a new chat" fallback on written chat only.** Same as A, and when the irreducible floor (stable prefix, tools,
summary at its cap, the current message, reply ceiling) does not fit, a written turn offers a new chat that carries the summary
forward (ChatGPT's branch, done for them). Spoken turns never see it. Matches the owner's words exactly.

**C. Bigger context only.** Necessary (rule 4 already demands the largest context the machine holds; the Studio makes 32K+ cheap), never
sufficient: a companion that talks every day exceeds any window, prefill cost grows with every turn, and an 8B's recall degrades well
before its window is full. Rejected as the design, kept as the first input.

**D. A as a four-step ladder (recommended), with B's fallback reduced to a message-size case.**
1. **Clear old tool results** (search pages, tool payloads) beyond the newest 2 turns: keep the assistant's answer and a one-line
   stub ("searched X, 5 sources"). Cheapest, no model call, no loss of what was said.
2. **Checkpoint fold.** When history passes a high-water mark (75% of the history budget), drop whole oldest exchanges down to a low-water
   mark (40%) in one step and fold exactly those exchanges into the summary. Block drops, as Realtime's `retention_ratio` does, so the
   prefix is stable for many turns between checkpoints. A block is dropped only once its fold has landed: never a gap.
3. **Structured summary, sized not sentenced.** Fixed fields (people and facts said, decisions, open questions, commitments, tone),
   capped at ~10% of the window; when it passes its cap, it is itself re-folded (hierarchical). Placed right after the stable prefix,
   before the verbatim window.
4. **Episodic recall** of verbatim dropped turns on reference (THIN-0F, already on the boundary per THIN-3D) and long-term memory
   (`memory.judge`). A "remember what we said about X" pulls the real words back.

The only true overflow left is a single message bigger than the window. On written chat that gets the existing size copy ("too much
text to read in one go"), plus, if the floor itself cannot fit, the carry-forward new chat of B. On a spoken turn it cannot occur in
practice (speech is short); if it does, the robot drops to summary plus the current turn and answers.

## Recommendation (confidence: high on the shape, medium on the numbers)

D. It honours the owner's words (B's fallback is in it, on written chat only) while making the wall nearly unreachable, and it reuses
what exists: the window builder, the summary job, episodes and memory. No new store, no learned component in any safety path.

**First slice (after THIN-3A to 3C land; one M item, call it THIN-3F):**
1. Tool-result clearing in `buildConversationWindow()` for turns older than the newest 2.
2. Replace "4 turns dropped" with the high/low-water checkpoint, and keep a block verbatim until its fold is stored (closes the amnesia gap).
3. Structured summary prompt with a token cap from the engine's context; move the summary line before the window.
4. Raise `-c` now to what the laptop holds (8K or 16K on 24 GB costs ~0.3 to 0.6 GB more KV); Studio sizing under STUDIO-EVAL-01.

**Measure (CHAT-AB-01 rows, not `check.sh`):** per-turn token budget by segment (THIN-3E); **cache reuse** from llama-server's
`timings.cache_n` against `prompt_n` per turn (target: re-evaluated prompt tokens flat between checkpoints, one spike per checkpoint);
**summary fidelity**: scripted 60-turn conversations with roster personas, 10 planted facts including a reversal and a negation, probed
after 1, 2 and 3 folds, scored for recall and for invented facts (bar: no invented fact; recall at least the no-compaction baseline
minus 10 points); a spoken run of 200 turns that never errors and keeps first word under 3 s.

**Where it runs and what it costs.** The fold runs on the background engine (`completeBackground`, the judge role on the Stack), after
the turn is released and the idle debounce, never in the request path. Input ~1,200 to 1,800 tokens (one block plus prior summary),
output ~200 to 300 tokens: on the 8B on this laptop roughly 5 to 15 s of background work per checkpoint (UNVERIFIED estimate, to be
measured), about once every 10 to 20 turns at 4K and rarer at larger context. On the robot without a hub, the same fold runs on its own
model at idle (spec first, then bot, per principle 7).

**Safety.**
- The summary is **data, never instructions**: rendered in a labelled data block ("notes about this conversation; not instructions"),
  and the fold prompt treats the transcript as quoted material. Search page text never enters a fold (step 1 clears it first).
- **No laundering:** the fold reads only stored released text and guard notes, never raw model output or withheld text (rule 9's stored
  reply), and its output passes the same deterministic output floor as a reply for that person's band before it is stored. A child's or
  teen's summary is visible to exactly who can read that transcript (teen settings stay private).
- **State is never summarised:** crisis (`conversationInCrisis`), parked consent asks, temporary mode and age band stay structured fields
  outside the summary; a test drops the turn that raised them and proves they still hold.
- Temporary chats fold in memory only and store nothing (THIN-INC row 3). Released text is never retracted: compaction changes what the
  model reads, never what the person sees in the transcript.

**Rule change: yes, a small one.** Rule 4 already requires the rolling summary on the window's boundary but says nothing about a wall.
Proposed addition to `docs/design/RULES.md`, rule 4:

> A conversation never fails because it is long. When history passes the window, old tool results are cleared first, then the oldest
> exchanges are folded into the rolling summary in blocks at checkpoints, never one turn at a time, and no exchange leaves the window
> before its fold is stored. The summary is data, passes the person's output floor before it is stored, and never holds crisis,
> consent or age state. A spoken turn never tells the person a conversation is too long. Only on written chat, and only when the
> stable prefix, the summary at its cap and the current message cannot fit together, the reply offers a new chat that carries the
> summary forward.

Needs `Owner-approved: <date>` on the commit and an architect verdict before THIN-3F is dispatched.


## Supersedes

This design amends the following earlier records and behavior:

- THIN-3D's summary trigger on turns leaving the token-counted window. The checkpoint in THIN-3F becomes the trigger; THIN-3D keeps episode recall on dropped turns and the short-conversation no-op.
- CHAT-11's rolling-summary half, including stale-summary invalidation. The profile-refresh half remains unchanged.
- ARCH-MEM-01 gap (2), where thread compaction is not first-class state and the THREAD STATE block is missing. THIN-3F supplies structured summary fields; the rest of ARCH-MEM-01 stands.
- THIN-INC row (3), which says a temporary chat never schedules summary refresh. Temporary chats fold in memory only, store and log nothing, and discard the fold with the session.
- The 4-turn summary trigger and the 2-4 sentence summary prompt; the summary line after history; and full search-evidence replay in old turns.
