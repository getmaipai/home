# Tools audit: what we have today (2026-10-03)

Cloud lane A. The "what we have today" half of the research, audit, design program. Facts and gaps only, no design
recommendation. Base commit f2f8102. No code was changed.

## Scope and limits

- Verified in this repo: manifests, host code, turn machine, store code, docs. Paths are repo-relative; `backend/src/lib/` is
  shortened to `lib/` in the tables.
- NOT verified: `getmaipai/.github` (PACKAGES.md, SETTINGS.md, UI.md, ENGINEERING.md), `getmaipai/catalog` and
  `getmaipai/commons`. This session's GitHub scope is `getmaipai/home` only, so none was cloned or read. `@maipai/spec` is not on
  disk (`backend/package.json:21` points at `../../commons-tags/spec-spec-v0.1.71/spec`, absent), so `spec/errors.json`
  and the manifest schema are known only from imports (`lib/plugins.ts:17-23`) and from manifests.
- PACKAGES.md requirements below are the ones quoted in this repo's code and docs, not the file itself. The gap table (section 5)
  is therefore a lower bound on what PACKAGES.md requires.
- Line numbers come from read-only sweeps; the headline ones were spot-checked (`modelCatalog.ts:101`, `model.ts:114-124`,
  `plugins.ts:542`, `policy.ts:343-346`, `store.ts` routes).

## 1. Bundled package inventory (35 packages in `backend/packages/`)

Columns: Tier (manifest `tier`; 0 is a recipe, 1 is a Deno handler), Role (`min_role`), Cons (`consequential`), Inc (`incognito`),
Off (`offline`), Route (`routing` keys; N is the pattern count), Model (how a model can call it today).

Model column key:
- **offered**: in `tools_offered` (`lib/modelCatalog.ts:101`), so the model sees it as a tool under `tool_choice: auto`.
- **pattern**: not offered, but `routing.patterns` match a whole utterance before the model runs
  (`turnMachine/nodes/commands.ts:76-127`) and answer with no model call. Skipped when crisis, min_role unmet, consequential,
  `always_offer`, or (temporary chat and `memory:write`).
- **none**: no route from the turn.

| id | kind | what it does | T | Role | Cons | Inc | Off | Route | Model |
|---|---|---|---|---|---|---|---|---|---|
| almanac-date | plugin | date arithmetic and relative dates | 1 | child | no | unaffected | full | patterns 3, answers | offered |
| almanac-time | plugin | time in a place | 1 | child | no | unaffected | full | patterns 4, answers | offered |
| almanac-holiday | plugin | holidays | 1 | child | no | unaffected | unavailable | patterns 2, answers | pattern |
| almanac-moon | plugin | moon phase | 1 | child | no | unaffected | full | patterns 3, answers | pattern |
| almanac-onthisday | plugin | on this day facts | 1 | child | no | unaffected | unavailable | patterns 3, answers | pattern |
| bedtime-storybook | project | bedtime story project (plan.json) | 0 | child | yes | ephemeral | full | examples only | via virtual `start_project` |
| buddy | companion | companion persona | 0 | child | no | unaffected | full | none | none (not a tool) |
| default | companion | default companion persona | 0 | child | no | unaffected | full | none | none (not a tool) |
| pal | companion | companion persona | 0 | child | no | unaffected | full | none | none (not a tool) |
| tutor | companion | companion persona | 0 | child | no | unaffected | full | none | none (not a tool) |
| convert | plugin | unit conversion | 0 | child | no | unaffected | full | patterns 1 | offered |
| currency | plugin | currency conversion | 1 | child | no | unaffected | unavailable | patterns 1 | pattern |
| define | plugin | dictionary lookup | 0 | child | no | unaffected | unavailable | patterns 3 | pattern |
| joke | plugin | tells a joke | 0 | child | no | unaffected | unavailable | patterns 3 | pattern |
| knowledge | plugin | Wikipedia summary | 1 | child | no | unaffected | unavailable | patterns 5 | pattern |
| lights-off | plugin | lights off in a room | 0 | child | no | unaffected | unavailable | patterns 2 | pattern |
| lights-on | plugin | lights on in a room | 0 | child | no | unaffected | unavailable | patterns 2 | pattern |
| list-add | plugin | add to a list | 0 | child | no | unaffected | full | patterns 3 | pattern |
| list-view | plugin | read a list | 0 | child | no | unaffected | full | patterns 3 | pattern |
| lock-doors | plugin | lock doors | 0 | teen | yes | unaffected | unavailable | examples only | none |
| math | plugin | arithmetic | 0 | child | no | unaffected | full | patterns 3 | offered |
| media-lookup | plugin | movie, show, book facts | 1 | child | no | unaffected | unavailable | patterns 8 | pattern |
| music | plugin | MusicBrainz lookup | 1 | child | no | unaffected | unavailable | patterns 2 | pattern |
| news | plugin | NPR headlines | 1 | child | no | unaffected | unavailable | patterns 2 | pattern |
| recall | plugin | read memory | 0 | child | no | unaffected | full | patterns 2 | pattern (not offered on purpose, `modelCatalog.ts:72-77`; memory is injected context, rule 1) |
| remember | plugin | write a memory | 0 | child | no | ephemeral | full | patterns 8 | offered |
| remind | plugin | set a reminder | 0 | child | no | unaffected | full | patterns 1 | offered |
| sports | plugin | MLB scores | 1 | child | no | unaffected | unavailable | patterns 2 | pattern |
| storytime-style | skill | story style instructions (SKILL.md) | 0 | child | no | unaffected | full | examples only | none |
| timer | plugin | set a timer | 0 | child | no | unaffected | full | patterns 1 | offered |
| translate | plugin | translate text (model call) | 0 | child | no | unaffected | full | patterns 1 | pattern |
| trivia | plugin | trivia question | 0 | child | no | unaffected | unavailable | patterns 4 | pattern |
| weather | plugin | weather for a place | 0 | child | no | unaffected | unavailable | patterns 6, 6 examples | offered |
| websearch | plugin | web search with page reads | 0 | child | no | unaffected | unavailable | patterns 2, `always_offer` | offered |
| write_document | plugin | create or edit a document artifact | 0 | child | no | ephemeral | full | examples only | none (left out on the DOC-TOOL-01 gate, `modelCatalog.ts:85-95`) |

