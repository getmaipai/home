# Session D: packages, the store, the catalog

Work order: `docs/plans/session-d-packages-and-store.md`. Rules and
ownership: `docs/plans/wave-2.md`. One `## Step N:` section per shipped
step, in order.

## Step 0: setup and verdicts

Worktree `../home-d`, branch `session-d-packages-and-store`, data dir
`data-d`, port 8802. `bun install` and `scripts/check.sh` both green on
branch-off from `main` (f4056a7).

**A note on sequencing.** `wave-2.md` says D may start once Session A has
merged to `main`. At the time this worktree was cut, A had not merged
(steps 11-12 of `session-a-intelligence.md` still open in its own
worktree). Checked before proceeding: D's owned paths
(`backend/packages/**` except `remember`/`recall`, the `lib`/`routes`
files in the ownership map, `spec/interpreters`, `spec/emulators`,
`spec/vocab`) do not overlap any file A's diff touches. The one shared
file both sessions edit is `spec/schemas/manifest.schema.json`, and A's
change there (a new top-level `companion` object) is purely additive,
sitting beside where D's step 2 additions land - the exact "additive
only, rebase first" shape the shared-file protocol already accounts for.
Proceeding now, and rebasing onto `main` (picking up A's merge when it
lands) before every commit per the standing rule, rather than blocking
on a merge that touches nothing D owns.

**Scope of this review queue.** `docs/BACKLOG.md`'s "Legacy: copy,
re-examine, record" section lists one giant verdict queue spanning every
session's territory (media apps, the Electron desktop, bot firmware, DNS
filtering, and so on, alongside the ~35 orphaned chat tools). Verdicting
UI, platform, and hardware items outside this session's expertise and
file ownership would be the design-resolver's job or another session's,
not a rubber stamp from here. This section verdicts only what maps to
D's lane: legacy chat tools and hub features that are packages, package
categories, or store/catalog-shaped. Everything else in that queue is
left for the session that owns the matching files (E for UI/apps, F for
platform/hardware/desktop, C for voice/bot); noted below by name so nothing
silently falls through, not re-verdicted.

### Verdicts: legacy chat tools -> Wave 2 packages

One line each, per principle 8. "Rebuild" means the package below
reimplements the same user-facing capability from scratch (Tier 0 recipe
or Tier 1 code), never legacy's own code. "Redesign" means several
legacy tools become one differently-shaped package. "Drop" means no
package this wave, with the reason. Source: `legacy-backups/home-legacy.git`
`backend/src/tools/` (read-only, for verdicts and hard-won-logic pointers
only, never for scope - org rule).

