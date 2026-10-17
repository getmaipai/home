# Setup: voice and web search

Proposed 2026-10-17 after Jesse's live first run on the Mac Studio ("no voice setup? no search setup? ... think about where it
best belongs"). Not accepted until the architect rules and Jesse answers the one open question below. It narrows
[install-wizard-2026-10-13.md](install-wizard-2026-10-13.md) and adds no screen to the happy path.

## What exists today (from code, 2026-10-17)

| Piece | State |
|---|---|
| Voice models (speech to text `moonshine-tiny-en-int8`, `silero-vad`, speech out `pocket-tts-english`, wake word) | Done. `PLAN_ROLES` in `backend/src/setup/checks/setupDownloads.ts` lists `stt`, `tts` and `wakeword` for minimal, moderate and recommended, and the Stack's own plan wins when it has one. Voice needs no setup screen. |
| Microphone permission | Asked by the browser at first use (`frontend/src/lib/voice/mic-capture.ts`). It needs a click and a secure page, so it cannot be done in setup. |
| Web search, Stack-owned SearXNG | **Missing.** STACK-SEARCH-01 is in the Stack repo and not built (plan note, 2026-10-13). With `search.searxng_url` empty, `requireSearxngSettings()` in `backend/src/lib/packageHost.ts` throws, so a new household has no web search. |
| Web search, row 12 and "Use it" | Built. `searchRows` in `backend/src/setup/checks/checks.ts` probes loopback 8888 and 8080 and the plan page offers a found instance; it never writes the setting without the click (rule 11). The row is hidden on Checks (`CheckGrid.tsx`). |
| ddgs | Built as an adults-only second source (SEARCH-DDGS-01), but it needs a hand-run sidecar (`scripts/ddgs-sidecar`, `MAIPAI_DDGS_URL`). STACK-DDGS-01 (Stack supervises it) is open. It was off by default (ruling of 2026-10-11); Jesse ruled it ON by default for adults on 2026-10-17 (see Ruling). |
| Own SearXNG address field, Test | The checker exists (`checkSearchInstance`, `GET /api/search/instance`, `/apply`). The setup flow has no address field. |

## Decision

**Voice: no step, no page.** It is already in every plan's downloads. The only change is wording: the plan line names it
("Voice: talk to Home") so the person sees it is included; the microphone prompt stays at first use. Nothing else to
install or ask. Turning voice off belongs to SETUP-PLAN-CUSTOMIZE-01, not a new screen.

**Search: install by default, ask only on failure.**

1. *Default path, zero screens.* Every plan installs Home's own SearXNG through the Stack, as the plan note already says.
   This is feasible without Docker: the Stack already ships `uv`; SearXNG is a pinned release plus hash-locked Python
   packages, run as a Stack-supervised child bound to 127.0.0.1 under the Stack's existing launchd service. Size is not
   measured (UNVERIFIED, tens to a few hundred MB). The work is in the Stack repo (STACK-SEARCH-01), then one line in the
   plan's download list; Home cannot do it alone.
2. *Fallback: one conditional screen "Web search"* after Plan, shown only when the plan has installed and the search row is
   not green (Stack search absent or failed) and no instance was found on loopback. Content, in this order and nothing more:
   - Title "Turn on web search". Two sentences: "SearXNG is a search service you run yourself. It asks many search sites at
     once and keeps no record of who asked." (the value: private, no tracking, combined results).
   - One field "SearXNG address" and a Test button (the existing checker with `candidateBaseUrl`, never a second checker).
     A failed test shows the one-line fix the checker already words.
   - Buttons: "Use it" and "Skip for now". "Use it" extends the existing `POST /search/use-candidate` in `backend/src/routes/setup.ts` (no new route): the same no-people-yet guard and the same checker pass before saving. Its host test widens from loopback ports 8888 and 8080 to what a typed address may be: `http` or `https`, no credentials in the URL, and a host that is loopback, a private network address (10.x, 172.16 to 31.x, 192.168.x) or a `.local` name. Public hosts, link-local and metadata addresses (169.254.x) are refused with "Use a search service on your home network." A found-on-this-computer instance still goes through the same route.
   - Skip leaves Home answering from its offline library and the model's own knowledge (the existing degrade path). The
     fix later is Settings, Web search (SEARXNG-SET-05).
