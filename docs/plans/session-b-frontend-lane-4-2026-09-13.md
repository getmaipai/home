# Session B: lane 4 (2026-09-13)

Work order from the coordinating session. Same rules as lane 3
(`session-b-frontend-lane-3-2026-09-12.md`), plus the shared-checkout
protocol now in force: Session A is on `main` in the same checkout
(backend: `turnEngine.ts`, `episodes.ts`, `guards.ts`, the benches);
gate every commit on your own diff applied to a throwaway worktree of
`main`, commit by name in the shared checkout, `git add -p` on
`docs/dev.md` and `docs/BACKLOG.md`, remove the worktree. Ownership
this lane: `frontend/**`, `scripts/screenshot.ts`, `scripts/check.sh`
(item 1 only), `docs/user/**`, `docs/assets/**`, and for item 3 the
spec and backend files it names. Live checks use your own backend on a
spare port with a temp data directory (as you did for Memory), never
the 8787 backend. Report to `getmaipai-c0` on ready, done, blocked,
question, low context. Commit this file with item 1.

## 1. getmaipai/home#55: wire `bun run a11y` back into `check.sh` (S)

The gate was left out while #43 (the chat contrast failure) was open;
#43 closed 2026-09-06 and the timestamp finding was resolved tonight
(11e8afd). Confirm `bun run a11y` passes clean now, then add it back to
`check.sh`'s frontend block where the old comment said it sat (after
the build step, before the reading-level lint). Since `check.sh` is
shared with Session A, this is the one item where a wholesale stage of
that file is fine (it is one hunk, yours). Acceptance: `check.sh` runs
the a11y scan and passes; time the added cost and record it in dev.md;
if it exceeds two minutes on its own, say so and keep the gate anyway
(the org rule is correctness over speed here). Close the issue.

## 2. A real PWA (S-M)

BACKLOG.md "A real PWA" (UI / shell). Today: manifest only, no
service worker, no offline page, one oversized icon. Build, in this
order, each a commit if you prefer: (a) icons at the sizes the
manifest standard names, generated from `brand/` in the org repo
(never redrawn), plus a maskable variant; (b) a service worker with
the rules the item lists from legacy's `sw.js` v5: navigations
network-first with an offline page, full passthrough on Firefox
(local network access), reload exactly once on `controllerchange`;
(c) `lazyRetry` for a stale chunk after an update (once per session)
and a React error boundary with a plain-English recovery screen.
Prefer a maintained library (the Vite PWA plugin) over a hand-written
worker if it can express those three rules; say which you chose and
why. Acceptance: Lighthouse's PWA installability checks pass against
the built frontend served by your spare-port backend (record the
report's numbers); airplane-mode reload shows the offline page; a
simulated update reloads once, not in a loop; the error boundary
renders on a thrown render error in a test. The privacy page needs no
change (nothing new leaves the house), state that in dev.md. Tick the
item.

## 3. getmaipai/home#60: an edited message survives a history reload (M)

Now unblocked: Track A merged and Session A is not in these files.
Correction (coordinator ruling, 2026-09-13): this item's own text
originally said "spec first" - a real conversation THREAD is spec-
shaped (spec/schemas/conversation.schema.json, since it syncs), but an
individual TURN (conversation_turns) is deliberately NOT
(conversationHistory.ts's own header comment: a raw utterance log
never syncs and stays hub-internal). `supersedes` describes an edit
branch within that same hub-internal log, so it is a backend-only
nullable column with a migration, no spec schema, no fixture, no
regenerated bindings. Read the turn row in `backend/src/db/schema.ts`
directly, not the conversation spec. `POST /api/turn` and `/api/turn/
stream` accept `supersedes`, the history route returns it, and
`chatHistoryAdapter.ts` rebuilds the branch so an edited message shows
the edit as the active branch with the original as its sibling. Files:
`backend/src/db/schema.ts` and a generated migration,
`backend/src/lib/turnEngine.ts` (an additive passthrough option on
`runTurn()`/`runTurnStream()`'s own opts, threaded to `logTurn()` -
Session A's file, mid-ROUTE-01 there: tell it before you edit),
`backend/src/lib/conversationHistory.ts` (Session A's file: tell it
before you edit and keep the change additive), `backend/src/routes/
turn.ts` (also Session A's: same), `frontend/src/apps/chat/
chatHistoryAdapter.ts`, `chatModelAdapter.ts`. Acceptance: reproduce
the bug in the browser first and record exactly when the message
vanishes; after the fix, edit plus Update, reload, and the edited
message is still there with the branch switcher showing two versions;
a backend test for the supersedes round trip; a frontend test for the
rebuilt branch. Close the issue.

## Out of scope

Anything in Session A's lane (#79, #78, CHAT-22, ROUTE-01), the
screenshot matrix pipeline item, #75.
