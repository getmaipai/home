# Session E: the UI, the wizard, and the user docs (frontend and the UI schema)

A self-contained work order. Read `wave-2.md` first (rules, ownership,
shared-file protocol, contracts), then this file, then code until every
step is merged. Written 2026-09-06.

Jesse's standing instruction from Wave 1 still holds: frameworks, not
hand-carved React. Session B put the kit on shadcn/ui, the shell on the
library sidebar, chat on assistant-ui, data on TanStack Query, and pages
on the `UiNode` renderer. You extend that; you never build beside it.

## Read first

1. `getmaipai/.github/CLAUDE.md`, and `docs/UI.md`, `docs/SETTINGS.md`,
   `docs/ENGINEERING.md`, `docs/STYLE.md`, `docs/UPDATES.md`,
   `docs/NOTIFICATIONS.md` there.
2. `docs/plans/wave-2.md`, all of it, especially every contract (you
   are the consumer of three of them).
3. `docs/plans/session-b-ui.md` and `docs/dev.md`'s `## Session B:`
   sections: what exists, what B recorded as still open (the text-floor
   sweep, Textarea, Tabs, Chip, the PWA and screenshot matrix if B's
   steps 8 and 9 did not land, the TV rule for package pages).
4. `docs/BACKLOG.md`: "UI / shell", "Settings", "Chat, memory and
   persona" (the "Memory in the chat UI" item), "People, relationships
   and permissions", "Cross-cutting", and "Wave 2 additions".
5. Platform plan 6, 12, and 2.3 (read only); the 2026-08-25 navigation
   note at the org root.
6. `frontend/src/{shell,kit,apps}/**`, `spec/ui/README.md`,
   `spec/ui/schema.json`, `spec/ui/pages/*.json`, `scripts/screenshot.ts`.

## The goal

At the end of this session a family can set the hub up, find every
capability the other three sessions built, and a parent can see and
set what a child can do, all from screens rendered from data. Concretely:

- First run is a wizard, not a form: household, owner, the AI-outputs
  disclaimer and the one-time adult acknowledgment, hardware and the
  model set, trust this hub, packages, remote access, the emergency kit,
  a backup target, restore as the second screen.
- Home shows who is here, today's cards from package widgets, pinned
  apps, and the one prompt box.
- The store page installs a package with a permission prompt; Health,
  Repairs, Updates and Storage exist; a parent's controls page shows a
  child's grants, ceilings, time allowances and approvals.
- Push-to-talk works in the composer against C's socket.
- Every page renders at phone, tablet, desktop and far, light and dark,
  in a screenshot matrix that fails on an accessibility violation.
- A `docs/user/` page exists for every screen, written for a dad.

## Files you own

See `wave-2.md`, "Ownership map", session E. You do not touch
`backend/` other than `settings/uiKeys.ts`, nor `spec/` other than
`spec/ui/`. A backend need goes into your dev file and the backlog; you
build against the contract with a mock until the route lands.

## Steps, in order

### Step 0: setup and B's leftovers (S-M)

Worktree `../home-e`, branch `session-e-ui-and-docs`, `data-e`, port
8803 for your backend, `bun install`, `scripts/check.sh` green. Then
whatever B's wrap-up left: the PWA (`vite-plugin-pwa`, offline page,
reload-once rule, stale-chunk retry, boot watchdog capped at three) if
step 8 did not land; the screenshot matrix with `@axe-core/playwright`
if step 9 did not; the 16 px type-floor sweep (the bell badge and thread
timestamps); `Textarea`, `Tabs` with a URL-bound tab, and a `Chip` in the
kit; a shared PIN-entry hook lifted from `SignIn.tsx` and
`ProfileSwitcher.tsx`.

### Step 1: the first-run wizard (M)