Plus two tools offered to the model that are not packages: `start_project` and `answer_from_this_conversation` (section 4).
`start_project` is in `tools_offered` and has no `backend/packages/` entry. `answer_from_this_conversation` is not listed
(`answer_from_context_tool: false`, `modelCatalog.ts:111`).

The offered set is 10 ids: almanac-date, almanac-time, convert, math, remember, remind, start_project, timer, weather, websearch.
9 of them are packages (websearch, weather, timer, remind, remember, math, convert, almanac-time, almanac-date).

Counts: 35 packages. Tier 0: 24. Tier 1: 11. Kind: plugin 29, companion 4, project 1, skill 1. 27 declare `routing.patterns`.
9 packages are in the model's offered set. 18 are reachable only by exact pattern. 8 have no turn route (bedtime-storybook only through `start_project`).

### Permissions, data sources and what leaves the house

| id | permissions | data_sources (all `opt_in: true`) | leaves the house |
|---|---|---|---|
| almanac-holiday | net:date.nager.at | nager-date | the country or year asked for, to Nager.Date |
| almanac-onthisday | net:en.wikipedia.org | wikipedia | the date, to Wikipedia |
| currency | net:api.frankfurter.dev | frankfurter | currency codes and amount, to Frankfurter |
| define | net:api.dictionaryapi.dev | dictionaryapi-dev | the word, to dictionaryapi.dev |
| joke | net:icanhazdadjoke.com | icanhazdadjoke | an HTTP request (no personal text) |
| knowledge | net:en.wikipedia.org | wikipedia | the topic, to Wikipedia |
| media-lookup | net:www.wikidata.org, net:en.wikipedia.org | wikidata, wikipedia | the title, to Wikidata and Wikipedia |
| music | net:musicbrainz.org | musicbrainz | the query, to MusicBrainz |
| news | net:feeds.npr.org | npr-rss | an HTTP request for the feed |
| sports | net:statsapi.mlb.com | mlb-statsapi | an HTTP request, to MLB |
| trivia | net:opentdb.com | opentdb | an HTTP request, to Open Trivia DB |
| weather | net:geocoding-api.open-meteo.com, net:api.open-meteo.com | open-meteo | the place name, to Open-Meteo |
| websearch | integration:searxng, llm:complete | searxng, page, wikipedia | the query to the owner's SearXNG (which queries public engines), fetched result pages to their hosts; optional hosted key (Brave, `search.brave_api_key`, adults only, THIN-4H) sends the query to the provider |
| lights-on, lights-off | home:light | none | stays in the house (Home Assistant) |
| lock-doors | home:lock | none | stays in the house |
| list-add, list-view | lists:write, lists:read | none | stays |
| recall, remember | memory:read, memory:write | none | stays |
| remind, timer | reminders:write, timers:write | none | stays |
| translate | llm:complete | none | stays (local engine) |
| bedtime-storybook, write_document | artifact:write | none | stays |
| almanac-date, almanac-moon, almanac-time, convert, math, buddy, default, pal, tutor, storytime-style | none | none | stays |

