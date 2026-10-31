# Memory audit and redesign (2026-10-31)

This note records what the live hub's memory actually did in its first two weeks, why one reply told the owner "you and
your daughter better wear jackets", and the decisions that fix it. It covers six backlog rows: MEM-AUDIT-01 (the profile
card), MEM-AUDIT-02 (capture), MEM-AUDIT-03 (recall), MEM-AUDIT-04 (lifecycle), MEM-AUDIT-05 (the per-turn trace) and
MEM-AUDIT-06 (the household fixture and regression tests). The code lands with this note (2026-10-31). Every record stays the spec shape with
id, provenance and clock stamp (principle 3). A person's memories are theirs alone (RULES.md rule 6a). The memory lifecycle
note of 2026-10-17 (review queue, tidy, change feed, preferences) is unchanged by this one; where the two touch, section 7
says which wins. Names in the examples are the persona roster (Sage the owner, Marlow the teen, Nova the child), never the
family.

## 1. What the audit found

**Snapshot.** The live hub on 2026-10-31 (installed sha-6b653ad) held 337 turns (205 chat, 132 robot) over 74 conversations,
2026-10-17 to 2026-10-30. The judge eligibility gate skipped 190 of them (signal `primary_act` greeting, question, backchannel or
directive) and judged 146. It wrote 4 turn-sourced memories (1.2 per 100 turns) plus 2 weekly profile paragraphs. Every one of
the 6 records has `uses = 0`: the relevance recall path never injected a memory in production. Only the profile paragraph, which
bypasses recall, ever reached a prompt.

**Quality of the six.** Two are useful durable facts. One is useful but framed as transient ("is talking to their daughter"),
so it decays as a state instead of standing as a relationship. One is a trivial one-off event (a coyote sighting, importance
0.4). Two are the weekly profile paragraphs: they repeat the other facts and bake "this week" narrative into a durable, pinned
record.

**Misses found by hand in the same 337 turns, none captured:**

- A second child and that child's partner, both named by the owner.
- A friend who is a former bandmate.
- An explicit "make a note that X is human and should not be judged by Y's actions" request.
- Three instructions to the assistant about its own behavior: "stop saying that", "I don't understand why you typed out all
  your responses", and "why didn't you check" the weather after being told it is cold.
- The owner's robot project.

**The jacket reply.** The weekly profile paragraph (category `identity`, pinned, source `memory.consolidate:profile`) named
the child and the owner's "this week" state. The profile is injected into the stable system prefix on every turn
(`backend/src/lib/turnMachine/nodes/context.ts` line 365, `getProfileParagraph`) with no relevance check and no usage rule
beside it. The prompt that writes it (`backend/src/lib/memoryJudge.ts` line 1813, `rewriteProfileParagraph`) asks for
"what's going on with them this week". PROFILE-CHANNEL-01 (2026-09-28, `docs/dev.md` line 32218) already decided the profile
carries identity only; the prompt drifted from that decision and nothing measured the drift.

**Code-level causes.**

| | Cause | Where |
|---|---|---|
| a | The eligibility gate `hasEligibleClause` takes only inform and commissive clauses, so a question or a directive is skipped whole. Questions and directives are where the owner named people and gave instructions | `backend/src/lib/turnSignal.ts` line 617 |
| b | The extraction prompt is long and rule-dense, never sees the existing memories, and the shared 8B judge measured 33 percent precision and 40 percent recall (JUDGE-QUALITY-01). After it, seven deterministic rejectors run in series (`ineligible_act`, `ungrounded`, `subject_mismatch`, `commissive_shape`, `passing`, `world`, `example_echo`), each able to drop a true fact | `memoryJudge.ts` lines 305 to 386, the rejectors after `buildExtractionPrompt` |
| c | The explicit-save route matches only "remember that *" phrasings, so "make a note" and "keep in mind" are never saved | `backend/packages/remember/manifest.json` `routing.patterns` |
| d | No category exists for an instruction to the assistant (how to behave for this person), the kind of memory people notice most when it is missing | the category list in the spec and the prompt |
| e | Recall: an entity-name match and a pinned row bypass the 0.62 cosine floor (`forceInclude`), so any message naming a known person pulls that person's facts whatever the topic | `backend/src/lib/memory.ts` line 757 |
| f | A `state` expires 7 days after `created_at`, never at its own `valid_to` | `memory.ts` lines 1319 and 1394 |
| g | Dedupe at cosine 0.92 and above supersedes before the `sharesAttribute` guard; the guard runs only in the 0.60 to 0.92 band | `memoryJudge.ts` line 1041 |
| h | No per-turn trace says which memories were injected, so "why did it say that" cannot be answered from the turn row | the turn stats JSON |
| i | Comments in `memory.ts` line 697, `memoryJudge.ts` line 1761 and `context.ts` line 313 cite `scripts/bench/memory-eval.ts`, which does not exist | stale comments |

