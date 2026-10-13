# Search answer quality: the "Bring Her Back" turn (2026-10-13)

Diagnosis only. Turn `turn-uo4ikmaypk` (adult, written, local 9B model). The user described a horror film
(foster couple, a girl who cannot speak). The right answer, "Bring Her Back" (2025), was the second of 7 results.
The reply named "The Woman in the Window" with an invented plot, cited unrelated pages and opened with talk about a
failed search. No rule in `docs/design/RULES.md` is broken by anything below; every fix listed stays inside the rules.

## What happened

Generation 1 called `websearch` with `scope: "reference"` (empty result). Generation 2 (`tool_retry`) called it again
with `scope: "web"`, `read_page: true` (7 rows). The phrasing generation then wrote the reply. The classifier head
(`search_assist`) scored 0.01 and, in shadow mode, did nothing; the model searched by itself.

## Root cause per symptom

(a) Reference scope first. The tool's `scope` description tells the model to use `reference` "for people, places, things,
works, words ..." (`backend/packages/websearch/manifest.json:52`). A film is a "work", so the model followed the
description. The offline library has no entry that matches a plot description, and the first call returns zero rows. The
description is the only steer; no code decides the scope (correct under rule 1).

(b) Retry narration in the final reply. Two things stack. First, the retry round stores its own user message in
`state.messages` ("The lookup for this did not happen ... You may try once more", built by `retryInstruction`,
`backend/src/lib/turnMachine/nodes/lookupFallback.ts:130`, appended at `nodes/model.ts:856-863`), so the phrasing prompt
still contains it. Second, the empty reference outcome stays in `state.outcomes`, so `missedKinds` is non-empty and the
phrasing instruction gets `lookupMissedClause` appended ("say plainly ... that you could not look that part up",
`nodes/model.ts:821-826`, `lookupFallback.ts:60`), even though the retry found results. The model was told to confess a
failure that the retry had already fixed, and it narrated "came up blank ... let's try again".

(c) Wrong film, wrong citations. The phrasing instruction opens with "Answer this question of mine completely from what
you know; use the results above as support" (`backend/src/lib/composer.ts:1174-1180`), so memory leads and results are
decoration. The model does see title, URL, snippet and, where read, `page_text` for each numbered source
(`composer.ts:946-967`). The "Bring Her Back" snippet is about a foster mom and a dead daughter, so the evidence was
present. Citation numbers are written by the model itself ("cite by number like [1]", `composer.ts:944`). Nothing checks
that a cited source supports the sentence, and nothing checks that the named film appears in any source. A 9B model that
answers from memory first will attach numbers to whatever it likes.

(d) 360 words. A non-issue for adults. The plan carries `max_words: 360` for a question with sources
(`backend/src/lib/register.ts:54,95`) but the comment at `register.ts:70-77` and RULES.md rule 5 say it reaches nothing on
an adult written turn; the 455-token reply is far under the 1536 ceiling. The length is a symptom of the invented plot,
not of a cap. Nothing to fix; do not tighten it (that would break rule 5).

(e) Seven sources listed. The reply's sources are every row of every outcome, cut at 8
(`backend/src/lib/turnMachine/nodes/answer.ts:120`, `sourcesFromRows` in `backend/src/lib/turnContext.ts:297`). The card
is built before the text is known and is never narrowed to the numbers the reply cites. The search is by design a
ranked list, so irrelevant rows show.

(f) Bare "7" under the action row. Confirmed by reading code, not by looking at the page: it is
`MessageFooterExtra` in `frontend/src/apps/chat/chatThreadSlots.tsx:637-645`. It renders a ghost icon `ElementsButton`
whose only child is `{sources.length}`, with the words "7 Sources" only in `aria-label` and a hover tooltip. The kit
`SourcesCard` is drawn with `hideTrigger` (`:647-649`), so Home replaces the kit's own trigger with its own hand-made
button that has no icon and no visible label. This is the shape rule 9 forbids (a Home-built control beside a kit
Element); the baseline lints did not catch it because the button is a kit Button, not a wrapper.

