# The chat engine's records: per-model sampling, vetting, the Stack catalog, grounding and the shadow signals (2026-10-17)

This note decides how a chat model's own settings reach the engine (sampling from its record, never a global set), what a
model must prove before a household runs it (vetting), where the one model record lives (the Stack catalog), what the
generation record carries, how the search prefix and fetched text are grounded, and which learned signals may exist and
in what mode (shadow). It covers THIN-2B, MODEL-RECORD-1.7B-01, THIN-6A, MODEL-VET-01, STACK-CATALOG-01, ENGINE-CANARY-01,
STACK-LIGHT-PROFILE-01, GROUND-A-01, SEARCH-DDGS-01c, OWUI-ADOPT-06, TOOL-RESULT-TRUST-01, REVIEW-01, ACT-02, EVAL-05,
IMG-PIPE-INTENT-01, IMG-VISION-SHADOW-01, IMG-VISION-VETO-01 and IMG-REVERSE-01. It is governed by the "Chat turn" area of
[RULES.md](RULES.md) (rules 0 to 14) and its record, [the thin chat path](../plans/chat-thin-path-2026-10-02.md). Design note
only; no code, no spec tag, no setting changed.

## 1. What exists today (from code, 2026-10-17)

| Piece | Where | State |
|---|---|---|
| One global sampling set on every chat request | `backend/src/lib/llm.ts:372` `CHAT_SAMPLING` (temperature 0.7, min_p 0.05, XTC 0.5/0.1, DRY 0.8/1.75/2), applied by `chatSamplingFor()` unless the caller passed `temperature` or `response_format` | Live. Its only evidence is the FAST-06 tool-calling bench at 10 repeats; no reply-quality or repetition measurement (rule 3 names both) |
| Per-model sampling with its source | Stack `backend/src/lib/modelCatalog.ts`: Muse 30B (temperature 1.0, top_p 0.95, top_k 64, "model card, recommended sampling"), Qwen3-VL-4B and VL-8B (0.7, 0.8, 20, presence_penalty 1.5, "model card"); `supervisor.ts:1435` `withPinSampling()` fills `temperature`, `top_p`, `top_k`, `presence_penalty` only where the request left them undefined | Built and defeated: Home always sends `temperature: 0.7`, so Muse never runs at its card's 1.0, and Home's XTC and DRY ride every model unmeasured. The Qwen3-1.7B and 8B pins carry no sampling |
| The spec model record | `@maipai/spec` 0.1.153 `schemas/model-capabilities.schema.json`: `turn_budget` requires `rounds`, `always_search`, `model_transitions`; `tools_offered` deprecated; `max_tools`, `background_turns` optional; no `sampling` field (`llm/README.md:46` still names it "a named gap") | Spec change needed before THIN-6A and THIN-2B |
| Home's catalog | `backend/src/lib/modelCatalog.ts`: four chat records mirroring the Stack's pins plus `fitsWithin()`, `kvCacheBytes()`, `weightsBytes()`, `recommend()`; `budget.ts` `resolveTurnBudget()` | A second copy of the pin (url, sha256, bytes) kept by hand; `rounds` and `model_transitions` still read in `machine.ts:149,219,274` |
| Generation record | `backend/src/lib/turnStats.ts` `projectGeneration()`: reason, thinking, max_tokens, prompt_n, cache_n, timings, `tool_call_raw_args`, `envelope_parsed`, error facts | Carries no round index, no offered tool ids, no `tool_choice`, no sampling source |
| Vetting | Stack `readiness.ts:182` `roleCheck()` (state not checked, passed, failed, skipped; at; reason; stale) served on `GET /stack/v1/roles`; the picture check before `imageInput`; Home's `enginePostLoadCheck.ts` | One check per role, not a suite; nothing proves the template delivers a late fact or the clock (the Qwen3-VL bug of 2026-10-07) |
| Stack catalog route | `GET /stack/v1/models/catalog` (Stack `routes/models.ts:38`), Home client `stack/client.ts:399` `modelCatalog` | Exists; Home does not read it for chat |
| Search decision signal | `backend/src/lib/searchAssist/` (LR head over nomic, weights spec `search-assist-weights.schema.json`), `chat.search_assist` off, shadow (default), rescue; `stats.search_assist` records `p_rounded` and an action | Shadow; rescue stays off ([ROUTER-BUILD-02](../plans/router-build-02-2026-10-12.md) section 11: no arm passed M1) |
| ddgs quiet window | `backend/src/lib/retrieval/ddgsSource.ts:30-52`: `QUIET_WINDOWS_MS` 1 h, 3 h, 12 h, 24 h, `quietUntil` and `blockCount` module variables | Lost on every hub restart, so a block is re-probed at once |
| Page reading | `backend/packages/websearch/manifest.json:54` `read_page` ("Leave this out. Home reads the top result pages itself") | No separate link reader; no `read_link` tool in `backend/packages/` |
| Turn signal heads | `turn-signal.schema.json`, engine kind `head`, role `turn-signal` in the spec | Spec only; ACT-02 not built |
| Pictures in answers | `show_images` package, adults only (IMG-OFFER-01), `relevance.ts` vetoes, YuNet person presence | Live; no category or similarity model |
| Benches | `backend/scripts/bench/chat-ab-01.ts` (arms A, A2, AP, AT, APT, APM, B, C, S; rows k1 to k6, r1 to r4, f1 to f4, w1 to w4, q1 to q4, mt1, mt2, sp1 to sp6, fresh-ts), `tool-calling.ts` (spec corpus plus the budget-offered pass), `search-recency-02.ts`, `fixtureSearch.ts`, `read-page-01.ts`, `vision-02e.ts` | All exist; no new harness is proposed |