## 2. Research basis

- Small models score lower with unneeded context than with none (TARG, arXiv 2511.09803; Yoran et al., ICLR 2024). In-topic
  distractors hurt most (Shi et al., arXiv 2302.00093). A "use only when relevant" line moves frontier models and not
  open-weight ones (PersistBench, arXiv 2602.01146). So the fix is fewer, better-chosen lines, not a longer rule.
- Every production memory system splits a tiny always-on profile from a gated, dated store: ChatGPT, Zep, Letta, LangMem,
  Memobase. Memobase's injected rule reads "Unless the user has relevant queries, do not actively mention these memories".
- Honcho's household rules: a fact about a person comes only from that person's own messages, and an acknowledgement
  transfers no fact.
- Claude Code's auto-memory keeps a "feedback" type for how the assistant should behave; that is the `instruction` category
  below.
- Keep verbatim turns beside extracted facts (Fidelity Before Structure, arXiv 2601.00821); the hub already keeps the turn
  row, so a memory only needs its source turn id.
- Dedup at cosine 0.92 to 0.95 catches strict duplicates; lower bands need an attribute check.
- A 30B-class extractor is within 2.4 points of GPT-5 on Mem0's memory benchmarks; an 8B one is not. That is JUDGE-QUALITY-01's
  question, not this note's.

## 3. Decisions

1. **A profile card replaces the profile paragraph.** No weekly LLM rewrite. The profile is a deterministic list of at most 8
   active durable facts of the speaker's own person scope in the categories `identity`, `instruction` and pinned preferences,
   each rendered as a dated line, under 400 characters in all, preceded by one rule line: "Background about Sage. Use it only
   when it changes your answer; never mention or allude to it otherwise." Relationship, state, event, project and goal facts
   never enter the profile. Existing profile rows (source `memory.consolidate:profile`) are archived on the next consolidation
   run. The paragraph prompt and the rewrite pass are removed.
