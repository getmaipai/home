# Session B: lane 9, the home screen and one search over everything (2026-09-13)

Work order from the coordinating session. Frontend and docs only;
Session A is in the chat engine and memory (4b, 4c, #99, #98, CHAT-15).
Same protocol as lane 8. Commit this file with item 1.

## 1. The home screen: reconcile the decision with what is built, then finish it (M)

BACKLOG.md "The home screen: keep the dashboard, make it a real home"
(UI / shell) carries Jesse's 2026-09-05 ruling and the recommendation:
a greeting with who is here, a row of today cards, a pinned-apps strip
driven by the sidebar's `pinnedIds`, one prompt box that is both
search and chat, personal data on the shared screen only once the
person is confirmed. Today's Home (`frontend/src/apps/home/`) already
has the greeting, the who-is-here strip, the Today cards, the packages
row, the favorites strip and an "Ask MaiPai anything" box.

Do: (1) write a short design note in `docs/dev/session-b.md` listing
each element of the recommendation as built, partly built, or missing,
by reading the page and its components, not the backlog prose; (2)
build the missing pieces that are frontend-only: the prompt box
becomes search and chat in one (typing shows matches from what exists
today through existing endpoints: apps by name, memories through the
memory search route, saved conversations by title; Enter with no match
selected sends the text to chat as it does now; a match selected
opens it), and the pinned strip reads the same `pinnedIds` the sidebar
uses (one definition); (3) the "confirmed person" rule: on a surface
where no one is signed in, Home shows household-level cards only (no
memories, no personal today cards); read what the shell knows about
the signed-in state and use it, no new backend. Acceptance: a
frontend test per promise (a typed query lists an app, a memory and a
conversation; Enter with nothing selected sends to chat; the strip
order follows `pinnedIds`; a signed-out surface shows no personal
card); the flow exercised live and the Home screenshots regenerated
and opened (desktop and phone); the BACKLOG item rewritten to what is
true, ticking the recommendation's built parts and leaving "skills as
home-screen widgets" (L) and voice or face confirmation as their own
items.

## 2. Unified search: the palette, over what exists (M)

BACKLOG.md "Unified search: one palette over everything", Jesse's
2026-09-05 ask. Build the palette (Cmd/Ctrl-K on desktop, the Search
entry on phone and TV) over the sources the frontend can reach today
without a new backend route: apps and settings pages (client-side),
memories (the memory search route), conversations (the list route),
people (the people route). One list, grouped, keyboard-navigable,
touch targets at the floor, the kit's own command palette primitive if
it has one (check `frontend/src/kit`) before building one. Write, in
`docs/dev/session-b.md`, the one backend route the full item needs
later (a fan-out `/api/search` over package content) as a named
Session A item with the response shape you would consume, so it can be
built without redesign. Acceptance: tests per source; live check;
screenshot of the open palette on desktop and phone opened; the
BACKLOG item's status line says what is searchable now and what waits
on the route.

## Out of scope

Anything under `backend/`; the fan-out search route (named for
Session A); widgets (L); voice or face confirmation of the person.