3. *Alternatives (ddgs).* On by default for adults when SearXNG could not be set up (ruling below). The screen says so in one
   line, and "Use it" and "Skip for now" both write `search.web_sources` as `["searxng", "ddgs"]`. Until STACK-DDGS-01 lands
   there is no helper, so DuckDuckGo stays unbuilt and answers nothing (`webSourcesFor` drops an unbuilt source); the
   privacy row shows only while the helper runs. An admin turns it off under Settings, Search.
4. *Ordering.* The fallback screen is useful now (it is exactly today's state) and disappears by itself once STACK-SEARCH-01
   makes row 12 green. Build it first.

**Verdict (principle 8):** voice is kept as is (already shipped, no feature added); web search is rebuilt as "installed by
the Stack, asked only on failure", replacing the one-line "Use it" on the plan page as the only setup contact with search.

## Rule check

- Rule 11 (RULES.md): the Stack installs and owns search by default, an owner's own SearXNG is one setting checked at save
  time. This design is that rule; no conflict. A found instance stays "offered, never used on its own".
- Rule 0: `search.web_sources` is an admin-only household setting. Setup does not run as an admin: the setup routes refuse once anyone exists (`people` has a row), and the fallback keeps that guard. No conflict. Children and
  teens remain SearXNG-only, so without SearXNG they have no web search even if ddgs is on for adults.
- Rule 6: no wording of the answer changes; the degrade path is unchanged.
- ddgs by default: this contradicted THIRD-PARTY-SERVICES.md ("off by default", ruling 2026-10-11). Jesse reversed it on
  2026-10-17 (see Ruling). It is not a RULES.md rule and RULES.md says nothing on ddgs. The age and surface gates are unchanged.
- Privacy (PRIVACY.md): the fallback adds no outbound connection; Test calls the address the person typed. The ddgs and
  SearXNG privacy rows exist; the Stack's install hosts need rows in the STACK-SEARCH-01 commit.

## Ruling (Jesse, 2026-10-17, in chat)

When SearXNG cannot be set up, the built-in DuckDuckGo source (ddgs, adults only) turns ON by default. This reverses the
2026-10-11 "off by default". Children, teens and guests stay SearXNG-only (age and surface gates outrank everything).
Recorded in THIRD-PARTY-SERVICES.md and PRIVACY.md (`.github/docs`). Owner-approved: 2026-10-17.

## Supersedes

- SETUP-SEARCH-01's plan-page "Use it" button (install-wizard note, `SetupWizard.tsx` plan case): when the fallback screen ships it replaces that button, since the screen offers a found instance first. Until then the button stays. The "Voice and vision" and "Web search" bullets of the Custom card in install-wizard-2026-10-13.md stay valid;
  this note adds the conditional fallback screen and the plan-line wording.

## Architect verdict

APPROVED with four amendments, applied above: (1) extend `POST /search/use-candidate` and state the allowed hosts;
(2) correct the rule 0 line; (3) list what the fallback replaces under Supersedes; (4) SETUP-SEARCH-03 depends on
SEARXNG-SET-02 and wires the existing `stackSearchState` hook. Ruled 2026-10-17 against RULES.md rules 0, 6, 9 and 11. The
ddgs-by-default question was answered by Jesse on 2026-10-17 (Ruling): on by default for adults.

## Investigation: could teens or children use ddgs? (2026-10-17, no change made)

Jesse asked why ddgs is adults only. Nothing in the code or gates changes until he approves.

**Why adults only: no safety reason was ever written down.** The first record is `.github` commit `00582f4`
("THIRD-PARTY-SERVICES: allow an optional ddgs sidecar", owner-approved 2026-10-11, "off by default, adults only, one fixed
browser identity, no rotation, no proxies"). `81fbf91b` (SEARCH-DDGS-01, 2026-10-12) built it as "adult-only", with three locks
(`ModeSource "ddgs"` closed for child and teen, guest filtered in `packageHost.ts`, `ddgsSearch` refuses a non-adult band).
The BACKLOG row says "adults only (child, teen and guest never reach it)" and `docs/dev.md` repeats it. The design file it
cites (`data-scratch/design/SEARCH-DDGS-01.md`) is not in the repo. No note mentions safe search, scraping or filtering as
the reason. The conservative default fits rule 0 (any doubt means no), but the reasoning was not recorded.

**Facts about ddgs (read from the library source on its main branch; the pinned 9.16.0 could not be run here, the Mac has
only Python 3.9):**
- The README lists `safesearch` as on, moderate, off (default moderate) for text, images, videos and news.
- For text search that value is mostly not applied. The DuckDuckGo text engine posts to `html.duckduckgo.com/html/` with only
  query, region and paging: `safesearch` is accepted and ignored (maintainer, issue #289: unstable and unused). Bing and
  Yandex text engines also ignore it (and are marked disabled). Brave sets a cookie; Mojeek sends `safe=1` only for "on".
  Only images use it reliably.
- The sidecar (`scripts/ddgs-sidecar/server.py`) calls `CLIENT.text(query, max_results=...)`: no safesearch argument and no
  backend choice, so the library's automatic engine mix runs. Strict is not asked for even today.
- DuckDuckGo itself does not guarantee blocking: its help page says some content can still get through. Strict works through
  `kp=1` or `safe.duckduckgo.com`, which this unofficial HTML client does not use.
- The library says "for educational purposes only", scrapes without an API contract, and is blocked or CAPTCHA'd from home
  addresses at times (`docs/dev/session-d.md` around line 1126: a cold request was bot-blocked on the first call).
  Rate limits and 429s are why the sidecar has quiet mode. This is the "behave as the user would" boundary in
  THIRD-PARTY-SERVICES.md; adults accepted that, a child's search is a worse place to lean on it.
- Sources: [DuckDuckGo SafeSearch help](https://duckduckgo.com/duckduckgo-help-pages/features/safe-search),
  [ddgs README](https://github.com/deedy5/ddgs), [ddgs issue 289](https://github.com/deedy5/ddgs/issues/289).

**How Home protects minors on SearXNG today:** a per-request `safesearch` of 2 for a child (strict) and the person's level
for a teen (`packageHost.ts`, `safeSearch.ts`), only engines that SearXNG's own `/config` marks safesearch-capable
(`safesearchEnginesFor`, `webRotationPool`), privacy-flagged engines (Yandex, Baidu) excluded (SEARXNG-SET-04), the adult-site
host list always applied, page text cleaned before the model sees it, and the output gate. The engine list is an instance
setting Home can read and check. With ddgs none of the first two exist: Home cannot see or set which engine answered or
whether a safe level took effect. Only the host list, page cleaning and output gate would remain.

**Live test: not run.** No Python 3.10+ on this Mac and no SearXNG reachable. The source reading above already shows the
text path does not send a safe level, so a leak test would only measure DuckDuckGo's default moderate filter. Run it on the
box (STACK-DDGS-01 time) if teens are ever reconsidered.

**Recommendation: keep ddgs adults only, for children and teens alike.** Reasons: the safe level is not sent on the text
path, Home cannot verify the engine, DuckDuckGo disclaims a guarantee, and rule 0 says any doubt means no. Teens without
SearXNG keep "Library only" plus the Wikipedia fallback the settings already offer; the setup screen should say so in one line.
Options, if Jesse wants teens later (all need his approval and an architect verdict, none for children):
1. Adults only (now). Cost: nothing.
2. Teens with a Home gate: needs ddgs images-style strict (`kp=1`) support in the sidecar or `safe.duckduckgo.com`, a
   backend pin to engines that honor safe search, a domain allowlist or a result classifier ahead of page fetch, an admin
   toggle per household (off by default), and a 15-query leak bench with zero unsafe hits. Risk: medium, unofficial scraper.
3. Never for minors, written as a rule in RULES.md (Jesse only).
Tracked as SEARCH-DDGS-TEEN-01 (open, no build).
