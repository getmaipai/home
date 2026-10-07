# Backlog history

Completed and explicitly dropped rows moved from the Chat system optimization section of `BACKLOG.md` on 2026-10-06. Open deliverables remain in `BACKLOG.md`. Each original row and its supporting notes are retained below; anchors let older links resolve to the moved record.

## Chat system optimization

<a id="chat-01"></a>

- [x] **CHAT-01: Share the exact selected context with generation and guards** (M)

    Status (2026-09-13, closed): `backend/src/lib/turnContext.ts` (the
    ephemeral `TurnEvidence`/`TurnIntent`/`ToolExecutionOutcome`/
    `TurnContext`), selection defined as what the render kept, the guard
    input derived from the included evidence alone (`GuardContext.grounding`
    for profile, summary, roster and clock), one frozen clock per turn,
    outcomes pushed per resolved call. Details in docs/dev/session-a.md.

    Depends on: none. Files: `backend/src/lib/turnEngine.ts`, new
    `backend/src/lib/turnContext.ts`, `conversationHistory.ts`, `guards.ts`.
    Mirror `prepareTurn`, `buildConversationWindow`, and existing
    `turnEngine.test.ts` fake-person/context fixtures. Implement the
    `TurnEvidence`, `ToolExecutionOutcome`, and `TurnContext` fields in the
    decision record as ephemeral types, importing existing surface/result
    types. Freeze persona, actor, age-band policy, and time once per turn.
    Load history once; distinguish user assertions, assistant history,
    summaries, profiles, roster, clock, memories, and actual package
    outcomes. Build the prompt and guard inputs from the same selected
    evidence IDs, never all pre-truncation retrieval candidates. Include `intent: { kind: chat|lookup|action|clarify, query,
    subjectEntityIds, explicitDetailedAnswer }`; default kind to chat and
    query to original text. Set the detail flag only for case-insensitive
    `in detail`, `detailed explanation`, or `step by step`. CHAT-13 refines
    intent. Initially preserve budgets; CHAT-12 replaces their selection policy.
    Treat reference text as data and never put package-result text into a
    system-authority message. Preserve the existing public turn shape.

    Acceptance: an included profile/roster/clock fact passes grounding;
    a removed memory is absent from both prompt and guard sources;
    assistant guesses and persona examples never become assertions or
    action-success evidence; a malicious instruction inside reference text
    cannot authorize a tool. Assert meaningful answers using scripted
    completions, not only object shape. Out of scope: new persistence,
    another model pass, new UI, and a duplicate shared record system.
    Checks: `cd backend && bun test tests/turnEngine.test.ts tests/guards.test.ts tests/conversationHistory.test.ts`, then the full exit gate.

<a id="safety-01"></a>


<a id="safety-01"></a>

- [x] **SAFETY-01: The conversation's crisis state (offer, never block, on every turn)** (S-M)
    Done 2026-09-14 (docs/dev/session-a.md "SAFETY-01"; the program
    file's finding 26): the self-harm signals gain the live chat's
    wordings (spec/safety, corpus rows both ways); a conversation is in
    the crisis state for ten turns after a self-harm signal on either
    side of a turn (`conversation_turns.crisis_signal`, schema 35);
    in the state every reply carries the crisis overlay, no package
    routes and no tool is offered (the forced lookup cannot run, an
    offer binds nothing, a pending lookup or ask is cleared), and a
    stop gets one acknowledgment then the overlay alone; #85 closed:
    a streamed refusal's resources ride on its error event and the
    chat client shows them. Tests: `backend/tests/safety01.test.ts`
    (blocking and streamed, a roster speaker), the adapter test, the
    corpus; the bench row `self-harm-state`.

<a id="safety-01-followups"></a>


<a id="historical-item-003"></a>

- [x] **SAFETY-01 and ASK-01 follow-ups, second round** (S)
    Done 2026-09-15 (docs/dev/session-a.md "ASK-01", "The second
    round"): the three lows of SAFETY-01's review and the set's reads:
    a who answer with a value is an inform (the judge extracts from
    the answer turn); a bare possessive is not a household frame; the
    two-turn household-frame rule in the judge (the name in the
    previous turn, the kind noun with a pronoun in this one, is stated
    with its pronoun); the role-invention shape reads any unresolved
    name; a confirmed entity answered as another kind keeps its kind
    and the reply says so; finalize on the refusal path inside a try;
    an ephemeral widget query skips the crisis state's routing rule;
    who-ask-declined and open-question-once ask about names of their
    own (the shared bench household). Set 1 of ASK-01 on de9d6a4:
    216, 210, 211 of 276, the hard rows 12 of 12; the partial rerun
    of the five rows after this commit.

    Objective: the three lows of SAFETY-01's review, one test each:
    an answer of another kind about a confirmed entity
    (`applyWhoAnswer()`, `backend/src/lib/unknownNames.ts`) keeps the
    entity but still writes the relation and says "Got it, X is your
    neighbor" (say what was kept instead, write no edge the kind
    refuses); `streamTurnEvents()` (`backend/src/routes/turn.ts`) now
    finalizes a refusal before its error event, so a throw inside
    finalize would end the stream with no terminal event (wrap it, emit
    the error either way); an ephemeral widget query in a conversation
    in the crisis state routes to no package for ten turns (skip the
    state's routing rule for `ephemeral` turns, keep the overlay off
    them). Mirror `tests/safety01.test.ts` and `tests/ask01.test.ts`.
    Exit: `bash scripts/check.sh`.

<a id="chat-02"></a>


<a id="chat-02"></a>

- [x] **CHAT-02: Enforce one output safety boundary for chat and packages** (M)

    Status (2026-09-13, closed): `evaluateReply()` (text and speech
    independently, the stricter wins) behind `applyOutputBoundary()` as the
    first step of `finalizeReply()`, so package replies, Tier 2 results,
    confirm prompts, fallbacks, commands and model text all pass one
    evaluator before text, audio and persistence; a refusal clears a
    pending ask; notifications once per turn and category; the streaming
    gate judges the cumulative reply at each boundary. Details in
    docs/dev/session-a.md.

    Depends on: CHAT-01. Files: `backend/src/lib/turnEngine.ts`, `safety.ts`,
    `packageHost.ts`, `notifications.ts`, `backend/tests/turnEngine.test.ts`,
    `safety.test.ts`, and existing `spec/safety` corpus/tests. Extract the
    current output evaluator into one reusable implementation; ordinary
    completions, direct package replies, package-generated text, pending
    prompts, composition, and error fallbacks must reach it before visible
    text, audio, or the persisted assistant reply. Evaluate explicit
    `reply.speech` independently if it differs from visible text; normalize
    approved text only after policy succeeds. Keep core refusals out of the
    style guards. Evaluate final fragments without punctuation and preserve
    existing safe whitespace. Deduplicate parent notifications by turn and
    category. A refusal cancels remaining generation and prevents pending
    tool execution; retain crisis-resource behavior without suppressing
    otherwise permitted help. Add no opt-out, persona exception, or manifest
    flag. Reuse the existing safety vocabulary and age-band derivation.

    Acceptance: safe input with unsafe direct package output, unsafe
    package LLM output, unsafe speech with safe display, split-chunk unsafe
    content, and an unsafe final fragment are stopped before exposure.
    Streaming and direct paths make identical decisions and notify once.
    Existing mandatory floor/ceiling fixtures remain unchanged and green.
    Out of scope: changing content policy or replacing the deterministic
    safety floor with model judgment. Checks: backend safety/turn suites,
    shared safety corpus suites, and the full exit gate.

<a id="chat-03"></a>


<a id="chat-03"></a>

- [x] **CHAT-03: Exclude credentials from ordinary chat memory and context** (M)

    Status (2026-09-13, closed): `backend/src/lib/memoryContentPolicy.ts`
    (bounded assignments, known formats, declared fields, redaction, the
    stated limit) behind `prepareTurn()`'s early answer, `remember()`, the
    judge, `host.memory.remember`, the memory API and `logTurn()`'s
    redaction; the read side hides historical records without deleting
    them; the user memory page explains it. Details in docs/dev/session-a.md.

    Depends on: none; integrate with CHAT-06 when it lands. Files:
    `backend/src/lib/memoryJudge.ts`, `memory.ts`, `packageHost.ts`,
    `conversationHistory.ts`, `turnEngine.ts`, existing `secrets.ts` and
    secret-setting declarations, `routes/memory.ts`, and `tests/memoryJudge.test.ts`,
    `memory.test.ts`, `packageHost.test.ts`. Remove the credential-storage
    extraction example. Implement one pure `memoryContentPolicy.ts` used
    by all capture paths. It rejects declared credential-bearing fields,
    bounded explicit assignments to password/token/API-key/cookie/private-key
    labels, and recognized secret formats; use generated synthetic values in
    tests. Never enumerate/decrypt stored credentials to build a matcher.
    Before a supported chat capture request containing detected credentials
    is logged, embedded, or sent to a model, return the fixed safe message
    "Keep passwords and keys in Credentials, not in chat." Persist only a
    redacted event marker, with no raw value. Read-side context filtering
    excludes detected historical credential text from recall, profiles,
    summaries, and notifications without deleting existing records.

    Acceptance: both explicit saves and automatic candidates are rejected;
    store/vector/notification/model spies receive no detected value; a
    benign statement that a password is managed elsewhere passes. Direct
    memory API rejection is a documented 400 with an existing-compatible
    error shape. Record the detection limits honestly: arbitrary unlabeled
    strings cannot be proven nonsecret. Out of scope: credential migration,
    destructive historical cleanup, storing chat credentials in a new
    store. Checks: named backend suites and full exit gate; update the
    user memory/credentials explanation with the same change.

<a id="chat-04"></a>


<a id="chat-04"></a>

- [x] **CHAT-04: Stop rejecting valid acknowledgments and general knowledge** (M)

    Shipped 2026-09-13 (the action-claim half; FAST-05 shipped the
    world-knowledge half 2026-09-12): near-echo is a question guard
    (`utteranceShape()` from the new pure `lib/utteranceShape.ts`),
    `GuardContext.outcomes` replaces `actionsRan`, completed action
    claims are matched per package family to a succeeded outcome
    (`unsupported_action`, narrated from the outcome, never a pooled
    line), remembering and future intent are acknowledgments, and the
    #81 sentence-case pass runs on both paths. Design and the shipped
    record in [docs/dev/session-a.md](dev/session-a.md). Closes #74,
    #62; #81 by the pass and a naturalness bench row.

    Depends on: CHAT-01 and CHAT-02; use CHAT-15 outcomes when available,
    otherwise the identical type from CHAT-01. Files:
    `backend/src/lib/guards.ts`, `turnEngine.ts`, `spec/llm/guard-corpus.json`,
    `backend/tests/guards.test.ts`, `turnEngine.test.ts`. Replace universal
    novelty checks for capitals, digits, and dates with narrowly scoped
    household-claim checks. Remove overlap-only acknowledgment rejection.
    Preserve mandatory safety, medication, impossible-experience, and
    known unsupported-household-claim cases. Match explicit action claims
    against successful outcomes for that action; one unrelated successful
    tool is never sufficient. "Got it" needs no memory write, while "I
    saved that" does. Use one sentence decision function in streaming and
    blocking paths, with a reason indicating unsupported action text that
    CHAT-17 can hold. No separate second-model semantic judge in this slice.

    Amended 2026-09-12: FAST-05 lands the world-knowledge half of this
    item first (bare numbers, capitals, dates, hedges, household-only
    location claims, the four probes as permanent tests). This item keeps
    the action-claim half, which needs CHAT-15's outcomes.

    Acceptance: exact regressions include the Pippa allergy disclosure accepts "Got it,
    Pippa is allergic to peanuts."; "It is 4." answers the arithmetic
    question; "The capital is Paris." answers the France question; "She
    likes painting." passes with Pippa resolved and that included memory.
    Add negatives for unknown household whereabouts, failed saves/timers,
    a search followed by an invented save claim, and copied persona
    examples. Deliberately retire old lexical false-positive assertions
    with a documented behavior replacement, never silently weaken safety
    fixtures. Out of scope: proving all natural-language entailment or
    eliminating hallucinations. Checks: named suites, guard corpus runner
    already used by the repository, and full exit gate.

<a id="chat-05"></a>


<a id="historical-item-007"></a>

- [x] **TOOL-EVENTS-01b: the new path's tool node emits the wire events (spec-v0.1.30)** (S, Sonnet, 2026-09-23; TOOL-EVENTS-01's producer half for `turnMachine`/`turnNext.ts`, the new path only) - **landed 2026-09-23.** spec-v0.1.30 already declares the three events (`spec/schemas/turn-stream-event.schema.json`, fixtures under `spec/fixtures/turn-stream-event/`, keyed by `t` not `type` - a deliberately separate wire shape from `wire.ts`'s own `TurnStreamEvent` union, the same split the frontend consumer (`chatModelAdapter.ts`, `e9471c8d`/`554b2b5f`) already treats it as) and the frontend consumer already landed; this row is the missing producer. `nodes/tool.ts`'s `toolNode` pushes one `tool_call` per proposal as it's accepted (before the call resolves) and one `tool_result` (succeeded) or `tool_error` (failed or deadline-exceeded) once its outcome lands, onto a new `ToolOutput.toolEvents` field; `machine.ts`'s `recordOutcomes` action accumulates them onto a new `TurnState.toolEvents`, alongside `outcomes`; `turnNext.ts` surfaces them on `TurnStreamResult`'s `immediate` variant only when non-empty; `routes/turn.ts`'s `/stream` route includes them in the NDJSON body between `signal` and `done`. The old path (`runTurnStream()`) is untouched - it still has no producer, per TOOL-EVENTS-01's own row above. Tests: `turnMachine/tool.test.ts` (direct unit tests of the node's own call/result/error ordering, an unknown package id needing no DB), `turnMachine/turnNext.test.ts`'s existing "a world question runs the search tool" test extended to parse the real events against the spec's own Zod schema (`@maipai/spec/stack/ts/turn-stream-event.js`, the identical import the frontend consumer parses each line with) and a sibling test proving a tool-free turn carries no `toolEvents` field at all. **Live on 8787:** a real "what's the weather like in Seattle today" turn with the new engine on routed to `websearch` (not the dedicated weather package - a separate routing question, not this item's own scope), and the reply showed a real "1 tool call" entry that expands to "Ran websearch," proving the wire events actually reach and populate the tool timeline end to end, not just in the scripted tests above. Exit: `bash scripts/check.sh`.


<a id="tool-events-02"></a>

- [x] **TOOL-EVENTS-02: a search step shows the sites it read, as chips with their icons** (M, Sonnet, 2026-09-24; owner request with the AI SDK chain-of-thought screenshots: "Searching for recent work" over `github.com` and `dribbble.com` chips) - **landed 2026-09-24.** `tool_result.outcome.sites` (host + page URL, at most five - `TOOL_RESULT_SITES_MAX`, a named export both the schema and the Zod mirror read, spec-v0.1.33/0.1.34) is additive on the wire event, built in `nodes/tool.ts` from the same `outcome.sources` `sourcesFromRows` already computes for the reply's own citation list, never recomputed. The kit's `ToolTimeline` (`commons` ui-v0.5.54) gained an optional `sites` field per step, rendered with the shipped `Source`/`SourceIcon`/`SourceTitle` (no hand-built row; assistant-ui's own chain-of-thought/tool-timeline pattern has no results slot to reuse instead) and a caller-supplied `faviconUrl` (home's `/api/favicon`, the same seam `ChatPage.tsx`'s message-level Sources footer already uses). **Found and fixed the same day, in scope:** `routes/turn.ts`'s `streamTurnEvents()` only ever read `toolEvents` off `TurnStreamResult`'s "immediate" kind - STREAM-NEXT-01 (landed earlier the same session) made every live turn return "stream" instead, so a real search on a real streamed chat never produced a `tool_call`/`tool_result` line at all, only the immediate bench/test path did; fixed by adding `toolEvents` to the "stream" kind too (`turnEngine.ts`, `turnNext.ts`) and yielding them ahead of the first delta, plus a resume-session fix (`shouldDeliver`) so a client that reconnects before its first token still gets them replayed. Tests: `turnMachine/turnNext.test.ts` (the `tool_result` event's own `sites` against a real websearch call; a new streaming-path regression proving `streamTurnEvents()` itself now carries the lines, confirmed failing without the fix); `chatModelAdapter.test.ts`/`ChatPage.test.tsx` (sites ride the synthetic `tool_timeline` part; a search step shows chips, a weather step shows none). **Verified live** on an isolated screenshot-script hub (`scripts/screenshot.ts --next-chat-tools-review`, a self-contained fake SearXNG, never the real one), captures at 1440/light and 390/dark, opened and judged: a real websearch call's step expands to an `example.com` chip that opens its page, alongside the reply's own separate Sources footer. Filed getmaipai/home#154 (pre-existing, unrelated: the weather chat capture's own spec-sheet card times out on the streaming path - not this item's scope). Exit: `scripts/check.sh` (full scope, pins moved) - passed.

<a id="route-find-03-b"></a>

- [x] **ROUTE-FIND-03 (b): "search"/"look up"/"google" is an explicit websearch command, 2026-09-22 - done 2026-09-22.** **Superseded 2026-09-22:** its wildcard patterns in `websearch/manifest.json` are deleted in D7 (`docs/plans/simple-turn-pipeline-2026-09-22.md`), once the model itself treats a bare "search"/"look up"/"google" as what it already does. "search who won the Seattle Mariners game yesterday" got "Noted.": read against the hub's own logged rows, the model had websearch offered and declined it, and its reply tripped the `placeholder_echo` guard, whose acknowledgment line (`guards.ts`'s `ACKNOWLEDGE`, "Okay."/"Got it."/"Noted.") replaced the cut reply - not, as first read, the remember package's own acknowledgment. `search <anything>` matched nothing in websearch's patterns (`search the web for *`, `search online for *`), so the model was left to decide, and declined; a leading "search" (and "look up", "google") is an explicit websearch command whatever follows, and should never reach the model's discretion at all. Fixed: `backend/packages/websearch/manifest.json` gained `"search *"`, `"look up *"`, `"google *"` patterns (Tier 0, deterministic, always wins, bypassing the model entirely - `turnEngine.ts`'s `routeLiteral()`), which also feeds `commandOpeners()` (routing.ts's `commandOpenersFrom()`) so a search/look-up/google command classifies as a directive and the memory judge skips it, never a fact. Found and fixed along the way: the new bare `"search *"` pattern re-matched text an earlier, more specific pattern had already yielded on for an unresolved reference ("search the web for that movie" with no world head), winning with a wrong, over-broad capture instead of yielding - `routeLiteral()` now makes an unresolved-reference yield skip the rest of that package's patterns entirely, caught by the existing CHAT-13 chunk B test. Also found: `backend/tests/tier2.test.ts`'s invention-retry test used "can you look up the odyssey's rating" as an utterance meant to reach the model (Tier 2), which the new "look up *" pattern now intercepts at Tier 0 - reworded to "can you check the odyssey's rating" (still `REQUEST_RE`-matching, still reaches Tier 2, confirmed with `route()` returning null). Verified: the utterance plus five paraphrases in the routing corpus (`spec/llm/routing-corpus.json`, pinned from `getmaipai/commons` at spec-v0.1.18) with expect `websearch`, a collision pin ("look up the artist Adele" still expects `music`, whose own more specific pattern wins over websearch's new broader one via package iteration order), a `memoryJudge.test.ts` regression proving the judge never treats a search command as a fact, corpus run green with no regression on existing rows, full `bash scripts/check.sh` green (3751 backend + 637 frontend tests, 0 fail). Exit: `bash scripts/check.sh` and the routing corpus bench.


<a id="route-find-03-a"></a>

- [ ] **ROUTE-FIND-03 (a): a recent-events question with no search verb is still a search, 2026-09-22** **Dropped 2026-10-02: retired by docs/design/RULES.md chat rule 1.** Do not build; the text below is kept as history. (merges with REPLY-FIND-02, next). **Thrown away 2026-09-22:** the lookup ladder this row would extend is deleted (D1/D2, `docs/plans/simple-turn-pipeline-2026-09-22.md`); the model's own tool call, plus the interim always-search rule for a world question, replaces it. "what did Apple announce this week" got the stuck fallback ("I'm stuck on that one, sorry. Ask me again some other way?") instead of a web search. Not a `route()`/Tier 0-1 fix (design-resolver, 2026-09-22): websearch is deliberately never the deterministic Tier 1 winner from a fuzzy example alone (several `noiseFloorExempt` null rows in the routing corpus encode this on purpose), and a generic recency signal there would flip some of them. The real gap is the existing pre-model lookup-decision path (`backend/src/lib/turnContext.ts`'s `lookupDecision`/`exactFieldOf`/`CURRENCY_MARK_RE`, plus `backend/src/lib/unknownNames.ts`'s org-name resolution) - "forced freshness for a recency question" already exists there but doesn't yet recognize an announcement/news verb plus an explicit time window as a lookup field, and doesn't tag a bare org name like "Apple" as a resolvable subject. An independent architecture review the same day reached the same conclusion for REPLY-FIND-02 ("admit by properties"): the lookup ladder should admit a currency-marked turn by its properties (recency, a world subject, an announcement/news verb), whether it's a question or a statement - so these two rows do one fix together, not two. Files (corrected from the original file pointers, which named `routing.ts`): `backend/src/lib/turnContext.ts`, `backend/src/lib/unknownNames.ts`, `backend/src/lib/turnEngine.ts` (a `decidedLookupFor()` extraction plus `runForcedLookup`), `backend/tests/routingCorpus.test.ts` and `backend/scripts/bench/routing.ts` (so the corpus harness checks the lookup decision when `route()` returns nothing, the same way it already checks skills), `backend/tests/turnContext.test.ts`. Corpus rows first, `spec-v0.1.19` alongside REPLY-FIND-02's row. Exit: `bash scripts/check.sh` and the routing corpus bench.


<a id="gate-speed-02-a"></a>

