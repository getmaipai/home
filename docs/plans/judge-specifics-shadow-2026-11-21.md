# Made-up-specifics check, shadow only (JUDGE-SPECIFICS-01)

Status: proposal for the architect gate, 2026-11-21. Source: the read-only review of the 4B judge ("expand the 4B judge, how").

## Problem
A reply that states names, figures or dates with no basis in the turn (no tool outcome, no injected memory) is the most common way a chat model invents things. The tools-off bench showed the new fast chat model (Qwen3.6-35B-A3B) inventing a book author and a game result in 4 of 14 truth cases; with search on it invented nothing in 34 cases, so the live rate is small and currently unmeasured. Home has no measurement of it at all. The only in-turn judge use today is the claim check on Thinking and Max replies that have sources (`nodes/answer.ts`, `research.ts`).

## Change
After a reply is released, when the turn had no tool outcomes and the reply has a fact cue (`hasFactCue`, `fabrication.ts`), ask the small judge one question and count the result. Nothing else.

- **Sees:** the person's question, the reply, and one boolean: whether memory was injected into the turn.
- **Returns:** exactly `{"specifics_without_basis": true|false}`. No category, no text.
- **When:** after the reply is released to the person; on a spoken turn after speech has started. Never before first sound, never in the reply path.
- **Effect:** none on the turn. It does not block, rewrite, delay, add a note, or trigger a search (rule 1 stays: a verdict never triggers a search). It increments a counts-only counter beside the search assist's counters (`lib/searchAssist/counters.ts` pattern): total checked, flagged, unavailable. No text, no ids (rule 6a).
- **Call:** `completeBackground` directly, as the claim check does, not `completeWithFallback`: the chat fallback would take the chat slot and cost the next turn its prompt prefix. Fixed instruction first, variable text last, `max_tokens` 40, non-thinking, 1500 ms deadline, fail open (slow, unavailable or unparsable counts as "unavailable", changes nothing).
- **Switch:** its own household key `chat.specifics_check` (`off` or `shadow`, default `shadow`), defined in `backend/src/settings/aiKeys.ts`, with its own help text. It does not reuse `chat.search_assist`, whose meaning is only the search assist (architect condition, 2026-11-21).
- **Scope:** adult speakers only, as the claim check is (`answerStyleFor`, `research.ts:21`, gives every non-adult, bare or spoken-unknown turn the instant style). Child, teen, unknown speaker and robot turns are never sent to the judge (architect condition 1).
- **Counters:** a sibling `lib/specificsCheck/counters.ts` with the same closed-list pattern and a `specifics_check.` prefix; no per-band keys; read through a counts-only operator route (`routes/operator.ts`).

## Rules this touches, and why it complies
- Rule 0 (age and surface gates): no effect on any reply, so nothing is loosened.
- Rule 1 (model decides): the judge never decides or triggers a search or tool; it only counts.
- Rule 3 (no model-specific code): the judge is the Stack's `judge` role by name; no model name appears.
- Rule 6a (logs): counts only.
- Adult content: the check has no content category and never blocks or rewrites, so it cannot become a censor.
- Voice latency: runs after first sound; the single chat engine slot is untouched.

## Measure before it counts as useful
Pass thresholds (set by the review): fires on at least 3 of the 4 tools-off new-model fabrications (t1, t2, t3, t14); at most 2 false fires across the 54 replies (the 4 dense truth replies plus the 40 conversation turns); on 20 new cases at least 8 of 10 invented caught and at most 1 of 10 real flagged; judge p95 under 1500 ms. Unmeasured today: the 4B's real latency in the Stack and whether it has its own engine. If it misses the thresholds it stays off.

## Not in scope (decided in the review)
Tool-skip detection (rule 1), reply-length nudges (rule 5), a 4B tool-argument check (grounding in `policy.ts` already does it in code), an empty-result guard (landed in 10285f9ae).

## Supersedes
Nothing.