| Legacy tool(s) | Verdict | Reason |
|---|---|---|
| `search.ts` | **Rebuild** | Web search, step 7. Legacy's own scraper ladder (`webSearch.ts`) is the counterexample the org's "we are the user" rule names by file; the new package goes through SearXNG as a sidecar, never keyless scraping. |
| `unit_conversion.ts` | **Rebuild** | Unit/currency conversion, step 7, as a `compute` step (mathjs) plus frankfurter.app for live rates - the unit table itself is worth reusing as reference, the fetch-a-scraped-page shape is not. |
| `calculator.ts` | **Rebuild** | Math, step 7, as a `compute` step over a restricted `mathjs` evaluator - a maintained library replaces the hand-rolled parser (org principle 6). |
| `news.ts` | **Rebuild** | News headlines, step 7, RSS from a household-chosen list, cached and warmed. Legacy's Google News RSS + category map is a reasonable reference for the RSS-parsing shape; no keyed API, per the plan. |
| `localNews.ts` | **Drop** | Depends on a US "Patch" hyperlocal slug resolver with no equivalent data source decided; folding a location-specific feed into the plain `news` package needs a design decision (a location setting, a source with global coverage) not made this wave. Filed as a backlog gap for the household-location work, not built. |
| `sports.ts` | **Rebuild** | Sports scores, step 7, a free key-free scoreboard API or RSS (the plan defers the exact source to the build step); legacy's league-keyword matching is worth reusing as reference. |
| `musicInsights.ts` | **Drop** | Answers questions about *the household's own local listening history* (`music_history` table) - a different feature from step 7's music/media metadata lookup, and depends on a listening-history feature this wave doesn't build. Not the same package; no verdict needed until listening history exists. |
| `videoAbout.ts`, `onTv.ts`, `showtimes.ts`, `whereToWatch.ts`, `tvshows.ts` | **Drop** | Priority 3 (control/playback-adjacent media) by the backlog's own lookup-before-control rule; blocked on the media player runtime (plan 4.8, Hub v0.2) this wave doesn't touch. `music_and_media` (step 7) covers only the metadata-lookup half (MusicBrainz/TMDB-style), explicitly never playback. |
| `datetime.ts`, `holidays.ts`, `moonphase.ts`, `onThisDay.ts` | **Redesign** | Merge into one `almanac` package (step 7's own name for this: "legacy had five tools for this"). `time.ts`'s date-parsing half (`chrono-node`) is genuinely reusable hard-won logic; its alarm/timer-row half moves to `lists` below instead, since alarms need no separate app surface here, just `host.schedule`. |
| `time.ts` | **Redesign** | Split: natural-language time parsing feeds `almanac`'s date/time answers; the alarm/timer *creation* half is superseded by `lists`' reminders/timers (step 8), which uses `host.schedule` directly rather than a dedicated `clock_timer_runs` table - no live-countdown UI exists in this wave to poll one. |
| `shopping.ts` | **Redesign** | Legacy's version is price-tracking (a URL, tracked listings, price drops) - a different feature from step 8's household shopping list. Step 8's `lists` package is the rebuild target for "add milk to the shopping list"; legacy's price-tracking shape is dropped (no design decision on a price-tracking data source this wave). |
| `homeAssistant.ts` | **Rebuild** | Already partially shipped in Wave 1 (`packageHost.ts`'s `home.call_service`, the security-domain gate, `lib/commands.ts`). Step 9's `lights` package is the first real recipe-driven consumer. Legacy's own NLP-against-a-live-catalog approach is superseded entirely by the manifest/permission model; nothing of its code carries over. |
| `knowledge.ts` | **Rebuild** | The Tier 1 knowledge-lookup package, step 5's proving package for the Deno sandbox: offline Wikipedia via a local Kiwix ZIM when present, web search otherwise. Legacy's ZIM-search-then-web-fallback order is the one piece of hard-won logic worth carrying the *shape* of, not the code (new host, new sandbox, new RPC). |
| `fetchUrl.ts` | **Drop** | Superseded by `host.fetch` as a general capability every package already has; a dedicated "open this link" package adds nothing `host.fetch` plus a `format` step doesn't already cover once a package wants it. No standalone package. |
| `maps.ts` | **Drop** | Not in step 7's package list; needs a decision on an offline map/routing data source (GraphHopper regions, MapLibre tiles) this wave doesn't make. Filed as a backlog gap, not built. |
| `localEvents.ts` | **Drop** | Same hyperlocal-data-source gap as `localNews.ts`; no verdict until a location/local-data decision is made. |
| `peopleLookup.ts`, `propertyLookup.ts` | **Drop** | Reverse-lookup of *other people's* address/phone/property records has no articulated family use case in the platform plan or backlog, and sits uneasily against the product's own privacy promise (a private family hub looking up strangers). Not built; flagged for Jesse if the feature is actually wanted, rather than built on assumption. |
| `medical.ts` | **Drop** | Liability-sensitive (medical reference/advice) with no design review of disclaimers or scope; same posture as image/video generation's "needs real design attention before any code." Not built this wave. |
| `recipes.ts` (meal database) | **Drop** | Not in the backlog's Priority 1/2 lists; no household ask recorded for it. Left for a future wave if requested. |
| `homeInventory.ts` | **Drop** | Not in step 7-9 scope; no spec record type exists for tracked household items and no ask recorded. Future wave. |
| `confirmPending.ts` | **Not D** | Runtime confirmation of a consequential action is the turn engine's job (backlog: "Consequential packages need a confirmation at run time", owned by C). D's part is already done: `consequential: true` plus the security-domain gate in `packageHost.ts`. |
| `createRoutine.ts` | **Drop, superseded** | The `command` primitive (`lib/commands.ts`, shipped Wave 1) already covers "when I say X, do Y" with a lighter authoring path than a legacy routine ever had. |
| `recallConversations.ts`, `memory.ts` (tool) | **Not D** | Superseded by C's real memory/conversation system (`lib/memory.ts`, `lib/conversationHistory.ts`), already shipped. |
| `narrate.ts` | **Not D** | Superseded by the `storytime-style` skill (already bundled, `kind: "skill"`) plus the persona/TTS system - C and E's territory, not a plugin. |
| `playMusic.ts`, `curatePlaylist.ts`, `plex.ts`, `youtube.ts`, `requestMedia.ts` | **Drop** | Priority 3 playback control, explicitly deferred by the backlog's own rule until the Priority-1 lookups and the media player runtime exist. Not this wave. |
| `imageGen.ts`, `videoGen.ts` | **Not D** | Generation features; the org's non-removable child-safety invariants mean these need dedicated design attention before any code (backlog: "deliberately not started"). Not a packages-lane question. |
| `calendar.ts` | **Not D (needs a decision)** | Local-only vs. real CalDAV/OAuth is an open design question per the backlog; belongs with whichever session picks it up after a `design-resolver` pass, not built speculatively here. |
| `documentEdit.ts`, `canvas.ts`, `coding.ts` | **Drop** | Advanced tool-calling / Tier 2 territory (backlog: "explicitly NOT an open agentic loop by design"), sequenced behind `embed`-based routing and more real Tier 0/1 skills. Not this wave. |
| `bookmarksLibrary.ts`, `saveToBookmarks.ts` | **Drop** | Needs a bookmarks library/reader app surface (E's domain) this wave doesn't build; a bare "save a link" package with nowhere to view it back is not a complete feature. Future wave, paired with the app. |
| `displayAlert.ts`, `setStatus.ts`, `sleep.ts`, `machineStatus.ts`, `serviceStatus.ts`, `downloadStatus.ts`, `dockFiles.ts` | **Not D** | Platform health/status/robot-state surfaces - F's (`health`, `repairs`) or C's (bot sleep state) lane, not packages. |

### Verdicts: legacy hub features outside D's lane (named, not re-verdicted here)

Per the scope note above, these stay with the session that owns the
files: MaiPai TV linear channels, Music Studio/karaoke/stems, Podcasts,
Books/readers/OPDS/KOSync, Reference (Kiwix ZIM as an *app*, distinct
from the `knowledge` package's own ZIM use above), Remote (SSH/VNC/RDP),
Notes and voice memos, Photo Frame, Cameras (Frigate), Drop (file
relay), File Converter, Spotlight search, Writing Tools, Watch/Listen
Together, Cast, in-app docs, the Display/HUD pod pages, the DNS filter,
family audio guardrails, storage locations, monitoring, uninstall,
consent records, remote engine pairing, SABnzbd/aria2, ESPHome flashing,
the Electron desktop, Atom Echo/Tab5 firmware, the tvOS Top Shelf
endpoint, Speed Test, "MCP in" (the hub acting as an MCP *server* to an
external client such as Claude Desktop - distinct from step 5's "MCP
out," the hub as MCP *client* to its own Tier 1 packages, which is this
session's to build).

### What step 7-9 build (the "rebuild"/"redesign" verdicts above, concretely)

- `almanac` (redesign, merges `datetime`/`holidays`/`moonphase`/`onThisDay`)
- `web_search` (rebuild, via SearXNG sidecar)
- `convert` (rebuild, compute step)
- `math` (rebuild, compute step)
- `news` (rebuild, RSS)
- `sports` (rebuild)
- `translate` (new; no legacy tool of this name existed)
- `music_media_lookup` (new shape; legacy's closest tools were playback-
  adjacent and dropped above)
- `lists` (redesign, reminders/timers/shopping-and-todo, replacing
  legacy's price-tracking `shopping.ts` and the alarm-creation half of
  `time.ts`)
- `lights` (rebuild, first real `home.call_service` consumer)
- `knowledge` (rebuild, Tier 1, the Deno/MCP sandbox's proving package)

Package ids above are working names, set for real at scaffold time in
each step's own section below.
