# Search palette: one modern, complete Cmd+K (2026-10-29)

Why this exists: the owner called the header search "ugly, not modern" and said it "doesn't incorporate everything".
Opened on the dev hub, the empty state is four sidebar links in a large empty box, and a query finds only the kinds
`GET /api/search` serves. This note is the design the rows below build on. It builds on
[shell-search-2026-09-23.md](shell-search-2026-09-23.md): one global search, the same on every page; an app's own in-page
search stays that app's.

## Supersedes

- shell-search-2026-09-23: "ranking beyond cmdk's ordering" is out of scope there; this note adds one server-side ranking
  (decision 3). Its "`value` set to the title so cmdk's ordering still applies" ends with the move to the shipped
  command-palette Element (decision 5).
- The lane-9 client-side provider set (`frontend/src/shell/search/providers.ts`, `useSearchCommand.ts`) and its "last token
  prefix-matched" behaviour. The server's word-prefix score (decision 3) replaces it.
- SEARCH-MODAL-SIZE-02 (BACKLOG): its recent-chats empty state is folded into decision 5 and the row closes with SEARCH-MODERN-04.
- Backlog row "Unified search: one palette over everything" is closed by SEARCH-MODERN-01 to 04 for the kinds listed in
  decision 2; package providers, web fall-through and intents stay with that row's remainder and PALETTE-INTENTS-01
  (which builds on this palette and on its command results).

Unchanged: RULES.md in full (nothing here loosens a child or teen protection; every new kind reads through the gate its own
page already applies), the settings result placement (`placeSetting`), the conversation FTS index (SHELL-SEARCH-03).

## What exists today (measured 2026-10-29)

- **Route.** `GET /api/search`: conversations (title plus message text through `conversation_turns_fts`), people, settings,
  apps, media. Substring match, cap 8 per kind, no ranking across kinds.
- **A second copy.** The client-side provider set runs its own matching, including memories and commands the route lacks.
  Two definitions of "what search finds" is wrong (principle 1).
- **Two kit dialogs.** `HeaderSearch` (header icon and Cmd+K) and `search/CommandPalette` (SearchPage and Home's prompt
  box, with an Ask row). The kit also ships the `command-palette` Element (`src/elements/command-palette.tsx`: icon, subtitle,
  group, key hints, "lg" size).

## Decisions

1. **One definition, on the server.** Every findable kind is a provider in `lib/search/providers.ts`; the client set is deleted.
2. **Kinds.** Built in this slice, each reading through the owning page's own visibility function so a child or teen never
   finds more than that page shows: `memory` (`list(actor)`, plain memories only), `alarm` (own alarms), `companion`
   (`listCompanionCards`, the age-band filter), `command` (owner or admin, as `GET /api/commands`). `news` is a later row and
   must read through the shelf's one release path (`releaseShelfItems`: band_ok, the minor floor re-run, Kids' lists for a
   child), never a direct read of stored titles.
3. **Ranking (reuse check).** FTS5's `bm25()` and `highlight()` already rank message text and stay with that provider. The
   other kinds are short titles from separate stores, so FTS5 does not apply, and a search library (MiniSearch, Fuse.js,
   uFuzzy) would add a dependency to rank a few dozen titles per request. One tiered score is used instead (exact title,
   title prefix, word prefix, substring, other field), about 15 lines, no tokenizer, plus the title `match` range for
   highlighting. Typo tolerance is a later row; if it is wanted, uFuzzy replaces the score then.
4. **Wire (additive).** `SearchResult` gains optional `match: [start, end]`. Old clients ignore it.
5. **The look (commons, rule 9).** The one dialog that survives is `HeaderSearch`, rendered with the shipped `command-palette`
   Element as it ships: server results map to `PaletteCommand` (group, label, subtitle, icon); the empty query shows recent
   chats (folds SEARCH-MODAL-SIZE-02). A prop the Element lacks (accept pre-ranked results without its own label filter,
   highlight range, a footer Ask row) is added in `commons` first, never a Home wrapper or `className`. No hand-built chips
   or shimmer. `search/CommandPalette` is retired once SearchPage and Home's prompt box read the same component.
6. **Recents.** The empty query lists the person's recent chats only, from the server's own conversation list (no new
   local store), so a child gets no recents beyond their own chats and a shared browser keeps nothing per query.
7. **"Ask" row.** It opens chat with the typed text as an ordinary message. It never turns on the composer's search control
   (RULES.md rule 1, the explicit-search path).
8. **Release.** The commons change is its own worktree and a `ui-v0.5.x` tag; Home pins it after. Only Jesse says yes to the
   tag (PINNING.md).

## Rows

- SEARCH-MODERN-01 (built, tests beside the change): server providers `memory`, `alarm`, `companion`, `command`.
- SEARCH-MODERN-02 (built): tiered ranking and `match` on the wire.
- SEARCH-MODERN-03: delete the client-side provider set; `useSearchCommand` and Home's prompt box read `api.search`.
- SEARCH-MODERN-04 (commons): `HeaderSearch` on the `command-palette` Element, recents, Ask row; Home pin bump after the tag.
- SEARCH-MODERN-05: `news` provider through the shelf release path.

## Out of scope

Typo and semantic search; another person's private chats; an app's own in-page search; web search (the turn engine's).