`/setup`, shell-less, rendered from `spec/ui/pages/setup.json` with a
`wizard` node (steps, progress rail, back always works), driving F's
`GET /api/setup/state` and `POST /api/setup/:step` (mocked until F's
step lands; the step list is in the contract). Steps in plan 12's order:
language and locale, time zone, household name; the owner's profile
with a passkey (F's WebAuthn routes) or a password; the AI-outputs
disclaimer and, for the owner as an adult, the one-time unrestricted
acknowledgment (one dialog, plain words, never repeated); hardware
detection and the model set that fits, with the first download's size
and time; "trust this hub" (install the household CA, with a QR for
other devices); the default package set, switchable; Tailscale as an
optional step; the emergency kit shown once with "print this"; a backup
target; done, with "what to try". The second screen is always "restore
from a backup". A family member's join flow: a QR from the admin's
screen carrying the address and the CA, the profile picker, PIN or
passkey. A kid profile: birthdate in, band out, presets shown to the
parent with exactly what they will see of the child's activity. A guest
profile with an expiry.

Tests: step order, back, resume mid-wizard, restore branch, the
acknowledgment shown once. Acceptance: a fresh `data-e` walked end to
end at phone and desktop, screenshots looked at.

### Step 2: Home with real cards, and the app kind's first page (M)

- Widgets from D's contract: a `widget_card` and `widget_row` node,
  rendered from `GET /api/widgets` and the data route, refreshed by the
  query layer at `refresh_s`, household-level cards until the person is
  confirmed (the profile switcher's PIN counts); the card-size slider
  (one CSS variable every grid consumes, 180 to 560 px, per app per
  device, the Photos and Plex toolbar-zoom pattern) as a kit control.
- `contributes.pages` from a package feeds the nav registry; the first
  package page (D's `lists`) renders from its schema JSON through the
  same renderer, proving the `app` kind is data and reaches Go later.
  Record the decision that closes the backlog's "re-decision needed on
  the `app` item" (pages are schema data; custom React only as a
  `platforms: [web]` escape hatch that no default package uses).
- Lists and the running timer as their own pages and as a card.

### Step 3: the store, Health, Repairs, Updates, Storage (M)

Schema pages over the contracts: the store (browse, search, the card
with README, permissions, privacy rows, community honesty text, install
with the two-call permission prompt, channel, rollback, uninstall);
Health (sections from `GET /api/health`); Repairs (severity, fix
action, dismiss, learn more); Updates (grouped by kind, Update all,
per-row install, hold, rollback, a sidebar badge); Storage (layout,
sizes, quotas, targets, the per-package cache rows). Each has an
`EmptyState` that says what a healthy hub looks like, not a blank.

### Step 4: push-to-talk (M)

The composer's microphone button over C's `WS /api/stt/stream`: the
browser captures 16 kHz PCM (reuse `mic-capture.ts`), the VAD state from
the server drives the button, partials show in the composer, the final
sends. The wake-word toggle stays; a "demo only" banner is reworded for
a family. Hands-free (wake, listen, reply, re-listen) is one state
machine in `lib/voice/` with the legacy thresholds recorded in the
backlog (700 ms arm, RMS 0.04 plus probability 0.60 over 12 frames), and
`sentenceSpeechScheduler.stop()` finally has a caller: barge-in stops
playback. Until C's route lands, a mock socket that replays a fixture.

### Step 5: memory, conversations and the parental view (M)

- Memory page: multi-select archive and forget plus clear-all through
  the batch bar (the backlog's named consumer), the per-person view an
  adult can open for a child, "what changed since" from `?since=`.
- Conversations: the list with rename, delete, batch delete, clear-all;
  the parental view per plan 4.14 (a parent sees a child's
  conversations, a summary and safety flags for a teen's, nothing of an
  adult's), rendered only where F's grants say so.
- Notifications: the thirty-day history page, clear-all, quiet hours
  and the web-push opt-in in Settings from F's keys.

### Step 6: people, relationships, grants and parental controls (M)

Schema pages over F's routes: People gains relationships (who is whose
parent, sibling, guardian) and entities (the family's named things);
a person's page shows effective permissions from
`GET /api/people/:id/permissions`; a parent's controls page for a child:
grants and denies from the vocabulary, the content ceiling dials with
the floor shown as not movable, time allowances and schedules per
category, the approval queue (Ask to Install, Ask to Browse), sessions
and devices with revoke. Admin settings render nothing for non-admins
(the `settings.admin` action), never disabled controls.

### Step 7: the far surface for package pages, and the rest of accessibility (M)

- The "TV in one rule" for schema pages: on `far`, every node renders
  its far profile (focus scale, the tvOS type scale, no free text entry;
  a text input becomes the remote's keyboard or Quick Connect), so no
  package does TV work. Norigin paused while any overlay is open.
- Colour contrast measured against the real token palette in both
  themes (a test, not a read-through), a screen-reader pass on each page
  recorded with fixes, keyboard-trap tests, reduced motion verified.

### Step 8: i18n scaffolding, decided then built (S-M)

The backlog calls i18n undecided. Dispatch the `design-resolver` agent
with the standards and plan 6.7, then scaffold what it decides (the
expected shape: a maintained library such as `lingui` or `react-i18next`,
message catalogs per locale under `frontend/src/locales/`, English
extracted, `household.locale` selecting the catalog, the far profile's
type scale per script). Package strings are D's problem and are noted
for the catalog's own i18n item; this step covers the shell, kit and
core pages only.

### Step 9: user docs (M, spread across every step)

Every screen you build gets a page under `docs/user/` in the same
commit: getting started, the wizard, home, chat and talking to it, the
store, people and parental controls, memory, notifications, privacy,
settings, fix a problem, update. Screenshots from the matrix, looked at
before use. F builds the site that renders them; write plain Markdown
with front matter `title` and `description` so it drops in.

### Step 10: wrap up

`docs/dev/session-e.md` complete (versions pinned, decisions, what is
left); one line in `docs/dev.md`'s "Wave 2" index; `docs/BACKLOG.md`
checked off and corrected; changes the org's `UI.md` needs flagged for
Jesse; `scripts/check.sh` green; `code-review` on the final diff; merge
into `main`; delete the worktree; do not push unless Jesse says ship.

## If you get stuck

- A design question: the `design-resolver` agent, decision recorded.
- A backend route not yet on `main`: the contract and a mock; rebase
  daily and swap.
- A library that does not do what its docs say: the nearest maintained
  alternative, reason recorded, never hand-build.
- Something only Jesse can decide: finish every other step, then stop
  with a status block.