`data_sources` is read only for the privacy page (`lib/privacy.ts:199-208`) and `wire.ts:605`. No code enforces it at call time.

### Tests and quality scale

| group | packages | test form |
|---|---|---|
| Tier 1, `smoke.kind: deno_test` | almanac-date, almanac-holiday, almanac-onthisday, almanac-time, currency, knowledge, media-lookup, music, news, sports | `handler_test.ts` in the package, run by `lib/smoke.ts:186` (`deno test --no-check`) |
| Tier 1, no `smoke` key | almanac-moon | has `handler_test.ts`, manifest declares no smoke |
| Tier 0, `recipe_fixture` | convert, define, joke, lights-off, lights-on, list-add, list-view, lock-doors, math, remind, timer, translate, trivia, weather, websearch, write_document | `tests/smoke.json` |
| Tier 0, no smoke | recall, remember | `recipe.json` only |
| `static` | bedtime-storybook, storytime-style | no tests |
| no smoke, no tests | buddy, default, pal, tutor | none |

Quality scale: all 35 declare `quality_scale: bronze` and a `quality_scale.yaml` with `scale: bronze`. Silver `diagnostics_and_reauth`
is `met: false` in all 35. Gold `real_service_verified` is `met: true` in 6 (define, joke, knowledge, media-lookup, trivia, weather)
and false in the other 29. Bronze completeness is checked by `backend/tests/package-bronze.test.ts`.

Provenance: only 7 packages mirror the catalog (`backend/packages/bundled-provenance.json`: define, joke, knowledge, media-lookup,
storytime-style, trivia, weather; all at catalog commit b876690). The other 28 are edited here. Known drift: catalog commit
c475887 is not mirrored (`docs/BACKLOG.md:176`).

### Manifest fields in use, and which the host reads

| field | read by Home code? |
|---|---|
| `id`, `version`, `kind`, `tier`, `description`, `args` | yes (`lib/plugins.ts:153-258`, `model.ts:114-124`) |
| `routing.patterns`, `routing.always_offer` | yes (`nodes/commands.ts:76-127`) |
| `routing.examples` | bronze test only (5 or more) |
| `permissions` | yes (`lib/packageHost.ts:1580-2083`; `memory:write` also gates temporary mode, `policy.ts:342-346`) |
| `min_role` | yes (`plugins.ts:446`, `536`, `policy.ts:332`) |
| `consequential` | yes (`policy.ts:360-363`, `commands.ts:89`, `packageHost.ts:1905`) |
| `data_sources` | display only (`privacy.ts`) |
| `cache`, `warm` | yes (`lib/packageCache.ts:272`; scheduler for warm) |
| `smoke` | yes (`lib/smoke.ts`) |
| `incognito` | no read found; temporary behaviour is by permission, not by this field |
| `offline` | no read found; offline is runtime failure (`network_unreachable`, `packageHost.ts:337,355`) |
| `requires`, `optional`, `platforms`, `min_app`, `license`, `backup` | no read found |
| `answers`, `fallback_reply`, `timeout_ms` | Tier 1 path (`plugins.ts:548-551`) |

## 2. The package host as built

