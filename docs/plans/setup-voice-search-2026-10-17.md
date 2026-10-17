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
| ddgs | Built as an adults-only second source (SEARCH-DDGS-01), but it needs a hand-run sidecar (`scripts/ddgs-sidecar`, `MAIPAI_DDGS_URL`). STACK-DDGS-01 (Stack supervises it) is open. It is off by default by the owner's ruling of 2026-10-11 (THIRD-PARTY-SERVICES.md). |
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
3. *Alternatives (ddgs).* Not switched on silently. See the open question. Until STACK-DDGS-01 lands there is no sidecar to
   enable, so the screen cannot offer ddgs honestly.
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
- **Conflict to name, not drop:** enabling ddgs by default contradicts THIRD-PARTY-SERVICES.md ("off by default, adults
  only", owner's ruling 2026-10-11). It is not a RULES.md rule, but only Jesse changes it.
- Privacy (PRIVACY.md): the fallback adds no outbound connection; Test calls the address the person typed. The ddgs and
  SearXNG privacy rows exist; the Stack's install hosts need rows in the STACK-SEARCH-01 commit.

## Open question for Jesse

Should ddgs (DuckDuckGo, adults only, through a Stack-run helper) switch on by default when SearXNG could not be set up,
or stay off until an admin turns it on?

## Supersedes

- SETUP-SEARCH-01's plan-page "Use it" button (install-wizard note, `SetupWizard.tsx` plan case): when the fallback screen ships it replaces that button, since the screen offers a found instance first. Until then the button stays. The "Voice and vision" and "Web search" bullets of the Custom card in install-wizard-2026-10-13.md stay valid;
  this note adds the conditional fallback screen and the plan-line wording.

## Architect verdict

APPROVED with four amendments, applied above: (1) extend `POST /search/use-candidate` and state the allowed hosts;
(2) correct the rule 0 line; (3) list what the fallback replaces under Supersedes; (4) SETUP-SEARCH-03 depends on
SEARXNG-SET-02 and wires the existing `stackSearchState` hook. Ruled 2026-10-17 against RULES.md rules 0, 6, 9 and 11. The
ddgs-by-default question stays open and is Jesse's alone.