## Backlog overlap

- CHAT-FALSE-CLAIM-01 (open): covers a turn with no tool outcome claiming a lookup. Different failure; not a duplicate.
  Its fix would not touch (b), which has a real outcome.
- CHAT-HISTORY-TOOLPAIR-01 (open): pictures replay only. Not related.
- SEARCH-EMPTY-01, SEARCH-ROWS-01 (done): handle empty and snippet-less results, not a retry that recovered.
- THIN-4B (done): the `[n]` mapper; it renders numbers, it does not verify them. Not a duplicate of (c) or (e).
- SEARCH-PROMPT-01: no row exists in `docs/BACKLOG.md` (only a mention in `data-scratch/away-log.md`); treated as new.
- No existing row covers (a), (b), (e) or (f).

## Fixes, smallest first, all inside the rules

1. SEARCH-ANSWER-01 (S): when a retry round produced results, drop the stale missed-lookup state: do not append
   `lookupMissedClause` for an earlier empty outcome whose retry succeeded, and do not replay the retry instruction message
   into the phrasing prompt. Pure prompt assembly, no word rule. Bench not needed beyond a regression test on this shape.
2. SEARCH-ANSWER-04 (S): the footer count in (f) becomes the kit's own sources trigger as it ships (let `SourcesCard`
   render its trigger, drop `hideTrigger` and the hand-made button), or an additive prop in `commons` first if the
   trigger cannot be controlled. Frontend only, rule 9.
3. SEARCH-ANSWER-02 (S, bench first under rule 3): change the `scope` description so a described or half-remembered work
   goes to the web, and `reference` is for confirming known facts; or make an empty `reference` result fall through to the
   web inside the same call (code, not a word list). Rule 1 safe either way; the model still chooses.
4. SEARCH-ANSWER-03 (M, bench first): reorder the phrasing instruction for a search turn so the results lead and memory is
   the fallback ("name only what the sources support"), and show only the sources the reply cites, with the rest behind
   "more results". Citation filtering reads `[n]` markers, not wording, so no word router. Needs the rule 3 sampling and
   reply-quality bench on CHAT-AB-01 fresh set (3 repeats) because it changes the phrasing prompt.

Nothing here needs a rule change. A hard grounding check on the output (named film must appear in a source) would read
the answer's wording; it is not proposed, and if wanted it is the owner's call because of rules 1 and 6.

## Follow-up 2026-10-13 (poster request)

Conversation conv-iv2n72jlpb. Turns turn-d3ushvu41k, turn-jvdegpmqi4, turn-o416bde5y6 (the same "show je the poster" sent
three times) all stored the canned line; the earlier answer is turn-4rxa10ml9h. Read from `data/hub.db` (read-only) and code.

(1) The phrase is `policyRefusalLine()`'s fallback branch, `backend/src/lib/turnMachine/nodes/answer.ts:90`. Every policy
refusal reason without its own line (`ungrounded_args`, `unknown_tool`) ends there (GROUND-01 made that on purpose). The trace
of all three turns shows `policy` outcome `{ok:false, code:"ungrounded_args", arg:"subject"}` and `stop_reason:"tool_calls"`.

(2) Why the draft vanished. The model answered with text AND a tool call in one generation (first_delta_ms 0-1, so the text
streamed live to the screen). The call was almost certainly `show_images` with `subject` "The Woman in the Window". The policy
node (`nodes/policy.ts:138-160`, `checkGrounding`) requires some term of every free-text arg to appear in the utterance, the
window's USER turns or the roster (`groundingSourceTexts`, `policy.ts:176-182`). "show je the poster" contains no film name and
the film name lives only in an assistant turn, so the subject is "ungrounded", the call is refused, the machine goes to
`answer` with `policy_refused` (`machine.ts:252`, `answerInputFrom` `machine.ts:553`), and the turn value's reply text becomes
the canned line; the client swaps the streamed text for the final reply. Only the final text is stored (`reply_text`); the
discarded draft and the refused call args are not in `stats` (`tool_call_raw_args` is null on these generations), so the
draft cannot be recovered afterwards. The show_images manifest itself tells the model that "a follow-up means the previous
message's subject" (`backend/packages/show_images/manifest.json`, subject description) while policy refuses exactly that.
The IMGQ-09 re-ask (`turnNext.ts:759`) did not run: it needs a kept text reply, `MAIPAI_IMGQ09_REASK=1` and no tool call.
The unabomber turn (turn-licsedj994) shows the sibling `unknown_tool` path to the same line.