| area | built | evidence |
|---|---|---|
| Manifest load and validation | yes: Zod `PackageManifest` from `@maipai/spec`; 400 `manifest_invalid` on failure; recipe validated against `Recipe`; mtime cache | `lib/plugins.ts:153-258`, `:207` |
| Args validation | yes: Ajv 2020, `strict:false` | `plugins.ts:44`, `:468-490` |
| Manifest lint | partial: routing patterns only (question-word openers) | `lib/manifestLint.ts:39-90` |
| Tier 0 (recipe) | yes: `runRecipe` over `createHost` from spec | `plugins.ts:555-561` |
| Tier 1 (Deno) | yes: one warm process per package, `--allow-read`/`--allow-write` on its own dir, `--cached-only`, no `--allow-net`, no env, no subprocess; `host.*` calls go back through `createHost` so permission, SSRF and rate limits match Tier 0 | `lib/denoHost.ts:1-11,110-119,310`; branch at `plugins.ts:542` |
| Tier 2 | not a package tier. "Tier 2" in dev.md is tool-calling routing. No manifest has a tier other than 0 or 1 | `docs/dev.md:6246`; manifest sweep |
| MCP | partial: used only as the stdio transport to a Tier 1 Deno process. No MCP client for external servers | `denoHost.ts:6-8` |
| Connector | no code. `integration:<id>` permission is the shape (`docs/dev.md:6786-6792`); `integration.call` supports only `home_assistant.get_state` and `searxng.search`, the rest `capability_missing` | `packageHost.ts:1913-1922` |
| Permission enforcement | yes: exact-string match, `permission_denied`; `net:` per host and per redirect hop with SSRF check and rate limit | `packageHost.ts:1580-1584,1629,1649,1672` |
| Host methods not wired | `files.read`, `files.write`, `files.list` return `capability_missing` | `packageHost.ts:1598-1600,2071-2083` |
| Role gating | yes (`meetsMinRole`) at run, list, commands, policy | `plugins.ts:446,536`; `routes/plugins.ts:18`; `commands.ts:78`; `policy.ts:332` |
| Age gating | none at manifest level. Age reaches packages only as `search.safe_search` via `speakerAgeBand` | `packageHost.ts:76,1930` |
| Temporary mode | by permission: any package declaring `memory:write` is refused (`temporary_mode`); artifact create and update refused | `policy.ts:342-346`; `commands.ts:96`; `packageHost.ts:1803,1842` |
| Anonymous speaker, crisis | refused for memory-touching packages; crisis refuses all | `policy.ts:327,336` |
| Consent | one hard-coded rule: a websearch naming a roster person returns `consent_needed`. `opt_in` is display only | `policy.ts:349-353`; `privacy.ts:208` |
| Error mapping | `HostError` to 403 (`permission_denied`), 404 (`not_found`), 400 other; Tier 1 failure to 502 with `fallback_reply`; spoken text from `ERROR_CATALOG[code].spoken_fallback`; tool failure to `errorCode`/`userMessage` | `plugins.ts:496-501,562-577`; `tool.ts:142-170` |
| Repairs | yes: smoke failure disables the package and raises an `issues` item (source `packages`); Tier 1 faults raise `packages.deno`; `routes/repairs.ts` lists, fixes, dismisses | `lib/smoke.ts:47,71-99`; `denoHost.ts:39,244,357` |
| Smoke schedule | boot and daily core job `packages.smoke`; manual `POST /api/plugins/:id/smoke` | `index.ts:155,169,231` |
| Install | yes: `POST /api/store/installs/:id`, verify twice, permission-escalation 409, smoke, disabled plus Repairs on failure | `lib/store.ts:171-309`; `routes/store.ts:93` |
| Update | same call as install. No checker, no scheduled `catalog.check`, no auto-update | `store.ts:116` (comment); `lib/updates.ts:10-16` |
| Rollback | yes, single step, from `previousVersion` | `store.ts:328-352` |
| Uninstall | route exists (`POST /api/store/installs/:id/uninstall`) and removes the row, `versions/` and staging, keeps Tier 1 `state/`. No uninstall hook, no standard confirmation text, cannot remove a bundled-only package. BACKLOG PKG-UNINSTALL-01 (`docs/BACKLOG.md:683`) says "no uninstall path"; the route disproves the first half of that claim | `store.ts:364-378`; `routes/store.ts:143`; `frontend/src/lib/api.ts:1022` |
| Enable and disable | only smoke-driven `package_status`; no manual route | `smoke.ts:71`; `routes/plugins.ts:55-57` |
| Signing and verification | TUF-style index: ed25519 over canonical JSON, root threshold pinned by the client, expiry, rollback high-water marks per role, targets-hash in timestamp; tarball length and sha256; manifest id and version re-checked after unpack | `lib/storeIndex.ts:209-288`; `store.ts:214,233,247,251`; `backend/tests/storeIndex.test.ts` |
| Permission diff on update | yes, but compares the index entry's `custom.permissions`, not the unpacked manifest | `store.ts:201-211` |
| Not enforced | `min_app`, `requires`, `signer`, `changelog_url`, `channel` (stored, never used to pick a version) | `storeIndex.ts:34-46`; `store.ts:279` |
| Not found | banned-API scan, licence check, SBOM, re-validation of the unpacked manifest at install | grep over `backend/src` |
| Capabilities (`requires`) | not built (CAP-GATE-01 open, `docs/BACKLOG.md:685`) | no `capabilities.ts` |