2. **New category `instruction`:** how the assistant should behave for this person ("answer in short sentences", "check the
   weather when I say it is cold", "do not say X"). Durable, person scope, importance 0.8, shown in the profile card. Extraction
   and the explicit-save route both produce it.
3. **Explicit save phrasings widen.** "make a note", "note that", "keep in mind", "don't forget that", "for future reference"
   and "remember:" route to the `remember` package beside the existing "remember that" forms ("don't forget to lock up" is a
   reminder and stays out). An explicit save is always stored,
   never rejected by the judge's grounding or passing filters, and takes its category from the judge when one is available,
   else `fact`. The `remember` recipe stores the save as `fact` the moment it is said, under the turn's id; the better
   category arrives through the judge's pass over that same turn (the judge reads a plugin turn too): the judge's record
   supersedes the recipe's row when its wording differs, and re-stamps the row's category in place when the wording is the
   same (ingestion keys an active row on its text), so "make a note that Marlow is allergic to peanuts" ends as one
   `relationship` record, never a `fact` beside it.
4. **The eligibility gate judges every finished model turn whose user text has at least three words**, whatever its primary
   act. Only greetings and backchannels, and any turn under three words, are skipped. Questions and directives carry facts
   and instructions; three words is the shortest statement people make about themselves ("I hate cilantro", "I like tea"),
   and a four-word floor dropped every one of them.
5. **The extraction prompt is rewritten shorter**, in the Honcho and Mem0 pattern: the speaker's own messages only, a closed
   category list, one fact per item, every pronoun and relative date resolved, an empty list is a valid answer, few-shot
   negatives, an importance guide, and one line that an explicit request ("make a note", "remember") is always a fact. The
   rejectors stay, but each is measured against the household fixture of decision 9; any rejector that drops more true facts
   than junk on that fixture is loosened. The measurement report decides which; section 5 holds the numbers.
6. **Recall:** an entity-name match becomes a +0.15 boost that still needs cosine 0.50 or above; pinned rows keep their bypass,
   because a person chose them. Top-5 and the 0.62 floor for everything else stay. Each injected line carries its date and
   subject: "(2026-10-28, about Sage) Sage dislikes sweaters."
7. **Lifecycle:** a `state` expires at `valid_to` when set, else 14 days after `created_at`; an `event` with a date leaves
   recall 2 days after that date; the 0.92-and-above dedupe band runs the same `sharesAttribute` guard as the 0.60 to 0.92
   band; superseded rows keep their history.
8. **Trace:** every turn records in its stats JSON which memory ids and profile fact ids were injected, with their scores
   (`memory: {profile: [...], injected: [{id, score}]}`), so an audit answers "why did it say that" from the turn row.
9. **Eval:** a household fixture in persona names, built from the real misses and the jacket case, drives
   `backend/scripts/bench/judge-eval.ts` and a new awkward-recall check. The jacket case becomes a deterministic regression
   test: a profile holding a relationship fact never renders it, and "starting to get cold out" against a store holding a
   child relationship fact injects nothing about the child.
10. **Out of scope here, filed as follow-ups:** a stronger judge model (JUDGE-QUALITY-01, needs a Stack role change); the
    child-band capture policy (a safety surface, needs its own note); a pending-until-approved review queue for inferred facts
    (MEM-REVIEW-02); a Self-ReCheck second pass before injection (measure first).

## 4. Rules checked

RULES.md rule 1 (memory reaches the model as injected context, never a tool: unchanged); rule 4 (the window reserves room for
the memory block: the profile card is smaller than the paragraph it replaces, 400 characters against the paragraph's cap, and
recall stays at top-5); the speaker-evidence paragraph (lines 36 to 41: unchanged, `selfOnly` recall stays and an unknown
speaker reaches no memory). No NEEDS-RULE-CHANGE.

## 5. Measurements

**The replay (2026-10-31).** The live hub's 337 turns, replayed through the chain as it was, against 26 hand-labelled durable
facts: 5 were captured and 21 lost. Where each loss died:

| Stage | True facts dropped | Junk dropped | Verdict |
|---|---|---|---|
| gate (`hasEligibleClause`, directive and question turns skipped) | 3 (the behavior instructions) | 190 turns skipped, 187 of them with nothing to keep | loosened: three-word rule, decision 4 (a three-word statement such as "I hate cilantro" now reaches the judge) |
| extraction (the prompt's "requests are not facts" rule; short voice statements returning `[]`) | 11 (6 facts inside requests, 1 instruction, 4 short statements) | not counted | rewritten, decision 5 |
| `example_echo`, `placeholder`, `credential` | 0 | not counted | unchanged |
| `ungrounded` | 0 | 14 (facts copied from the assistant's reply) | unchanged, exactly as it was |
| `world`, `passing` | 0 | not counted | unchanged |
| `ineligible_act` | 1 ("whose my daughter Nova's boyfriend": the fact sat in a question clause) | not counted | loosened: a question or directive clause grounds a fact that carries half its content words |
| `unknown_grounding` | 1 (the proper noun sat in that question clause) | not counted | loosened: a proper noun said anywhere in the utterance grounds (the turn-level `ungrounded` check still refuses a name said nowhere) |
| `subject_mismatch` | 5 (the model filled `subject` on 0 of 29 candidates, so every fact about a named person read as "about the speaker") | not counted | rewritten: who a fact is about is read from its text and the household roster; `subject: null` is unknown, never the speaker |
| `commissive_shape` | 0 | not counted | unchanged |
| `invalid_emotion_category` | 0 (one `state`, "alarmed by a coyote", rightly dropped) | 1 | unchanged |

The `credential` and `placeholder` rejectors are safety filters and are not measured here. Baseline from the snapshot: 4
memories from 146 judged turns, at least 8 hand-found misses, 0 injections by recall.

**The household fixture** (`backend/scripts/bench/datasets/memory-household-01.json`, 30 cases: 18 of the replay's misses in
persona names, the 3 instructions, 6 negatives, 3 assistant-only facts that must not be captured), run through
`bun run scripts/bench/judge-eval.ts --dataset memory-household-01` against the Stack on `127.0.0.1:8770` (the shared judge
role), once before and once after MEM-AUDIT-02's capture changes:

| Run | Precision | Recall | Skipped at the gate |
|---|---|---|---|
| before (chain as it was, 2026-10-31) | not run | not run | not run |
| after (three-word gate, rewritten prompt, text-derived subject, carrier clauses, widened saves) | not run | not run | not run |

Neither run completed on 2026-10-31: the Stack on `127.0.0.1:8770` stopped answering (connection refused on `/healthz` and
`/v1/models`) between the fixture being written and the first judge call, and the bench refuses to start without a judge
(CHAT-22). The two rows are filled by the first session that finds the Stack answering: the command is in the header of
`backend/scripts/bench/judge-eval.ts`, run once with `main` as it was before MEM-AUDIT-02 and once after, never in a loop,
because the judge role is shared with the live hub. The deterministic half of the measurement is in `bun test` already:
every fixture shape (the song request, the boyfriend question, the two-clause "make a note", the lowercase friend, the
instruction category, the joke, the hypothetical, the anonymous robot speaker) has a case in `backend/tests/memoryJudge.test.ts`
under "MEM-AUDIT-02: capture what people actually say".

**Two deviations from the brief, taken deliberately:** the prompt's request example keeps "DDR" as the person said it
rather than expanding it, because the untouched `ungrounded` rejector drops any proper noun the person never spoke; and
"don't forget" routes to the `remember` package only as "don't forget that *", because "don't forget to lock up" is a
reminder, never a fact to store (the fixture's `neg-reminder` case).

## 6. Slices

| Id | Size | Order | Depends on | Exit check |
|---|---|---|---|---|
| MEM-AUDIT-05 (trace) | S | 1 | none | A turn's stats JSON names the profile fact ids and the injected memory ids with scores; a turn with no injection records empty arrays; a test reads the trace from the turn row |
| MEM-AUDIT-06 (fixture and regression) | S | 2 | MEM-AUDIT-05 for the recall check | The household fixture in persona names holds every hand-found miss and the jacket case; the two jacket regression tests fail on today's code and pass after MEM-AUDIT-01 and 03 |
| MEM-AUDIT-01 (profile card) | M | 3 | MEM-AUDIT-06 | The card renders at most 8 dated lines under 400 characters with the rule line; a relationship, state, event, project or goal fact never appears; `rewriteProfileParagraph` and its prompt are deleted; the next consolidation run archives every `memory.consolidate:profile` row |
| MEM-AUDIT-02 (capture) | M | 4 | MEM-AUDIT-06, section 5 numbers | The `instruction` category exists in the spec, the prompt and the explicit-save route; the six new phrasings reach the `remember` package and are stored whatever the judge says; a four-word question with a named person yields the relationship fact on the fixture; the shortened prompt scores at or above today's judge-eval precision and recall |
| MEM-AUDIT-03 (recall) | S | 5 | MEM-AUDIT-06 | An entity-name match below cosine 0.50 is not injected; above it the +0.15 boost applies; a pinned row still bypasses; every injected line starts with "(date, about name)" |
| MEM-AUDIT-04 (lifecycle) | S | 6 | none | A `state` with `valid_to` is archived at that date and one without at 14 days; a dated `event` leaves recall 2 days after its date; a 0.95-cosine pair that fails `sharesAttribute` is an ADD, not a supersede; a superseded row keeps its `valid_to` and history |

## 7. Supersedes

- PROFILE-CHANNEL-01's "the profile paragraph carries identity only": kept as the intent, replaced in mechanism by the
  deterministic card of decision 1. The paragraph and its weekly rewrite are gone.
- The memory lifecycle note's `state` expiry ("expires in 7 days", section 1 of that note): now `valid_to` first, else 14 days
  (decision 7). Its tidy, review queue, change feed and preferences are unchanged.
- MEMORY-RELEVANCE-01's `forceInclude` for entity matches (the comment at `memory.ts` line 750): replaced by the boost of
  decision 6. The pinned half of that override stays.
- MEM-06's eligibility ("only an inform or a commissive clause can yield a memory", `turnSignal.ts` line 611): replaced by
  the three-word rule of decision 4 for the turn gate. `isEligibleClause` may still inform the judge's clause citation; it no
  longer skips a turn.
- The three stale `memory-eval.ts` comments (cause i): rewritten to name `judge-eval.ts` and `recall-floor.ts` in the slice
  that touches each file.
- Nothing in RULES.md.