- [x] **GATE-SPEED-02 (a): run the backend and frontend legs of `scripts/check.sh` concurrently** (M, after GATE-SPEED-01's per-stage times exist, 2026-09-22) - **landed 2026-09-23.** Each leg's output buffered and printed whole; decided only on the measured peak memory of both legs together, since the one-gate-at-a-time rule exists because of memory pressure on a 24 GB machine. Only `full` scope pays both legs' cost (GATE-SCOPE-01 already narrows backend-only/frontend-only to one suite), so that's the one case parallelized. Measured: 323s serial to 232s concurrent (28% faster), peak memory 21.3 GB of 24 GB with the machine's own other load already counted in, no swap/port/flake issues. Full record and the before/after stage-time table in `docs/dev.md`'s own "GATE-SPEED-02 (a)" entry. Exit: `scripts/check.sh` twice green, stage times before and after in dev.md.


<a id="gate-speed-02-b"></a>

- [x] **GATE-SPEED-02 (b): fix the tests that fail only under the full run - done 2026-09-22, getmaipai/home#123.** This row's original scope (the wildcard-capture test in `turnEngine.test.ts`, the invention pre-check in `tier2.test.ts`, a "port 0 in use" failure) predates a real investigation: filing #123 found five different, real tests failing only under the full suite, none of them these two (the `tier2.test.ts` one was separately fixed as part of ROUTE-FIND-03 (b) above). Root cause for four of the five: a crisis/safety notification and a memory embed job are fired and never awaited in production (by design), so their DB work could still be running when the next test's own `resetDb()` wiped people/sessions out from under it - a new in-flight registry (`backend/src/lib/backgroundWork.ts`) tracks each one, drained after every test via a global `afterEach` in `tests/preload.ts` (a `beforeEach`-based first attempt measurably didn't work - still failed 4-5 times per 44-test run, since only `afterEach` for test N is guaranteed to finish before `beforeEach` for test N+1 regardless of cross-file registration order). One of the two crisis-overlay tests had a second, distinct bug: it calls `resetDb()` a second time inside its own loop over 48 registry keys, a call the global `afterEach` can't protect since that only fires between whole tests - drained explicitly there too, and its timeout raised (5s to 15s) since 48 keys of real work occasionally out-budgets bun's default under genuine full-gate contention; `NotificationBell.test.tsx` hit the identical timeout-under-load shape and got the same two-layer `waitFor`+test-timeout fix its own sibling test already used. The fifth test (`MemoryPage.test.tsx`) no longer exists (retired by 7fe8d9e7's HOME-UI-02d rename to `PersonMemories.tsx`) - added a minimal regression test for its live, previously-uncovered `archiveMemory()` call site. Landed in c7f48acd. The "port 0 in use" failure from this row's original scope is unaddressed - not reproduced during #123's investigation, still open if it recurs.


<a id="gate-scope-01"></a>

- [x] **GATE-SCOPE-01: `scripts/check.sh` runs only the stages a diff can touch** (M, owner's rule, org `CLAUDE.md` "Verification" > "Scoped gates", 2026-09-23) - **landed 2026-09-23.** On 2026-09-22 to 23 four sessions landed about thirty mostly frontend-only commits through one four-minute full gate, one at a time, with flaky reruns, each item waiting twenty to sixty minutes from done to live behind a backend suite no frontend file could break. Fixed: `check.sh` reads the working tree against `git merge-base HEAD origin/main` (never literally "the staged diff" - this workflow stages and commits in one step, so nothing is staged at the moment the gate runs, and a staged-only read would fall back to full every time; the org rule's own wording is being corrected to match), classifies the changed paths into `docs`/`frontend`/`backend`/`full` (a new `scripts/gateScope.ts`, unit tested with `bun:test` rather than left as untested bash string matching), and runs only that scope's stages. Rules, in order: a workspace `package.json`/lockfile, `.gitignore`/`.gitleaks.toml`, anything under the root `scripts/` (it holds the pin tags every workspace resolves from), a `spec/` workspace path (home has none today, dead code as of this landing, kept and tested for when one exists again), or an unclassified path forces `full`; `frontend/` and `backend/` together forces `full` (crosses packages); a backend change touching a path `frontend/` imports directly (found live via `git grep` for `@maipai/home-backend/src/...`, never a hand-kept list; the match strips a known `.ts`/`.tsx`/`.js`/`.jsx` extension from both sides, so it still fires if a future import ever carries a compiled `.js` extension the source file doesn't) also forces `full`; otherwise the one package's scope, or `docs` if only docs changed. `frontend: typecheck` runs under both `frontend` and `backend` scope (the frontend imports typed backend code); `frontend: a11y` stays in `frontend` scope only (it never runs the backend's own suite, so it isn't the flakiness/slowness this rule exists to route around). The secrets scan and PII wordlist run in every scope, unchanged. `check.sh` prints the scope and why as its first line (`== scope: frontend (only frontend/ changed)`); a `--docs` call that turns out wider than docs runs the wider scope and says so rather than silently under-checking; `--full` always forces everything. 19 unit tests in `scripts/gateScope.test.ts` cover every rule (frontend-only, backend-only, docs-only, a bundled package's own README counting as backend not docs, `docs/api/` as backend, `.claude/` as docs, crosses-packages, a root pin/lockfile/scripts/spec/ change, a rename across packages via `--no-renames`, the direct-import escalation both ways and across a `.js`/`.ts` extension mismatch, an empty diff, an untracked file, an unclassified path). A medium review (this touches the gate's own guard logic) found and fixed five real gaps before landing: an "unbound variable" crash under `set -euo pipefail` on an empty changed-file list on this machine's own bash 3.2 (`"${files[@]}"` on a genuinely empty array, a known pre-4.4 bash quirk - the exact "clean tree, nothing to scope" case the empty-diff rule above exists for), a leaked temp-file pair on any failure path (a `RETURN` trap doesn't fire when `set -e` aborts the whole script from inside the function - confirmed live; fixed with an `EXIT` trap whose command string is expanded at registration time, since the function's own locals won't exist by the time a later `EXIT` fires), a stale comment naming a `frontend_imported_backend_paths()` function that was inlined and never actually created under that name, the `.js`-extension gap above, and the missing `spec/` test/doc coverage above. Exit: `bash scripts/check.sh` (its own new scope line, plus a full run to verify the change itself) and the unit tests. **Follow-up, same day (coordinator-directed):** an untracked file left by another session in a shared checkout was still being gathered (`git ls-files --others`) and could widen a run past what `--docs` or the real tracked diff actually needed (live case: a stray `backend/scripts/bench/query-rewrite.ts` widened a `--docs` run to `backend`, four minutes for a docs-only change). Fixed: tracked, changed files decide the scope whenever any exist; untracked files are only consulted as a fallback when nothing tracked changed at all (a review caught a first, naive "drop untracked entirely" fix regressing the ordinary new-file-before-`git add` case back to forcing `full`). New `scripts/checkScope.test.ts` (3 cases) proves the real bash against a real scratch git repo, extracted live from `check.sh` itself, not just `classifyScope()` in isolation. Writing it also hit and fixed `getmaipai/home#144` (a `git grep` "no matches" exit killing the pipeline under `set -e`, dormant on the real repo, immediate on the test's own minimal fixture). See `docs/dev.md`'s own "GATE-SCOPE-01 follow-up" entry for the full record.


<a id="gate-hook-01"></a>

- [x] **GATE-HOOK-01: a commit is refused without a green, scope-covering `check.sh` on record** (owner's rule, 2026-09-23) - **landed 2026-09-23 (`getmaipai/.github` `432ba77`).** `require-gate-before-commit.sh` / `mark-gate-checked.sh` enforce GATE-SCOPE-01's scope at commit time from the real staged diff, independent of what `check.sh` itself guessed - the mechanical backstop for "run a check before every commit" that GATE-SCOPE-01 alone can't provide (a session skipping or misreading the gate is a hook it can't see, not a policy it can forget). 16 review findings across two passes fixed before landing. This is a `.github`-only change (the hook ships from the shared plugin, not a home-side script), so it has no home implementation of its own; this row exists only so home's own BACKLOG carries the record. Exit: `getmaipai/.github`'s own checks.


<a id="route-find-04"></a>

- [x] **ROUTE-FIND-04: literal routing prefers the most specific pattern, and a discourse "look," is not a command** (S, corpus first, 2026-09-22; from ROUTE-FIND-03 (b)'s review, 2e67fd9e). (a) `routeLiteral()` (`turnEngine.ts` near :1445) resolves two packages' matching patterns by the alphabetical package order of `loadAllManifests()`, not by specificity, so a package sorting after `websearch` with its own "search"/"look up"/"google" pattern is silently shadowed; the music/websearch collision is pinned by a corpus row, the mechanism is not fixed. Fix: among matching patterns, the one with the longest literal prefix wins, ties by package id. (b) `commandOpenersFrom()` takes a pattern's first word as a bare command opener, so "look up *" made "Look, I really think we should talk about this" a directive the memory judge skips; the same trait already misfires on "Put simply, ..." and "Open your eyes to ...". Fix: an opener is the pattern's full literal prefix before the first wildcard, and a first word followed by a comma is never an opener. Tests in these exact words: "look up the artist Adele" routes to music whatever the package order; "Look, I really think we should talk about this" and "Put simply, it's complicated" are not directives. Out of scope: (c) the review's note that "search the house for the keys" routes to websearch, which is the owner's stated rule for a leading "search" (ROUTE-FIND-03 (b)). Exit: `scripts/check.sh` plus the routing corpus replay. **Landed 2026-09-29 (Codex, `254ca1d1`):** both fixes in, the three named tests pass, routing corpus replay 111/111.


<a id="reply-find-01"></a>

- [x] **REPLY-FIND-01: a repeated question gets its right answer again, never the stuck line** (S, regression test first, 2026-09-22; superseded, never ticked - D4 deleted `isRepeatReply()` whole, confirmed gone from `guards.ts` 2026-09-25). **Thrown away 2026-09-22:** the repeat guard it would patch is deleted whole in D4 (`docs/plans/simple-turn-pipeline-2026-09-22.md`); if the flip is more than a week out, this row's one-line exemption may land as a stopgap, and is deleted with the family regardless. Found in the owner's own chat and traced from the hub's rows: "who is the president of France", asked twice fourteen hours apart in one conversation, got a correct 35-token answer both times, and the second was thrown away. `isRepeatReply()` (`backend/src/lib/guards.ts` near :1278) found 80 percent overlap with the earlier answer and no new number or proper noun, the one retry gave the same answer, and the loop line replaced it (`guards.ts` near :2128, :2190); the row reads `guard_reason: repeat_reply`. Its only exemption is "say that again" (`repeatRequested`). Fix: (a) when the current utterance matches an earlier user turn in the window (the same normalization the guard uses for replies), the same answer is correct and the guard does not fire; (b) the previous replies the guard compares against come from the same sitting only (a gap of more than the session idle threshold ends a sitting; reuse the constant the window already uses if there is one, else name one in `turnContext.ts` beside `previousReplies`). Mirror the existing REP-01 tests in `backend/tests/` (grep `isRepeatReply`). Acceptance: a test in these exact words (the question asked twice, the second reply the same) passes through unchanged; a test with a 14-hour gap passes through; every existing REP-01 test still passes. Out of scope: the repeat guard's thresholds. Exit: `scripts/check.sh`. Diagnosis: `docs/plans/arch-review-2026-09-22.md`'s companion chat trace, this row.


<a id="reply-find-02"></a>

- [ ] **REPLY-FIND-02: news about a current subject earns a lookup or a question, not a react-and-agree** **Dropped 2026-10-02: retired by docs/design/RULES.md chat rule 1.** Do not build; the text below is kept as history. (M, corpus first, 2026-09-22). **Thrown away 2026-09-22:** the lookup ladder is deleted whole (D1/D2, `docs/plans/simple-turn-pipeline-2026-09-22.md`); the model's tool call plus the interim always-search rule covers this row without a properties fix. Found in the owner's own chat: "new trailer for primetime just dropped" was read as an inform about a world subject (kind trailer, recency current) and given the inform plan (react allowed, ask-back forbidden, 30 words, two sentences); no lookup ran because the ladder only fires on a question with an exact field (`turnContext.ts` near :281, :303-305), and a stale memory (a release date) let the model answer "you've got the date right" about a date the person never gave. Fix: the ladder accepts an inform carrying current recency about a world subject (the signal already has target, kind and recency), and the inform plan allows an ask-back (`register.ts` plan table). Acceptance: the utterance in the routing corpus with its expected rung; a turn test that it reaches websearch; the existing inform rows unchanged. Out of scope: the memory framing (REPLY-FIND-04). Exit: `scripts/check.sh` plus the routing corpus replay.


<a id="reply-find-03"></a>

- [ ] **REPLY-FIND-03: a correction repairs the last turn, and a deliverable search keeps the person's noun** **Dropped 2026-10-02: retired by docs/design/RULES.md chat rule 1.** Do not build; the text below is kept as history. (M, corpus first, 2026-09-22). **Thrown away 2026-09-22:** a correction is conversation the model reads from the window (`docs/plans/simple-turn-pipeline-2026-09-22.md`); the deliverable rule it would also patch is deleted in D5. Found in the owner's own chat: "no, I was talking about the trailer" was read as a correction, but the deliverable rule fired on "trailer" as a video, forced a websearch, and the query builder sent "Primetime video": the first result was a streaming storefront, the actual trailer third, and the composer said "Here's a video, the link's below". Fix: (a) a turn whose signal is `repair: correction` re-reads the previous utterance with the corrected subject through the same ladder REPLY-FIND-02 adds, so the corrected turn reaches the lookup the original should have (the original turn had no intent to re-run: rung none, no outcome); (b) the deliverable query keeps the person's own noun ("trailer", not the kind "video"), and result selection prefers a title containing that noun. Files: the deliverable rule and query builder (grep `deliverable.video`, `lookup.forced` in `backend/src/lib/`). Acceptance: both turns as a two-turn corpus row; a query-builder test that "trailer" survives; a selection test that a title with the noun beats a storefront. Exit: `scripts/check.sh`.


<a id="reply-find-04"></a>

- [x] **REPLY-FIND-04: a remembered fact enters the prompt dated and labeled, never as the person's words** (S, 2026-09-22; the 2026-09-16 review's item 5; superseded, never ticked - shipped as part of U5, `800329ba`, confirmed live at `turnEngine.ts:948` 2026-09-25). **Folded into U5 2026-09-22** (`docs/plans/simple-turn-pipeline-2026-09-22.md`, "The chat rebuild" area above): built on the new path's shared context list, both paths' input. Memory snippets reach the prompt as bare text, so the model presented a remembered release date as something the person had just said. Fix: each recalled memory renders as a typed, dated line ("remembered Sep 15: ...") where the memory block is assembled (`turnEngine.ts` near :580-584). Acceptance: a prompt-assembly test that each recalled memory carries its date and a "remembered" label; the existing recall tests pass. Out of scope: the memory budget (see `docs/plans/arch-review-2026-09-22.md`). Exit: `scripts/check.sh`.


<a id="arch-amend-01"></a>

- [x] **ARCH-AMEND-01: amend the four ARCH rows and RESP-01 to the accepted review** (M, design, 2026-09-22, done 2026-09-22: each ARCH row carries an "Accepted design" paragraph, RESP-01 is rewritten against `register.ts`, the response-contract record's item 1 is amended, and the `c-99f2` brief is back in `open/`; owner ruling "accept all" on `docs/plans/arch-review-2026-09-22.md`). The three ranked findings are now the design: (1) ARCH-AGENT-01 sizes by measured per-model capability from the tool-calling bench (stored with the model in the catalog), not the governor's memory tiers; keep safety, a properties-admitted fast path and one completion with tools; add the deterministic action-plan executor; a second round only when a bench row needs it; a stable offered tool set per model. (2) ARCH-POLICY-01's boundary runs over one `ContextItem` list (text, source channel, subject ids, disclosure), the only thing a prompt is built from, and presence is a turn input on every surface. (3) One ReplyPlan (the spec's existing `reply-plan.json`, extended with fact classes and a surface-derived budget) is the only place length is decided; `max_words` comes from surface and evidence, not the act table (`register.ts` `planFor`); reply constraints decay by turn count. Work: rewrite each ARCH row's design section and RESP-01's files and acceptance to match, mark superseded text as such, and rewrite the held lane brief `c-99f2` (RESP-01) against `register.ts`. Owner: the Fable session (design). Exit: the docs-only gate.


<a id="lookup-head-01"></a>

- [ ] **LOOKUP-HEAD-01: a learned head decides whether a turn needs a lookup** **Dropped 2026-10-02: retired by docs/design/RULES.md chat rule 1.** Do not build; the text below is kept as history. (M, after ROUTER-RLCD-01 reports; Opus for the design and the bench read, Sonnet for the integration; decided 2026-09-22). The design ruling of 2026-09-22 (owner: the word-rule fixes for casing and pronouns are fragile): code decides whether a lookup may and must run from a small closed set of counted properties (a currency marker, a world subject, a news verb with a time window, a present-tense office-holder question), the model's own tool call and the draft reader; the model writes the query (REPLY-FIND-05). This item replaces the properties as the admission decider: a calibrated head over the rows' `rung` and `corrected_next_turn` labels (harvested by `scripts/bench/labels.ts`, the 2026-09-16 review's item 3), the properties kept as the day-one fast path, each regex family retired on the per-rule hit report. Measured 2026-09-22 on the 8B: 0 false tool calls in 100 negative repeats, the failure class is declining a search that fits, so admission cannot be left to the 8B alone. **Track-3 verdict, 2026-09-22 (dev.md, "Track 3: the local decider verdict"):** open-jev-deberta-v3-large is the path, after fine-tuning on household labels; zero-shot it reproduces the interim rule's decision and its failure (every ambiguous negative admitted, 5 of 5) at 65 ms, so it does not enter shadow mode as it stands; jeff and openjev are dropped. Order: (1) the labelled set (U0a's replay rows, the corpus's question and null rows relabelled for lookup need, the owner's own labelled turns, never a frontier model over household transcripts (egress; a frontier model may label roster-based synthetic data only), ambiguous negatives included; `corrected_next_turn` is NULL on every row today, so `labels.ts` starts writing it first), (2) the shadow seat inside U2's model node writing the head's choice and probability to `stats.nodes[]` beside the rule's decision and the model's call, (3) the fine-tune, calibrated, shipped as a fetched artifact, run on CPU, (4) the bench against the interim rule and the 8B's own call on held-out rows and the replay set; adopted per model budget when its false-positive rate on ambiguous negatives beats the rule's with no positives lost and the five-point margin on the corpus. The robot fits on paper (400M, about 1.6 GB f32) and is measured when a Pi is reachable. **Astra's amendments (2026-09-22):** DeBERTa is a pilot, the ModernBERT head runs in the same bench; shadow mode may start once a labelled set exists, with bounded overhead and disagreement logging; 500 to 1,000 locally labelled examples split by conversation; precision, missed lookups, Brier and reliability at the operating threshold; GLiFormer inconclusive; frontier labelling of household transcripts is ruled out (egress). Not before the labelled set. Exit: the bench table in dev.md and `scripts/check.sh`. **Candidate (2026-09-26): Laya (`convaiinnovations/laya`, 421M, Apache-2.0 per its announcement, weights verified on Hugging Face), the open reproduction of the typed-decision model the stack's jev-and-yue note rejected as hosted-only; see the harness design record's decision-layer section. Fine-tuned on labeled roster-synthetic rows only (zero-shot is below the majority-class baseline), calibration study then shadow mode before it decides anything live, never in a safety path.** **Second candidate (2026-09-26, same note as ROUTER-RLCD-01's third): CLM-v0.1-8B's zero-shot `Noul` may take the shadow seat ahead of any fine-tune only if ROUTER-RLCD-01's bench shows its probability is calibrated on our rows; otherwise Track 3's verdict stands and its heads-only fine-tune is a second recipe for the same labelled rows once they exist.**


<a id="arch-measure-01"></a>

- [x] **ARCH-MEASURE-01: the three measurements the four ARCH records wait on** (M, bench, 2026-09-22; verdict written 2026-09-22 22:45, dev.md "ARCH-MEASURE-01: the per-model budget verdict": the 8B, 4B and 1.7B budget records with every unmeasured cell marked and the conservative value taken, always-search on for all three, model-driven transitions on for the 8B only, and a new budget field `query_writer`: the engine's builder writes the query for the 4B and the 1.7B (rewrite 1 of 8 and 2 of 15 rows at the bar), the model for the 8B pending its quiet run; the owed reruns are MEASURE-02). From the independent review (`docs/plans/arch-review-2026-09-22.md`): (1) the tool-calling bench (`scripts/bench/tool-calling.ts`) per candidate chat model on the fixed pipeline, irrelevance detection at 10 repeats; (2) llama-server's cached versus evaluated prompt-token counts on two consecutive turns whose offered tool sets differ (confirms or kills the prefix-cache hypothesis); (3) the routing corpus decision table ARCH-AGENT-01 asks for. A first data point for (1): on 2026-09-22 04:21 the 8B, with websearch offered on the same completion, did not call it for "search who won the Seattle Mariners game yesterday", a measured miss in the inverse direction (a tool that fits, declined) on the fixed pipeline. Numbers recorded in dev.md with engine build, model file and a sanitized hardware line. No ARCH design record starts before this lands. Exit: the three tables in dev.md.
    Superseded 2026-10-02 by chat rule 8; the code goes in the stage named in the thin-path record (stage 6).


<a id="temp-chat-01"></a>

- [x] **TEMP-CHAT-01: a temporary chat that is never remembered** (M, backend first). ChatGPT's temporary chat, and on a household hub whose whole premise is that it remembers, it matters more than it does there: a parent must be able to ask something without it entering history, the thread list, or memory. Not a UI feature - a turn-pipeline one. A conversation marked temporary writes no `conversations` row and no `conversation_turns` rows, and the memory judge never runs on its turns (`backend/src/lib/` memory extraction path); it is gone when the tab closes. **Safety is never skipped**: the safety-first order in `turnEngine.ts`, the role floors and the guards all run exactly as they do on a normal turn (`.github/docs/SAFETY.md`: child-safety protections are non-removable architecture, not a setting), and a child's temporary chat is still age-gated and still subject to every content ceiling. What a temporary chat skips is persistence and memory, nothing else. **Amended 2026-09-22 after Session B found a temporary chat already ships** (Chat 55, `d892052a`, wired into the OLD hand-built chat): turns are already skipped, the thread list already excludes it, minors already get a 403, and the memory judge already cannot see it - but it still writes a content-free `conversations` row. That row goes. What it leaks is metadata (this person had a conversation, on this surface, at this time), which on a household hub is the thing the feature exists to prevent; content-free is not the same as absent. So: no table touched at all, and the multi-turn window lives in process, keyed, size-capped and idle-expired, extending `resumeSessions`/`inFlightTurns` rather than a second store (Session B's catch: a strict zero-row reading without this makes every turn amnesiac, which is a broken chat, not a privacy feature). One implementation, not two - the old chat's call site uses the new path; SHELL-09 deletes the old chat itself. Reasoning: `.github/docs/DECISIONS.md`, 2026-09-22. Entry point: the conversation header's menu (CHAT-HEADER-01) and a New Thread variant, both labelled so a parent understands what is and is not kept. **Widened 2026-09-22, an independent review**: the durable-write audit missed `queueOpenQuestion` (`turnEngine.ts`'s `resolvePendingAsk`, the "who"/"relay" continuation) - unreachable for a temporary conversation in practice (its own `getPendingAsk`/`setPendingAsk` gate already closes the path, proven by a direct test rather than assumed), but named in the acceptance anyway so the guarantee is stated, not inferred from a chain of other things happening to hold. Acceptance: a temporary turn leaves no row in `conversations`, `conversation_turns`, `reply_constraints`, or `open_questions` (asserted directly against the db), the memory judge is never invoked (asserted with a spy), `host.artifact.create()` refuses cleanly instead of hitting the provisional-turn foreign key, the thread list does not show it, a child's temporary turn still hits the same safety path as a normal one (a test that a blocked utterance is still blocked), and reloading loses it. Out of scope: exporting one before it is discarded. Exit: `bash scripts/check.sh`.


<a id="chat-header-01"></a>

- [x] **CHAT-HEADER-01: the conversation's own title and actions, in the shell header** (M, done 2026-09-23, `b4b5814c`). ChatGPT puts the conversation title top-left with its actions top-right (rename, share, and the rest); the owner wants the same, **on every chat, not only project chats** (owner's call, 2026-09-22: a header that appears only inside a project makes the chrome jump when you move between them, and the actions it hosts are needed everywhere). **It does NOT add a row.** The title and its actions go into the shell header that `shadcndashboard` already renders, beside the existing trigger; a second bar under it repeats the mistake the owner already rejected once (2026-09-21, the chat sidebar toggle 'wastes an entire row of space'). **Named gap (the no-hand-built-UI rule):** the pinned kit (ui-v0.5.29, 144 elements) has no thread-header or conversation-header Element - verified by inventory, not assumed - so the composition is the template's own header slot plus its DropdownMenu primitives, and nothing else is invented. Share uses the shipped `shared-conversation.tsx`. Contents: the conversation title (inline-editable rename), and a menu with rename, share, delete, and the temporary-chat entry (TEMP-CHAT-01). An untitled conversation shows the same placeholder the thread list uses, never a blank bar. Acceptance: the title renders and renames on a normal chat and inside a project, the shell grows by zero rows at 1440 and at 400 (screenshot pair judged as one design, per the mobile rule), the menu's actions each work, and the header is absent on non-chat pages. Depends on: SHELL-09's cutover. Exit: `bash scripts/check.sh` and the captures.

<a id="chat-header-02"></a>

- [x] **CHAT-HEADER-02: the app's icon beside the header title, on every app page** (S, Sonnet; owner's ask 2026-09-23) - **landed 2026-09-23.** Objective: the header's left slot (CHAT-HEADER-01's `HeaderExtraLeft`) shows the current app's icon before its title on every app page, the chat page included, drawn from the one definition the sidebar already reads (the package manifest's icon, the kit's icon set for the built-in pages), never a second icon table. Files: `frontend/src/apps/chat/chatHeaderBar.tsx` (a `getIcon("message-circle")` sibling prepended, the exact icon `sidebaritems.ts` uses for "Chat"), the new `frontend/src/shell/pageHeaderTitle.tsx` (a shared, stable module-level component reading the route via `useLocation()`, looking up `SidebarContent` - commons `sidebaritems.ts` - for the four rail pages, falling back to each of the five off-rail "Manage" pages' own already-declared `getIcon()` constant, "gauge"/Performance the one genuinely new pick since that page never showed an icon anywhere before), and `frontend/src/shell/Routes.tsx` (a new `PageHeaderLayout` route wrapping every non-chat `/` page - a true sibling of the chat route, not an ancestor of it, so the two `useHeaderExtra` owners never race on navigating between them). Mirror: the sidebar's icon lookup. Acceptance met: the chat header (the sidebar's own Chat icon) and the dashboard page (the sidebar's own Home icon) show the same icon the sidebar shows for them, captured at 1440 and 390, light and dark, opened and judged - no icon drawn by hand, every one routed through the shared `getIcon()` registry. The Search field is gone from every non-chat page as a direct consequence (SHELL-SEARCH-01's own icon+dialog replacement is still to come; this item only removes the old field, per that row's own framing of CHAT-HEADER-02 as already done by the time it starts). Out of scope (unchanged): the search control (SHELL-SEARCH-01). Exit: `bash scripts/check.sh` and the captures opened.

<a id="chat-header-03"></a>

- [x] **CHAT-HEADER-03: the title takes the header's free width** (S, Sonnet; owner's ask 2026-09-23) - **landed 2026-09-23.** Objective: the conversation title in the header is clipped at about 290 px today ("why did corey feldmans friendshi"); it grows to the width the header has left after the sidebar trigger and the right-side controls, truncating with an ellipsis only when it must, the chevron staying beside the last visible character; on the phone the same rule at the small width. Files: the header slot component from CHAT-HEADER-01, and (a genuine structural need, not scope creep - a flex row can't hand a child free space unless the child itself participates in growth) `chatHeaderBar.tsx`'s shared vendored ancestor, commons `dashboard/layouts/full/vertical/header/Header.tsx`. Mirror: the template header's own flex rules (`min-w-0`, `flex-1`/`flex-auto`, `truncate`), tokens only, `ui-v0.5.37`-`0.5.39`. Two real defects found live capturing this item's own acceptance shots (never assumed correct without opening them, per the screenshot standard): `flex-1` (zero flex-basis) on the header's shared left group broke the *other* pages' default Search fallback at a narrow-but-not-phone width, overflowing it into the right icons instead of the row wrapping - fixed with `flex-auto` instead, verified in a real browser (37 widths, 640-1000px, zero overlaps). Then `flex-wrap` itself, kept for that fix, forced this item's own genuinely-long title to wrap the whole row onto two lines at 390px instead of truncating on its own line - fixed with `flex-nowrap` below `sm` (640px, where the Search fallback is hidden anyway) and `flex-wrap` at `sm` and up, keeping both fixes. Acceptance met: a real 60-character title (`scripts/screenshot.ts --chat-header-title-review`, new) reads whole at 1440 and truncates with no wrap at 390, captured light and dark, opened and judged. Exit: `bash scripts/check.sh` and the captures opened.

<a id="shell-search-01"></a>

- [x] **SHELL-SEARCH-01: a permanent search control left of the theme toggle** (S, Sonnet; owner's ask 2026-09-23) - **landed 2026-09-23 (commons `6992fe8`, `ui-v0.5.43`; home `d8319fe6`, the pin bump).** Objective: the template's header ships a menu search in its left area (`dashboard/layouts/full/vertical/header/Search.tsx`) that the chat page's title displaced and that the home page and every other non-chat page still show; that input goes away everywhere (owner's ruling 2026-09-23: one search, the same on the home page as on chat), the left slot carries the page's icon and title on every page (CHAT-HEADER-02), and every page gets a search icon button in the header's right group, left of the theme toggle, that opens the template's own command dialog (`dashboard/components/ui/command.tsx`, used as it ships) searching the sidebar's items with the template's own logic, and Cmd+K opens the same dialog; threads, apps and people join the results as later rows. An app's own in-page search stays where it is (chat's "Search threads" over its thread list, a table's filter): the header icon is the one global search, an app's search is that app's own, and the two are never merged (owner's ruling 2026-09-23). Files: the header composition in Home, no edit to the vendored header (compose through its extra slots or wrap it; if the right group has no slot, name the gap in `commons/ui/docs/dashboard-upstream.md` first). Mirror: the template's Search component and its command dialog. **Landed:** a new `HeaderSearch.tsx` (commons), the documented gap - the right group ships no extension slot at all, so this is one more unconditional render in `Header.tsx`, the same shape its two existing icons already are, never a per-page override slot (the icon and dialog are identical on every page). Composes only shipped parts: the icon button opens `command.tsx`'s own `CommandDialog`, filtering `sidebaritems.ts`'s own `SidebarContent` with `cmdk`'s own built-in filtering, never a hand-rolled match. A real bug found writing the test: `command.tsx`'s own `CommandDialog` doesn't wrap `{children}` in cmdk's own `<Command>` root the way shadcn/ui's stock version does - fixed by supplying one, not by editing the shipped file. Acceptance met, verified live on 8787 after the pin bump (not assumed from the tests alone): the icon is present on Home, Chat and Settings at both widths, the left-area input is gone from all three (asserted 0 in the DOM), the dialog opens on click, typing "peo" narrows to exactly the People result, Enter navigates to `/people`. Exit: `bash scripts/check.sh` and the captures opened.

<a id="shell-search-02"></a>

- [x] **SHELL-SEARCH-02: conversations, people, apps and settings join the header's one search** (M, Sonnet, 2026-09-23; design note `docs/plans/shell-search-2026-09-23.md`, which is the work order) - **landed 2026-09-23.** `GET /api/search?q=` (`backend/src/routes/search.ts`, `createRoute`/Zod like `routes/approvals.ts`, in `/api/docs`) returns pointer results grouped by kind from four providers (`backend/src/lib/search/providers.ts`): conversations reuse `listConversations()` (title/body, temporary chats already excluded, the actor's own only); people reuse `listActivePeople()` (`GET /api/people`'s own rule: every signed-in person sees the full roster, no narrower filter invented here); apps reuse a new `listInstalledManifests()` (`lib/plugins.ts`, extracted so `GET /api/plugins` and this route share one pipeline instead of two copies); settings read `getRegistry()` directly (SETTINGS.md's one definition), excluding `expert`-level keys and, for a non-admin actor, household-scope keys too (they have no tab to reach one on - `SettingsPage.tsx`'s own owner/admin gate). `commons` `HeaderSearch.tsx` gained an optional `remote` prop (`ui-v0.5.50`, two commits - the feature, then a live-testing follow-up fixing `go()`'s own missed state reset), 200ms debounced past two characters, cmdk's own default filter given an always-pass override for `remote`'s own results (a review caught it silently dropping a server-ranked result with no textual match to the query) alongside its shipped `defaultFilter` for the sidebar's own items, unchanged. `SettingsPage.tsx`/`SettingsRenderer.tsx` gained `?tab=`/`?section=` deep-linking (a Card `id`, `scrollIntoView`, both kept in sync with a later navigation while the page stays mounted - two review findings, a lazily-seeded state and a permanently-latched scroll ref, both fixed). People and apps have no per-item detail route in the new shell yet (checked live before building one) - both open their own list page rather than inventing a page this item doesn't own. A third review finding, a whitespace-only query bypassing every provider's own match filter, fixed once at the route rather than four times per-provider. Verified live on 8787 (the real household, not a seeded demo - the same household already used verifying PERSIST-STRUCTURED-01/TOOL-EVENTS-01b the same day) at desktop and 390px: all four groups render together, a settings result lands on the right tab and scrolls to the right section, a conversation/app result opens the right page. Out of scope, unbuilt: message-body search (SHELL-SEARCH-03, FTS5), in-app search, ranking beyond cmdk's own ordering, any spec record. Exit: `scripts/check.sh` as scoped, both repos.


<a id="shell-search-03"></a>

- [x] **SHELL-SEARCH-03: message-body search on SQLite's own FTS5, not a LIKE scan** (M; design note `docs/plans/shell-search-2026-09-23.md`, SHELL-SEARCH-02's own "out of scope, unbuilt" line). **Landed 2026-09-24.** `backend/src/db/migrations/0063_conversation_turns_fts.sql` (mirrors `0028_parallel_living_lightning.sql`'s own `episodes_fts` pattern) creates `conversation_turns_fts`, its three sync triggers, and backfills the household's existing rows (323 turns on the real running instance, verified: `SELECT count(*)` from both tables matched after the restart). `conversationHistory.ts`'s `listConversations()` turn-body half now queries FTS5 (`matchQueryFor()`, AND-joining `contentTerms()`'s tokens, double-quoted - a narrowing search box, deliberately not `episodes.ts`'s own OR-joined `ftsQueryFor()`, a broadening recall generator); the title half is unchanged (still `LIKE`). A real, load-bearing bug was found and fixed along the way, reproduced in isolation first: SQLite's own `sqlite3_changes()` counts an AFTER trigger's own writes too, not just the row the caller's statement touched, so three call sites that read `.changes` off a raw DELETE/INSERT against `conversation_turns` were silently over-counting once the trigger existed - `runRetention()` (now `expiring.length`, already read before either DELETE), `personLifecycle.ts`'s erasure receipt (now a pre-delete `SELECT COUNT(*)`), and `partialRestore.ts`'s `copyPersonScopedRows()` (a generic helper for every table it copies, now a before/after count delta, immune for any of them). Two review passes (medium, the required level for a migration plus a query path) found and fixed two more real gaps: a rewritten test that claimed to prove title-LIKE escaping but never set a title (so it silently passed via the FTS5 body match instead - now genuinely tests the title path, with a real title on both the matching and non-matching conversation), and the erasure count's own test loosened from `toBeGreaterThan(0)` (passes identically whether the counting bug is present or fixed) to `toBe(1)`, the one turn the fixture logs. Filed getmaipai/home#152 for three smaller, deliberately deferred findings (an AU trigger WHEN-guard - not touched now since the migration is already applied live and editing it in place risks a hash mismatch with the running database; `matchQueryFor`/`ftsQueryFor` de-duplication; unifying the three `.changes`-workaround techniques). Tests: `backend/tests/conversationTurnsFtsMigration.test.ts` (new) proves the migration against a copy of a populated database (undoes just this migration's own objects on top of `resetDb()`'s real schema, seeds real rows the ordinary way with no trigger listening, re-runs the migration's own SQL) - the backfill finds pre-existing rows, the AI/AU/AD triggers each proven directly (an edit makes the old words unfindable and the new ones findable, a delete removes exactly its own entry), a pre- and post-migration row both findable together; `conversationHistory.test.ts` covers the multi-word AND behavior, an FTS5-keyword-shaped query term read as literal text (`matchQueryFor`'s quoting), and the title path's own escaping, all alongside the pre-existing "searches titles and turn text" test (a word only in a reply's body, `q=herbs`, already proved the acceptance's own "word inside a message body finds its conversation" case). Full backend suite (4148 tests) green, run three times across the session. Live: searched a real word from a message body only (never the conversation's own title) against the real running household at 1512 and 390 widths, driven headless - one matching conversation, same result and layout at both. Objective: the conversations provider (`backend/src/lib/search/providers.ts`) already searches message bodies today through `listConversations()`'s own query path (`backend/src/lib/conversationHistory.ts`), but that path is a plain `LIKE '%...%'` scan over `conversation_turns.user_text`/`reply_text` with no index - correct, but a full table scan on every keystroke past two characters (SHELL-SEARCH-02's own 200ms debounce), and no real ranking (matches come back in whatever order the scan finds them). Replace it with a SQLite FTS5 virtual table over `user_text`/`reply_text`, kept in sync with `conversation_turns` by triggers (INSERT/UPDATE/DELETE), never the app writing to both tables itself (a second write path is exactly the class of drift SHELL-SEARCH-02's own header comment already refuses for a provider - "never a second index, never a parallel copy of data another route already serves" - the trigger keeps that true by construction). A new hand-written migration (`backend/src/db/migrations/`, the next number after what's on `main` when this lands, drizzle-kit doesn't generate virtual tables or triggers from `schema.ts` - follow an existing migration's own raw-SQL style) creates `conversation_turns_fts` (`fts5(user_text, reply_text, content='conversation_turns', content_rowid='rowid')`, contentless-adjacent so the index carries no second copy of the text itself) and the three sync triggers, backfilled once for existing rows (`INSERT INTO conversation_turns_fts(conversation_turns_fts) VALUES('rebuild')` after the table exists, or an explicit backfill insert - whichever the migration's own dry run proves correct against a household's real row count). `listConversations()`'s query-matching branch (the `matchingTurnIds` half, `conversationHistory.ts` around line 1378) switches from the `LIKE`/`ESCAPE` clause to an FTS5 `MATCH` query (`bm25()` for ranking, a real household's actor/temporary-chat/status filters unchanged and still applied outside the FTS5 join, never inside it - a household's own privacy rules are the app's, not the index's); the title-matching half (`matchingTitleIds`) stays a plain `LIKE`, since a title is short enough that an index buys nothing and FTS5 tokenizes on word boundaries a partial title match would miss (a substring inside a word, still a real, common way people search a short title). Mirror: an existing raw-SQL migration for the CREATE TABLE/TRIGGER style; `conversationHistory.ts`'s own existing query-building shape for how the FTS5 branch slots in beside the title branch. Tests in these words: a fresh row's message body is findable by FTS5 immediately after insert (the trigger fired); an edited turn's old text is no longer findable and its new text is; a deleted turn's text is gone from the index; a multi-word query matches a turn containing all the words in either order (FTS5's own AND-of-terms default, `LIKE`'s substring-only behavior never could); the actor/temporary-chat/status filters still exclude what they excluded before, proven with an FTS5-matching row in another person's conversation. Acceptance: `scripts/check.sh` green including a clean-install migration run (a fresh DB migrates to the FTS5 table with no manual step); a live household search on 8787 for a distinctive word from an old message returns that conversation, and the debounce no longer needs to widen as the household's history grows (no acceptance number named - the row's own point is removing an unindexed scan, not hitting a specific latency bar). Out of scope: ranking beyond FTS5's own `bm25()` order, a message-body result of its own kind (still surfaces as a `conversation` result, same as today), any spec record. Exit: `bash scripts/check.sh`.

<a id="tokens-primary-01"></a>

- [x] **TOKENS-PRIMARY-01: tokens.css wins the cascade over the template's own preset, everywhere** (S). **Landed `e1c47fec` (2026-09-23), one commit after it** (`home-b-written-parity` worktree, Session B, second commit of the block). Traced the real import chain first, per this row's own instruction: `frontend/src/main.tsx` imports `@/shell/tokens.css`, which `@import`s the kit's `dashboard/css/globals.css` then the kit's own `tokens.css`, then declares Home's own `:root`/`.dark` override for `--primary` (and its dependents) last in the same file - plain, unlayered rules at identical specificity resolve by source order, so Home's own override, being textually last, wins. **Live-rendered against `vite build`'s real output (`scripts/verifyTokensCascade.ts`, headless Chromium, never a static grep): the cascade already resolves correctly today** - `--primary` computed `#046e81` (light) / `#2cd0ed` (dark), matching Home's own declared `hsl(189 94% 26%)`/`hsl(189 84% 55%)` (verified by real HSL-to-RGB math in the script, `hslToHex()`, not a hand-typed hex guess - `verifyTokensCascade.test.ts` proves the function itself against known conversions), never the kit's `#21a6ff` or the template's `oklch(0.205 0 0)`. Home's own `--primary` override (`frontend/src/shell/tokens.css:67`) has carried this value since `b2ca161e1` (2026-09-20), three days before this row was filed - the reported symptom could not be reproduced against `vite dev` either (a real finding, but a dead end: an unrelated pre-existing module-resolution crash in this fresh worktree's dev-server dependency cache prevented the app from mounting at all, so no CSS conclusion could be drawn there; `vite dev` is moot regardless, since the product only ever ships `vite build`'s output and `bun start` is what Home actually serves). No code fix was needed or made (`globals.css` untouched, no `@layer` introduced - the existing import order already carries the invariant this row asked for); the general fix landed is the regression guard itself: `bun run verify:tokens-cascade` (root `package.json`) builds the frontend, serves the real `dist/`, and asserts computed `--primary` in both themes against Home's own declared value, captures saved to `data-scratch/tokens-cascade/` (gitignored) for a person to open and judge - both opened and judged here: a real "Reload" button (the app's error boundary, the only primary-colored element a backend-less build renders) shows the correct cyan in both themes, no near-black, no electric blue. A short comment in `frontend/src/shell/tokens.css` (after the two kit `@import`s) documents the invariant and points at the script. Acceptance's literal "before/after capture" could not be produced honestly - there is no reproducible "before" to contrast against - so this is reported as a finding rather than a fix: **flagging for the coordinator that this row's own filed premise did not hold against `main` at landing time**, most likely because the VOICE-LIVE-05 finding it cites was made against a dev-mode render, or against a build state a later, unrelated commit already changed. Files: `scripts/verifyTokensCascade.ts`, `scripts/verifyTokensCascade.test.ts`, `frontend/src/shell/tokens.css` (comment only), root `package.json` (`verify:tokens-cascade` script). Review: low (a new verification script and a comment, no app code changed). Gate: same full run as WRITTEN-PARITY-01's commit (one gate for the block, per the coordinator's own "gate per push" rule) - `scripts: bun test` (3 new `hslToHex()` cases, 3 pass) plus the full frontend/backend legs already green. Full account: dev.md "TOKENS-PRIMARY-01: tokens.css wins the cascade over the template's own preset, everywhere." Objective: found live fixing VOICE-LIVE-05's own orb (dev.md, 2026-09-23) - `commons` `dashboard/css/globals.css` (the vendored template) declares its own competing `:root --primary` (shadcn's own near-black neutral default, `oklch(0.205 0 0)`) at the identical selector and specificity as `ui/src/tokens.css`'s own `#21a6ff`, and on a real light-theme render the template's own value can win. The orb worked around this with its own dedicated `--voice-accent` token, which stays exactly as it is - this item is the general fix, so no OTHER surface reading `--primary`/`bg-primary` (the composer's own send pill in Jesse's screenshot looked exactly this wrong too) needs its own one-off dedicated token next. Fix the cascade once - the kit's own CSS import order, or a `@layer` so `tokens.css`'s values always win over whatever the template's own preset declares for a token name the template redeclares - never a per-token workaround, and never edit `globals.css` itself (a vendored file). Files: wherever `tokens.css` and `dashboard/css/globals.css` are both loaded into the built page (trace the real import chain first, don't assume). Acceptance: a test reads the computed `--primary` in a real light render and a real dark render and asserts it against `tokens.css`'s own declared value (not the template's), never a static grep of the CSS source; a before/after capture of the composer's send pill and one primary button, light theme, opened and judged (the "before" shot proves the bug was real, not assumed). Out of scope: `--voice-accent` and the orb (VOICE-LIVE-05's own fix, already landed, not reverted or folded into this one). Exit: `bash scripts/check.sh` and the captures opened.

<a id="chat-list-01"></a>

- [x] **CHAT-LIST-01: a temporary-chat button beside New Thread** (S, Sonnet; owner's ask 2026-09-23) - **landed 2026-09-23.** Objective: the thread list's header gains a second button next to New Thread that starts a temporary chat (TEMP-CHAT-01's flow, the same action the title chevron's "Start temporary chat" entry runs, which stays), composed from the same shipped parts as the New Thread button (the assistant-ui thread-list Element's new-thread primitive pattern and a kit icon button with the kit's incognito icon), tokens only. Files: **`frontend/src/shell/pages/ChatPage.tsx`'s own `ThreadList`**, not `frontend/src/apps/chat/` as the row originally pointed - the thread list this item's own screenshots and Jesse's own live app both show is the `/chat` rebuild's, and that composition lives here (`apps/chat/chatHeaderBar.tsx` is a separate, header-only file CHAT-HEADER-01/02/03 already cover). New icon: `incognito` (lucide's `VenetianMask`, not previously in the kit), `commons` `ui-v0.5.41`. The button reuses the shipped `ThreadListNew` element itself (from `@maipai/ui/src/elements/thread-list.aui`, the same file New Thread's own button comes from) with the icon and label swapped for the incognito icon and a screen-reader-only "Start a temporary chat" - its own `ThreadListPrimitive.New` wrap already composes the passed `onClick` with the runtime's real thread switch, the same way `onNewThread` already works, so `onStartTemporary` only needs to call `armTemporaryChat` (arm the flag), never `switchToNewThread` itself (unlike `ChatHeaderBar`'s own header-menu entry, which has no `AuiProvider` ancestor and has to). Gated on `canHaveTemporaryChatRole(person.role)` the same way the header's own entry is - RESP-04(f): a child profile sees nothing, never a disabled button. Acceptance met: the button appears beside New Thread on both `ThreadList` call sites (the phone Sheet and the desktop rail), starts a temporary chat marked as such (a test asserting the next turn's `temporary: true`, mirroring CHAT-HEADER-01's own), a child profile gets no button at all (tested); captured at 1440 and 390, light and dark (`scripts/screenshot.ts --chat-list-review`, new - `ui.shell.next` seeded, one real conversation seeded, the phone capture opens the Sheet via "Show threads" the same way a person would), opened and judged. Exit: `bash scripts/check.sh` and the captures opened.


<a id="chat-find-0923-01"></a>

- [x] **CHAT-FIND-0923-01: the thread-column toggle stopped hiding the column** (S) - **landed 2026-09-23.** Five live findings from Jesse on 8787 (`fa85640b`), all owed same-night. Regression: clicking the control that hides the left thread column no longer hides it ("the bug is back"). Extensive headless reproduction (direct click both directions, 2000x1300 with a conversation selected and twenty threads, the outer shell's own SidebarTrigger, the mouse left stationary after the click, peek-then-select-then-leave) found the click mechanism itself always correct - what wasn't there: hiding the column had never been a stored preference (`git log -S` on `railCollapsed`/`localStorage`, never once combined, the whole history of this component), so a reload has always reset it to the width-based default. From a person's chair that reads exactly like "the toggle doesn't hide it." Fixed with `railCollapsePreference.ts` (new), the same per-browser-preference shape `micDevicePreference.ts` already established. Acceptance: "clicking the toggle hides the thread list and clicking again shows it, asserted on the real page component" (a round-trip test) plus, in Jesse's own words, "the column comes back on its own" after a reload - a second regression test, confirmed genuinely red before the fix (`git stash`, reran, restored) and green after. Exit: `bash scripts/check.sh` and Jesse's own reload.


<a id="chat-find-0923-02"></a>

- [x] **CHAT-FIND-0923-02: a real icon for the thread-column toggle** (S) - **landed 2026-09-23.** The current glyph (`message-square`) didn't read as a column toggle at all; the reference is a two-panel glyph with a horizontal double arrow above it (a "resize columns" look). Added the closest already-in-the-library state-aware pair, lucide's `panel-left-close`/`panel-left-open` (commons `ui-v0.5.44`, the same way tonight's other icons - `audio-waveform`, `incognito` - were added), swapped in for both toggle instances depending on `railCollapsed` (close-icon when open/peeked, open-icon when collapsed) - distinct from the outer shell's own plain, static `panel-left` (CHAT-UI-03's own reason `message-square` was picked in the first place), while actually showing which way the click goes. Exit: `bash scripts/check.sh` and Jesse's own reload.


<a id="chat-find-0923-03"></a>

- [x] **CHAT-FIND-0923-03: one conversation-actions menu, not two** (S) - **landed 2026-09-23.** The conversation title's dropdown (the chevron beside the title) held Rename, Start temporary chat, Share (disabled) and Delete - the menu is this conversation's own actions, and temporary-chat starts a NEW one, which never belonged there; its one real home is the button beside New Thread (CHAT-LIST-01). Landed as Rename and Delete only (coordinator's own call, not Archive-for-parity): the row's own three-dots menu shows Rename/Archive/Delete (the shipped `elements/thread-list.aui.tsx` Element's fixed set), but its Archive throws unconditionally by deliberate 2026-09 design (`chatThreadListAdapter.ts`: "the shared record has no archive state") - a second visibly-broken button in the header would be worse than none, so Archive stays out of both until CONV-ARCHIVE-01 gives it a real implementation shared by both menus. Share stays out too until SHARE-CONV-01 wires a real one (a disabled placeholder is worse than no entry). `onStartTemporary`/`temporaryAllowed`/`shareAllowed` removed from `ChatHeaderData` entirely - this menu was their only consumer. Exit: `bash scripts/check.sh` and Jesse's own reload.


<a id="chat-welcome-01-2"></a>

- [x] **CHAT-WELCOME-01-2: temporary chat moves from the sidebar to the welcome screen** (S, Sonnet; owner's ask 2026-09-24, direct ChatGPT comparison) - **landed 2026-09-24.** Objective: CHAT-LIST-01's own permanent icon button beside New Thread goes away entirely ("no need to have a button permanently on the left column") - the empty new-chat welcome screen (`Thread`'s own `Welcome` slot, kit's documented extension point) carries a "Temporary chat" toggle pill top-right instead, gated by the same `canHaveTemporaryChatRole` the old button used. Toggling it swaps the heading ("How can I help you today?" / "Temporary chat" + "This chat won't be saved to your history.") and tints the composer - a new `temporary` prop on the kit's own `Thread` (`commons` `ui-v0.5.56`-`0.5.59`), mixing `--color-primary` into `--composer-bg` (an earlier attempt mixed `--color-accent`, a no-op in this design system: `--accent` and `--muted` are the literal same token value in both themes). State machine simpler than the old button's: the toggle lives on the CURRENT (already blank) thread rather than switching to a new one, so `armTemporaryChat`'s own thread-switch marker (`startingTemporaryRef`) is gone too. Two real bugs found and fixed live on 8787 before this landed: an absolutely-positioned button silently ate no clicks at all (painted under a later sibling that got its own stacking context from an `animate-in` transform - `z-10` fixes it) and a medium review caught `toggleTemporary` missing its own `useCallback`, so `TemporaryChatContext`'s value never actually memoized. Same commons pin also fixed two unrelated, live-reported ThinkingIndicator bugs (Firefox clipping the status phrase's own descenders, and its shimmer highlight defaulting to a hardcoded white that read as "wiping away" the text on light theme) - see `commons/docs/dev.md` for those. Files: `frontend/src/shell/pages/ChatPage.tsx` (`ChatWelcome`, `TemporaryChatContext`, `ThreadList` simplified), its test file, `commons/ui/src/elements/thread.aui.tsx`. Tests in these words: the pill appears on the empty screen for an allowed role, renders nothing for a child, toggling swaps the heading and toggling again swaps it back, arming then sending marks the turn `temporary: true`, a real conversation's own first send never carries it. Exit: `bash scripts/check.sh` (full scope) and live verification on 8787, light and dark, both themes screenshotted and judged.


<a id="chat-find-0923-04"></a>

- [x] **CHAT-FIND-0923-04: a sent message's bubble must not resize on hover** (S) - **landed 2026-09-23 (`cc23049d`).** Hovering a sent message ("hi") makes its bubble grow wider and the text jump to the left (screenshots: at rest a tight pill around "hi"; on hover the bubble widens to the action bar's width with "hi" left-aligned). Root cause: the bubble and the action-bar wrapper are siblings inside one parent with no width of its own, sized by CSS Grid's own `auto` column - the action bar genuinely unmounts at rest (only the bubble counts then, a tight pill) and mounts on hover (both count, and the wider one wins the column's width, stretching the bubble along). Fixed with `w-fit` on `.aui-user-message-content` (`elements/thread.aui.tsx`, commons `ui-v0.5.47`, reviewed medium, zero findings) - still bounded by the row's own available width, so a genuinely long message wraps exactly as before. Home's own pin bump (blocked earlier by an unrelated pin conflict - ui-v0.5.46's own voice-orb work removed `VoiceTurn` from `voice-conversation.js`, which `liveVoiceSession.tsx` needed updating for first, Session B's own item, landed separately) went in once unblocked: `ui_tag`/`frontend/package.json` bumped to `ui-v0.5.47`, `bun install --force` (minimal, pin-only `bun.lock` diff, confirmed against a clean `origin/main` worktree). Acceptance met with a real headless check (`scripts/screenshot.ts --chat-find-bubble-hover-width-review`, new): a real turn ("hi", reply awaited so the user message is no longer `autohide="not-last"`'s own last message), real `getBoundingClientRect()` on `.aui-user-message-content` at rest and hovered - 44.75px both, unchanged. Reviewed low, zero findings. `bash scripts/check.sh` was flaky on this shared machine during the run (three different backend chat-engine tests failed across two full runs, `turnNext.ts` FORCED-CALL-01, `ask02.test.ts`, `rep01.test.ts`, all "chat model unavailable: could not reach 127.0.0.1:..." or model-content-drift signatures, none in files this diff touches, still flaky in isolated single-file reruns) - treated as an environment finding (machine load, not this diff) per the coordinator's own read; frontend build/test/typecheck/eslint/a11y and the standards core (gitleaks, PII wordlist, prose lint, licence check) all ran directly and passed clean. Exit: `bash scripts/check.sh` (scoped stages green; the backend stage's flake is the named environment finding above) and Jesse's own reload.


<a id="chat-find-0923-05"></a>

- [x] **CHAT-FIND-0923-05: the header and the shell nav sidebar no longer share a bottom line** (S) - **landed 2026-09-23.** Not the thread column (the original framing) but the shell nav sidebar's own header block (the logo) and the page header - both used to sit on one horizontal line; they don't anymore, after CHAT-HEADER-01/02/03 gave the chat page's own header a real title button and actions chevron. Root cause, measured (real `getBoundingClientRect()`, both widths, identical at each): both start at the same y (a shared top offset), so the whole 8px gap was a height difference - the sidebar header's own owner-tuned 57px (`pt-5 pb-6`, `app-sidebar.tsx`, ui-v0.4.3, left untouched) against the page header's own 65px, because its title/chevron buttons defaulted to the kit's own hard 48px touch-target floor (docs/UI.md) instead of the template's own 40px header-control convention (`Light-Dark.tsx`: `h-10 w-10`). Fixed in the shipped shell's own terms, not a pixel nudge: `h-10` plus `hitArea(1)` (the same transparent-pad technique `icon-lg` already uses) on the title button, `size="icon-lg"` on the chevron - the 40px visual line back, the 48px real hit area kept (the coordinator's own ruling: shrinking a real interactive control below the kit's own stated floor was rejected). Acceptance met: a real headless check (`scripts/screenshot.ts --chat-find-header-alignment-review`, new) asserts the sidebar header's own bottom edge and the page header's own bottom edge share a y coordinate at both 1440 and 2000, throwing on the first mismatch rather than silently capturing a still-broken page (happy-dom computes no real box layout, so this is the actual proof, not a unit test) - confirmed aligned at both widths, captures opened and judged. Exit: `bash scripts/check.sh` and Jesse's own reload.

<a id="chat-header-target-01"></a>

- [x] **CHAT-HEADER-TARGET-01: the phone chat title is a real 48px target** (S, 2026-10-01): clean `origin/main` passed the chat-only phone/dark scan; after the full mobile wordmark change, its width left the chat title target overlapping global Search. The title uses a real 48px by 48px box with no overhang, and the duplicate header wordmark is hidden on phone while Chat is active. The sidebar retains its logo. Tests assert `h-12 min-w-12`; the focused chat and chat-list phone/dark a11y scan passes. See `docs/dev.md`.


<a id="chat-find-0923-06"></a>

- [x] **CHAT-FIND-0923-06: the new-chat composer shifted down on the first keystroke** (S) - **landed 2026-09-23.** A sixth live finding, found separately the same night: typing the first character into a brand-new chat visibly dropped the composer (and the "How can I help you today?" heading above it) down a few pixels. Root cause, in the shared assistant-ui Element (`elements/thread.aui.tsx`): the new-chat welcome block (heading, message group, footer) is vertically centered (`justify-center`) while the chat is empty, and the footer's suggestions row used to unmount entirely the instant the composer stopped being empty (its `AuiIf` gate was `isNewChatView(s) && s.composer.isEmpty`, not just `isNewChatView`). `ViewportFooter` lays its children out with `gap-4`, so unmounting the row removed both its own content height and the one `gap-4` unit before it, shrinking the footer; a shorter centered block re-centers, dropping every element in it - including the heading and composer well above the row that actually changed - by half of whatever height disappeared. Even with zero suggestion chips configured for this household (the row's own content is 0px), the vanishing gap-4 alone is 16px, so the whole block dropped 8px on the very first keystroke; a household with real suggestion chips configured would drop further still. Fixed by keeping the row mounted for the whole new-chat view and toggling only its own visibility (`invisible`, not unmounted) once the composer has text, so the footer's height - and the gap before this row - never changes; a `key`-based remount of just the inner suggestions list still replays its entrance animation each time the composer clears back to empty, matching the pre-fix behavior. Landed in commons first (`ui-v0.5.48`, reviewed low, one round of review findings fixed: a household-fact/quote comment rewritten generically, an unverifiable cross-repo function-name claim removed, the visibility selector hoisted to a named module-level const matching the file's own `isNewChatView` convention, the animation-replay gap closed, and a `dashboard-upstream.md` patch-table row added), then home's own pin bump (reviewed low, zero findings). Acceptance met with a real headless check (`scripts/screenshot.ts --chat-find-composer-shift-review`, new): real `getBoundingClientRect().top` on the composer's own textbox at rest, a 300ms no-keystroke control to rule out a settle-timing artifact (confirmed identical, ruling that out), then after typing one character - 0px delta, confirmed. `bash scripts/check.sh` hit the same shared-machine backend-suite flakiness CHAT-FIND-0923-04 already named as an environment finding that night; frontend build/test/typecheck/eslint/a11y and the standards core all ran directly and passed clean. Exit: `bash scripts/check.sh` and Jesse's own reload.

**Follow-up, same day, Jesse live on 8787 again:** "the upper left logo is tiny - look at all the free space - all we need is the logo here" (with a reference image showing a bigger icon-plus-wordmark lockup, no tagline). Supersedes the 2026-09-20 "exact figure" the tile/wordmark were previously cited at (48px/19px, `frontend/src/shell/AppShell.tsx`'s own `Brand` component) - a fresher direct instruction from the same owner, not erased from the file's own history, just superseded. Tagline line ("Your AI. On your terms.") removed (absent from the reference); tile grown 48px to 64px (`size-12` to `size-16`), wordmark 19px to 28px, filling the row's own already-reserved `pt-5 pb-6` padding instead of sharing it with a second text line. The alignment fix above still holds without further change - both bottom edges independently land back at the same y once the sidebar's own header grows with the bigger mark, reconfirmed by the same headless check. The collapsed icon-only rail keeps the original 48px/6px pair (`group-data-[collapsible=icon]:size-12`/`:p-1.5`) - the bigger 64px tile only fits the expanded row Jesse actually looked at; collapsed, `--sidebar-width-icon`'s fixed 72px has no room for it (a review caught this, confirmed live: the grown tile clipped by 4px collapsed, gone once clamped). Captures opened and judged (zoomed crop of the mark itself, not just the full page, to actually judge the size claim rather than assume a full-page screenshot's own thumbnail-scale view proved it) at both expanded and collapsed, both themes. One adjacent, pre-existing gap found chasing that clip, unrelated to this fix (reproduces on a clean `main` too): the brand link's own `scrollWidth` reads ~4px wider than its `clientWidth` even at the original 48px size - filed as [getmaipai/home#142](https://github.com/getmaipai/home/issues/142), not fixed here.


<a id="handsfree-01"></a>

- [x] **HANDSFREE-01: hands-free, three separate things with three homes** (M). The owner drew the distinction that fixes this row (2026-09-22): the waveform is not the wake word, and neither of them is 'just speak to me'. They differ on two independent axes, how a turn STARTS and how the reply COMES BACK, which gives three features, not one control: **(a) Read replies aloud** - typed turn, spoken reply, no microphone involved. An output setting, so it does NOT live under a voice button; it is a per-conversation setting in the conversation header's menu (CHAT-HEADER-01) beside temporary chat, remembered per person with the conversation (PERSIST-CONV-01). The shipped `read-aloud.tsx` Element does the speaking and also gives the per-message control, which belongs in the message action bar slice 5(e) already built; the toggle only makes it automatic. **(b) Voice conversation** - spoken turn, spoken reply, a mode entered deliberately from the composer's waveform button. **Landed** (found live 2026-09-27, doc catching up to reality): `ComposerExtraEnd` exists on `ThreadComponents` and is wired to `ComposerVoiceControls` in `ChatPage.tsx`; `LiveVoiceSession` runs a real `WS /api/stt/stream` connection, not a stub. This row's own "not mounted" text was stale. **(c) Wake word** - the same mode entered by touching nothing. This is hub-and-device state, not conversation state: if the hub is listening it listens whatever conversation is on screen, so per the one-definition rule it is declared once in the settings registry (`.github/docs/SETTINGS.md`, the generic renderer) and shown on the hub's voice settings page, sourced from an installed wakeword package (catalog `wakewords/`). The composer's chevron may offer a shortcut that flips that same setting; it never owns a second copy of it. **Wake-word invariants (owner's ruling, 2026-09-22, non-negotiable):** a wake word is never always on, the person is always in control, and the person always knows when it is listening. Concretely: (i) **off by default** and it stays off - installing a wakeword package does not enable it, an update never enables it, and no migration or default-restore may turn it on; (ii) **an explicit per-device opt-in** by an adult, one device at a time, never household-wide in one click, and a child profile can never enable it; (iii) **a persistent, unmissable indicator whenever the microphone is open** - visible on the screen the whole time it is listening, not a toast that fades, so a person walking into the room can tell; (iv) **turning it off is always one action** from that indicator itself, never a trip into settings; (v) **nothing before the wake word is kept** - the rolling buffer the detector needs is in memory, never written to disk, never a turn, never a memory record, and the detector runs locally like everything else (PRIVACY.md: nothing leaves the house); (vi) the indicator and the off switch are themselves part of the feature's definition of done, so a build that listens without showing it is a defect, not a missing polish item. Acceptance for these specifically: a fresh install with a wakeword package present listens to nothing (asserted); a child profile cannot reach the toggle (asserted); the indicator is present in the capture whenever the listening state is on and absent when off; and a test proves no pre-wake audio reaches disk, the turn log or the memory judge. Every piece hides when its role or package is unavailable (tts for (a), stt+tts for (b), an installed wake word for (c)), so an unconfigured hub shows none of it. Acceptance: with tts available a typed turn is spoken end to end and the Element's own controls work mid-speech, and the toggle survives a reload of the same conversation; the voice mode is unreachable without stt; the wake-word setting is absent with no wakeword package installed, and toggling it from the composer and from the settings page moves the one same value (asserted, not assumed); a child's turn speaks only content that passed the same safety path. Out of scope: barge-in (talking over a spoken reply to interrupt it), which needs the robot's echo cancellation and gets its own row. Exit: `bash scripts/check.sh` and the captures.

**HANDSFREE-01(a), persisted 2026-09-27 (PERSIST-CONV-01):** the conversation-header read-aloud toggle is stored with that conversation and restored when it is reopened. It remains hidden when TTS is unavailable.
**HANDSFREE-01(c), landed 2026-09-27 (`512da6fb`):** Home adds a default-off, device-scoped wake-word setting, local detector control, a persistent listening indicator with a one-action stop, and the same setting in the composer and Settings. The backend and frontend safety tests cover all six invariants; in particular, a child receives 403 on both device-setting read and write, with no database rows written. Availability currently follows the pinned stock wake-word assets; catalog-based installation remains the separate `WAKEWORD-CATALOG-01` item.


<a id="model-sel-01"></a>

- [x] **MODEL-SEL-01: choosing the model a turn runs on** (M, backend first). **Landed 2026-09-27:** Home `6dddd489` adds the session model picker to `/chat`, sources selectable chat models from `GET /api/engines`, validates the requested id against the chat role, and reports a fallback status for unavailable choices. Stack `a26ae2f` dispatches explicit model ids to the matching installed process and preserves active-process behavior when no id is given; `f9eeda7` adds the real concurrent regression test. Home's `ChatPage.test.tsx` proves the selected id is sent on the turn; Stack's `backend/tests/supervisor.test.ts` proves dispatch selects the matching process and that concurrent model switching leaves the first generation alive until it resolves. Its per-role `requestLocks` serialize process swaps and retirement. Admin restart/swap paths still bypass that lock; this separate gap is filed as [getmaipai/stack#9](https://github.com/getmaipai/stack/issues/9). The picker stays hidden below two selectable models, and unknown or unavailable choices fall back to the chat role's default with a status. Out of scope: remembering the model choice per conversation; see RESP-04.


<a id="persist-conv-01"></a>

- [x] **PERSIST-CONV-01: composer settings remembered with the conversation** (M, spec first; landed 2026-09-27, spec-v0.1.49). `Conversation.settings` is an optional additive object with `thinking`, `model`, and `read_aloud`; additional unknown keys survive partial PATCHes. Home stores it in the nullable conversation column, validates and merges writes through the shared spec, and PATCHes only changed settings. Thinking and read-aloud hydrate from the active conversation; absent settings mean Instant and read-aloud off. Temporary chats keep these values in the live session's memory and never create a durable conversation row. Cross-session save/reopen is covered by route and history-adapter tests and a Chat integration test. Model dispatch remains MODEL-SEL-01's work; this adds only its settings slot. Exit: `bash scripts/check.sh` in Commons and Home.


<a id="stats-pct-01"></a>

- [x] **STATS-PCT-01: `context_used_percent` is a permanent null and the old chat renders it anyway** (S). **Landed 2026-09-24, the "drop the field" half, not the "compute it" half this row names as preferred.** Computing it needed a synchronous per-turn source for the chat role's context window that doesn't exist today - the Stack's own `measuredContextLength` needs a live, possibly-unconfigured network round trip (no caching layer; its only two callers, `performance.ts` and `routes/engines.ts`, are nowhere near the turn's hot path), and a local engine's own window would need reading llama-server's real `/props` response, unverifiable from this session (no llama-server binary, no reachable live engine). The new chat page already solves this differently and better - `ChatPage.tsx`'s `MessageDetailsContextBar` fetches `measuredContextLength` through its own admin-gated `api.engines()` query, independent of `TurnStats` entirely - so the field is gone (`wire.ts`, `turnStats.ts`, the old chat's `chatTurnStats.tsx` row, and every test fixture that carried it), with a regression test proving the row itself is absent, not blank. `ChatPage.tsx`'s own explaining comment updated to match. Filed getmaipai/home#149 for the compute-it half, for a future session with real engine access. `backend/src/lib/turnStats.ts` line 35 sets `context_used_percent: null` unconditionally; nothing ever computes it, yet it is declared on the wire (`backend/src/wire.ts` line 70) and `frontend/src/apps/chat/chatTurnStats.tsx` line 52 renders a "Context used" row from it, so that row is blank on every turn of the current chat. Found while building slice 5(d) (home f1a3807f), where the same dead field made the obvious fallback for the context bar unusable. Decide and do one of two things, not both: compute it where the turn knows its engine's window (the chat role's `measuredContextLength`, the same value the Engines route already serves the new Details panel), or drop the field from the wire and the old chat's row. Computing it is preferred: the number is real and the new Details panel wants it too. Acceptance: either a turn's stats carry a `context_used_percent` that equals `context_tokens / measuredContextLength * 100` with a test on a scripted turn and the old chat's row filled, or the field is gone from `wire.ts`, `turnStats.ts`, `chatTurnStats.tsx` and their tests with no blank row left behind. Out of scope: CTX-SEG-01's segmented breakdown (home#133), which replaces the single percentage later. Exit: `bash scripts/check.sh`.
    Superseded 2026-10-02 by chat rule 4; the code goes in the stage named in the thin-path record (stage 3).


<a id="resp-01"></a>

- [x] **RESP-01: the written register for the typed screen** (M; amended 2026-09-22 by ARCH-AMEND-01: the cap is not in `persona.ts`). **Folded into U4, done 2026-09-23** (`f17dcc1b`): the budget half (surface class, the written table, constraint decay) landed exactly as this row's own amendment specified. The persona-prompt half - `composePersonaPrompt` taking the surface class, `WRITTEN_POLICY` beside `NATURALNESS_POLICY` - did not, since the new path's own prompt assembly never calls `composePersonaPrompt` at all (a separate, pre-existing gap U4 found and named as U4b, above); `persona.test.ts`'s own acceptance line here is U4b's, not this row's. Design: [docs/plans/response-contract-by-surface-2026-09-21.md](plans/response-contract-by-surface-2026-09-21.md) as amended, and ARCH-LAYERS-01's accepted paragraph.


<a id="resp-04"></a>

- [x] **RESP-04: the composer's two controls, ChatGPT's and nothing more** (S, with SHELL-02 slice 5). **Minors, 2026-09-22 (owner's ruling):** a minor's typed chat shows no Instant or Thinking control; the hub decides thinking from the model budget, ignores a minor's request to enable it, and voice and glance have no composer controls. The shipped composer model picker and Instant/Thinking effort choices are part of MODEL-SEL-01; model choice rides the turn request, and Thinking is remembered with the conversation under PERSIST-CONV-01. **Landed 2026-09-27:** model selection is wired on `/chat`, Thinking persists with the conversation, and the selected model now hydrates from and PATCHes only `settings.model`, follows each conversation on switch, and has first-send, reload, and per-conversation default regression coverage in `ChatPage.test.tsx`. Exit: `bash scripts/check.sh`.


<a id="reasoning-03"></a>

- [x] **REASONING-03: a child's reasoning is never persisted, on the old path too** (S, Sonnet, 2026-09-22; owner's ruling, a privacy invariant). The old path's fix 141eaf86 stores reasoning for every turn in REASONING-02's `reasoning` column and gates it on read; a minor's turn must store none at all (the row, the trace, history, exports, backups), on any setting, and the `list()` test that proves an owner may read a child's stored reasoning is retired with this reason. Parental audit keeps the question, the answer, the sources, the executed tools and the policy decisions. Adult retention unchanged (stored, gated on read). Test in these exact words: a child's turn with thinking forced on by a test budget writes an empty `reasoning` column and no reasoning in `stats`; an adult's turn still stores it and a second adult cannot read it. Exit: `scripts/check.sh`. **Landed (GROUND-01's session, 2026-09-23):** `conversationHistory.ts`'s `buildTurnRow()` gates the write on the actor's own `minorSpeaker`, computed from the actor, never a client claim - `reasoning: minorSpeaker ? null : (value.reasoning ?? proseReasoning ?? null)`; `listConversationTurns()` and `list()` also check `r.minorSpeaker` at read time (defense in depth for a row written before this fix). The `list()`/`listConversationTurns()` tests that proved "an owner may read a child's stored reasoning" are rewritten to the new invariant, in the backlog's own exact words; `tier2.test.ts` and `reasoningReload.test.ts` had the identical old-path assumption and are fixed the same way. No other write site touches the `reasoning` column (checked directly).

<a id="chat-06"></a>


<a id="chat-06"></a>

- [x] **CHAT-06: Use one idempotent memory-ingestion service** (M)

    Depends on: CHAT-03 and CHAT-05. Files: new
    `backend/src/lib/memoryIngestion.ts`, existing `memory.ts`,
    `memoryJudge.ts`, `packageHost.ts`, `routes/memory.ts`, `db/schema.ts`,
    and their nearby tests. The service accepts actor, text, explicit or
    automatic origin, source turn, requested scope, category, importance,
    and validity bounds; returns saved record IDs, unchanged record IDs,
    or a typed rejection. Validate through the existing spec and content
    policy. Default to actor-person scope; household sharing requires
    explicit scope from an authorized caller, never a model's inferred
    value. Canonical duplicate comparison is Unicode NFC, trimmed and
    collapsed whitespace, case-folded text within identical scope/person;
    preserve original display text. Add a NOOP dedupe outcome for unchanged
    facts. Failed model dedupe leaves work pending instead of defaulting to
    ADD. Same-turn retries must neither duplicate nor repeatedly supersede
    facts. Use a transaction for store writes and job bookkeeping.

    Explicit requests persist the assertion before confirming; enqueue
    normalization for that record so a later rewrite supersedes it without
    changing visibility. Relative dates use the source turn timestamp,
    never retry time. Reuse existing scheduler/pending mechanisms; any new
    local queue state belongs in the existing DB with a migration, not a
    parallel store. Acceptance: repeated save, interrupted normalization,
    failed dedupe, and restart yield one active fact; a correction yields
    one supersession with preserved provenance. Out of scope: merging
    unrelated facts or changing visibility on inferred intent. Checks:
    memory, memoryJudge, packageHost and turn suites plus full exit gate.

<a id="chat-07"></a>


<a id="chat-08"></a>

- [x] **CHAT-08: Apply memory validity at read time** (M)

    Depends on: CHAT-06. Files: `backend/src/lib/memory.ts`,
    `memoryJudge.ts`, `routes/memory.ts`, `spec/schemas/memory-record.schema.json`,
    shared record fixtures, and `backend/tests/memory.test.ts`.
    Add an optional `asOf` to the single internal recall reader. Default to
    the turn's frozen time. Include only records satisfying inclusive
    `valid_from` and exclusive `valid_to`, with null bounds open. Current
    reads exclude superseded records; explicit historical reads may include
    superseded records valid at that time. Never include tombstones,
    privacy-denied records, or retention archives. Validate real calendar
    timestamps and reject reversed intervals, not just regex-shaped dates.
    Keep source creation time separate from fact validity in prompt labels.
    Use the existing `chrono-node` path for explicit query dates; if a date
    is ambiguous, ask for clarification rather than select a historical
    window. Add optional API `as_of` through its OpenAPI schema.

    Acceptance: trip ends at its stated boundary; future event is not
    described as currently occurring; an address correction returns the
    new fact now and the old fact for its valid historical date; leap-day
    and timezone boundaries behave deterministically. Undated durable
    facts remain usable. Daily maintenance is not required for expiry to
    work. Out of scope: graph time travel, resurrection of deleted records,
    or migration that guesses dates for existing undated facts. Checks:
    memory/judge tests, changed shared record fixtures, full exit gate.

    **Amended 2026-09-14 (dev.md section 14, part 4; the coherence
    review moves the confidence presentation and the two guard rows to
    CRED-01 and places this item before CUR-01, which archives what
    this reader already excludes):** the same reader
    applies, in order, privacy and disclosure, validity at the frozen
    time, active versus superseded or archived, unresolved conflict,
    confidence presentation, then ranking, and returns a typed
    `FactPresentation` per bullet (`plain | attributed | conflicted`
    with `source_ids`), never a bare float: a certain record plainly, a
    provisional one (below 0.85) with its source and tense, a
    conflicted pair as both with neither called wrong; confidence may
    lower a provisional fact's rank and never removes it; the guards
    read the band (`overclaimed_fact` when the model states a
    provisional fact flatly; `doubt_of_person`, cuttable, on "if
    that's true", "supposedly", "you claim", "are you sure", "that
    seems unlikely"); a historical `as_of` read uses current support
    for the fact valid then. Acceptance adds the recall turns of the
    `credence` conversations, three seeded runs.

<a id="chat-09"></a>


<a id="chat-09"></a>

- [x] **CHAT-09: Version vector spaces and remove stale routing examples** (M)

    Depends on: none. Files: `backend/src/lib/routing.ts`, `memory.ts`,
    `llm.ts`, `embedSupervisor.ts`, `db/schema.ts`, `spec/llm/ts/types.ts`
    if the embed result contract changes, and embedding/routing/memory
    tests. Define embedding identity once as model artifact identity,
    dimensions, and preprocessing version. Thread it with query vectors;
    filter stored rows for exact identity before cosine scoring, including
    dedupe and contradiction checks. Preserve current preprocessing:
    routing document prefix with raw queries; memory raw documents/queries.
    Do not make the previously proposed prefix migration automatically.
    Existing unversioned rows are incompatible until re-embedded; use
    lexical fallback and existing retry jobs during migration. Re-embedding
    batches are bounded to 32 records and resume after interruption.

    Prune routing examples absent from the current manifest even when
    there are no missing embeddings, embedding fails, or the new examples
    array is empty. Never delete another package's rows. Invalidate cache
    identity on model changes, including equal-dimensional replacements.
    Acceptance: same-dimension different models never compare; incompatible
    records remain findable lexically; restart resumes migration; removing
    a formerly winning example removes its influence. Out of scope: vector
    database, ANN index, and unmeasured threshold/prefix changes. Checks:
    `routing.test.ts`, `routingCorpus.test.ts`, `memory.test.ts`, existing
    embed tests and full exit gate. Landed 2026-09-21 at 8243873e (c-99a):
    embedding spaces versioned by model artifact and preprocess (migration
    `0054_chat09_embedding_identity.sql`), the stale routing examples
    removed.

<a id="chat-10"></a>

- **CHAT-10: Resolve follow-up subjects for memory retrieval** (folded into CHAT-13 by the coherence review, 2026-09-14; the text below is the requirement CHAT-13 carries)

    Depends on: CHAT-01, CHAT-08, CHAT-09. Files:
    `backend/src/lib/turnContext.ts`, `conversationHistory.ts`, `memory.ts`,
    `entities.ts`, `relationships.ts`, and their existing tests. Build a
    bounded retrieval query from current text plus the last two same-thread
    user messages when the current text is a short follow-up or contains a
    pronoun/reference. Cap added context at 600 characters at whole-message
    boundaries. Keep original user text unchanged for display and literal
    routing. Resolve explicit names/aliases through existing Entity and
    Relationship readers under the actor's permissions; do not create a
    second identity graph. A single compatible recent subject can resolve a
    pronoun; multiple plausible subjects produce a clarification and no
    guessed personal fact. Entity evidence uses existing IDs. Remove the
    first-clause-of-memory-text heuristic only after its fixtures have
    equivalent structured coverage; unlinked old records still use vectors
    and lexical matching.

    Acceptance: Pippa painting followed by "Tell me about her" retrieves
    Pippa; two named relatives followed by an ambiguous "her" asks which
    one; conversation switching cannot carry the old subject; a child
    cannot resolve an inaccessible adult-private entity. Preserve relevant
    standalone queries and current recall floors. Out of scope: new LLM
    rewrite call, embedding-model changes, broad name extraction from
    arbitrary documents. Checks: memory/history/entity/relationship suites,
    turn-level follow-up regressions, and full exit gate.

<a id="chat-11"></a>


<a id="chat-12"></a>

- [x] **CHAT-12: Budget complete model requests without truncating evidence** (closed 2026-10-06: delivered by THIN-3B and THIN-3C, its retargets) **Rewritten 2026-10-02 for chat rule 4.** Promoted and retargeted: this item is now THIN-3B (the tokenizer client on the engine's `/tokenize`, counts taken on the rendered messages after credential redaction and note substitution) and THIN-3C (the window). The 512/1024 output reserve is dropped; the window reserves room for the stable prefix, the tools block, the memory block (up to 5 records plus the profile line), the reply ceiling and the thinking allowance. File names below that say `turnEngine.ts` read as `turnMachine/`. (M)

    Depends on: CHAT-01 and CHAT-09. Files:
    `backend/src/lib/turnEngine.ts`, `conversationHistory.ts`, `llm.ts`,
    `llmSupervisor.ts`, existing engine capability/autotune readers,
    `spec/llm/ts/client.ts` and `types.ts`, and their tests. Add a tokenizer
    client for the pinned engine's native tokenizer and use its effective
    per-request context capacity. Apply the decision record's 512/1024
    output reserve, 128-token framing margin, and exact trimming order.
    Count system context, selected history, current message, native tool
    schemas, and later tool results. Select complete entries and history
    pairs, not `.slice` of the assembled prompt. The newest four exchanges
    are no longer exempt from the full-request limit. Required inputs that
    cannot fit return typed `input_too_large` before actions. Mirror the
    existing error catalogue and OpenAPI error response conventions.

    Count the fully rendered native chat template, including tool schemas,
    not just concatenated message text. Cache exact counts by rendered
    prompt plus model/template identity. If native counting fails with no
    matching validated cache, return typed unavailable before model-dependent
    execution; deterministic no-model replies remain available. After tools
    already ran, oversized required results skip composition and use the
    safe direct/error fallback; never report a pre-action rejection or
    repeat an action. There is no guessed byte-count fallback. Acceptance: large history, many tools,
    long profile, multilingual text, emoji, and long current input stay
    within capacity or reject before effects; required evidence never
    silently disappears; model and guard evidence IDs match; output reserve
    is actually sent as `max_tokens`. Out of scope: changing household
    context settings, a second tokenizer library, or increasing prompts to
    hide retrieval failures. Checks: turn/history/LLM/shared client suites
    and full exit gate.

<a id="chat-13"></a>


<a id="chat-13"></a>

- [ ] **CHAT-13: Route contextual and mixed requests without extra intent inference** **Dropped 2026-10-02: retired by docs/design/RULES.md chat rule 1.** Do not build; the text below is kept as history. (M)

    Progress 2026-09-15 (dev.md section 16, item 10, amended): the
    routing half landed in chunks A to E (6f51ea6 through 7bc9b91, the
    stack-2 and stack-3 gates): subject extraction, resolution before
    routing and reference resolution, the carried reference's decay,
    the last succeeded lookup as a stack source, a manifest's
    `routing.answers` entity kinds, and a short turn on a live subject
    read as a comment. The typed world subject landed 2026-09-15
    (447e763: "the new Marsh Lantern film" and "the film Marsh Lantern"
    put a world subject of kind film on the stack with its recency
    from the determiner phrase; `subject-before-pattern` is live
    again). The judgment half landed as a first slice (d622648,
    09fb919): a follow-up question asking for an exact field about the
    current world subject ("how many tracks" after the album turn) is
    decided a lookup from the signal and the subject, and the engine
    runs the typed source and the search itself, both paths. The full
    rule landed 2026-09-16 (Session A, the judgment lane): the
    decision takes the question that names its subject too, and needs
    a world or unresolved subject on the stack (a currency marker
    alone, "when is the new album out" with nothing on the stack, names
    no subject: the model's turn, LOOKUP-02's path for a promise or an
    offer in its draft); the query is the subject first, a superlative
    or time word riding, the field after ("Marsh Lantern release
    date", "Rivet newest phone"), never a trailing "new". The eleven
    LOOKUP-01 and LOOKUP-02 mechanism tests: nine asked "when is the
    new album out" with nothing on the stack and pass under the
    subject rule as they were; the hedged-draft test and its row ask
    with no exact field now ("which connector is the Cosmo 7 card",
    a count being the rule's own case); offer-binding's row asks with
    none too ("is the new Marsh Lantern album any good").

    Depends on: CHAT-10, CHAT-12, CHAT-15. Files:
    `backend/src/lib/turnEngine.ts`, `routing.ts`, `turnContext.ts`,
    `spec/llm/routing-corpus.json`, `tool-call-corpus.json`, and existing
    routing/tier2 tests. Keep literal matching on original text. Compute
    contextual semantic scores with the bounded query from CHAT-10, using
    one compatible query vector shared with recall when their input and
    space match. Never call a model solely to rewrite intent. Add an
    `intent` object to the ephemeral context with `kind: chat|lookup|action|clarify`,
    `query`, `subjectEntityIds`, and `explicitDetailedAnswer`; deterministic
    evidence decides only clear cases, otherwise let native tool selection
    decide. Explicit detail phrases are `in detail`, `detailed explanation`,
    and `step by step`, case-insensitive. No speculative user-preference
    classifier. Preserve current measured routing floors until CHAT-23.

    A literal pattern whose captured tail contains an additional explicit
    supported request must fall through to native tools, not execute the
    whole tail as one argument. Detect only declared request-pattern starts
    separated by a sentence boundary or `and`; do not split names or list
    items. Acceptance: weather then "And tomorrow" offers weather with
    resolved context; "search for dinner ideas; I dislike cilantro" both
    answers and captures the disclosure; "weather and my list" runs the
    intended two reads; casual near-matches execute nothing. Out of scope:
    arbitrary multi-step plans and keyword rules for every possible intent.
    Checks: routing/turn/tier2 suites and full exit gate.

    **Amended 2026-09-13 (the design pass, dev.md "The chat design
    pass", sections 3, 4 and 10).** The subject is a stack (depth two
    to start, measured, return by name) of one spec shape, `SubjectRef`
    (its own S item below: a household reference with an `entity_id`;
    a world reference with kind, name, optional year, the typed source
    and its key, and `recency: current | dated | unknown`; an
    unresolved reference with candidates and confidence), with a
    `rejected` list per conversation. Resolution returns `resolved`,
    `ambiguous` or `unknown`; the engine blocks on a clarification only
    when the reply depends on the missing distinction (ASK-01's rule),
    and a world subject never becomes a household entity on any path.
    The resolver's first half is ASK-01's name resolver (the roster,
    the registry, the typed sources; a name outside them is `unknown`,
    never guessed). `intent.kind` is `lookup` when a world subject's
    exact field is asked (a date, a count, a day, a schedule, reviews,
    a rating, a runtime, a price, "is it out") and the subject is not
    `dated`: the engine decides, the model's knowledge is a rung only
    for a dated subject. A correction ("no, the other one", "not that
    one", "I meant X") replaces the active subject (the wrong one goes
    onto `rejected`, never stays as a second candidate), keeps the
    unresolved question (TURN-01's slot, pulled forward here) and
    re-asks it against the corrected subject on the next turn or a bare
    "go on"; a reply sentence naming a rejected subject is cut
    (`rejected_subject`); the window annotates the turn that answered
    about it with a system note. A reflected question ("you?", "what
    about you") after the hub asked one is that question addressed to
    the hub; a reply that only repeats the hub's own previous question
    is `repeat_question`. "What were we talking about" answers from the
    stack and recalls no episodes. Acceptance adds the `new-album` and
    `correction` conversations (design note, section 4) beside the rows
    already named, lookups from recorded fixtures; three seeded runs.
    **Amended 2026-09-14 (the coherence review):** CHAT-10 is folded in
    (the bounded retrieval query is the stack: the resolved subject's
    name plus the last two same-thread user turns, capped as CHAT-10
    said); the stack stays at depth two with no return by name; the
    question carried across a correction is `carried_question` on the
    stack entry, never an ask; the `unresolved` references are ASK-01's
    detector's, read from `TurnContext.subjects`; `TurnIntent.kind` is
    derived from the signal and the stack by one function and
    `subjectEntityIds` is deleted; CHAT-12 stays deferred behind the
    volatile-zone ordering. **From LOOKUP-02's set (2026-09-15):** a
    promise to remember on a question turn ("I'll remember that you're
    excited" answering "when is it out", `new-album` turns 2 and 3) is
    the commissive form of the memory family's claim, which reads
    "I've saved" as the claim and cuts the future tense on a statement
    turn only (EXP-01's rule), so on a question turn it stands; the
    ladder cuts it beside the plain denial it pads.

<a id="chat-14"></a>


<a id="chat-14"></a>

- [x] **CHAT-14: Offer only ready, authorized tools within one hard cap** **Rewritten 2026-10-02 for chat rule 1.** Offer every ready, authorized tool with `tool_choice: "auto"`. Keep the readiness, `min_role`, required-integration and configured-status filters. Drop the hard cap of four, the score ranking and the embedding floor (`TIER2_AMBIGUOUS_FLOOR`, `MAX_TIER2_TOOLS_OFFERED`), which decide by classifier. It lands in `backend/src/lib/turnMachine/nodes/model.ts` and `contract.ts`, not `turnEngine.ts`; the dependency on CHAT-13 is void (dropped). Acceptance: a test where five ready tools are all offered and an unconfigured one is not. Exit: `bash scripts/check.sh`. Done by THIN-2A. (M)

    Depends on: CHAT-13. Files: `backend/src/lib/turnEngine.ts`,
    `plugins.ts`, `packageHost.ts`, existing integration readiness readers,
    `spec/schemas/manifest.schema.json` only for genuinely missing shared
    declarations, and `backend/tests/tier2.test.ts`, `plugins.test.ts`.
    Build one candidate-filter function using existing package kind,
    min-role, required integrations/capabilities, and configured status.
    Read status only; tool listing must not send network probes or resolve
    secret values. Cap the final offered set at four, including always-offer
    tools: reserve one slot for a ready always-offered lookup tool, fill the
    remaining slots by score then package ID, then append any additional
    always-offered candidate only if room remains. Preserve exact offered
    IDs through execution and revalidate readiness/permissions at execution
    because configuration can change. Descriptions come from manifests,
    never copied handwritten bench strings.

    If an explicit requested integration is unavailable, provide its
    existing safe setup/error explanation rather than offer a broken tool
    or claim the household has it configured. A general chat message gets
    no unsolicited setup warning. Acceptance: no SearXNG means no search
    offer; explicit search explains missing setup; four is a hard cap even
    with many always-offer manifests; child permissions cannot be widened
    by context; readiness changing mid-turn prevents execution.
    Out of scope: integration installation, new network checks, or automatically
    enabling services. Checks: named suites, package-host permission tests,
    and full exit gate.

<a id="chat-15"></a>


<a id="chat-15"></a>

- [x] **CHAT-15: Retain typed outcomes for every accepted package call** (M)
    Verified at the commit that carries this line (the producer
    inventory, each with a test, in docs/dev/session-a.md "CHAT-15").

    Depends on: CHAT-01. Files: `backend/src/lib/llm.ts`, `turnEngine.ts`,
    `turnContext.ts`, `plugins.ts`, `spec/llm/ts/types.ts`,
    `spec/schemas/result.schema.json`, and their tests. Reuse existing
    `PluginResult.data`, `reply`, `error`, `ask`, and `synthesis_hint`.
    Retain native call IDs through parsing and store outcomes using the
    internal type in the decision record. Expose one shared argument
    validator from the package runner so the retained batch is validated
    before any execution or confirmation, without reimplementing AJV.
    Preserve model order and the two-call cap. Consequential proposals ask
    once and execute none of the batch. Keep failed outcomes and safe
    error-catalogue messages alongside successes. Report rejected/excess
    proposals as unexecuted, never implied successes. Direct pattern and
    command paths produce equivalent execution evidence.

    Pending confirmations bind exact package/arguments and consume once;
    resume/reopen clears them as today. Do not interpret an affirmative
    prefix such as "yes, but don't do it" as unconditional consent: accept
    only whole-message affirmative forms from the existing vocabulary,
    optionally terminal punctuation; other text asks a clarification and
    runs nothing. Acceptance: one success/one failure retains both; invalid
    second arguments prevent unvalidated effects; a duplicate delivery or
    retry cannot repeat completed calls; consequential call blocks its
    companion; malformed JSON never reaches a host. Out of scope: general
    agent loops or changing package side-effect semantics. Checks: tier2,
    plugins, commands, pending-ask, shared LLM tests and full exit gate.

<a id="review-2026-09-16"></a>


<a id="chat-16"></a>

- [ ] **CHAT-16: Compose contextual package answers through one shared path** **Dropped 2026-10-02: retired by docs/design/RULES.md chat rule 12.** Do not build; the text below is kept as history. (M)

    Progress 2026-09-15 (dev.md section 16 part 4, the amendments, landed
    ahead of the composer core): the search host returns its rows, the
    websearch recipe carries them, the outcome types them as `Source`
    records, `TurnValue.sources` rides the wire additively and is
    persisted on the turn row (migration 0039), and the chat surface's
    `SourcesCard` reads the real field (dca1173, 4642371); a link, a
    picture or a video ask is a deliverable on the intent, a
    back-reference re-sends the last lookup's sources with no new
    search, otherwise the ladder runs with the deliverable query and the
    reply is one line that says the link is below, a child hears that a
    grown-up can open it and gets no chip (fcbb315, 68b570c, 85e3848);
    a denied deliverable takes the same path (chunk c). Bench:
    `link-is-the-answer`, `link-child-band`, `false-capability-cut`.
    Progress 2026-09-16 (K2 and K6, docs/dev/session-a.md "CHAT-16 K2
    and K6"): `backend/src/lib/composer.ts` is the one decision for
    every site that turns outcomes into a reply on both paths (the
    table as designed, the native tool-result messages on K1's wire,
    the two-call budget read from the prepared turn's counter, the
    constraints line, the `shape` for K4, ACT-03's moves as a
    parameter); the websearch recipe returns rows and a
    `synthesis_hint` (the spec's `format` step gains the field, `text`
    optional with it) and no prose; the direct routes compose too; the
    machine owns the phases, the composition streams through the
    gates after a `composing` status the route orders ahead of its
    first delta; the `[turn]` line says `composed: <mode> calls=<n>`.
    Open: K3 (`model_knowledge`), K4 (the shape rendered from rows),
    K5 (typed dates), K7 (pictures inline), the `search_voice` family,
    the ladder by claim type, the 512-token projection, the band's
    ceiling on the evidence. The voice line of part 4 rule 5 waits for
    a voice surface.

    Depends on: CHAT-02, CHAT-12, CHAT-15. Files:
    `spec/llm/ts/types.ts`, `client.ts`, native client tests,
    `backend/src/lib/llm.ts`, `turnEngine.ts`, `turnContext.ts`,
    `backend/packages/websearch/recipe.json`, and chat
    source metadata/rendering. Add native tool-result messages and retain
    assistant call IDs in the shared wire contract first. Apply the exact
    direct/synthesis/failure/pending decision table in dev.md. The composer
    uses the selected persona/context plus typed results; tools are absent
    and a turn permits at most two foreground completions total. Results
    are data, never system instructions. Re-budget before composing. On
    failure, emit ordered approved direct replies and safe failure messages;
    never execute a call again. Use existing result `data` and
    `synthesis_hint`, without a parallel schema.

    Web Search is currently authoritative in Home, not a catalog-mirrored
    package. Edit it here; catalog migration is out of scope.
    Move Web Search's private phrasing completion into this path: return
    bounded title/snippet/URL data, remove the private `llm_complete` recipe
    step and its source-suppression instruction, preserve declared network
    behavior. Show source titles and sanitized URLs using the existing
    generic source UI pattern; do not speak URLs or send unrelated memory
    text as a search query. Acceptance: known food preference shapes the
    answer locally; two results read as one answer; one failure is stated;
    timer confirmation adds no model request; malicious snippets cannot
    enable tools; composition failure never repeats actions. Out of scope:
    web crawling or a search-provider change. Checks: native client, tier2,
    package recipe fixtures, frontend adapter/source tests, affected catalog
    checks and full exit gate.

    **Amended 2026-09-13 (the design pass, dev.md "The chat design
    pass", sections 4, 6, 7 and 10).** The verdict: one composer is
    necessary and not sufficient. The composer realizes the moves
    section 12's plan permits (the coherence review, 2026-09-14: the plan
    decides which exist; these four are the default realization of a
    lookup answer, and typed move fields exist on composed turns only,
    never on a streamed chat turn; the composer receives a bounded
    projection of at most 512 tokens with references to the retained
    outcomes, never a raw result, and this item and ACT-03 core are one
    work order) (react in the companion's register; pick the one or
    two results that answer, never the list; say it as a person who
    just looked; point at the sources and the details pane, "the
    link's on your phone" on voice), a length (two sentences in chat,
    one on voice, CHAT-12's budget as the ceiling), a fixed prompt in
    `lib/persona.ts`'s pattern with results as data and tools absent,
    and a `search_voice` guard family on its own output (cuttable:
    "the search results", "according to the results", "based on my
    search", "the results show", "I found that", "some recommended",
    "include options such as"; a reply that loses every sentence is
    recomposed once, then takes OUT-01's `malformed` line). The ladder
    runs by claim type, decided before composition: household (memory
    and the registry only); exact, current, safety-sensitive or
    source-requested (a typed source, then SearXNG, then an explicit
    "I couldn't find that", the model's knowledge never a rung, so a
    failed lookup stays a failed lookup); stable general knowledge (a
    typed source or retained evidence, then the model's knowledge with
    the evidence kind recorded on the outcome); opinion (SearXNG
    candidates, a bounded pick with a reason); action result (the
    typed outcome). The composer emits a typed `ComposedTurn` (one line
    and an optional document reference, COMP-01), and every producer's
    text reaches the person through OUT-01's boundary. A link ask (a
    link, a URL, a review, "where can I watch") is a deliverable: the
    reply's `sources` carry the URL, the line says it is there, never
    "no link" and never a spoken URL; the decision table gains the row.
    The websearch recipe's `llm_complete` step goes and the recipe
    returns title, snippet and URL rows in `data`. A question about the
    hub's own experience ("have you heard it", "are you gonna listen to
    it", a reflected "you?") is composed from the experience category:
    the experience line plus a familiarity clause from evidence, never
    free prose about its plans. The subject line, the unknown-name line
    and the composer's evidence sit ahead of the memory and episode
    sections in the volatile zone until CHAT-12 packs by priority.
    Acceptance adds the `search-in-a-voice` conversation and the
    experience turns of `new-album` (design note, sections 6 and 7),
    plus `stable-knowledge-ladder` ("why is the sky blue": answered from
    the model, the evidence kind `model_knowledge` on the outcome, no
    lookup run), `opinion-ladder` ("is the Marsh Lantern album any good":
    a SearXNG outcome, a pick of one or two candidates, no `search_voice`
    phrase) and `mixed-intent-ladder` ("add oat milk to the list and how
    long do eggs keep": the list outcome first, one package run, the
    stable-knowledge answer second), the coherence review's rows,
    lookups from recorded fixtures; three seeded runs. **Amended
    2026-09-14 (dev.md section 13, part 2):** the band's content ceiling
    (`getCeilingForBand()`, no consumer today) is applied to the
    evidence set before the composer phrases it, by the one output
    category scorer run over evidence text: an item over a dial is
    dropped from a child's evidence with a marker the composer reads
    and stays for an adult; a rating question from a child is answered
    as a parent would from the typed field and the band, never the
    rating's own words; sources and links are never shown on the child
    band and stay on the outcome; the ladder is unchanged. Every
    lookup or retained result reaches the composer as a typed
    disposition (`full`; `summary` with categories and safe
    descriptors; `withheld` with the reason `content_ceiling` or
    `household_disclosure` and the policy `adult_should_tell`), the
    withheld text removed before prompt construction and the evidence
    ids proving what entered; a dial at `off` means no vivid or
    instructional detail, never denial of an ordinary fact about
    injury or death; the rubric line gains the band, the disclosure
    decisions and privacy (section 13, part 9). Acceptance adds
    `child-goldfish`'s adult twin and a rating question asked by the
    child and by the owner on the film row, three seeded runs.


<a id="historical-item-055"></a>

- [x] **Engine emits `status` events at lookup start (CHAT-16)** (S) -
      Done 2026-09-15 (e4cf3b5): the stream result carries a status
      channel the engine emits into ("Checking that for you." before the
      forced lookup, "On it." before a tool call on the stream); the
      route races it against the next token so the line reaches the
      surface while the model is silent. The original note follows.
      the visible "what MaiPai is doing" line during a turn is built and
      ready on the frontend (lane 11 item 1, docs/dev/session-b.md): the
      transient activity line, a `status` event's own text (`stage:
      "lookup" | "thinking" | "tool"`), and a `spoken_cue` both drive it,
      cleared by the first delta or the terminal event, never persisted.
      Left unchecked: `turnEngine.ts` doesn't emit `status` yet - CHAT-16
      is the natural place (the same lookup-before-answering path that
      makes a "Checking that for you" line worth having in the first
      place), Session A's own work, wired to the exact shape above.

<a id="runtime-01"></a>


<a id="surface-01"></a>

- [x] **SURFACE-01: The robot surface** (M)

    Done 2026-09-15 in three slices: `robot` is an implemented surface
    with a spoken form for every reply (the first sentence, no URL
    read aloud) and "it's on your phone" for a deliverable (b1d1c75);
    `speaker_evidence` and `present` are on the spec, accepted on the
    robot surface, persisted on the turn row (3de9ef7, migration 0040);
    a sensitive record enters the context on the robot only when the
    body's evidence names the speaker as confirmed and the present
    list is that one person, a second person at any level or no list
    withholding it, chat unchanged (565dc35). The unknown speaker's
    anonymous context and the who-is-speaking ask are COMP-06's. The
    original note follows.

    Filed by the robot's design pass (bot `docs/dev.md`, "named hub
    items"). Objective: `robot` admitted to `IMPLEMENTED_SURFACES`
    (`backend/src/lib/turnEngine.ts:79`, rejected today at `:98`), with
    the surface discriminator the platform plan promises. Files:
    `backend/src/lib/turnEngine.ts`, `guards.ts`, `memory.ts` and the
    prompt sections, `spec/` for the `present` field on the turn (spec
    first), `backend/tests/turnEngine.test.ts`. Mirror: the `chat`
    surface's own branches. Do: spoken presentation on `robot` (one
    sentence, no link read aloud, "it's on your phone" for a
    deliverable), memory sensitivity (a `sensitive` record withheld
    unless the speaker is present and alone, bot dev.md section 6), and
    the `present` list on the turn (who the body says is in the room,
    the input the withholding reads). Acceptance: a robot-surface turn
    runs end to end in the scripted-engine tests; a sensitive record
    reaches the prompt on a `present: [speaker]` turn and never on a
    turn with a second person present; the same turn on `chat` is
    unchanged. Out of scope: the wire events (WIRE-01), the body's
    presence evidence (the robot's own). Exit: the named tests, `bash
    scripts/check.sh`.

<a id="wire-01"></a>


<a id="wire-01"></a>

- [x] **WIRE-01: The signal and the plan on the wire** (S-M)

    Done 2026-09-15 for the signal and the cancel (f60b7df: the frozen
    signal rides the stream as its own event right after `turn_meta`
    on every turn; 76931ef, 248812f: `POST /api/turn/{turn_id}/cancel`
    aborts the in-flight completion for real, the stream ends with
    `turn_cancelled` and the partial turn is logged as a disconnect is;
    the turn routes joined the OpenAPI router on the way). The `plan`
    event waits for ACT-03, as the item says. The original note follows.

    Filed by the robot's design pass (bot `docs/dev.md`, "named hub
    items"; section 5 is the consumer's contract). Objective: the robot
    drives its expression from the turn's own signal and plan, so both
    ride the stream. Files: `backend/src/wire.ts` (`TurnStreamEvent`,
    today `turn_meta | delta | spoken_cue | done | error` at `:117`),
    `backend/src/routes/turn.ts` (`streamTurnEvents()`),
    `backend/src/lib/turnEngine.ts`, `spec/streaming/` (spec first),
    `backend/tests/turnEngine.test.ts`, the frontend adapter tests.
    Mirror: the `spoken_cue` event, added the same way. Do: a `signal`
    event right after `turn_meta` (the signal is frozen before routing,
    so it costs nothing and never waits on the model); a `plan` event
    before the first delta once ACT-03 lands; a `cancel` event the
    caller can send and the engine honors with the real abort of the
    in-flight completion. Acceptance: the stream tests read `signal` as
    the second event on every model turn and on every immediate turn;
    `plan` is absent until ACT-03 and asserted there; a cancel mid-stream
    ends the turn with the upstream completion aborted (the bench's
    `inferenceStopped` check). Out of scope: the robot's rendering of
    the cues. Exit: the named tests, `bash scripts/check.sh`.

<a id="chat-17"></a>


<a id="chat-18"></a>

- [x] **CHAT-18: Release turn activity exactly once on every exit path** (S)

    Status (2026-09-13, closed): `acquireTurnLease()` with an idempotent,
    per-lease `release()`; blocking turns release in `finally`, streaming
    turns through `holdLease()` on the outermost generator (exhaustion,
    throw, `return()`, abort) and an idempotent `finalize()` with one
    terminal flag; the two-minute timer is a once-per-lease warning, never
    a decrement; a clock seam replaces sleeps. Details in docs/dev/session-a.md.

    Depends on: none. Files: `backend/src/lib/turnActivity.ts`,
    `turnEngine.ts`, `routes/turn.ts`, `routes/openai.ts`,
    `backend/tests/turnActivity.test.ts`, `turnEngine.test.ts`, `openai.test.ts`.
    Replace unpaired global increment/decrement calls with an acquisition
    that returns an idempotent `release()` closure. Acquire at validated
    turn start before safety/pending/command returns can finish; invalid
    requests acquire no lease. Blocking execution releases in `finally`.
    Streaming transfers ownership to its generator and releases on normal
    exhaustion, error, `return()`, and HTTP disconnect. Guard double-finalize
    with one terminal-state flag. Finish timestamps use actual release time.
    Keep an optional stale-task diagnostic but remove the two-minute timer
    as the correctness mechanism; it must never decrement a different
    active turn. An immediate refusal cannot release another user's turn.

    Acceptance: overlap a long model turn with an immediate command and
    refusal; the long turn still blocks background work. Abort before
    first byte, fail during preparation, throw during generation, disconnect
    after a delta, and call release twice; all leave the exact correct
    active count and permit maintenance after 20 seconds. Use the existing
    test timing hooks rather than real sleeps. Out of scope: inference
    priority, new metrics page, or changing refusal semantics. Checks:
    named suites and full exit gate.

<a id="chat-19"></a>


<a id="chat-22"></a>

- [x] **CHAT-22: Make every conversational live bench safe to run** (S)

    Status (2026-09-13, closed): one setup helper
    (`backend/scripts/bench/setup.ts`) refuses a nonempty, non-temp or
    missing data directory and any run without supplied chat and embed
    URLs; every bench ends through `finishBench()` (zero cases exit 1);
    `memory/run.ts` deletes only its own rows; seven entry points proven
    isolated against a stub in `tests/benchSetup.test.ts`. Details in the
    "Session A, after the block" section of dev.md.

    Depends on: none; run before any new live experiment. Files:
    `backend/scripts/bench/{routing,tool-calling,conversation,naturalness,persona-eval,judge-eval,memory-eval}.ts`,
    `backend/scripts/bench/memory/run.ts`, and existing
    `backend/tests/isolation.ts`, `preload.ts`, `reset-db.ts` patterns.
    Build one bench setup helper that creates its own disposable data
    directory before importing database modules, disables service spawning,
    and connects only to an explicitly supplied existing inference URL.
    Never invoke `resetDb` outside bun:test. Refuse an existing/nonempty or
    household data directory before any mutation. Fix the current household
    memory bench's broad cleanup by deleting only records created by that
    bench within its isolated database; cleanup cannot stop a shared model
    server. No auto-download or model replacement. Failed setup exits
    nonzero; zero executed cases cannot report success.

    Acceptance: add deterministic tests using a temporary sentinel directory and stub
    HTTP server proving refusal leaves the sentinel unchanged, repeated
    runs isolate records, and cleanup leaves the external server alive.
    Extend bun:test; do not create a shell test harness. Output synthetic
    transcripts and metrics only, with engine/model identity and executed
    case count. Out of scope: running a benchmark against family history.
    Checks: new tests colocated with existing bench-related tests, existing
    isolation tests, one isolated stub bench invocation for each touched
    entry point, and full exit gate.

<a id="chat-23"></a>


<a id="recall-02"></a>

- [x] **RECALL-02: Episodes are evidence, never lines** (S-M)
    Done 2026-09-14 (docs/dev/session-a.md "RECALL-02"): the person's
    side by default, the hub's side only on a "what did you say" turn
    and then as a reported note; the lexical floor of two shared words
    (or one plus the vector floor) before fusion; the vector floor
    raised to the measured 0.72; no block under two content words (the
    design's three moved to two on the first measurement, the
    coordinator's decision) or on a question about this conversation;
    three lines and 400 characters; the guard reads episodes. Three
    seeded runs recorded there. RECALL-02b (2026-09-14, an outside
    reading): the person's side is every caller's default and the
    hub's side opt-in (the callers enumerated in the commit), a
    thank-you with its object and "what did we discuss" refuse a
    lookup, a closer is never a copied line, and three tests read the
    final prompt.

    Objective: a reply never copies a sentence from another
    conversation, and a short or meta turn recalls nothing. Files:
    `backend/src/lib/episodes.ts` (`recallEpisodes`, `formatEpisodeLine`,
    `formatEpisodesForPrompt`, the unused `pairedText`),
    `backend/src/lib/guards.ts` (`guardUnrelatedRecall`),
    `backend/src/lib/turnEngine.ts` (`prepareTurn`'s episode call),
    `backend/scripts/bench/recall-floor.ts`, `backend/tests/episodes.test.ts`,
    `guards.test.ts`. Mirror: the vector floor `EPISODE_MIN_COSINE` and
    the `guardedTurnNote()` system-note shape. Do: assistant-side
    episodes only on a recall-shaped question (the recall package's
    routing examples define the shape), rendered as a reported-speech
    system note with the paired user side, never `you replied: "..."`;
    a lexical floor (two shared content words, or one plus the vector
    floor), measured on the recall-floor bench and recorded; no episode
    block on a turn with fewer than two content words (amended from
    three, 2026-09-14) or a question about this conversation; at most
    three lines and 400 characters;
    `guardUnrelatedRecall` reads `ctx.episodes` beside `ctx.sources`.
    Acceptance: the `copied-line` conversation (design note, section 1,
    the explicit-history third conversation included) and the opening
    turns of household-subject-dog and household-subject-person, three
    seeded runs. Out of scope: CHAT-10's bounded query (the subject
    becomes the query when CHAT-13 lands). Exit: `bun test
    tests/episodes.test.ts tests/guards.test.ts`, the recall-floor
    bench's recorded floor, `bash scripts/check.sh`.

<a id="recall-03"></a>


<a id="recall-03"></a>

- [x] **RECALL-03: Within-conversation recall past the window** (S)
    Done 2026-09-14 (docs/dev/session-a.md "RECALL-03 and GUARD-LINES";
    from Jesse's live chat of 2026-09-14): the current conversation's
    own person-side turns that fell out of the window are evidence for
    the turn, recalled by the same floors as an earlier conversation's
    episodes (`recallEpisodes()` gains `withinConversationId` and
    `excludeTurnIds`, the window reporting its `turnIds`), plus the
    earliest dropped turn whatever the floors say when the question is
    about how the chat began (`ASKS_ABOUT_START_RE`,
    `earliestDroppedTurn()`); rendered under "Earlier in this
    conversation" as the person's words, never the hub's side; the
    guards read them as evidence. The `recall-past-the-window`
    conversation (fourteen turns, the two live turn shapes with roster
    names). One seeded set, GUARD-LINES riding on it.

<a id="guard-lines"></a>


<a id="guard-lines"></a>

- [x] **GUARD-LINES: The replacement bank says the plain honest line** (S)
    Done 2026-09-14 (docs/dev/session-a.md "RECALL-03 and GUARD-LINES"):
    every bank line without "told" or "nobody" (Jesse's rule of
    2026-09-13, applied to the bank itself): "I don't have that one
    yet." for a household fact, "I don't know that one." for a world
    fact, the act-aware lines for an emptied reply; the legacy lines
    stay recognized by the window's strip; `allReplacementLines()` and
    a test that none carries the words; the fixture's `HONESTY_LINES`
    updated. Also here, two folds from EXP-01's set: a future-tense
    promise to act on a statement ("I'll add that to the list") is
    skipped like a completed claim, and a sentence that followed a
    skipped one on a conjunction loses the lead.

<a id="out-01"></a>


<a id="out-01"></a>

- [x] **OUT-01: One validated reply boundary after every producer** (S)
    Done 2026-09-14 (docs/dev/session-a.md "OUT-01"): the rule and the
    repair in `lib/wellFormed.ts`, run in `finalizeReply()` on every
    producer; a short malformed model output regenerated once under a
    48-token cap, its repair standing; the streaming opening hold and
    the final span's repair; the `malformed` line; dash-line persona
    examples (persona-eval before and after recorded); the bench's
    universal `well-formed` check and per-run count. Three seeded runs
    recorded there.

    Objective: a fragment, a lone token, an empty reply or a reply with
    an unmatched quotation mark is never sent or stored, from any
    producer. Files: `backend/src/lib/turnEngine.ts` (`finalizeReply`,
    the one place every producer passes: `runTurnStreamHoldingLease`'s
    `finalize` and first-chunk hold, `peekAndHandle`'s empty-reply
    branch, `runTurnHoldingLease`'s `answerWithSafetyAndGuards`),
    `backend/src/lib/guards.ts` (a `malformed` reason and its bank),
    `backend/src/lib/persona.ts` (`examplesBlock` renders dash lines,
    no quotation marks), `backend/scripts/bench/conversationScore.ts`
    (a universal `wellFormed` check on every row),
    `backend/tests/turnEngine.test.ts`, `persona.test.ts`. Mirror: the
    invention retry's one-retry bound. Do: a complete sentence (a
    terminator; two words, or one from the engine's short-answer
    vocabulary; balanced quotes and brackets; no control markers),
    checked before `logTurn`; one regeneration for a model fragment,
    then the `malformed` line; a package or command line that fails is
    logged loudly and replaced by the same line; the streaming first
    chunk held to two words or a boundary and the final buffered span
    repaired, never emitted raw; the persona-eval bench rerun on the
    unquoted examples. Acceptance: every fixture row passes `wellFormed`
    in three seeded runs; a scripted engine that answers "I", an empty
    string, an unmatched quote and a dangling connector yields the
    retry then the fixed line, and none of the four raw forms is stored;
    "Yes." on a confirmation stands; the check runs on the model, a
    package, a command and a guard replacement. Out of scope: sampler
    changes (record the fragment rate per run instead). Exit: the named
    tests, the persona-eval bench, `bash scripts/check.sh`.

<a id="spec-01"></a>


<a id="spec-01"></a>

- [x] **SPEC-01: The design pass's spec migration, one bump** (S-M, spec only; after OUT-01, before every engine item that reads a new field) - shipped 2026-09-14, Session B

    Objective: every record the pass changes is declared once, with a
    default, in one spec release, so the robot pins one bump and no
    engine item waits on a later spec item (dev.md, "Coherence review,
    2026-09-14", question 4). Files: `spec/schemas/memory-record.schema.json`
    (`child_disclosure: child_ok | teen_ok | adult_only` with `set_by`
    and `set_at`, null on person and self scope; `fact_confidence`
    (named against the signal's `act_confidence`, the outside review's
    point), `confidence_evidence`, `conflicts_with` as section 14 defines them,
    default 1.0 with one `legacy_assertion` entry, no writer until
    CRED-01; `scope` gains `companion` with `companion_id`; `expired_at`;
    the per-record retrieval signal REVIEW-01 reads), `entity.schema.json`
    (`pronouns`), `vocab/relationship-types.json` (`relative_of`), a new
    `vocab/entity-kind-nouns.json`, a new `vocab/life-events.json`
    (the adult-to-tell classes and section 14's life-events classes, one
    file), a new `conversation-turn.schema.json` (the shared turn record
    the robot syncs: `signal`, `plan`, `subjects`, `outcomes`, `document`
    nullable, `review_id` nullable, `notice_ids` nullable for AGE-02's
    dedupe and audit key), `turn-signal.schema.json`
    (`refers_to_prior` nullable until CHAT-13), `reply-plan.schema.json`
    (the moves declared once: react, care, say, pick, point, ask_back,
    close, defer; `required | allowed | forbidden` each; playfulness;
    `max_sentences`; `max_words`; the band fields of section 13 part 9),
    `subject-ref.schema.json` (the discriminated union of the item
    folded below, plus `carried_question` on a stack entry),
    `open-question.schema.json` (keyed by person with an optional
    conversation; kinds `who | clarify_fact | relay`; asked once at the
    end of the person's next reply, then cleared), `model-capabilities.schema.json`
    (a `turn-signal` role and a `head` engine kind), a `vocab/defect-codes.json`
    from which the guard reason enum, the `plan_violation` sub-kinds and
    REVIEW-01's five review-only codes are generated, fixtures for every
    variant, both generated bindings, `spec/README.md`. Mirror: step 3a's
    additive fields and their round-trip fixtures. Acceptance: the
    round-trip fixtures for every new field and record; the validator
    refuses a world `SubjectRef` carrying an `entity_id`, a `companion`
    scope without `companion_id`, and a `child_disclosure` on person
    scope; every existing fixture validates unchanged (additive only);
    the bot's pin note names the one version. Out of scope: any hub code;
    the companions and manifest changes (SPEC-02). Exit: the spec suite,
    `bash scripts/check.sh`.

    Second reading taken 2026-09-14, Session B, same bump: an outside
    review of 29ac71f found the schema's own `fact_confidence` default
    (`null`) never matched what a memory record actually requires
    (non-null, 1.0 on migration) - a `memory-legacy` fixture now proves
    the schema's own migration claim is a real, constructible record,
    not just prose. The bigger finding: every cross-field rule (scope
    needing its person/companion_id, `child_disclosure`'s scope rule,
    `fact_confidence`'s kind rule) lived only in the TypeScript
    validator, so a robot validating by the Python binding alone could
    write what the hub refuses. `spec/records/py/validate.py` is now
    that rule set's Python twin, plus seven more refusals in both
    languages: a non-companion scope with a `companion_id`,
    `child_disclosure_set_by`/`_set_at` set inconsistently,
    `retrieval_feedback`'s `corrections`/`last_corrected_at` pairing,
    `TurnSignal.source: head` needing a `classifier_id` (and no other
    source having one), clause ranges unordered, overlapping, or past
    the utterance's length, an `OpenQuestion` whose status contradicts
    its own timestamps, and a world `SubjectRef` with `source_kind` and
    `stable_key` not both set or both null. A refusal fixture per rule
    runs in both suites (`spec/tests/ts/record-validate.test.ts`,
    the new `spec/tests/py/test_record_validate.py`).

<a id="reg-01"></a>


<a id="reg-01"></a>

- [x] **REG-01: A statement is not a request, and the assistant register is stripped** (S)

    Done 2026-09-14 (docs/dev/session-a.md "REG-01"): the three rules in
    `lib/guards.ts` reading ACT-01's signal (`act` on the guard
    context): on a statement with no outcome an action claim is skipped,
    never narrated (`isSkippable(reason, ctx)`); the assistant register
    beside the closers, one list, a sentence that is only register
    skipped and a register lead or tail cut (`assistant_register`); the
    hub's previous question said back skipped (`repeat_question`, the
    previous reply on the context). The engine's one retry with the
    note on both paths when nothing remains, then the malformed line.
    Corpus rows both ways; the `statement-not-request` conversation.
    The plan half (a plan forbidding the claim before generation, the
    `plan_violation` family) is ACT-03's.

    Objective: a first-person statement never gets "I've noted that",
    a guard replacement never names a package family the person did not
    mention, and no question is said twice. Files:
    `backend/src/lib/guards.ts` (`guardUnsupportedAction`,
    `unsupportedActionLine`, the #95 closer list extended into one
    `assistant_register` list, a `repeat_question` reason),
    `backend/src/lib/turnEngine.ts` (the statement-turn retry, the
    previous reply's question sentences on the guard context),
    `backend/src/lib/turnContext.ts`, `backend/tests/guards.test.ts`,
    `turnEngine.test.ts`, `spec/llm/guard-corpus.json`. Mirror: the
    SKIPPABLE `claimed_experience` handling and the invention retry. Do:
    on a statement-shaped turn with no outcome an action claim is
    skipped, and an empty result gets one retry with the system note
    "Nothing was asked; respond to what they said"; the assistant-
    register sentences are skippable; a sentence that repeats a question
    from the hub's previous reply is skippable. Acceptance: the
    `statement-not-request` conversation (design note, section 5), three
    seeded runs; corpus rows both ways for each list. Out of scope: the
    companion's register itself (COMP-03, EVAL-03). Exit: the named
    tests, `bash scripts/check.sh`.

<a id="reg-02"></a>


<a id="exp-01"></a>

- [x] **EXP-01: Experience and plan claims** (S)

    Done 2026-09-14 (docs/dev/session-a.md "EXP-01"): the plan forms
    (`PLANNED_EXPERIENCE_RE`: going to, gonna, plan to, can't wait to,
    excited to, looking forward to, curious to, try to, want to, with
    the verbs and their gerunds, an implicit subject allowed, the
    verb's object deciding: "hear what you think" is conversation) and
    "haven't ... yet" are `claimed_experience`; the negation exemption
    only for a plain negation with no yet, but or though; a claim about
    the hub's own past promise ("I said I'd look it up") is
    `claimed_statement` with its own line. Eleven corpus rows both
    ways; the fixture's `PLAN_CLAIM` beside `EXPERIENCE_CLAIM`, the
    `new-album` conversation (its lookup and reflected-question rows
    LOOKUP-01's and CHAT-13's), copied-line-history turn 2 as the
    target turn. Also here, an S line from REG-01's set: the line that
    stands when the register scrub empties a reply reads the act.

    Objective: the hub never says it has seen, heard, played or plans
    to watch anything. Files: `backend/src/lib/guards.ts`
    (`CLAIMED_EXPERIENCE_RE`), `backend/tests/guards.test.ts`,
    `spec/llm/guard-corpus.json`, `backend/scripts/bench/conversationFixture.ts`
    (`EXPERIENCE_CLAIM`). Do: intent forms (going to, gonna, plan to,
    can't wait to, excited to, looking forward to, curious to, with
    watch, see, hear, listen, play, read, try, check out) and
    "haven't ... yet"; the negation exemption only for a plain negation
    without "yet" or "but". Acceptance: the `new-album` conversation's
    "are you gonna listen to it" and "nope, you?" turns (design note,
    sections 4 and 7) show no claim in three seeded runs; corpus rows
    for each new form and for the hearsay forms that must stand ("I
    hear it's good", "I've never heard it"). Out of scope: the composed
    experience answer (CHAT-16). Exit: `bun test tests/guards.test.ts`,
    `bash scripts/check.sh`.

<a id="ask-01"></a>


<a id="ask-01"></a>

- [x] **ASK-01: The unknown-name rule (ask, never assume)** (M; spec S first)
    Done 2026-09-14 (docs/dev/session-a.md "ASK-01"): the resolver in
    `lib/unknownNames.ts` (the `compromise` tagger's candidates, the
    household frames, SPEC-01's SubjectRefs on the turn and the row,
    the carry for a pronoun-only turn); the unknown line and the
    registry's subject line ahead of the memory section; the engine's
    own ask appended on both paths (after the last delta on a stream),
    deduped against the model's question, outranking the engagement
    dial; the deterministic answer parser through step 3a's paths
    (kind from the noun vocabulary, relation from `said_as`, pronouns,
    description), a cancel, an unreadable answer falling through; step
    3a's amendment (a name alone is a candidate) with the judge's
    OpenQuestion (`open_questions`, asked once at the end of the next
    reply, answered before it is put, or declined for good);
    `false_familiarity` (replaced by the ask), `pronoun_mismatch`, and
    the role-invention shape for the seltzer row; `entities.pronouns`
    written; five bench conversations and their expectation kinds.
    The seeded set is the coordinator's next "set".

    Objective: a name the hub has never heard is asked about, never
    assumed, and the answer creates the entity as stated; an inference
    is a candidate and an open question, never knowledge. Spec first:
    `spec/schemas/entity.schema.json` gains `pronouns` (nullable
    string); `spec/vocab/relationship-types.json` gains `relative_of`
    (person to person, symmetric, terminable); a new
    `spec/vocab/entity-kind-nouns.json` maps answer nouns to kinds;
    round-trip fixtures and both generated bindings. Then the engine:
    `backend/src/lib/turnEngine.ts` (`prepareTurn`: the name resolver,
    the unknown line in the context ahead of the memory section, the
    appended ask that outranks the persona's engagement dial),
    `backend/src/lib/turnContext.ts` (`subjects`: the `unresolved`
    SubjectRefs the detector writes, SPEC-01's shape; `unknownNames` is
    deleted by the coherence review),
    `backend/src/lib/conversationHistory.ts` (`PendingAsk.kind` gains
    `who`; the `OpenQuestion` record of SPEC-01, keyed by person, kinds
    `who`, `clarify_fact` and `relay`, asked once at the end of the
    person's next reply on any conversation, in place of a conversation
    column),
    `backend/src/lib/subjects.ts` (the deterministic answer parser
    calling `ensureSubjectEntity` and `writeRelation` with `stated:
    true`; the hedge rendering in `subjectLabel` removed),
    `backend/src/lib/memoryJudge.ts` (an inferred entity or
    relationship becomes a candidate plus the open question, not a
    rendered or recallable record, the step 3a amendment),
    `backend/src/lib/memory.ts` (recall never reads an unconfirmed
    inferred relationship), `backend/src/lib/guards.ts`
    (`false_familiarity`, `pronoun_mismatch`; the acknowledgment bank
    never replaces a sentence about an unknown name), their tests, the
    guard corpus. Mirror: `resolvePendingAsk()` for the `who` kind; step
    3a's creation and confirm paths (`promoteToStated`); the
    `compromise` tagger as a dependency through bun (the org's prebuilt
    rule), never a copied word list. **Amended 2026-09-14 (the coherence
    review, question 2):** the detector never calls a typed source or
    the network to classify a name; a name is `unknown` at turn time,
    and the engine's ask fires, only when the utterance frames it as
    household (a relation phrase, "my" or "our", a pronoun for it in the
    same turn, or the roster's shape); a bare proper noun with no frame
    is an `unresolved` SubjectRef with no ask, and part 4's open question
    catches a household inference the judge makes. Step 3a owns every
    transition (confirm, `promoteToStated`, the orphan rule); this item
    owns the asking and the answer parser that calls 3a's paths, and
    adds no transition of its own. Two rows join:
    `who-ask-declined` ("never mind" to "Who's Juniper?": the ask
    cleared, no entity, no second ask) and `open-question-once` (asked
    once at the end of the next reply, never again after "not now").
    Acceptance: the three conversations
    in the design note, section 3 (`unknown-name-person`,
    `unknown-name-pet-lowercase`, `unknown-name-marathon`), plus
    `coworker-likes-seltzer` turn 4 as a target row for the
    false-familiarity family (OUT-01's set, 2026-09-14: "who is Quill"
    answered "the child in the house, Bramble's sibling" with the
    coworker label in the context, a household invention the guards
    did not catch), three seeded
    runs; unit tests per part (the resolver's known set, the appended
    ask deduped against the model's own question and appended under the
    brief persona, the answer parser for a pet, a relative and an
    unreadable answer, the judge's open question asked once and its
    candidate unreadable by recall until confirmed, the two guard shapes
    both ways). Out of scope: CHAT-13's subject stack (it reuses this
    resolver). Exit: the spec round-trip tests, the named backend tests,
    `bash scripts/check.sh`.

<a id="ask-01-followups"></a>


<a id="historical-item-068"></a>

- [x] **ASK-01 follow-ups: the resolver's edges** (S)
    Done 2026-09-14 (docs/dev/session-a.md "ASK-01", "The follow-ups"):
    the eleven lows of the second and third reviews and the seven of
    the fourth, in `lib/unknownNames.ts`, `lib/turnEngine.ts`,
    `lib/conversationHistory.ts`, `lib/memoryJudge.ts` and
    `lib/guards.ts`, each with a regression test in
    `tests/unknownNames.test.ts` or `tests/ask01.test.ts`: the About
    line's entries and the memory bullets' subject labels are
    grounding evidence; the relation question uses the prompt's own
    phrase per type; a bare answer binds only a question this
    conversation raised or about its last subject; a declined engine
    ask is recorded so the judge's later candidate queues no twin; a
    question whose subject is gone, or a pending one older than a
    week, lapses (`expired`); "of course" is not familiarity; the third
    relation pattern needs its connector; a bare yes answers a relation
    question only; a confirmed entity is never replaced by an answer;
    the replacement is created before the guess is retired; "and" is
    never the noun; a possessive name is filtered after the strip.

    Objective: the five low findings of ASK-01's second review, each a
    small change in `backend/src/lib/unknownNames.ts` or
    `backend/src/lib/turnEngine.ts` with a test in
    `backend/tests/unknownNames.test.ts` or `tests/ask01.test.ts`:
    the third relation pattern matches across a verb object ("Tell
    Nadia my phone is broken" frames Nadia as a thing; bound the
    pattern to the name's own clause); the pre-asked answer path reads
    the person's oldest pending question from any conversation, never
    expiring (scope it to the conversation that raised it or the last
    day, and expire the rest per the spec's `expired` status); the
    kind-mismatch replace in `applyWhoAnswer()` acts on whatever the
    subject id points at (limit it to an unconfirmed candidate, as
    `candidateByName()` already does); an open question whose subject
    is gone is still asked and binds an empty name (expire it
    instead); `ensureFreshEntity()` soft-deletes the candidate before
    the create, so a failed create strands its records (create first,
    then retire); a bare "sure" or "right" to "Who's X?" is read as a
    yes with nothing learned (treat a verdict with no candidate edge
    as unreadable); the About line is in the prompt but not in the
    turn's evidence, so the role-invention shape can cut "Quill is a
    generous coworker" with the label only in that line (add the line
    as grounding evidence); the volunteered answer binds the oldest
    pending question rather than one whose subject was in the last
    turn's subjects; `PRONOUN_ANSWER_RE` takes "and" as the noun in
    "he's our rabbit and he bites"; a possessive name ("Grandma's") is
    filtered after the strip, not before. Acceptance: one test per line, `bun test
    tests/unknownNames.test.ts tests/ask01.test.ts`. Out of scope:
    CHAT-13's subject stack. Exit: `bash scripts/check.sh`.

<a id="rep-01"></a>


<a id="rep-01"></a>

- [x] **REP-01: A cross-turn repetition guard, and the objection** (S)
    Done 2026-09-16 (docs/dev/session-a.md "REP-01"; dev.md section
    16 part 3, item 4 of its list; findings 29 and 46): one
    deterministic read at the boundary on both paths over the hub's
    previous two replies (`GuardContext.previousReplies`, off the
    window). `repeat_sentence`, skippable: a sentence equal after
    normalization (`normalizeForRepeat()`: case, punctuation and
    whitespace collapsed; a closer is nothing, so is a sentence of two
    words or fewer) to one in either previous reply is skipped
    wherever it sits, on the stream per sentence at the guards' point.
    `repeat_reply`, the whole-reply case (`isRepeatReply()`: content
    words overlapping a previous reply's by 80 percent or more with no
    new proper noun or number, or every sentence a repeat): the
    chat-loop line stands in, marked emptied, and the engine retries
    once with `REPEAT_RETRY_NOTE` (REG-01's retry, the turn's second
    generation); a retry that repeats too leaves the line; on the
    stream the end-of-reply case is recorded on the row. On an
    objection (target hub with a repair, or `OBJECTION_RE`'s shapes)
    a bare assertion of understanding is `self_assertion`, skipped, a
    tail on the register family; the retry note carries the objection
    (`repeatRetryNote()`). The exemptions are by construction: the
    guards read the model's text only (a fixed line the engine
    repeats, a package's deterministic answer and a re-asked
    confirmation or ask never pass through them), and two words are
    never a repeat. The plan half (`repeat: forbidden`, the remedy by
    objection type) rides with ACT-03. The ids join
    `spec/vocab/defect-codes.json`. Bench: `said-that-already`,
    `same-line-twice`, with `retries`, `distinctFromPrevious` and
    `guardHits` as expectation kinds; seven engine tests that scripted
    the same line on consecutive turns vary it now. Tests:
    `backend/tests/rep01.test.ts`, the corpus rows. Exit: `bash
    scripts/check.sh`.

<a id="set-reads-0915"></a>


<a id="historical-item-070"></a>

- [x] **The set's three reads: a child's asserted state, a remark is not the answer, the example line said back** (S)
    Done 2026-09-16 (docs/dev/session-a.md "The set's three reads"):
    the household activity shape reads a state after "is" or "has
    been" ("he's been asleep in the dark") as it reads a progressive,
    so a child's state the owner has no record of is an invention; a
    world mark in a `who` answer counts in an answer's shape only (no
    question, no tag, eight words or fewer), so "she was on that show
    for years, wasn't she" learns nothing; the persona's own example
    line said back ("Got it, added to the list.") is `example_parrot`
    read before the action family, a register-family skip with its own
    retry note. Rows: child-state-invented, remark-not-an-answer,
    example-line-not-an-answer; the corpus rows; tests/setReads.test.ts.
    Exit: `bash scripts/check.sh`.

<a id="ask-02"></a>


<a id="ask-02"></a>

- [x] **ASK-02: Candidate hygiene, brands and services, hub-introduced names, the confirmed public figure** (S)
    Done 2026-09-15 (docs/dev/session-a.md "ASK-02"; dev.md section 16
    part 7, item 7 of its list; findings 33 and 44): the resolver's
    world edge in `backend/src/lib/unknownNames.ts`. Rule 1, hygiene
    (`notAName()`): an edge dash trimmed, an oath in its slot
    ("Lord, that took ages"), a token the tagger also reads as an
    expression, an adjective, an adverb or a verb, a capitalized word
    that was an ordinary word in the last three turns or sits after a
    determiner ("that Answer was wrong"), and a typo one edit from a
    predicate word in a predicate's slot ("Wong, that's not it");
    the tagger's lexicon is the word list, nothing on the network.
    Rule 2: a brand or a service (the tagger's organization tag, a
    model number or a product noun after the name) is unresolved with
    `candidate_kinds: [organization]`, no frame, no ask. Rule 3: a
    name the hub introduced (its last two replies, a retained
    outcome's result text; a name the person said first stays theirs)
    is a `world` subject with that provenance, never unresolved,
    never asked back (`KnownNames.hubNames`, `namesIn()`). Rule 4:
    the `who` answer parser reads the world kinds ("the actress,
    Serena Vale", "a public figure", "she's famous", a full name to a
    first-name ask) into `WhoAnswer.world`; the answer creates no
    entity, retires a candidate of the name, puts a `world` subject of
    that kind on the turn, and runs the turn that raised the name
    (`PendingAsk.carriedQuestion`) as a websearch `via: forced` with
    the engine's query (`worldAnswerQuery()`), so the reply is the
    answer; the model's own identity question about a bare unresolved
    name ("someone you know or a public figure?") binds as the ask
    (`replyAsksIdentityOf()`). The `[turn]` line's subjects carry the
    world kind or the hinted kinds. Bench: not-a-name, hub-named-it,
    public-figure (the fake search's film cast row names Serena Vale),
    `subjectsAbsent` and a subject `kind` as expectation kinds. Tests:
    `backend/tests/ask02.test.ts`. Exit: `bash scripts/check.sh`. The
    full set on bc738b5 (86 rows, three runs): 240, 237, 239 of 302,
    the hard rows 12 of 12, the question rate 27.6 to 29.2 percent;
    LOOKUP-02 and ASK-02 accepted on it. The follow-up commit: the
    lookup stand-down reads the turn's household subjects (things,
    places, the carried ones), the stack deduped by entity; the query
    for a pronoun-only question with no world subject is the
    confessing sentence's own words; a queued question in play goes
    first and a relationship question about a name not in play holds;
    hub-named-it seeds its promise, the Serena Vale fixture carries
    what happened, not-a-name names Answer.

<a id="lookup-02"></a>


<a id="lookup-02"></a>

- [x] **LOOKUP-02: The hedge is a promise, the offer binds its question, the forced lookup is a ladder** (S-M)
    Done 2026-09-15 (docs/dev/session-a.md "LOOKUP-02"; dev.md section
    16 parts 1, 2 and 4, item 3 of its list): the read over the draft's
    first two sentences or 160 characters on both paths (the stream's
    hold widened); a denial of a deliverable (`false_capability`, the
    id in `spec/vocab/defect-codes.json`) is cut first and the promise
    behind it read; the hedge-plus-promise and help shapes join the
    promise and offer families; a hedge beside a checkable value on a
    world question is the other confession (`hedged_fact` on the
    `[turn]` line); an offer binds and never forces; the engine writes
    the lookup's query from the turn's subjects and the confessing
    sentence (`lookupQueryFor()`), never from the person's words; a
    pending lookup binds that question; the imperative consent forms
    run it; the forced lookup is a ladder (`runForcedLookup()`: the
    model's rung under `tool_choice: required`, then the search with
    the same query, the failed rung kept, `via: forced` on its
    outcomes); `capability_claim` is off a request the lookup tools
    serve. Bench: hedged-promise, offer-binds-the-question and its
    go-on-then variant, objection-reruns, hedged-draft,
    ladder-falls-through, with `seedReply` now a real draft through the
    recording proxy and the `outcomeArgsMatch` and `lookupShape`
    expectation kinds; open-question-once seeds its candidate. Tests:
    `backend/tests/lookup02.test.ts`, the corpus rows. Part 1's rule 1
    (the claim-type decision before generation) is CHAT-13's. Set 1 on
    2c3eaee: 38, 38, 38 of 47 over thirteen rows, the item's six green
    every run; its three reads fixed after (a number word is a
    checkable value; offer-binding reads the built query;
    act-register-requests seeds Rover as the registered pet, a seed
    confirming an earlier row's candidate of the same name).

<a id="lookup-01"></a>


<a id="window-01"></a>

- [x] **WINDOW-01: A bank line never reaches the model as its own words** (S)
    Done 2026-09-15 (17de27f, e35bac1; dev.md section 16 part 11,
    finding 38): the window strips a replaced reply's bank line whole,
    two-sentence lines included, and a pending line notes the wait
    instead of quoting the line; the family-note test reads the
    pending rule. Landed in the stack-2 gate with CHAT-13's chunks.

<a id="reg-02-tail"></a>

- [x] **REG-02-TAIL: Wishes are closers, and a tag question is a cut tail** (S)
    Done 2026-09-15 (d8b2427, 14d3736; dev.md section 16 part 9,
    findings 35 and 40): a wish sentence ("good luck", "fingers
    crossed") is register and skipped, a wish tail is cut, a standalone
    or same-line tag question at the end of a reply is cut with its own
    reason `tag_question` on both paths (the streaming path's cut was
    missing in the first commit; the full gate found it through the
    corpus row). Bench: `sign-offs`. Tests: guards.test.ts, the corpus
    rows `reg02-*`, two streaming tests in turnEngine.test.ts.

<a id="exp-02"></a>

- [x] **EXP-02: Experience verbs by object, three new forms, the replacement only on an experience turn** (S)
    Done 2026-09-15 (faa95d1 through 4ef16e3; dev.md section 16 part
    8, finding 34): the consumption verbs count only with a sensory or
    consumption object (a food or place word, a title on the stack,
    "it" or "that" when the live world subject's kind is media, place
    or food, the object the question itself named on an experience
    turn), never with a lookup infinitive; "can't wait", "as excited as
    you" and reputation hearsay on a `current` world subject with no
    review or rating outcome are claimed experience; the
    CANNOT_EXPERIENCE line stands in only when the person asked about
    the hub's experience, an objection turn never takes a capability
    line, and elsewhere the sentence is skipped and the rest stands.
    Bench: `experience-forms`. Tests: guards.test.ts "EXP-02", the
    corpus rows `exp02-*`. Four commits: the first three rounds each
    weakened a test to pass; the fourth restored them.

<a id="historical-item-076"></a>

- [x] **The set read of 2026-09-15 on d4fbf6e** (S)
    Done 2026-09-15 (350147d; the full seeded set, 238, 237 and 243 of
    313): chunk E's short-comment reclassification yields to a closing,
    greeting or backchannel the rule layer read ("thanks" after a
    lookup is a closing again, six rows); "check if I remember" is a
    recall promise, not a lookup; "supposed to be" and "meant to be"
    join the hedge marks; `carry-decays` and `comment-not-definition`
    name a cartoon title that is on no roster; `subject-before-pattern`
    is marked red until CHAT-13's typed world subject lands. Left for
    Session A's lane: an asserted state of a child the owner has no
    record of passes the household guess guard (cross-person-recall#2),
    a world-answer mark taken on a long statement that is no answer,
    and the prompt-side drift that draws "Got it, added to the list."
    on a plain statement.

<a id="cons-01"></a>

- [x] **CONS-01: Standing reply constraints** (spec S, engine S)
    Done 2026-09-15 (7e816a7 the spec; 145d2df, f773e80, 9ccaf9f,
    16f678f the engine; dev.md section 16 part 9, rules 2 and 3): the
    `reply_constraints` table and its migration, a deterministic parser
    ("stop saying X" checked against the hub's last two replies, the
    shape and length asks) and store (`lib/replyConstraints.ts`); the
    engine writes the constraint after the window and lets the model
    answer; a sentence carrying a banned phrase is cut (`banned_phrase`,
    skippable) and an emptied reply retries with the phrase in the note;
    the spoken cue drops any banned cue, never plays twice in a row for
    a person, and never plays on an objection to the hub
    (`cueSuppressed` on the stream result). Bench: `sign-offs` turn 3,
    `cue-banned`; `list-shape-on-lookup` waits for CHAT-16's composer.
    Tests: replyConstraints.test.ts, guards.test.ts "CONS-01", the
    corpus row, two stream tests.

<a id="alm-01"></a>

- [x] **ALM-01: Derived date and time questions as a compute over the almanac** (S-M)
    Done 2026-09-15 (dbf42dd the module; 9d4652c, d69335f the engine;
    7162ed9 the connective prefix, 041d856 the bench clock and the
    `derived-dates` row, both on the next stack; dev.md section 16 part
    6, rule 1):
    `lib/almanacCompute.ts` parses the relative-term grammar, answers
    from a given clock with fixed plain templates and the inputs
    recorded, and annotates a date's relation to today for the
    composer; 18 tests on a pinned Monday clock. The rule layer reads
    the relative term in the shared prepare path before routing and
    answers from the turn's clock with a typed `almanac-compute`
    outcome carrying the inputs; a follow-up reads the carried term;
    the bare almanac questions still route to their packages, behind a
    leading connective too. Rule 2 (every date in a composed answer
    annotated) rides with the composer core.

<a id="lookup-01"></a>

- [x] **LOOKUP-01: A promise is the lookup, an offer is a pending ask** (S-M)
    Done 2026-09-14 (docs/dev/session-a.md "LOOKUP-01"): the promise
    and offer shapes in `lib/guards.ts` (`lookupShapeOf()`, one
    definition for both paths); a first-sentence promise with no lookup
    outcome is never sent, the forced lookup runs (the invention
    retry's own mechanism) and its answer goes out, or the rest of the
    draft without the promise, or the lookup family's honest line; the
    streaming path holds the first sentence (`LOOKUP_HOLD_MAX_CHARS`)
    and aborts the draft's request before the forced completion; an
    offer or a promise that went out becomes a `lookup` pending ask
    bound to the question (`notePendingLookup()`), which a consent word
    runs through the websearch via ask, a refusal clears, and anything
    else falls through. The `offer-binding` conversation, the bench's
    fake SearXNG, EXP-01's two fold rows, and the bench's question rate
    beside the DailyDialog reference (finding 23, a measurement only).
    Until CHAT-13 gives the
    forced lookup a subject, the forced completion is the invention
    retry's own (the model writes the expression from the same
    messages) and the pending ask binds the person's utterance
    verbatim as the expression. The seeded set: 193, 194 and 193 of
    254 (RECALL-03's 189, 188, 186 of 251), the item's rows green in
    every run; its one regression (a promised lookup forced on a
    household subject) fixed in the follow-up: a question carrying a
    household subject is never looked up on the web and binds nothing.
    Follow-ups left on record: the empty-lookup reply shape (CHAT-13's
    ladder), the frame-only household subject (ASK-01).

    Objective: "let me check that for you" runs the check, and "do it"
    after an offer runs the offer. Files: `backend/src/lib/turnEngine.ts`
    (the first-sentence read on both paths; the forced lookup through
    `lookupTools`, the invention retry's own mechanism; the `lookup`
    pending ask), `backend/src/lib/conversationHistory.ts`
    (`PendingAsk.kind` gains `lookup`, bound to the resolved query),
    `backend/src/lib/guards.ts` (the promise and offer shapes, one
    definition shared with the lookup action family),
    `backend/tests/turnEngine.test.ts`, `tier2.test.ts`. Mirror: the
    invention retry in `runTurnHoldingLease` and `resolvePendingAsk`.
    Do: a promise or offer in the first sentence with no lookup outcome
    is an invalid draft and is not sent; the forced lookup runs on the
    subject and question and its result goes out as every lookup result
    does; a promise later in the reply becomes a `lookup` pending ask
    that a consent word resolves. Acceptance: the `new-album` "when is
    it out" turn and the `offer-binding` conversation (design note,
    section 4), three seeded runs; a scripted-engine test for each path.
    Out of scope: the composer (CHAT-16) and the decision rule for
    exact fields (CHAT-13's amendment). Exit: the named tests, `bash
    scripts/check.sh`.

<a id="engine-host-01"></a>


<a id="engine-host-01"></a>

- [x] **ENGINE-HOST-01: External engines for the hub and the bench** (S)
    Done 2026-09-14 (docs/dev/session-a.md "ENGINE-HOST-01"): the
    three supervisors' URL tiers (`MAIPAI_LLAMA_SERVER_URL`,
    `MAIPAI_BACKGROUND_URL`, `MAIPAI_EMBED_URL`, one name per engine,
    already spawning nothing) now probe the engine they point at and
    read its identity from `/props` (`lib/engineIdentity.ts`: the
    build, the model's file name, the health answer, the host as a
    label only, `local` or `external`, never an address); the `[turn]`
    line carries `engine`; the bench header and setup's refusals print
    the label for a non-loopback engine, the model's file name, and no
    hash for a file this machine does not have (llama-server exposes
    none); the recording proxy fronts the external chat engine as it
    fronts a local one. A test per supervisor and for the identity
    module. The privacy page is unchanged: an engine on the LAN is the
    household's own machine, and the hub talks to it only when the
    household points it there.

    Objective: run the hub and the seeded sets against engines on
    another machine in the house, so the bench machine's memory stops
    mattering and a set holds nothing else. Files:
    `backend/src/lib/llmSupervisor.ts`, `backgroundSupervisor.ts`,
    `embedSupervisor.ts`, `engineIdentity.ts`, `turnEngine.ts` (the
    `[turn]` line), `backend/scripts/bench/setup.ts`,
    `conversationLive.ts`, their tests. Out of scope: any change in
    what the engines do; a settings key for the URLs (the env keys are
    the developer's override, a household setting is its own item).
    Exit: `tests/engineIdentity.test.ts`, the three supervisor suites,
    `bash scripts/check.sh`.

<a id="subject-ref-spec"></a>

- **The `SubjectRef` spec, for CHAT-13** (folded into SPEC-01 by the coherence review, 2026-09-14; the shape is recorded here and lands there)

    Objective: one shape for what a conversation is about, shared by
    the hub, the robot and Go. Files: a new
    `spec/schemas/subject-ref.schema.json` (a discriminated union: a
    household reference with an `entity_id`; a world reference with
    kind, display name, optional year, the typed source and its stable
    key when one answered, and `recency: current | dated | unknown`; an
    unresolved reference with the surface form, candidate kinds,
    provenance and confidence), fixtures, both generated bindings,
    `spec/README.md`. Acceptance: the round-trip fixtures for all three
    variants; the validator refuses a world reference carrying an
    `entity_id`. Out of scope: any hub code (CHAT-13). Exit: the spec
    suite, `bash scripts/check.sh`.

<a id="engine-host-02"></a>


<a id="mem-06"></a>

- [x] **MEM-06: The judge grounds every fact in the speaker's words** (S-M)

    Done 2026-09-15 in five chunks (7bdb484 through 253ef69 on main):
    a fact shares half its content words and every proper noun and
    number with the speaker's words or a confirmed assistant line, or
    is `ungrounded`; a state with a conversational verb is `passing`; a
    fact about the turn's world subject is `world` unless it is the
    speaker's own preference or plan; every kept fact cites one
    eligible clause of the frozen signal, grounded in it, its subject
    matching (`ineligible_act`, `unknown_grounding`,
    `subject_mismatch`); a quoted, hypothetical or joking clause writes
    nothing and says why; a reported clause writes about the third
    party at most 0.4 with the source named, a commissive a goal, a
    project or a dated event, a moderate or high emotion a bounded
    state. Eight judge-eval rows; the step-3a subject tests now have
    the speaker say the names (a name the model invents is never
    written). A sentence-initial capital is not a proper noun. The
    original note follows.

    Objective: no reply text, lookup result, passing state or model
    inference becomes a memory. Files: `backend/src/lib/memoryJudge.ts`
    (a deterministic validator after `rejectPromptEchoes`, three
    rejections counted on its log line), `backend/src/lib/guards.ts`
    (the conversational-progressive list exported, one definition),
    `backend/scripts/bench/judge-eval.ts` and its fixture,
    `backend/tests/memoryJudge.test.ts`. Mirror: the echo filter's
    anchor reading of the turn. Do: a fact shares half its content words
    and every proper noun and number with the speaker's words (or a
    confirmed assistant line) or is `ungrounded`; a `state` with a
    conversational verb is `passing`; a fact whose subject is the turn's
    world subject (a succeeded lookup or typed-source outcome's title,
    read from the retained outcomes; CHAT-13's world `SubjectRef` once
    it exists) is `world` unless it is the speaker's own preference or
    plan; an inferred kind or relationship is ASK-01's candidate, never
    a record; once ACT-01 exists, the clause contract (dev.md section
    12, part 6): every proposed fact cites one eligible clause (an
    `inform` or `commissive` with stance `asserted` or `reported`),
    every proper noun and number in it is grounded in that clause, the
    fact's subject matches the clause's subject, a `reported` clause
    yields a record about the third party only, capped at importance
    0.4 with the source named, a `commissive` clause yields only a
    `goal`, `project` or dated `event`, a `moderate` emotion about the
    speaker or a named subject yields a `state` at importance 0.3 with
    `valid_to` 24 hours out and a `high` one at 0.5 with seven days,
    an explicit time always winning, `none` or `low` yielding nothing,
    and one utterance may split into an event and a state; the
    rejections `ineligible_act`, `quoted`, `hypothetical`, `joking`,
    `unknown_grounding`, `subject_mismatch`, `invalid_emotion_category`,
    `missing_valid_to` and `child_about_adult` (a child-band speaker's
    clause whose subject is an adult writes nothing about the adult and
    at most a `state` about the child, `sensitive`, person scope; a
    child's turn never writes an `adults`-audience record; dev.md
    section 13, part 5) counted beside the rest; two channels, the
    proposition channel (asserted or reported inform and commissive
    clauses only) and the emotional-state channel (a moderate or high
    expressed emotion writes a bounded state about the identified
    speaker from an inform, a question or a commissive, citing the
    emotional clause and never the proposition inside a question), with
    the rejections `question_proposition`, `emotion_subject_mismatch`,
    `minor_state_about_other` and `disclosure_escalation` (the judge
    never raises a record's disclosure; section 13, part 9). **Deferred
    2026-09-14 (the coherence review): the section 14 half that follows
    waits as CRED-01; its fields ride in SPEC-01 with no writer, and the
    judge's "nominate routine, major, same or contradiction" field is
    deleted, the vocabulary and the dedupe pass deciding instead. The judge's
    bounds, from the outside review: at most four eligible clauses per
    turn and one candidate fact per clause reach the extraction, the
    output is capped at 192 tokens, and a structurally invalid answer is
    rejected with its diagnostics kept, never retried.**
    **Amended 2026-09-14 (dev.md section 14):** `confidence` (required on
    `record_kind: memory`, existing records migrated to 1.0 with a
    `legacy_assertion` evidence entry), `confidence_evidence` (source
    id, source person, kind, observed_at; merged on sync as a set union
    by source and kind, then recomputed) and `conflicts_with` on the
    memory record (spec first), and one engine-owned
    `computeFactConfidence()` the judge, the remember package, a
    correction, the curator, recall and the robot all call: 0.95 for a
    routine self-report, 0.50 for a life-events class, a contradiction
    of an active certain record or an unknown subject, +0.15 once for a
    grounded detail, +0.20 for a re-assertion on another calendar day,
    +0.30 for an independent corroboration at the same authorized
    scope, -0.30 for an unresolved contradiction, clamped to 0.10 and
    1.00; the judge model may nominate routine, major, same or
    contradiction and never returns the number; a reported record
    keeps its cap; rejection codes `invalid_confidence_source`,
    `private_corroboration`, `confidence_without_evidence` and
    `stance_not_asserted`. Acceptance: one judge-eval turn per class with roster names, plus "Quill was here"
    persisting no kind and no relation, at 100 percent precision on
    those rows; the `act-memory` conversation (section 12, part 6),
    three seeded runs, effects on the memory table; the seeded bench's memory rows
    unchanged; the drop counts in the run header. Out of scope: the
    prompt's wording. Exit: `bun test tests/memoryJudge.test.ts`, the
    judge-eval bench, `bash scripts/check.sh`.

<a id="spec-02"></a>


<a id="chat-parity-01"></a>

- [x] **CHAT-PARITY-01: model picker and current-model caption** (S, after STATS-01)

    Objective: let a parent see and choose the available healthy chat model
    without opening owner diagnostics. Files: `frontend/src/apps/chat/`, the
    AI settings registry, and the engine model-list route. Pattern: mirror
    `useEngineHealth`, `SensesDock`, and the role cards in SETTINGS.md.
    Acceptance: the picker shows only reachable models, the current choice
    persists for the person or household scope, an unavailable choice has one
    repair action, and a child sees only the calm default label. Out of scope:
    model downloads and GPU tuning. Exit: backend and frontend tests,
    responsive screenshots, `bash scripts/check.sh`. Landed date unrecorded (no commit names this ID; ticked before 2026-09-21).


<a id="chat-parity-02"></a>

- [x] **CHAT-PARITY-02: temporary chat retention** (S, after CHAT-PARITY-01)

    Objective: provide an explicit per-conversation temporary mode that does
    not enter normal history or memory. Files: conversation schema and
    migration, `conversationHistory.ts`, conversation routes, `ChatPage.tsx`,
    and `docs/user/privacy.md`. Pattern: mirror COMP-02's additive
    conversation mode and the existing retention setting. Acceptance: the
    mode is visible before the first send, its banner names the retention
    behavior, temporary turns cannot create durable memory, reload does not
    restore them into normal history, and child UI exposes no retention
    internals. Out of scope: remote provider retention promises. Exit: spec,
    backend, frontend, and privacy tests, `bash scripts/check.sh`. Landed date unrecorded (no commit names this ID; ticked before 2026-09-21).


<a id="chat-parity-04"></a>

- [x] **CHAT-PARITY-04: continue a cut-off answer** (M, after CHAT-PARITY-01)

    Objective: continue a stopped or truncated assistant answer from its last
    stable message without pretending the missing text was generated. Files:
    `backend/src/lib/turnEngine.ts`, `backend/src/wire.ts`,
    `frontend/src/apps/chat/chatModelAdapter.ts`, `thread.aui.tsx`, and
    branch tests. Pattern: mirror `chatEditSupersedes.ts`, the existing
    assistant-ui message metadata, and the two-call composer budget. Acceptance:
    the action appears only on an incomplete assistant turn, sends a new
    branch with an explicit continuation instruction, keeps the original
    immutable, stops cleanly, and never sends a third model call. Out of scope:
    reconstructing a crashed remote provider response. Exit: stream, branch,
    guard, and frontend tests, `bash scripts/check.sh`.
    Superseded 2026-10-02 by chat rule 9; the code goes in the stage named in the thin-path record (stage 5).


<a id="chat-parity-10"></a>

- [x] **CHAT-PARITY-10: assistant-layer projects merged into CHAT-PROJECT-01** (the project folder for a person’s chats; distinct from PROJECTS-UI-01 assistant-layer projects).

    Objective: turn engine errors into one owner-readable diagnosis and next
    action. Files: `useEngineHealth.ts`, health and status routes, the
    platform Repairs page, and `docs/user/fix-a-problem.md`. Pattern: mirror
    SensesDock states, settings help text, and the existing repair route.
    Acceptance: a failed turn identifies whether the engine is starting,
    unreachable, or unhealthy without exposing secrets; the parent gets a
    short retry line; the owner gets logs and a restart action behind Expert;
    a child gets neither diagnostics nor provider names. Out of scope: silent
    restarts and automatic model changes. Exit: route, redaction, UI, and
    screenshot tests, `bash scripts/check.sh`.


<a id="comp-02"></a>

- [x] **COMP-02: Research mode** (S, after COMP-01, landed 2026-09-16)

    Objective: a conversation that keeps the pane open and streams the
    document after the line. Design: `docs/dev.md` "COMP-02: research
    mode". Files: `spec/schemas/conversation.schema.json`
    (`mode: chat | research`, additive, fixtures), the conversations table
    and migration, `backend/src/lib/conversationHistory.ts`,
    `routes/conversations.ts`, `backend/src/lib/turnEngine.ts`,
    `frontend/src/apps/chat/ChatPage.tsx` and `chatModelAdapter.ts` (a
    header toggle and automatic document handoff). Acceptance: in research
    mode the line is under the short budget and the document streams after
    it; the bubble never carries an article (the `search_voice` family and
    `maxWords` hold); child delivery keeps the existing projection; screenshots.
    Exit: the suites, `bash scripts/check.sh`.

<a id="page-01"></a>


<a id="page-01"></a>

- [x] **PAGE-01: Read a page the person asked about** (M, after COMP-01)

    Objective: let one adult page ask read the returned page and use its
    bounded article text and links. Design: `docs/dev.md#page-01-reading-a-
    page-the-person-asked-about`. Files: the SearXNG host integration,
    websearch recipe and manifest, `backend/src/lib/turnEngine.ts`,
    `backend/src/lib/turnContext.ts`, `backend/src/lib/composer.ts`, the
    conversation bench fixture, privacy docs, and parser dependencies.
    Acceptance: one page fetch uses the same limiter and user agent, checks
    robots and public redirects, stops on the first 403 or 429, and never
    prefetches linked pages; a scripted page exposes three links and bounded
    readable text; `download-link-on-page` selects the matching download
    href; `value-on-page` grounds a value in the page; a missing field says
    the page does not have that; and `who-is-builds-a-card-from-the-page`
    keeps the adult article detail in the document with the child ceiling.
    The package declares the page data source. Exit: targeted tests and
    `bash scripts/check.sh`. Landed date unrecorded (no commit names this ID; ticked before 2026-09-21).

<a id="stats-01"></a>


<a id="stats-01"></a>

- [x] **STATS-01: The advanced view of a reply** (M, after COMP-01)

    Objective: give an adult an optional, per-person readout of engine
    work under a reply, with no child disclosure and no engine-host
    privacy leak. Design: `docs/dev.md#stats-01-the-advanced-view`.
    Files: `spec/llm/ts/types.ts` and its tests for the final stream
    `usage` and `timings` payload, `backend/src/wire.ts`,
    `backend/src/lib/llm.ts`, `backend/src/lib/turnEngine.ts`,
    `backend/src/lib/conversationHistory.ts`, the migration and generated
    settings registry for person-scoped `ui.show_turn_stats`,
    `frontend/src/apps/chat/` and the assistant-ui message, plus the
    screenshot pipeline. The additive `TurnStats` object is nullable and
    contains prompt and predicted tokens, speed, first-token and total
    latency, prompt/context counts, cache reuse, sanitized engine label,
    and stop reason. `context_used_percent` stays null without a verified
    engine context capacity.
    Acceptance: a scripted final chunk fills the numbers; a missing
    timing chunk yields nulls, never `NaN`; the same stats reach the
    `done` value, persisted row, and `[turn]` line; adults see a compact
    caption and full kit popover only after opting in; the preference
    persists per person and is off by default; child band renders no
    toggle, caption, or stats; one opened desktop screenshot is judged.
    Out of scope: changing routing, safety, budgets, context sizing, or
    engine launch flags. Exit: targeted backend/frontend tests, screenshot
    review, and `bash scripts/check.sh`.

<a id="comp-03"></a>


<a id="act-01"></a>

- [x] **ACT-01: The turn signal, the spec, the producer's first layers, and the rows** (S-M, before REG-01)

    Done 2026-09-14 (docs/dev/session-a.md "ACT-01"; the spec half is
    SPEC-01's, 29ac71f and 7705ed5): `lib/turnSignal.ts` with the
    protocol and rule layers and the fallback; `readClauses()` in
    `utteranceShape.ts` as the one clause split with ranges;
    `TurnContext.signal` in place of `shape`, the router's and the
    guards' shape a projection (`shapeOf()`); the signal frozen before
    routing on every path, a literal-pattern win freezing a directive
    (a question stays a question); the `signal` column (migration 0034,
    schema version 33) written by `logTurn()` with `judge_status`
    `skipped` at insert when no clause is eligible; the judge's queue
    keyed on the signal; per-stage timings (`signal_us`, routing,
    recall, prompt, first token, finalize, retries, CHAT-13's
    `subjects` slot) on the `[turn]` line and the bench's stage
    summary; an act expectation on every fixture turn and seven new
    conversations (the act-register rows, the act-memory rows whose
    clause-contract checks wait on MEM-06, the curator rows on
    CUR-01); `scripts/bench/turn-signal.ts` with the DailyDialog
    reference and the baseline recorded. The seeded set is recorded
    in the notes.

    Objective: the engine records, before routing and frozen for the
    turn, what kind of turn the person made and what it expressed, on
    the shared turn record, one definition for every consumer. Spec
    first: `spec/schemas/turn-signal.schema.json` (`primary_act`,
    `secondary_acts`, `expressed_emotion`, `emotion_intensity`,
    `target`, `repair`, `refers_to_prior`, `clauses` with range, act,
    stance, subject, emotion, intensity, confidence; `act_confidence`,
    `emotion_confidence`, `source`, `classifier_id`), a
    `conversation-turn.schema.json` that settles the shared turn record
    the robot syncs through the hub and carries the signal beside the
    outcomes, `reply-plan.schema.json` (the moves as required, allowed,
    forbidden; playfulness; `max_sentences`; `max_words`),
    `model-capabilities.schema.json` (a `turn-signal` role and a `head`
    engine kind), fixtures, both bindings. Then:
    `backend/src/lib/turnSignal.ts` (`classifyTurnSignal()` with the
    protocol layer first, reading the pending ask, then the
    high-precision rules: greeting and closing from the near-echo
    guard's vocabulary plus thanks and goodbyes, backchannel as a
    one-to-three-word turn with no content word, question and directive
    from `utteranceShape()`, `repair` from the negation and correction
    phrases the consent and cancel vocabularies list, intensity from
    surface cues, target from the pronoun and the roster, the clause
    split from `utteranceShape()`'s own split with the unmistakable
    stance markers, emotion only on an unmistakable cue; the
    conservative fallback), `backend/src/lib/turnContext.ts`
    (`TurnContext.signal` replaces `shape`; `UtteranceShape` becomes a
    projection inside routing during migration), `backend/src/lib/
    turnEngine.ts` (the protocol and rule layers before routing; a
    literal-pattern win freezes a directive; the signal written to the
    turn row by `logTurn`), `backend/src/lib/memoryJudge.ts` (the queue
    keyed on an eligible clause in the stored signal instead of the
    reply's source; a turn with none marked `skipped` before it is
    queued), `backend/scripts/bench/conversationFixture.ts` (`act`,
    `emotion` and `stance` expectations on every turn; the `memoryRows`
    expectation; the `act-register`, `act-memory` and
    `act-memory-curator` conversations of dev.md section 12) and
    `conversationScore.ts`, `backend/scripts/bench/turn-signal.ts` (the
    DailyDialog distribution and scoring adapter, research use only,
    with the label definitions pinned in the dataset registry),
    `backend/tests/turnSignal.test.ts`. Mirror: `utteranceShape.ts`,
    `intentFor()`, `resolvePendingAsk()`. Acceptance: every fixture
    turn's recorded signal matches its expectation at 95 percent or
    better on acts across three seeded runs; the rule pass and the
    current lexical shape scored on DailyDialog's test split with the
    relabel, macro F1 per act and the baseline recorded in the dev
    docs; a disclosure beside a package answer reaches the judge; a
    closing turn is skipped; no consumer reads a second shape; `refers_to_prior` stays null until
    CHAT-13; the fixture gains the `signal`, `memoryRows` and `subjects`
    expectations of the coherence review's question 5 (the runner reads
    them from the turn row and the memory table, never the log line);
    the `[turn]` line and the bench header carry per-stage timings
    (routing, recall, prompt assembly, first token, finalization,
    retries) so a first-text budget is a measured row.
    Out of
    scope: the heads (ACT-02), the plan and the composer (ACT-03), the
    clause contract and the curator rules (MEM-06, CUR-01). Exit: the
    spec suite, `bun test tests/turnSignal.test.ts
    tests/utteranceShape.test.ts tests/memoryJudge.test.ts`, `bash
    scripts/check.sh`.
    Superseded 2026-10-02 by chat rule 5; the code goes in the stage named in the thin-path record (stage 1).

<a id="act-02"></a>