## 3. The catalog repo as consumed by Home

`getmaipai/catalog` itself was not read (scope). From this repo only:

- No pinned default index URL or root key anywhere. `source` and `trust` arrive in each request body
  (`routes/store.ts:13-19,42-50,90-95`; `docs/dev.md:20278-20283`).
- Index format: TUF-shaped `root.json`, `targets.json`, `timestamp.json`; target entries carry `length`, `hashes.sha256` and
  `custom{source_commit, signer, min_app, requires[], permissions[], channel, changelog_url?}`
  (`lib/storeIndex.ts:18-68`). Tarballs are named from the target path (`store.ts:76-78`).
- Home's reader is a hand-written twin of the catalog's `tools/src/build-index.ts`, no shared module (`storeIndex.ts:7-11`).
- Fetch: `fetchRawIndex` over a dir or a URL, no timeout, no limiter (`storeIndex.ts:138-155`). Its only caller is
  `installLocked` (`store.ts:176`). `fetchVerifiedIndex` is exported "for a future `catalog.check` job" and no job exists.
- No route lists an index (BACKLOG STORE-01, `docs/BACKLOG.md:8096`). The Apps page "From the catalog" filter has no data.
- `lib/updates.ts` checks GitHub releases for `getmaipai/home` and `getmaipai/bot` only (`:50-51`); its header says no catalog is live.
- Bundled copies: `scripts/refresh-bundled-packages.ts` copies 7 ids from a sibling catalog checkout and writes
  `bundled-provenance.json`; `lib/bundledPackages.ts:212` hashes each dir; tests fail on a hand edit.