## 2. Purpose and audience

The job: every chat model runs on its own proven settings, from one record the Stack owns, and nothing learned changes a
turn until it is measured in shadow.

| Viewer | Sees | Does not see |
|---|---|---|
| Owner or admin | Engines page: each role's checks (passed, failed with "did not pass check N: what to do"), the bound model and its sampling source; Settings, Search: the resting line for DuckDuckGo; privacy page rows for every download and optional provider; the weekly review report in counts | Any person's text, titles, URLs or ids (rule 6a) |
| Adult member | Nothing of this directly: replies at the model's own sampling; sources on a read link; pictures in answers (already adult-only); the local "find my pictures like this one" when built | Shadow scores, review records of others, admin pages |
| Teen | The same turn path; a link reader only when web search is on for their controls, with their page cleaning and the adult-site host list; no pictures in answers; no model choice or thinking | Shadow scores (minors are never scored by the search head, `MINOR_RESCUE_ENABLED` off); reverse image lookup |
| Child | As a teen, with the child floor per sentence; a model with no measured record keeps the no-tools fail-safe (rule 8) | Everything above |
| Guest | Chat on the household's model; no ddgs, no link reader, no pictures | All settings |
| Robot, pod, TV | Spoken turns unchanged (rule 0): the rescue, the heads and the link reader never run on a spoken turn | Nothing new on the wire; additions only |

Rule 0 holds throughout: nothing here loosens a child or teen protection or changes how a spoken turn is shaped.

## 3. Flow

This is backend and Stack work; three surfaces change.

- **Engines page** (`frontend/src/shell/pages/EnginesPage.tsx`, kit `DataTable`, `Card`, `Button`): the role row gains a
  Checks column. States: "Checking (about 40 s)" while the suite runs; "Passed 7 of 7"; "Did not pass check 3 (tool calls). Home
  kept the last good model. Reinstall the model, or pick another one." as the kit destructive `Alert`; "Not checked yet" for a
  model installed but never launched. Offline: the page shows the last stored result with its date. Incognito: unchanged (an
  admin page).
