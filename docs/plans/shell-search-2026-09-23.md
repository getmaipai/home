# Global search: conversations, people, apps and settings in the header's one dialog (2026-09-23)

Why this exists: SHELL-SEARCH-01 landed the one global search (the header
icon and Cmd+K opening the kit's `CommandDialog` over the sidebar's own
items) and left "threads, apps and people join the results as later rows"
as the named gap (dev.md "SHELL-SEARCH-01"). The owner's rulings stand:
one global search, the same on every page; an app's own in-page search is
that app's and is never merged into it. This note is the design those
later rows build on, so the item is pickup-ready without inventing an
architecture while typing.

## The shape

**One typed route, one provider contract, one dialog.**

- **The route.** `GET /api/search?q=<text>` in `backend/src/routes/search.ts`,
  declared with `createRoute` and Zod the way `routes/approvals.ts` is, so
  it lands in `/api/docs`. It answers for the signed-in actor only and
  returns `{ groups: SearchGroup[] }` where `SearchGroup = { kind, heading,
  results: SearchResult[] }` and `SearchResult = { kind, id, title,
  subtitle?, href }`, `kind` one of `conversation | person | app | setting`.
  Results are pointers into pages Home already has (`href` is the page the
  Enter key opens), never the records themselves, so the wire carries no
  shape the spec already declares and nothing a child must not see. The
  Go client renders the same route later; the shape is additive from day
  one (org rule, Compatibility).
- **The provider contract.** `backend/src/lib/search/providers.ts` declares
  `SearchProvider = { kind, search(query, actor): Promise<SearchResult[]> }`
  and one registry array. Four providers in this slice, each a thin query
  over the store that domain already owns: conversations by title for the
  actor (temporary chats never appear; a conversation is the actor's own or
  shared with them by the existing rules), people by display name through
  the disclosure filter the memory and people pages already apply (a child
  actor sees the household the way those pages show it, no more), apps by
  their manifest name from the package host, settings by the registry's own
  labels (SETTINGS.md: one definition; the route reads the declaration, it
  does not keep a second list). A provider that throws is dropped from that
  response with a warning in the log, never a failed request.
- **Matching.** Prefix and substring on the title field, case-insensitive,
  in SQL for the stored kinds and in memory for apps and settings, capped at
  eight results per kind. Full text over message bodies is a later row
  (SHELL-SEARCH-03: SQLite FTS5, the engine's own prebuilt full-text index,
  never a hand-rolled tokenizer), not this one.
- **The dialog.** The kit's `HeaderSearch.tsx` gains one optional prop,
  `remote?: (query: string) => Promise<SearchGroup[]>`, and renders the
  groups it returns below the sidebar sections as `CommandGroup` and
  `CommandItem`, the shipped parts, nothing hand-built (no hand-built UI,
  owner's rule 2026-09-21). The local sidebar section keeps cmdk's own
  filtering; the remote groups arrive already filtered and are rendered with
  the same items, `value` set to the title so cmdk's ordering still applies.
  The query runs after two characters, debounced at 200 ms, with the last
  response kept while the next is in flight so the list never blinks empty.
  Home supplies the `remote` prop from a fetch of the route in its own
  header wiring; the kit never knows the route. The kit change is a
  `ui-v0.5.x` tag and a pin bump, the pattern SHELL-SEARCH-01 used.

## What a person sees

Typing "peo" still narrows to the People page under "Household" and now
also lists the household's people under "People", each opening that
person's profile. Typing a word from a conversation's title lists it
under "Conversations" and opens it. Typing an app's name lists it under
"Apps". Typing "theme" lists the appearance setting under "Settings" and
opens Settings on that section. A child signed in sees no conversation
that is not theirs and no person the people page would not show them.

## Acceptance (the item's exit)

- The route in `/api/docs`; a regression test per provider in the backend
  suite in the words above, including the child-actor case for
  conversations and people and the temporary-chat exclusion.
- The kit prop with a test that renders remote groups as command items.
- Live on 8787 at 1440 and 390: the four groups appear for a seeded demo
  household (persona roster names only), Enter opens the right page,
  captures opened and judged as one design (mobile is the same design).
- Review medium: it adds a route and reads people data through a
  disclosure rule.

## Out of scope

Message-body search (SHELL-SEARCH-03), search inside an app's own page,
ranking beyond cmdk's ordering, and any spec record: the results are
pointers, and the spec gains a shape only if a client needs to store one.