Catalog CI checks named in the org CLAUDE.md versus evidence in this repo (the catalog's own CI could not be inspected):

| check | evidence here |
|---|---|
| manifest lint | described: `docs/plans/session-d-packages-and-store.md:160-167`; catalog `tools/` lint, ticked at `docs/BACKLOG.md:10541-10546`. Not seen. |
| permission diff | Home does it at install (`store.ts:201-211`). A PR-comment diff in catalog CI is "deferred" (`docs/dev/session-d.md:925-933`). |
| banned-API scan | no reference in Home. `session-d.md:925-933` lists "vendoring scan" as deferred. |
| recipe conformance | smoke fixtures in Home (`recipe_fixture`); weather cites `spec/fixtures/recipes/weather-geocoded.json`. Catalog CI not seen. |
| licence check | no reference in Home beyond `NOTICE:8-9,29`. |
| scorecard | described as built (`docs/BACKLOG.md:10541-10546`; `docs/dev.md:25388-25392`: "lint+scorecard on all 7 packages"). Not seen. |
| other | pack (deterministic tarball), sign (Ed25519, second signer slot), index (thirty-day expiry), `check` CLI: described as built. `check.yml` at catalog `2d1d37c`, tag- and PR-triggered, std-v0.2.0, gitleaks. Whether anything but a README exists in the catalog: not verified. |

## 4. How a tool reaches the model today

Flow: manifest, then `tools_offered` literal, `toolSpecFor`, request with `tool_choice: auto`, tool call, `policyNode`, `toolNode`,
`runPlugin`, outcome, phrasing round, answer, output gate.

| step | where | what happens |
|---|---|---|
| 1 Offered ids | `lib/modelCatalog.ts:101` | A hand-written list of 10 ids on the one catalog chat entry. No offered-tool source other than this list. No manifest field marks a package model-callable (grep for `model_callable`, `age_bands`, `min_age`: none). |
| 2 Budget | `turnMachine/budget.ts:14-41` | `resolveTurnBudget` returns the catalog entry's `turn_budget`, else `NO_RECORD_BUDGET` (`rounds:0`, no tools, the minors' fail-safe). `rounds: 1` (`modelCatalog.ts:68`), `model_transitions: true` (`:112`). |
| 3 Spec | `turnMachine/nodes/model.ts:114-124` | `toolSpecFor(id)`: `answer_from_this_conversation` returns a const; `start_project` returns `startProjectToolSpec()` built from the project-type registry; anything else uses `loadManifestOnly(id)` and passes `{id, description, args}`. A failed load drops the id. |
| 4 Offer | `model.ts:609-616` | `tools_offered` sorted, mapped through `toolSpecFor`, sent with `tool_choice: "auto"`. No filter by age band, role, temporary mode, surface or permission at this step. |
| 5 Request | `model.ts:206-220,508-616` | `startCompleteStreamPieces("chat", ...)`. A phrasing round sends the same tools as `state.lastTools` with `tool_choice: "none"` (`:601-602`). `forceSearchOnly` sends `[websearch]` with `auto` (`:603-605`). |
| 6 Call parse | `model.ts:95-112,708-767` | Output kinds `text`, `tool_calls`, `answer_from_context`, `model_failed`. A websearch call with an empty or bare-pronoun `expression` goes to the query-writer recovery (`:738-767`). |
| 7 Policy | `nodes/policy.ts:224-363` | Refuses by `crisis_state`, `min_role`, `anonymous_speaker`, `temporary_mode` (`memory:write`), `consent_needed` (roster name in websearch), `ungrounded_args`, `confirm_needed` (consequential), `unknown_tool`, `manifest_invalid`, `context_tool_in_policy`. |
| 8 Run | `nodes/tool.ts:100-194`; `lib/plugins.ts:527-580` | `start_project` bypasses `runPlugin`. Others: `loadManifestOnly`, `meetsMinRole`, `validateArgs`, Tier 1 via `callTier1Handle`, Tier 0 via `runRecipe`. Raced against a deadline (tool 10 s, `modelCatalog.ts:135`). |
| 9 Outcome | `tool.ts:142-170`; `nodes/lookupFallback.ts` | `ToolExecutionOutcome{callId, packageId, status, via, errorCode, userMessage}`. `lookupFailureKind` reads status and code only. |
| 10 Phrasing | `model.ts:549-602` | Failed lookups are filtered out; with none left the model gets `lookupMissedInstruction` and writes its own "could not look it up" note (THIN-1D). Next round is `tool_choice: none`. |
| 11 Answer | `nodes/answer.ts:93-152` | Producers `policy_refused`, `immediate`, `model_text`, `context_quote`, `from_outcomes`, `model_failed` (fixed `COMPOSE_FAILURE_LINE`). |
| 12 Gate | `nodes/outputGate.ts` | Output gate, then done. |

Hand-written lists and special cases:

| item | where | note |
|---|---|---|
| `tools_offered` literal | `modelCatalog.ts:101` | THIN-2B (partly done) and THIN-2F (not started) target it. |
| `answer_from_this_conversation` | const `model.ts:58-70`; dispatch `:115,709`; refusal `policy.ts:224-228`; loop `machine.ts:413-415` | Virtual tool. Off in the catalog (`:111`), code still live. |
| `start_project` | `model.ts:120`; `policy.ts:245-289`; `tool.ts:121`; `machine.ts` guard `toolProvidesOwnReply`; `turnContext.ts:173-179`; `turnNext.ts:135` | Virtual tool in 6 files. Its reply skips the phrasing round. |
| `forceSearchOnly` | `machine.ts:75,125,334,413-415`; `model.ts:92,603` | Forced-search remnant. After an ungrounded `answer_from_this_conversation` quote it re-offers websearch alone under `auto`. Dead while the context tool is off (BACKLOG:78). |
| `isWorldQuestion`, `householdSubjectNamed` | none in `backend/src` | Gone; `isWorldQuestion` survives as a comment at `modelCatalog.ts:83`. |
| websearch special cases | `model.ts:738-767`; `policy.ts:349-359`; `tool.ts` (`read_page: true`); `machine.ts` `queryWriterFallback` | Name-keyed branches. |
| `remember` scope regex | `packageHost.ts:1516-1540` | Hand-written first-person and third-party possessive patterns. |
| exact-command router | `nodes/commands.ts:36-127` | forget, household custom commands, then manifest `routing.patterns` via `matchPattern` (`turnShared.ts:367`), `COMPUTED_WILDCARD_RESOLVERS` and `NEVER_FIRES_WILDCARDS` (`manifestLint.ts:51,90`). |
| `recall` omitted, `write_document` omitted | `modelCatalog.ts:72-77,85-95` | Hand decisions in comments. |
| old-path routing tiers | `turnEngine.ts:283,911-999,1181,1213,2550` | Pattern, embedding, keyword, tool tiers; `MAX_TIER2_CALLS_PER_TURN = 2`; `ORDINARY_DEFAULT_ORDER`. Reached only when setting `turn.pipeline.next` is false (default true, `routes/turn.ts:36-37`, `settings/aiKeys.ts:80-85`). The new path has no routing tiers. |

