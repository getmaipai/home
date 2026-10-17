# Instant mode on a model that always thinks (2026-10-17)

Jesse, live on the Mac Studio, 2026-10-17: "is Glimmer a thinking-only model? I can't change to Instant." Yes. This note
says what the control does today, what an honest Instant mode is, and the order to build it. It extends STACK-MUSE-01 (owner's
rule 2026-10-16: Muse Glimmer 30B is the chat model above 24 GB) and does not reverse it. Rules in
[RULES.md](RULES.md) govern; nothing here asks for a rule change.

## 1. What the control does today (from code)

The composer's trailing slot is `ComposerTrailingWithThinkingMode` (`frontend/src/apps/chat/chatThreadSlots.tsx`). Its mode
comes from `GET /api/host` `chat_capabilities.thinking` (`thinkingModeFor` in `backend/src/lib/modelCatalog.ts`), per model:

| Capability | Models | Before 2026-10-17 | Now (INSTANT-01) |
|---|---|---|---|
| `switchable` | Qwen3 8B (and the 4B, 1.7B) | Instant / Thinking dropdown, sends `enable_thinking` | Same |
| `always` | Muse Glimmer 30B, both builds | A static chip reading "Thinking", looks like a selector, does nothing, no reason | One plain line, "Thinks before every reply", no selector |
| `none` | models that never reason | A static chip reading "Instant" | Nothing |
| any minor | all | Hidden (rule 8, rule 2) | Unchanged |

So for Glimmer the control was a silent no-op shaped like a selector. That was the bug Jesse hit.

## 2. Facts measured on the Studio, 2026-10-17

Template (`/props` on the live Muse server): the only reasoning input is the text "Reasoning strength: X." in the system
message, `X` taken from `reasoning_strength`, default `high`. Any string is accepted, none is an off switch. The Stack launches
`{"reasoning_strength":"low"}` (`--chat-template-kwargs`); `enable_thinking` is ignored.

Own llama-server b10797 for Qwen3 4B (port 58123, killed afterward), the live Muse server read through its API with per-request
kwargs. The Studio was busy with other agents, so absolute numbers are inflated; the ratios are what matter. Median of 4 to 6.

| Run | "hello" first text | One-sentence fact first text | 3 dinner ideas, total |
|---|---|---|---|
| Muse, `low` (idle, single run) | 1.1 s | 2.4 s | 13.3 s (about 25 tok/s) |
| Muse, `low` (busy, n=6) | 2.3 s | 5.9 s | 21.4 s |
| Muse, `none` (busy, n=6) | 4.4 s | 3.7 s | 20.7 s |
| Qwen3 4B, `enable_thinking:false` (busy, n=4) | 0.03 s | 0.04 s | 7.8 s |

- `none` and `minimal` are not a real off. On "hello" and the fact question Muse still reasoned in 6 of 6 runs at both
  settings; on the long prompt it skipped reasoning in 4 to 5 of 6 runs at `low` and `none` alike. Muse decides by prompt,
  not by the word. Option (c) is rejected.
- The first-chat 23 s Jesse saw is not the reasoning: an idle warm Muse answers "hello" in about 1 s. That is load and prewarm,
  which another lane owns.
- Qwen3 4B answers short turns in tens of milliseconds, 40 to 100 times sooner than Muse, with no reasoning stream.

## 3. Options

**(a) Hide and explain.** Done as INSTANT-01. Honest, but it leaves chatter, short answers and voice waiting on a 30B that
reasons first.

**(b) A second small model for Instant.** The Qwen3 4B Q4_K_M judge is already resident on every tier from p32 up
(`PROFILE_MODEL_BINDINGS` in the Stack, p32, p64, p128), 3.76 GiB, already loaded, and Qwen3 takes `enable_thinking:false`.
Reusing it costs no extra memory. Nothing new is kept warm on a small machine: p16 runs the Qwen3 8B, which is `switchable`
and keeps today's control, so Instant there is the existing toggle. A separate 1.7B is not needed.

- Trigger: an explicit person-facing toggle, not a router. A router that reads message wording to pick a model is a
  classifier on open-ended text and sits against rule 1's intent; a learned router is a separate design with its own bench.
- Safety: age and surface gates outrank it (rule 0). Instant is adult and written-chat only; a child or teen never sees it and
  always runs Muse on the existing minor path, so a smaller model never weakens a minor's floor (rule 8). The output gate and
  the check-as-it-arrives gate apply to every reply the same way.
- Tools and search: the 4B has no tool-decision record. By rule 8 it gets the no-tools fail-safe until a CHAT-AB-01 style row
  exists for it (rule 3: evidence recall, false searches, at least 3 repeats, plus reply quality and repetition). Until then an
  Instant turn does not search and, per rule 6, says in its own words that it did not look anything up; a person who wants a
  search switches to the thinking model, or the search control (an explicit request) routes the turn to Muse.
- Quality tradeoff: a 4B is weaker at long reasoning and instructions. Instant is for chatter, short answers and quick
  rewrites, never for the person's long or sensitive questions. The toggle's label says so.
- Memory and context: no new resident weights; the judge runs with a 40960 window, so Instant history is windowed to that
  (rule 4, per slot) and the turn falls back to Muse when history would not fit.
- Contention: the judge also does background memory work. Instant turns take the judge slot ahead of background work, or the
  Stack gains a second slot; INSTANT-02 measures it.

**(c) Lower `reasoning_strength`.** Rejected by the measurement above. `low` stays (STACK-MUSE-01).

## 4. Recommendation

Ship (a) now, build (b) in four small slices, drop (c). Voice is the decision only Jesse makes: "nothing here changes how a spoken
turn is shaped" (rule 0), and moving voice turns to a 4B changes the voice. Decided by Jesse, 2026-10-17: voice turns do NOT use Instant yet; they stay on Muse until INSTANT-05
is decided after a spoken-turn repetition measurement exists.

## 5. Backlog rows

INSTANT-01 (this slice, built), INSTANT-02 (built in the Stack 2026-10-17, `90dfab5`: the existing `judge` role is the target, no new route; contention measured, first text 0.03 to 0.13 s beside a background generation),
INSTANT-03 (catalog record and bench for Qwen3 4B as the Instant chat model, rules 3 and 8), INSTANT-04 (the adult Instant
toggle on an `always` model, routes the turn, falls back to Muse, label states the tradeoff), INSTANT-05 (voice decision).

## 6. Architect verdict

Self-review against RULES.md; no `architect` agent exists in this checkout (`.claude/agents` is absent), so this is a checklist
verdict, not the agent's. INSTANT-01: APPROVED (removes a dead selector, touches no turn behavior, no minor path, no rule).
INSTANT-02 to 04: APPROVED in design provided the minor gate and the rule 3 bench stay as written. INSTANT-05: NEEDS the
owner's decision (rule 0, spoken turn shape).