- **Settings, Search, Web search** status line (exists today): while the ddgs window is open it reads "DuckDuckGo is resting
  until 2:10 pm after it refused a search; SearXNG answers meanwhile" (admin only; a member sees the sources line as today).
- **Chat**: a read link shows the kit's own tool disclosure and `SourcesCard` as any search does; a refused or failed read is the
  model's own words per rule 6. Nothing else is visible: sampling, vetting, the shadow heads and the review pass have no chat
  UI.

## 4. Records and settings (spec first)

All additive, `commons/spec` first, then Stack, then Home, then robot. Every stored record carries an id, provenance and a clock
stamp (principle 3).

| Name | Type | Default | Scope | Meaning |
|---|---|---|---|---|
| `ModelCapabilities.sampling` (new) | object `{temperature?, top_p?, top_k?, min_p?, presence_penalty?, repeat_penalty?, source}` | absent (the engine's defaults) | model record (Stack catalog) | The values the model's publisher recommends; `source` names the card and section. The Stack fills them into a request only where the request says nothing (`withPinSampling`, extended to `min_p` and `repeat_penalty`); Home sends no sampling field on a chat turn |
| `ModelCapabilities.turn_budget.rounds`, `.model_transitions`, `.always_search` | made optional and `deprecated: true` | ignored | model record | Retired by THIN-2B: the machine runs one offered round plus one retry (THIN-2G) on every model; a model may transition when `max_tools > 0`; the minor fail-safe keeps `max_tools: 0`. Removed in a later tag with a changelog note |
| `ModelCapabilities.vetting` (new) | object `{file_sha256, template_sha256, engine_build, at, hardware, checks: [{id 1 to 7, state passed/failed/skipped, ms, reason?}]}` | absent (not vetted) | model record, written by the Stack per launch | MODEL-VET-01's result, keyed by file hash and template hash so a re-download or a template change re-vets. `reason` is the plain-words line, never model output |
| `ModelCapabilities.image_embedding` (new) | `{projector?: component, dims}` | absent | model record | A SigLIP-class pinned model the Stack may run (IMG-VISION-SHADOW-01, IMG-REVERSE-01 A); its download appears on the privacy page |
| `spec/llm/check-layout.json` (new) | the exact message layout Home sends (stable prefix slot, window, context message, utterance) with two placeholders (a fact, a date) | fixed | spec | Check 1 of vetting renders it through the engine's real template; the Stack reads the file, never Home's code |
| Generation record (`turn-stream-event` / `TurnGeneration`) | `round` (0 or 1), `retry` (bool), `tools_offered` (package ids), `tool_choice` (`auto`, `none`), `sampling_source` (string, the record's `source` or `engine_defaults`) | absent on old rows | per generation on the turn's `stats` | What this generation was given, so a bench reads the fact off the record instead of the catalog. Package ids only: never an argument, title or URL (rule 6a) |
| `search-quiet-state.schema.json` (new) | `{id: "ddgs", quiet_until (date-time or null), block_count (int), updated_at, provenance: "hub"}` | none | household (one row) | SEARCH-DDGS-01c: the quiet window survives a restart; expired on read; not carried by a backup |
| `stack.profile` (new Stack setting) | `standard`, `light` | `standard` | household | STACK-LIGHT-PROFILE-01: `light` binds chat, judge, router and coding to Qwen3-4B (and Qwen3-VL-4B once pinned and checksummed) and admits the largest context the governor measures the machine can hold on the light binding (rule 4), never a smaller one; never touches a safety floor |
| `stack.canary.enabled` (new Stack setting) | boolean | `false` | household | ENGINE-CANARY-01 is a development job; off on every install, and the job refuses to run beside a time-measuring bench |
| `chat.read_link` (new) | `on`, `off` | `on` | household, admin | OWUI-ADOPT-06: whether the link reader is offered on a URL turn; a kid's or teen's offer still follows their web switch |
| `turn-review.schema.json` (new) | defect code, evidence ids, responsible layer, retrieved items that helped, proposed bounded adjustment, evaluation, status, provenance | none | per turn, the person's own data | REVIEW-01, as the row states; plus `MemoryRecord.retrieval_signal` |
| `turn-signal.schema.json` | gains `heads: {act, emotion, stance, source: model/fallback}` with calibrated class and `unknown` | absent | per turn | ACT-02 outputs; numbers and enum values only |
| `show_images` tool schema | optional `intent` enum `general, portrait, album_cover, product, poster` | absent | tool argument | IMG-PIPE-INTENT-01, only if IMG-PIPE-BENCH-01 trips its trigger |
| `search.image_lookup_provider` (new, only if Jesse says yes) | `off`, `tineye` | `off` | household, owner; adults only | IMG-REVERSE-01 B: an owner-keyed provider, write-only secret, consent card per picture, EXIF stripped |

What is deleted: Home's `CATALOG` array in `modelCatalog.ts` and its sizing math (`fitsWithin`, `kvCacheBytes`, `weightsBytes`,
`recommend`); the Stack's fit plan (`stack-fit-plan.schema.json`) already answers what fits. Home keeps a one-table cache of
the last catalog read (`model_catalog_cache`: the record JSON, `fetched_at`, provenance `stack`) so `thinkingModeFor()`,
the wizard's pros and cons and `resolveTurnBudget()` work before the Stack answers; until the first read every band gets
`NO_RECORD_BUDGET`. Home's measured turn fields (`max_tools`, thinking budgets, deadlines, `reply_ceiling_tokens`, `measured`)
move onto the Stack's record as data the Stack stores and never reads; Home's bench writes them through a commit to the Stack
catalog, one definition in one place (principle 4).

## 5. Privacy and offline

Nothing leaves the home by default. The outbound connections this note touches, each named with its switch:

| Connection | What it sends | Switch | Privacy page row |
|---|---|---|---|
| Model, projector, draft and head downloads (Hugging Face, pinned url, sha256, bytes) | A request for a pinned file | The install itself; nothing at run time | Exists; the SigLIP-class model and the ACT-02 head artifact add rows in the same commit |
| ddgs sidecar to DuckDuckGo | An adult's search words (owner's ruling 2026-10-17); a minor's only under `search.ddgs_for_minors` | `search.web_sources`, the minors setting | Exists |
| The link reader (OWUI-ADOPT-06) | One page request to the URL the person typed, from the home's address, nothing else | `chat.read_link`; the band's web switch | New row: "When you paste a link, Home may fetch that one page" |
| Engine canary (ENGINE-CANARY-01) | A release listing and one pinned engine build to a scratch directory | `stack.canary.enabled`, off; developer only | No household row (never on) |
| Reverse image provider (IMG-REVERSE-01 B) | The picture itself, EXIF stripped, after an adult taps the consent card | `search.image_lookup_provider`, off; Jesse's decision first | New row, only if built |