(3) Correctness. The earlier answer was wrong. The film is almost certainly "Bring Her Back" (2025, the Philippou brothers):
it was the second search result (cambridgeday.com, "Beware the foster mom with the dead daughter") in turn-uo4ikmaypk. The
model ignored it and named "The Woman in the Window" with invented plot. turn-4rxa10ml9h (the re-ask of the same question)
made NO tool call (sources empty, no tool nodes) yet wrote "the search results I found earlier confirmed ... [1] [4] [3]",
so those markers cite nothing. The poster request was refused before any picture work, and would have shown the wrong film.

(4) Bare digits. `[n]` markers are rewritten to `[n](#citation-n)` by `citeMarkers` (`frontend/src/apps/chat/chatCitations.ts:49`),
for every marker whether or not sources exist. `ChatCitationLink` (`chatCitationLink.tsx:15-16`) then, when the message has
no source at that index, returns `<span>{children}</span>`, which is the bare digit with its brackets gone. Turn
turn-4rxa10ml9h has no sources, so every hallucinated marker survives as "1", "3", "4". (`markCitations` leaves an
unmatched `[7]` as written; the live path uses `citeMarkers`, so that promise is not kept.)

(5) Fixes, smallest first. None conflicts with a rule; none reads wording.
- SEARCH-ANSWER-05 (S, regression test only): `groundingSourceTexts` also includes the previous assistant turns (and the
  titles of shown sources) for `show_images`' `subject`, or the manifest marks `subject` as grounded against the whole
  window. Code, not a word list; rule 1 intact (the model still picks the subject). Safety gates untouched (age and surface
  gates still run first in `policy.ts`). Note: for a child the existing household-subject check stays in front.
- SEARCH-ANSWER-06 (S): a refused tool call after text already streamed must not replace a good draft with the canned line;
  keep the streamed text and drop only the call (a failed tool never fails the answer, RULES). Needs a test of the
  `policy_refused` path with a non-empty draft. Also store the refused args/draft in `stats` (names only is fine) so it is diagnosable.
- SEARCH-ANSWER-07 (S, frontend): `ChatCitationLink` shows nothing (not the bare digit) for a marker with no source, or the
  backend strips `[n]` when the turn has no sources. Restore the `markCitations` "stays text" promise.
- SEARCH-ANSWER-08 (M, rule 3 bench first): a re-ask of a question the previous turn failed to answer should search again
  (turn-4rxa10ml9h answered from memory with fake citations). Candidate: a prompt line plus the existing search assist
  (it scored p=0.01, shadow mode). Phrasing/prompt change, so 3 repeats on the CHAT-AB-01 fresh set. Related to SEARCH-ANSWER-02/03.
Cheapest first: 05 and 07, then 06, then 08.

## Supersedes

This note amends the "Grounding, stated exactly" paragraph of `docs/plans/turn-machine-state-record-2026-09-22.md` (lines 131-148). The grounding set stays the utterance, the window's user turns and the names the hub itself said. `show_images.subject` alone additionally grounds on words from the last 1 to 2 `window-assistant-*` turns. It never grounds on `window-tool-*` turns or the system summary, and never on websearch, store or recall arguments. The bare-pronoun refusal stays. Age, surface, crisis, temporary and household checks keep running first.