Thin-path backlog status: THIN-2B open, partly done (`always_search` no longer read; `rounds`, `tools_offered`, `model_transitions` still
read, needs a commons spec tag; `docs/BACKLOG.md:80`). THIN-2F open, not started (`:82`). THIN-2G open, not started: a failed tool
goes straight to the `tool_choice: none` phrasing round (`:83`). THIN-4H done (hosted search key, `:114`; follow-ups: hosted calls skip
the cache, limiter, health record and page reads).

## 5. Gap table

Requirement source is "what this repo quotes of PACKAGES.md or the design" (see Scope). Status: built, partly, not built.

| requirement | status | evidence |
|---|---|---|
| One manifest shape validated against the spec | built | `plugins.ts:153-211` |
| Tier 0 recipe host | built | `plugins.ts:555-561` |
| Tier 1 Deno sandbox with scoped permissions | built | `denoHost.ts:110-119` |
| Tier 1 MCP (stdio to the handler) | built | `denoHost.ts:6-8` |
| MCP client and Connector packages | not built | no code; `integration.call` supports 2 calls (`packageHost.ts:1913-1922`) |
| Permission model enforced at call time | built for host methods | `packageHost.ts:1580-2083` |
| `data_sources` declared and disclosed | partly: displayed, never enforced or consent-gated | `privacy.ts:199-208` |
| Consent from `opt_in` | not built | display only (`privacy.ts:208`) |
| Host `files.*` methods | not built | `capability_missing` (`packageHost.ts:2071-2083`) |
| Per-person role gating | built | `plugins.ts:446` |
| Per-person age gating of a package | not built | no manifest field; only `safe_search` |
| `incognito` manifest field honoured | not built | no read; temporary mode is a `memory:write` rule |
| `offline` manifest field honoured | not built | no read |
| `requires` / `optional` capability gating | not built | CAP-GATE-01 (`docs/BACKLOG.md:685`) |
| Error mapping through `errors.json` | partly: catalog lookup for the spoken fallback; the raw `result.error` still becomes `userMessage` | `plugins.ts:496-501`; `tool.ts:142-170`. Raw text is kept off the model by the failure-kind mapping (`lookupFallback.ts`), not by the catalog |
| Repairs item on failure | built | `smoke.ts:71-99` |
| Smoke at install, update, on a schedule | built | `smoke.ts:3-7`; `index.ts:155,169` |
| Signed index, expiry, rollback, hash, double verify | built | `storeIndex.ts:209-288` |
| Pinned store URL and root keys | not built | request-body only (`routes/store.ts:42-50`) |
| Browse the catalog | not built | STORE-01 (`docs/BACKLOG.md:8096`) |
| Update check, notify, auto-update | not built | no `catalog.check` job (`store.ts:116`) |
| Single-step rollback | built | `store.ts:328-352` |
| Uninstall route | built (record is stale on this) | `routes/store.ts:143`; `store.ts:364` |
| Uninstall hook, confirmation text, media records untouched, child refused | not built or untested | PKG-UNINSTALL-01 (`docs/BACKLOG.md:683`) |
| Uninstall of a bundled package | not built | `store.ts:364-378` |
| Manual enable and disable | not built | `smoke.ts:71` only |
| Permission diff on update | partly: index metadata, not the unpacked manifest | `store.ts:201-211` |
| `min_app` / `signer` / `channel` honoured | not built | stored, unread |
| Banned-API scan, licence check, SBOM | not built in Home | grep |
| Re-validate the unpacked manifest at install | not built | validation happens on first load |
| Bronze for every bundled package | built (35 of 35) | `quality_scale.yaml`; `package-bronze.test.ts` |
| Silver | not built (0 of 35) | `diagnostics_and_reauth: false` everywhere |
| Gold | partly (6 of 35) | `real_service_verified` |
| Default set held to catalog bar via provenance | partly: 7 of 35 mirrored, drift at c475887 | `bundled-provenance.json`; `docs/BACKLOG.md:176` |
| Tools offered come from installed, enabled, permitted packages | not built | `modelCatalog.ts:101`; THIN-2F |
| Offered set filtered by band, role, surface, temporary mode | not built before the call; role, temporary and crisis are enforced after the call in `policy.ts` | `model.ts:609-616` vs `policy.ts:327-346` |
| Model-callable manifest flag | not built | grep |
| One more round after a failed tool | not built | THIN-2G |
| Catalog CI: permission-diff comment, vendoring scan, screenshots, CLA | deferred per Home's record; catalog repo not inspected | `docs/dev/session-d.md:925-933` |
| Footprint and backup declarations | not built | PKG-FOOTPRINT-01 (`:776`), PKG-BACKUP-DECL-01 (`:777`) |
| A package never opens a port | not verified | quoted at `docs/dev/ods-review-2026-10-01.md:88`; no check found in Home |

