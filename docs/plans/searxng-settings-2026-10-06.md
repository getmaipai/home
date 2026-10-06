# Settings > Web search: check and configure SearXNG

Design note, 2026-10-06. Item family SEARXNG-SET (01 to 05). Draft for the
architect gate; becomes `docs/plans/searxng-settings-2026-10-06.md` when its
first slice lands.

Owner's ask: "our app should be able to check and configure SearXNG to how we
need. In settings there could be a SearXNG section that shows whether we are
properly configured, and options to choose what to configure."

## Supersedes

Nothing. It extends three items without replacing them:

- THIN-4G (Home's one setting for an owner's own instance): its save-time
  check becomes a call to this note's one checker (SEARXNG-SET-03). THIN-4G
  keeps the setting, the "never silently replaced" rule and its order.
- STACK-SEARCH-01 (the Stack installs and owns SearXNG): this note adds the
  engine-group settings and the apply, preview and undo routes on top of the
  service module that item designs. It does not answer any of that item's
  open questions (fetch, runtime, memory share, licence).
- SEARCH-HEALTH-01 and SEARCH-PACE-01: reused as they are. The status page row,
  the two Repairs rows and the shared rate limiter are not duplicated.

`search.searxng_url`'s help text ("Web search is off until this is set")
becomes wrong once STACK-SEARCH-01 lands; SEARXNG-SET-01 rewrites it.

## 1. Facts about SearXNG (checked 2026-10-06)

Sources: docs.searxng.org (admin/api, settings, settings_search,
settings_server, settings_engines, settings_general, settings_outgoing,
searx.limiter, dev/search_api) and `searx/webapp.py` on the `master` branch.
Live facts come from read-only GETs of `/healthz`, `/config` and
`/stats/errors` against the household's own instance, the same calls the hub
already makes. Its address is not recorded here.