Offline: the Stack vets from local files; the quiet-window row and the catalog cache are local; a URL turn with no network
gets the model's own words that the page could not be read (rule 6). An admin sees check states, counts, timings and error
codes; never a person's utterance, a URL fetched, a review record's text or a stable person id beside an activity (rule 6a). A
backup carries the catalog cache and review records (the person's data); it does not carry the quiet window or vetting
results (the Stack re-vets after a restore).

## 6. Kit Elements and parts

Chat: the kit's tool disclosure and `SourcesCard` Elements for a read link, as websearch uses them; no new chat component. Non-chat:
`DataTable` (the Engines page already uses it), `Badge` for a check state, the destructive `Alert` for a failed check (the shape
setup already uses), `Collapsible` for check details, `AlertDialog` for the reverse-image consent card if it is ever built. No
`className` that changes shape, no wrapper (rule 9, 9b). A check-state cell variant the `Badge` lacks is an additive variant in
`commons` first.

**Reuse check.** Looked at first and used: the Stack's `withPinSampling()` and `roleCheck()`; llama-server's `/apply-template` and
`/v1/chat/completions` for check 1 and the template-proof checks; `chat-ab-01.ts`, `tool-calling.ts`, `search-recency-02.ts`,
`fixtureSearch.ts`, `read-page-01.ts` and `vision-02e.ts` as the benches; the XState machine's existing round and retry guards;
the spec `health-item` for a failed-check repair; the Stack's fit plan for sizing; `wakewordAssets.ts`'s pinned-download pattern for
the heads; the model cards for sampling values. Hand-built, with the reason: the vetting runner in the Stack (lm-eval-harness
and promptfoo score free text and ship their own runners and prompts; the checks need exact answers through our own message
layout on the live engine); the quiet-state row (no shipped state record has the shape); the deterministic review checks
(they read our own turn record). Rejected: a second runner for vetting (rule 11), any hosted model for labels or review.

## 7. Rule check

1. **Rule 0**: no gate loosens. The link reader for a kid or teen fetches through their page cleaning, their safesearch and the
   adult-site host list, only when web search is on for their controls; never on a spoken turn. No conflict.
2. **Rule 1**: the model decides. A URL is a parsed token, not wording; the offer is the conditional set the rule names ("a link
   reader"), with its own bench row and at most 16 tools, and the base set's search decision with the link reader offered is
   measured on the fresh held-out split per rule 13 (slice 11). The search head stays in shadow; the heads of ACT-02 decide no search.
   The GROUND-A-01 prefix sentences are prose the model reads, not a rule that reads the person. EVAL-05 ships reviewed text, never
   a runtime optimiser. No conflict.
3. **Rule 2**: sampling, templates and token counts are the engine's; Home stops re-deciding sampling. No conflict.
4. **Rule 3**: sampling from the model's record with the source named; `CHAT_SAMPLING` goes; no global override remains. The
   move itself is measured (section 8) because the record's values differ from today's on every model: reply quality,
   repetition, and for every model that offers tools the fresh-set tool decision rule 3 names (at least 3 repeats, held-out
   split, paired 95 percent intervals per rule 13). No conflict.
5. **Rule 4**: the window is the real context; GROUND-A-01's evidence cap is derived from it, never a constant. No conflict.
6. **Rule 6**: a failed read link, a vetting refusal or a resting ddgs never fails the answer; the model says so in its own words.
   Abstention under GROUND-A-01 is an instruction to say it does not know, not a stored line. No conflict.
7. **Rule 6a**: generation records carry package ids and numbers; review records are the person's own; the weekly report is
   counts. No conflict.
8. **Rule 7**: pages, not snippets, with numbered sources; the link reader is one more page under the same budget and host pace.
   The reverse-image provider, if built, follows the hosted-provider clause (optional key, off, write-only secret, never a minor,
   privacy row). No conflict.
9. **Rule 8**: nothing gated on an id. Vetting keys on file hash, template hash and engine build; `thinking_mode`, `image_input`
   and `sampling` are record fields; the light profile is a binding, not a feature gate; a 4B with no measured record keeps the
   minors fail-safe. No conflict.
10. **Rule 9, 9b**: kit parts only; the one hand-written piece is the Stack's check runner, not UI. No conflict.
11. **Rule 10**: the output gate is untouched by every item; IMG-VISION-VETO-01 and the review pass never touch it. No conflict.
12. **Rule 11**: the Stack owns the engines and the SigLIP-class model; the canary tests the Stack's own pins. No conflict.
13. **Rule 12**: the port list is unchanged; THIN-2B deletes fields only after every reader is re-pointed. No conflict.
14. **Rule 13**: section 8 names a bench row per slice, 3 repeats, paired 95 percent intervals, at `ease.reading_level = standard`.
    The 2026-09-23 bisect (`docs/dev.md`, stage 1: a prefix sentence alone collapsed 736 tokens to 111) is why every prefix change
    here (GROUND-A-01, TOOL-RESULT-TRUST-01) carries the k and w rows beside its own row. No conflict.
15. **Rule 14**: a companion adapter never carries sampling; the repetition row on spoken companion turns is rule 3's own
    requirement and is kept. No conflict.

No NEEDS-RULE-CHANGE. ROUTER-FOLLOWUP-02 (a 9B decision pass) remains outside rule 1 and is not designed here.

## 8. Slices

Bench rows: `AB` is `chat-ab-01.ts` with the rows named, 3 repeats, arms A (bare) and B (Home) paired; `TC` is
`tool-calling.ts` (spec corpus plus the budget-offered pass, 58 runs per repeat); `SR` is `search-recency-02.ts` plain arm on
the fresh held-out split with the fixture search, 3 repeats, paired 95 percent intervals (the harness's defaults); `REP` is the repetition count on sp1 to sp6 and the companion-voice row.

| Order | Id | Size | Depends on | Exit check |
|---|---|---|---|---|
| 1 | THIN-6Aa: `sampling` and `vetting` on the spec record; `rounds`, `model_transitions`, `always_search` optional and deprecated; `check-layout.json` | S, commons | none | spec fixtures round-trip; a record without `sampling` validates; new tag; Home and Stack pin bump |
| 2 | THIN-6Ab: `CHAT_SAMPLING` deleted; Home sends no sampling field; the Stack fills from the pin (`min_p`, `repeat_penalty` added to `withPinSampling`); the 1.7B and 8B pins get their card values with `source`; `sampling_source` on the generation record | S | 1 | regression test seen failing first: a Home chat request body carries no sampling key; the Stack's filled body equals the pin |
| 3 | THIN-6Ac: the measurement | S, bench | 2 | per chat model whose sampling changes in slice 2 and that offers tools (8B and Qwen3-VL-8B on p16, the Qwen3-1.7B starter, which offers the 8B's ten tools until slice 6, Muse on the Studio): AB k1 to k6, w1 to w4 (length, first text, structure), REP, and the tool decision as `chat-ab-01.ts --group fresh` (evidence recall and false searches on the CHAT-AB-01 fresh set's held-out split with the recorded fixture search stand-in, 3 repeats, paired 95 percent intervals), with TC beside it as a regression check only; accepted when no row is worse beyond its interval; numbers in `docs/dev.md` with engine build, file and sanitized hardware |
| 4 | THIN-2B: `rounds` and `model_transitions` no longer read; `machine.ts` guards use the constants and `max_tools`; `round`, `retry`, `tools_offered`, `tool_choice` on the generation record | S | 1 | `grep` finds no reader; `toolRecovery.test.ts` and `modelGate.test.ts` still pass; a minor on an unmeasured model still gets no tools |
| 5 | STACK-CATALOG-01: Home reads `GET /stack/v1/models/catalog`; `CATALOG` and the sizing math deleted; the cache table; `turn_budget` data moves to the Stack catalog | M | 1, 4 | `modelCatalog.ts` holds no pin; `thinkingModeFor` and the wizard read the cache; a Stack that never answers leaves every band on `NO_RECORD_BUDGET`; AB q1 to q4 unchanged |
| 6 | MODEL-RECORD-1.7B-01: the starter's record with `max_tools`, `background_turns: false`, sampling | S, bench | 3, 5 | TC at 1 and 3 tools offered on the 1.7B as a regression check (ARCH-MEASURE-01 saw 0 fitting searches in 50, so the conservative value is `max_tools: 0`); `max_tools` above 0 only with `chat-ab-01.ts --group fresh` on the 1.7B (held-out split, recorded fixture search stand-in, 3 repeats, paired 95 percent intervals) beside AB k1 to k6, w1 to w4 and REP; a child on it keeps no tools |
| 7 | MODEL-VET-01a: the suite in the Stack (checks 1 to 5 required, 6 and 7 per role), stored per file, template and build; the role stays offline on a failure with the previous good model kept | M, Stack | 1 | a seeded template that drops a late system message fails check 1; cost under 60 s on the 8B at p16 recorded; no learned component |
| 8 | MODEL-VET-01b: the Engines page column and the repair health item | S | 7 | screenshot at 1440 and 390 opened and judged; copy in section 3 |
| 9 | GROUND-A-01 with CHAT-GROUND-BENCH-01: the prefix says it has search and its knowledge predates today (the clock at the top); history keeps the native tool call and sources; evidence cap from the real context; "say you do not know" instruction | M | 3 | SR recall and false searches paired against plain (the lever SEARCH-FRESH-01 lists first); AB k1 to k6 and w1 to w4 not shorter; the Bring Her Back shape as a regression row ([record](../plans/search-answer-quality-2026-10-13.md)) |
| 10 | TOOL-RESULT-TRUST-01: the boundary line in the stable prefix; a replay bench of roster-synthetic pages carrying instructions through `fixtureSearch.ts` | M, bench first | 9 | pass rate with intervals in `docs/dev.md`; AB k rows beside it; a learned detector only if the boundary alone fails, never the sole gate |
| 11 | OWUI-ADOPT-06: `read_link` as a model-callable package offered on a URL turn | S | 4 | TC row `read-link` (10 URL turns the model should read, 10 it should not, 3 repeats, paired 95 percent intervals against the ten-tool offer) as the conditional set's own bench row (rule 1); the base set's search decision unchanged with the 11th tool, measured as `chat-ab-01.ts --group fresh` (evidence recall and false searches on the CHAT-AB-01 fresh set's held-out split with the recorded fixture search stand-in, 3 repeats, paired 95 percent intervals, no row worse beyond its interval); `cached_tokens` on the next turn recorded; a child's read passes the page floor |
| 12 | SEARCH-DDGS-01c: the quiet-state row | S | spec tag | a restart inside the window makes no request (stub that fails on any fetch); an expired row is removed on read |
| 13 | STACK-LIGHT-PROFILE-01: `stack.profile` | S to M, Stack | 7, SMALL-MODEL-BENCH-01 | the governor sizes the light roles; a 4B's `max_tools` is its measured value; check 1 passes on the VL-4B template; AB k1 to k6, w1 to w4, REP and `chat-ab-01.ts --group fresh` (3 repeats, held-out split, paired 95 percent intervals) on the light chat binding before it offers tools |
| 14 | ENGINE-CANARY-01: the scheduled scratch job | M, Stack | 7 | a known-good newer build yields a proposed bump with evidence; a seeded contract failure refuses and names the test; the job touches nothing outside its directory; AB k1 to k6 single run as the regression check (not a rate) |
| 15 | ACT-02: the heads, shadow first | M | ACT-01 | agreement numbers on held-out DailyDialog and GoEmotions splits in `docs/dev.md`; two weeks of shadow counts before the plan line reads them; the `signal` wire event gains fields only |
| 16 | REVIEW-01a to 01d: spec; deterministic checks and the record; the nightly pass on a `background_turns: true` model only; after a month of reports, auto-apply only for record-level adjustments of a bounded type (never weights, prompts, engine rules or a guard), while any proposal that changes a person's setting or preference is filed as a notification with Accept and No thanks per [the memory lifecycle note](memory-lifecycle-and-preferences-2026-10-17.md) section 4 (silence is never consent; it expires in 14 days) | M, spec first | 4, 5 | a seeded week yields one review per planted turn; the stable prefix is byte-identical before and after; a guard proposal never changes a guard |
| 17 | EVAL-05: dev-only optimiser over roster-synthetic sets; a new lock box per round | M, dev tool | 9 | every shipped text change lands with AB (3 repeats) and SR on a fresh lock box; the optimiser never runs on a household turn or transcript |
| 18 | IMG-PIPE-INTENT-01 | M, deferred | IMG-PIPE-BENCH-01 trigger (2 or more wrong-intent tiles) | the conditional set stays under 16; `answer-images` bench rows with intent |
| 19 | IMG-VISION-SHADOW-01 | M, deferred | IMG-VISION-BENCH-01 thresholds; `image_embedding` capability | two numbers per adult tile, no text; `category_shadow` counter; never a teen or child; privacy row |
| 20 | IMG-VISION-VETO-01 | S, deferred | 19 run for two weekly reports; Jesse's word | drops only when all five thresholds hold on a fresh sample; `unknown` keeps the picture |
| 21 | IMG-REVERSE-01a: "find my pictures like this one" over the person's own photos | M, deferred | 19's capability | per person and band; a 768-dimension half-precision vector is 1.5 KB, so 10,000 photos index in 15 MB; nothing leaves the home; no face identity |
| 22 | IMG-REVERSE-01b: an owner-keyed web provider | S note only | Jesse's decision 2 | not built until he decides; a consent card per picture; EXIF stripped; adults only |

Slices 18 to 22 add no scope beyond their rows; they are listed so their gates sit beside the rest.

## 9. Legacy verdicts

- Per-model sampling in the old engine's autotune (`engineAutotune.ts`'s per-box constants): **redesigned** as the model card's values on the record, filled by the Stack.
- The old `engineGuards.ts` post-load check: **merged into MODEL-VET-01** as check 2's shape (an exact short answer after load).
- The legacy `hwfit.ts` and the fit math copied into `modelCatalog.ts`: **dropped**; the Stack's fit plan is the one calculation.
- The forced-search and lookup rules: **dropped** (rule 1); the shadow head and ACT-02 heads keep only the signal's four jobs.
- Nothing else borrowed from legacy.

## 10. Supersedes

- `backend/src/lib/llm.ts` FAST-06's comment and `CHAT_SAMPLING` as a standing set (already marked superseded in `docs/dev.md:13658`).
- ARCH-MEASURE-01's budget columns `rounds`, `model_transitions`, `always_search`, `query_writer` and `answer_from_context_tool`
  (`docs/dev.md`, 2026-09-22) as catalog inputs; `max_tools` and `measured` stand.
- THIN-6A's open question "which catalog holds the fields": the Stack's, served by `GET /stack/v1/models/catalog` (section 4).
- MODEL-RECORD-1.7B-01's `tools_offered` list: replaced by `max_tools` (TOOL-OFFER-01 already derives the offer from manifests).
- MODEL-VET-01's pointer to `data-scratch/design/MODEL-VETTING-DESIGN.md` and its owner answers: that file is not in the repo or
  in `data-scratch/design/` today; this section 4 and slices 7 and 8 are the record. If the file turns up, its owner answers
  win where they differ and are copied here.
- The "see BUILD-PLAN.md" wording on STACK-CATALOG-01, GROUND-A-01 and OWUI-ADOPT-06: the file is not in the repo; this note is their design.
- [The thin chat path](../plans/chat-thin-path-2026-10-02.md) "Replacements" row "Global `CHAT_SAMPLING`, per-model catalog
  fields, S to M": sized and sliced here. Nothing in RULES.md changes.

## 11. Decisions for Jesse

1. **IMG-VISION-VETO-01**: let the category check drop an adult's picture once two weekly shadow reports pass the five thresholds. Recommended: yes, but the ask comes back with the two reports, not now.
2. **IMG-REVERSE-01 B**: build an owner-keyed web reverse-image provider (TinEye is the only one with a public paid API; Google Lens and Bing Visual Search have none; SearXNG cannot upload a picture). Recommended: no; ship the local index (slice 21) only, and revisit if a keyless provider appears.
3. **THIN-6Ac acceptance**: if Muse at its card's temperature 1.0 is longer and not slower but the tool-decision row drops inside its interval, keep the card values (rule 3) rather than tune a Home override. Recommended: keep the card values; a tuned override needs its own three measurements.