## 6. Findings

1. The model's tool list is code, not package state. Installing a package never adds a model tool. Adding one means editing
   `modelCatalog.ts:101`. A store-installed package can only reach a turn by an exact `routing.patterns` match.
2. Nothing between manifest and request filters by person. Role, temporary mode and crisis act only after the model has chosen a
   call, so the model sees tools it will be refused. An age band is never consulted for a package.
3. Two virtual tools bypass the package host: `start_project` (six files) and `answer_from_this_conversation`. Both are named
   in code, not declared in a manifest.
4. The host has no notion of "this package is a tool". Packages are also companions, a project and a skill, and the only
   discriminator is `kind`; `routing.always_offer` is the one offer-related manifest field and only websearch sets it.
5. Several declared manifest fields are decorative: `incognito`, `offline`, `requires`, `optional`, `platforms`, `min_app`, `backup`,
   `data_sources` (display only). Temporary-mode behaviour comes from the `memory:write` permission string, which is why
   `remember` declares `incognito: ephemeral` and is also blocked by permission, and `write_document` (`ephemeral`) is blocked
   only by artifact checks.
6. The supply chain is built end to end on Home's side (verify, install, smoke, rollback, uninstall) but has no live source:
   no pinned URL, no browse, no update check, no caller except an explicit POST.
7. Bundled provenance covers 7 of 35 packages; the other 28 have no catalog counterpart to compare with.
8. `docs/BACKLOG.md:683` and `lib/updates.ts:10-16` and `routes/plugins.ts:11-14` carry stale statements about the store
   (uninstall missing, no store). `GET /api/plugins` hard-codes `latest_version = manifest.version` and `channel = "stable"`
   (`routes/plugins.ts:23-25`).
9. Of 35 packages, 26 can answer by exact pattern with no model involvement (27 declare patterns; websearch is skipped as
   `always_offer`). 18 of those are never a model tool, so a phrasing that misses the pattern reaches the model with no
   way to call them.
10. Failure handling is split across three places: `ERROR_CATALOG` in the plugin runner, `lookupFallback.ts` kinds for the model, and
    `answer.ts` refusal lines. A raw error string still travels as `userMessage` on the tool outcome (`tool.ts:142-170`), which
    RULES.md rule 6 says must not reach a non-admin, a child or the model; the audit did not trace whether every consumer drops it.

## 7. Not verified

- Contents of `getmaipai/.github` docs (PACKAGES.md, SETTINGS.md, UI.md, ENGINEERING.md "Errors"), `getmaipai/catalog` (whether anything
  but a README exists, its CI workflow, its index) and `getmaipai/commons` `spec/` (manifest schema, `errors.json`, recipe
  interpreter). Out of this session's repo scope.
- No test or the app was run; counts come from manifests and file listings.
- Whether `host.llm.complete` is wired (`docs/dev.md:2518` says it throws; `translate` and `websearch` declare `llm:complete`).
- Finding 10 above (raw `userMessage` reaching a client) is by reading `tool.ts`, not traced to the wire.