| Fact | Status |
|---|---|
| No runtime admin API that changes settings. The only documented admin endpoint is `GET /config`, read-only. Config is `settings.yml`, found at `$SEARXNG_SETTINGS_PATH`, then `/etc/searxng/settings.yml`, then the bundled default. Some `server:` keys also take environment overrides (`SEARXNG_SECRET`, `SEARXNG_LIMITER`, `SEARXNG_PUBLIC_INSTANCE`, `SEARXNG_IMAGE_PROXY`). | Verified (docs) |
| A changed `settings.yml` takes effect only after a restart. | UNVERIFIED (the docs do not say; settings load at process start) |
| `use_default_settings: true` merges a small file over the bundled defaults; `use_default_settings.engines.keep_only` and `.remove` trim the engine list; an `engines:` entry with a known `name` overrides that engine's keys. | Verified (docs) |
| Per-engine keys: `disabled` (off by default, still user-selectable), `inactive` (removed), `weight` (default 1), `timeout` (overrides `outgoing.request_timeout`), `categories`, `shortcut`, `api_key`, `tokens`. | Verified (docs) |
| `outgoing.request_timeout` defaults to 2.0 s, `outgoing.max_request_timeout` to 10.0 s. | Verified (docs) |
| `search.safe_search`: 0 none, 1 moderate, 2 strict. The `safesearch` request parameter sets it per request. | Verified (docs) |
| `search.formats` lists the allowed output formats; a request for a format not listed gets HTTP 403 (`flask.abort(403)` in `webapp.py`). | Verified (docs and code) |
| `/config` is JSON with `autocomplete, brand, categories, default_doi_resolver, default_locale, default_theme, doi_resolvers, engines, instance_name, limiter, locales, plugins, public_instance, safe_search, version`. It does **not** list `search.formats`, so "JSON enabled" can only be learned by a real `format=json` request. | Verified (live) |
| Each `/config` engine carries `name, enabled, safesearch, categories, timeout, shortcut, paging, language_support, languages, regions, time_range_support`. No `weight`. | Verified (live) |
| `/config.limiter` reports `enabled` and some bot-detection flags, never the `pass_ip` list. Whether the hub is exempt can only be inferred from a 429 or a block page. | Verified (live) |
| The limiter's exemptions live in `limiter.toml` (`/etc/searxng/limiter.toml`), `[botdetection.ip_lists] pass_ip = [...]`, not in `settings.yml`. The limiter needs a valkey database. | Verified (docs); whether 2026.10 moved it into `settings.yml` is UNVERIFIED |
| `/healthz` answers `OK` as `text/plain`. | Verified (code, live 200) |
| `/stats/errors` is JSON `{engine: [{code, exception_classname, filename, function, line_no, log_message, log_parameters, percentage, secondary}]}`, served while `general.enable_metrics` is on (default on). | Verified (docs, live 200 JSON) |
| The `engines=` request parameter can name an engine that is `disabled` (off by default) but not one that is `inactive` or removed; the only other filter is private-engine tokens. | UNVERIFIED (a reading of `webapp.py`; SEARXNG-SET-02 proves it on the pinned version with a fixture) |
| SearXNG ships no prebuilt binary; Docker or a from-source install only. | Verified (Home's own `searchKeys.ts` header, research 2026-09); STACK-SEARCH-01 owns the answer |

Live household instance, sanitized: version `2026.10.4`, 87 engines, limiter
on, instance safe search 2 (strict), `/stats/errors` served, Wikipedia on,
Wikidata off, `wikicommons.images` on, image engines on (`bing images`,
`brave.images`, `duckduckgo images`, `wikicommons.images`, one keyed custom
image engine), news engines on, no Yandex or Baidu entries at all. Several
image engines had recent errors in `/stats/errors`. Search works, so JSON is
enabled there today.

## 2. What "configured how we need" means

The one table both products read is the engine-group catalog in the spec
(SEARXNG-SET-01). Engine names below are SearXNG 2026.10 names seen live; the
catalog pins them against the version the Stack ships and a test fails when a
name disappears.

| Group (plain label) | Engines (recommended) | Needed by | Default | Who receives the query |
|---|---|---|---|---|
| General web | `brave`, `duckduckgo`, `bing`, `startpage`, `mojeek` | every web search (Home rotates two per query, `webRotationPool()`) | on, cannot be turned off | Brave, DuckDuckGo, Microsoft, Startpage, Mojeek |
| Wikipedia and reference | `wikipedia`, `wikidata`, `wiktionary` | every web search (rotation adds Wikipedia), people and places | on, cannot be turned off | Wikimedia Foundation |
| Images | `wikicommons.images`, `brave.images`, `duckduckgo images`, `bing images` | pictures in answers (SearXNG is source 4 in `answerImages/select.ts`; encyclopedia pictures come from Wikimedia directly) | on | Wikimedia, Brave, DuckDuckGo, Microsoft |
| News | `brave.news`, `duckduckgo news`, `bing news`, `wikinews` | recommended only: Home does not send `categories=news` today | on | Brave, DuckDuckGo, Microsoft, Wikimedia |
| Video | `brave.videos`, `duckduckgo videos`, `bing videos`, `dailymotion` | video searches (`category: "videos"`) | on | Brave, DuckDuckGo, Microsoft, Dailymotion |
| Science | `arxiv`, `pubmed`, `semantic scholar`, `openairepublications` | optional | off | arXiv (Cornell), US National Library of Medicine, Allen Institute, OpenAIRE |
| Extra engines (privacy flag) | `yandex`, `baidu` | optional | off | Yandex (Russia), Baidu (China) |

Startpage and Mojeek names are UNVERIFIED on 2026.10 (not present on the
household instance); SEARXNG-SET-01 pins the list from the Stack's pinned
version's own `/config` before release.

**Minimum per feature** (a check fails below it):

- Search: JSON format on; at least 2 enabled engines in both `general` and
  `web` (rotation picks two); Wikipedia enabled.
- Children's and teens' search: at least 1 enabled `general`+`web` engine and
  1 enabled `images` engine with `safesearch: true` (what
  `safesearchEnginesFor()` names for a strict or moderate request).
- Pictures: at least 1 enabled `images` engine.
- Reachability: `/healthz` OK, no 429 or block page on the probe.

**Recommended extras** (warnings, never failures): Wikidata on;
`wikicommons.images` on (it is a built-in engine, no custom definition needed;
seen live); `outgoing.request_timeout` at or under 3.0 s so SearXNG answers
inside Home's 5 s attempt limit (`webSearchBudget.ts`); version under 6 months
old (scraping engines break as sites change; the stale-install finding in
`searxngHealth.ts`). Per-engine weights stay at SearXNG's default 1 until
LOOKUP-MEASURE-01 measures a better set: no weight is recommended by argument.

**Never**: an engine that needs an API key in the Stack-owned instance (rule 7:
search works with no key and no account). A keyed engine an owner runs on his
own instance is his business and is shown, not judged.

**Privacy-flagged engines** (Yandex, Baidu): off by default, an admin turns
each on, and the switch's help says in plain words: "Turning this on sends
search words to Yandex, a company in Russia." On top, Home never names a
flagged engine in a child's or teen's request and, while one is enabled, a
minor's request names its engines explicitly so a flagged one is never
included (SEARXNG-SET-04; rule 0 tightens, never loosens).

**Per-person safe search** stays where it is: `search.safe_search` (person
scope, SEARCH-SAFE-01). This section shows the instance default only as
information and never offers a per-person override.

## 3. Two modes (rule 11)

The mode is not a new key. It is `search.searxng_url`, the one setting rule 11
names: empty means the Stack-owned SearXNG (default, after STACK-SEARCH-01),
an address means the owner's own instance. Until STACK-SEARCH-01 lands, empty
means web search is off, as today, and the Stack controls are hidden.

### (a) The Stack-owned SearXNG (default)

- Group switches are Stack settings, declared once in the Stack's settings
  declaration (`stack/backend/src/settings.ts`, the place SETTINGS.md gives
  `stack.*` keys): `stack.search.groups.{news,images,video,science}` and
  `stack.search.engines.{yandex,baidu}`, boolean, scope device, `lives_in`
  `household.search`, `needs_restart: true`. General web and Wikipedia are not
  keys: they are always on, and the page shows them as locked rows.
- Changing a switch stores it as pending (the Stack's existing
  `needs_restart`/`pending` mechanism). The page shows "Changes waiting" with a
  preview of the file change (`GET /stack/v1/search/preview`: the current and
  pending `settings.yml` as diff lines) and an Apply button.
- Apply calls the existing `POST /stack/v1/settings/apply`. The Stack renders
  `settings.yml` from the spec catalog (`use_default_settings: true`,
  `engines.keep_only` = the union of the chosen groups, `search.formats:
  [html, json]`, `search.safe_search: 2` so a request that ever arrives without
  a level fails closed, `server.limiter: false` and a loopback bind since the
  hub is its only caller, `server.secret_key` generated once and kept in the
  Stack's secrets, never shown), writes it atomically beside the last good
  copy, restarts the service, and waits for `/healthz` plus one JSON probe.
  On failure it restores the last good file, restarts again, and reports the
  reason; it never leaves search down.
- Undo: `POST /stack/v1/search/revert` restores the previous applied file and
  the previous key values, then restarts the same way.
- Privacy: `/stack/v1/privacy` publishes one row per enabled group naming who
  receives the query (from the catalog), updated by each apply. Home's
  privacy page already shows the Stack's rows in its one table.

### (b) An owner-run instance

- Home never writes to, logs in to or opens a shell on another machine. It
  runs the checks and shows, for the failing ones only, the exact lines to add:

```yaml
# settings.yml: merge these keys into yours. Keep your own server.secret_key.
use_default_settings: true
search:
  formats:        # keep any other formats you already list
    - html
    - json
engines:
  - name: wikidata
    disabled: false
  - name: brave.images
    disabled: false
```

```toml
# limiter.toml (only when the limiter is on and blocked MaiPai)
[botdetection.ip_lists]
pass_ip = ["192.0.2.10"]   # this hub's address as your SearXNG sees it
```

- The snippet is built from the catalog and the failing checks, never a full
  file. The hub's address comes from its own network interfaces, with a note
  that a different network may see a different address. A Copy button and
  "Check again" sit under it, then "Restart SearXNG after saving."
- An unreachable instance is reported, never silently replaced (THIN-4G).

## 4. The checks (one implementation)

`backend/src/lib/searchInstanceCheck.ts` (Home, SEARXNG-SET-03) is the one
checker for both modes, for THIN-4G's save-time check and for the page. The
hourly canary in `searxngHealth.ts` stays the health source for the status row
and Repairs, and the checker reads its last result rather than repeating it.

| Check (plain title) | How | Fail or warn line, and the one-line fix |
|---|---|---|
| MaiPai can reach your search service | `GET /healthz` | Fail: "MaiPai can't reach your search service." Fix: "Check the address and that SearXNG is running." |
| Search results come back in a form MaiPai reads | the canary's last `format=json` result, or one probe if older than 15 min | 403: "JSON results are turned off." Fix: "Add json to search.formats." HTML: "The address opens a sign-in page." Fix: "Use an address that skips your sign-in page." |
| Not blocked by its limiter | `/config.limiter.enabled` plus the probe's status | Fail on 429 or a block page: "Your SearXNG's limiter is blocking MaiPai." Fix: "Add this hub's address to pass_ip in limiter.toml." |
| Up to date | `/config.version` (date-based) | Warn over 6 months: "Your SearXNG is over 6 months old; some engines may stop working." Fix: "Update SearXNG." |
| Enough web engines | `/config.engines` | Fail under 2: "Fewer than two web engines are on." Fix: enable from the General web list. |
| Wikipedia is on | `/config.engines` | Fail: "Wikipedia is off." Warn for Wikidata. |
| Pictures can be found | `/config.engines` | Fail: "No picture engines are on, so answers can't show pictures from the web." Fix: enable `wikicommons.images` and `brave.images`. |
| Safe search works for children and teens | safe-search-capable engines in `general` and `images` | Fail when the household has a child or teen profile, warn otherwise: "No child-safe engines are on for pictures." |
| News and video | `/config.engines` | Info only: which are on. |
| Engines having trouble | `/stats/errors` | Warn for an engine Home uses with `percentage` 50 or more: "Brave images is failing on about half its searches." Unavailable: "This SearXNG doesn't share error numbers." (unknown, not a fail) |
| Extra engines that send searches abroad | `/config.engines` for flagged names | Warn: "Yandex is on: search words go to a company in Russia. MaiPai never uses it for children or teens." |
| Default safe search | `/config.safe_search` | Info: "Your SearXNG's default is Strict. MaiPai sends each person's own level with every search." |

Each check returns `{id, title, state: pass | warn | fail | unknown, detail,
fix}`; the page shows the last check time.

**Request budget** (THIRD-PARTY-SERVICES.md): one full check is at most four
requests (`/healthz`, `/config` with the cache bypassed, `/stats/errors`, one
JSON probe only when the canary's result is older than 15 minutes), all
through the existing `searxng` token bucket. The result is cached; opening
the page never checks if the last check is under 5 minutes old; "Check again"
has a 60-second cooldown. No image probe: the images check reads `/config`.

## 5. Who sees it (rule 0)

Admins only (owner or admin role): the section, every route (403 otherwise)
and the engine lists. Children, teens and other adults never see engine
lists or raw errors; a child or teen keeps only the existing "Safe search
level" in Me, under SEARCH-SAFE-01's write rule.

## 6. The page and its kit parts

Settings > Household gains a "Web search" section (id `search`) beside
Integrations, and the `websearch` package's gear opens the same renderer
pointed at `lives_in: household.search` (SETTINGS.md rule 1). Order, top to
bottom:

1. Status card: `Card`, then `ItemGroup` of `Item` rows (`ItemMedia` icon,
   `ItemTitle`, `ItemDescription` with the fix, `ItemActions` holding a
   `Badge` pass, warn or fail), "Last checked 3 minutes ago" and a "Check
   again" `Button`. An `Alert` on top when any check fails.
2. Where search runs: the generic renderer for `search.searxng_url` (empty =
   "MaiPai's own search service"), `search.wikipedia_fallback` and the hosted
   key (THIN-4H) as declared.
3. Stack-owned mode: the generic renderer for the `stack.search.*` keys
   (Switches with their privacy help), locked rows for General web and
   Wikipedia, the "Changes waiting" card with `CodeDiff` (the vendored
   Element) for the preview, Apply `Button`, Undo behind an `AlertDialog`
   confirm.
4. Owner-run mode: the snippet as `InputGroup` + `InputGroupTextarea`
   (read-only) + `InputGroupButton` "Copy", one per file.

The status page keeps its one "Household web search" row (SEARCH-HEALTH-01,
`appNeeds.ts`); it gains a link to this section. No second health row.

**Reuse check** (principle 6): SearXNG has no admin API, so config means its
own file and its engine feature `use_default_settings` (an engine feature,
used as is). The file is written with the maintained `yaml` package, never
string-built. Every UI part is shipped: dashboard `Item`, `Badge`, `Alert`,
`Card`, `Switch` (through the generic renderer), `Button`, `AlertDialog`,
`InputGroup*`, and the `CodeDiff` Element. **Named gap, no new component:**
the kit has no standalone code block with Copy outside the chat runtime (the
Copy header inside `MarkdownText` is private to it and expects a message
part); the read-only `InputGroupTextarea` with an `InputGroupButton` is the
shipped composition shadcn documents for this, so it is used and no component
is written.

## 7. Spec, routes and tests

Spec (commons, first): `spec/search/searxng-engines.json` with its schema and
generated TypeScript: groups (id, label, plain description, needed_by,
default_on, locked, engines with name, operator, operator country,
safe-search expected, privacy flag) and the minimums in section 2. Both the
Stack (to write the file and its privacy rows) and Home (to check and to build
the snippet) import it. `keys.json`: `search.searxng_url` gets a new label and
help ("Your own SearXNG (optional). Leave empty to use the search service
MaiPai runs for you."), and the three `search.*` household keys move to
`lives_in: household.search`.

Home routes (admin only, `@hono/zod-openapi` since they are new):

- `GET /api/search/instance` returns `{mode, checkedAt, version, checks[],
  groups[], engineErrors[]}`; `?refresh=1` runs a fresh check under the
  cooldown.
- `GET /api/search/instance/snippet` returns `{settingsYml, limiterToml|null}`
  in owner mode, 404 in Stack mode.
- `GET /api/search/instance/preview`, `POST /api/search/instance/apply`,
  `POST /api/search/instance/revert` proxy the Stack's routes in Stack mode.

Tests (written first, seen failing):

- Home `searchInstanceCheck.test.ts`, fixtures in `tests/fixtures/searxng/`:
  **"an instance with JSON turned off fails the readable-results check and the
  snippet adds json to search.formats"** (403 fixture) and **"an instance
  with no picture engines fails the pictures check and the snippet enables
  wikicommons.images and brave.images"** (the two required regressions); an
  SSO page; a 429 with the limiter on; a stale version; `/stats/errors`
  absent reads as unknown; a household with a child and no safe image engine
  fails; a full check makes at most four requests through the shared bucket;
  the snippet never holds a `secret_key` value; examples use `192.0.2.x`.
- Home routes: child, teen and non-admin adult get 403.
- Home turn path (SEARXNG-SET-04): a teen's and a child's request never name
  `yandex` or `baidu` while they are enabled; an adult's request is unchanged.
- Stack: golden `settings.yml` per group combination; `keep_only` is the
  union; the secret survives an apply; a scripted failing restart restores
  the last good file; revert; privacy rows follow the groups; the pinned
  version's `/config` holds every catalog engine name.
- Frontend: the section renders pass, warn, fail and unknown; Copy; hidden
  for non-admins.

## 8. Acceptance

- Before and after screenshots by script against the seeded demo household
  and a local fake SearXNG (never a real one): before shows "JSON results are
  turned off" and "No picture engines are on" failing with the snippet;
  after shows every check passing. Each one opened and judged.
- Live, read-only: the page against the household's own instance shows its
  real version, limiter, engines and errors, with no write and no address in
  any log line or file.
- Stack mode, once STACK-SEARCH-01 lands: turning News off, previewing,
  applying and undoing on a scratch Stack restores search each time.

## 9. Rules

No rule change is needed. Rule 11 ends "Home checks it at save time and shows
its health like any other service": that is a floor this design keeps (the
save-time check is THIN-4G's) and goes beyond (on-demand checks and a config
snippet), which the rule does not forbid. Configuring the Stack-owned
instance through Stack settings keeps "the Stack installs, configures and
owns". Rule 7 holds (no keyed engine in the Stack's file; hosted key
untouched). Rule 0 holds and tightens (flagged engines never for a minor).
Rule 9 and S2 hold (kit parts only). Owner approval is not needed for any
rule.

## 10. Owner questions

1. When a child's or teen's safe search has no engines to use, should admins
   get a Repairs alert? **Yes, as a Repairs item (Recommended)**: an admin
   sees it on the Repairs page and in notifications. No: it shows only on the
   Web search page.
2. When MaiPai's own search service is ready, which should this household
   use? **Keep your own SearXNG (Recommended)**: nothing changes, MaiPai keeps
   checking it. Switch to MaiPai's: MaiPai runs and configures its own copy and
   your homelab one is no longer used.

## Order

SEARXNG-SET-01 (commons) first. Then SEARXNG-SET-03 (Home checker and routes;
useful today for the owner-run instance) and SEARXNG-SET-05 (UI) after it;
SEARXNG-SET-04 after 03. SEARXNG-SET-02 (Stack) after STACK-SEARCH-01's
service module. THIN-4G's save-time check calls SEARXNG-SET-03's checker.

## Paste-ready backlog entries

Commons `docs/BACKLOG.md`:

- [ ] **SEARXNG-SET-01: the SearXNG engine-group catalog in the spec** (S, 2026-10-06; design `docs/plans/searxng-settings-2026-10-06.md` in home). Objective: one definition of the engine groups both the Stack and Home read. Files: `spec/search/searxng-engines.json`, its schema, `gen/ts`, `spec/settings/keys.json` (`search.searxng_url` label and help; `search.*` household keys to `lives_in: household.search`), CHANGELOG, tag. Acceptance: groups General web and Wikipedia locked on; Images, News, Video on; Science off; Yandex and Baidu flagged and off; each engine names its operator and country; the minimums of section 2 are data; a fixture round-trips; no engine in the catalog needs a key. Out of scope: Stack and Home code. Exit: commons gate, new spec tag.

Stack `docs/BACKLOG.md`:

- [ ] **SEARXNG-SET-02 (M): the Stack configures its own SearXNG from the catalog** (2026-10-06; after STACK-SEARCH-01's service module and SEARXNG-SET-01). Objective: an admin chooses engine groups in Home and the Stack writes, restarts and verifies its own SearXNG. Files: `backend/src/settings.ts` (`stack.search.groups.{news,images,video,science}`, `stack.search.engines.{yandex,baidu}`, boolean, `needs_restart`), the search service module, `backend/src/lib/privacy.ts`, `backend/src/routes/v1.ts` (`GET /stack/v1/search/preview`, `POST /stack/v1/search/revert`), `docs/integrations.md`. Writes with the `yaml` package: `use_default_settings`, `keep_only` union, formats html and json, `safe_search: 2`, limiter off on loopback, secret kept. Acceptance: golden files per combination; a failing restart restores the last good file; revert works; privacy rows follow the groups; the pinned version's `/config` holds every catalog name and a `disabled` engine can be named per request (proves the UNVERIFIED fact). Out of scope: installing SearXNG (STACK-SEARCH-01). Exit: `bash scripts/check.sh`.

Home `docs/BACKLOG.md`:

- [ ] **SEARXNG-SET-03: one SearXNG checker and its admin routes** (M, 2026-10-06; after SEARXNG-SET-01; THIN-4G's save-time check calls it). Objective: Home checks any SearXNG (Stack-owned or the owner's) and tells an admin what is wrong and the one-line fix. Files: `backend/src/lib/searchInstanceCheck.ts` (new), `backend/src/routes/search.ts` (`GET /api/search/instance`, `/snippet`, `/preview`, `POST /apply`, `/revert`), `backend/src/lib/stack/client.ts`, `docs/dev/`. Acceptance: the checks of the design's section 4; at most four requests per check through the shared `searxng` bucket; 5-minute cache and 60-second "Check again" cooldown; snippet holds only failing keys and never a secret; routes 403 for child, teen and non-admin adult; regressions "JSON turned off" and "no picture engines" written first and seen failing. Out of scope: the turn path, UI. Exit: `bash scripts/check.sh`.
- [ ] **SEARXNG-SET-04: privacy-flagged engines never serve a child or teen** (S, 2026-10-06; rule 0; after SEARXNG-SET-03). Objective: while Yandex or Baidu is enabled on the active instance, a minor's request names its engines explicitly and never a flagged one. Files: `backend/src/lib/packageHost.ts` (`safesearchEnginesFor()`, `webRotationPool()`, `answerImageSearch()`), `backend/tests/packageHost.test.ts`. Acceptance: child and teen requests never name a flagged engine, whatever their level; adult requests unchanged; a failed `/config` read never blocks a search (SEARCH-SAFE-01's rule kept). Out of scope: the output gate. Exit: `bash scripts/check.sh`, review medium (a safety path).
- [ ] **SEARXNG-SET-05: Settings > Household > Web search** (M, 2026-10-06; after SEARXNG-SET-03; Stack controls appear once SEARXNG-SET-02 lands). Objective: admins see whether search is set up right and choose what to configure. Files: `frontend/src/next/pages/settings/NextHouseholdSettings.tsx` (a `search` section), a section file beside it, `frontend/src/lib/api.ts`, the status page row link, `docs/user/` search page, the privacy page. Parts: `Item`, `Badge`, `Alert`, `Card`, `Button`, `AlertDialog`, `InputGroup` with read-only `InputGroupTextarea` and Copy, `CodeDiff`, and the generic renderer for every key. Acceptance: before and after screenshots by script against the demo household and a local fake SearXNG, opened and judged; hidden for non-admins; no hand-built component. Out of scope: new kit components. Exit: `bash scripts/check.sh`.
