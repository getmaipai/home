# FAMILY-TABS-01: drop Tools everywhere reachable, rebuild People as
# Family with People / Pets / Bots tabs

Lane: codex-b, worktree `~/Developer/github.com/getmaipai/home-codex-2`
(branch `codex/shell-lane-b`, currently 5 commits behind `origin/main` -
fast-forward it first, see step 0). Model floor: Codex, low reasoning
(every file, pattern to mirror, and data source below is already
identified - this is execution, not design).

## Ready handshake

Before touching anything, reply with: the model named in your own
system prompt, your checkout path and branch, and "ready for
FAMILY-TABS-01". Wait for "start" before editing.

## Why

Jesse asked directly (2026-09-28) for two things: (1) Tools should be
unreachable from the nav *and* the URL - there's no reason for a
family member to browse it; (2) the People section becomes "Family"
and gains Pets and Bots alongside the existing People grid. A sibling
item, FAMILY-NAV-01 (codex-a, running in parallel in `home-codex`),
handles the one vendored file that defines the sidebar's own label and
link list (`commons`'s `ui` package) - it removes the Tools sidebar
entry and renames the People sidebar label to Family, then bumps this
repo's `ui` pin. That lane does not touch anything under
`frontend/src/` in this repo. Your job is everything else: making
`/tools` (and every alias that currently leads to it) genuinely dead,
and rebuilding the People page into a tabbed Family page. The two
lanes are on disjoint files and can land in either order; you do not
need to wait for FAMILY-NAV-01 to finish first, and neither does it
need to wait for you.

Two real data sources already exist for the new tabs - reuse them
exactly as they are, do not invent a parallel one:
- **Pets**: `GET /api/entities?kind=pet`, already wired as
  `api.entities("pet")` in `frontend/src/lib/api.ts:752`, returning
  `Entity[]` (`@maipai/spec`'s `entity.schema.json` - `kind`, `name`,
  `description`, `source`, `confirmed_by_person_id`). An entity with
  `source === "inferred"` and no `confirmed_by_person_id` is one the
  memory judge guessed at and nobody has confirmed is real - the
  spec's own rule is it's "never stated as fact to anyone until
  confirmed." `frontend/src/apps/memory/PeopleAndThings.tsx` (dead
  code today, not reachable from any route, but the logic is real and
  correct) already implements exactly this: it shows the entity with
  an "Unconfirmed" badge rather than hiding it (see its
  `entityUnconfirmed` check at line 138 and the badge at line 154).
  Mirror that same convention for the Pets tab: show every `kind:
  "pet"` entity as a card, and any unconfirmed one gets the same
  "Unconfirmed" badge treatment, never presented as a plain confirmed
  pet. Do not build a confirm action for this tab (that's an editing
  affordance PeopleAndThings.tsx also has; out of scope here, this tab
  is browse-only, same as the People tab).
- **Bots**: paired robots. `api.robotDevices()`
  (`frontend/src/lib/api.ts:503`, `GET /api/devices/robots`) returns
  every paired robot household-wide, but that route is
  `requireRole("owner", "admin")` server-side
  (`backend/src/routes/devices.ts`'s `listRobotsRoute`) - a non-admin
  caller gets a 403. `api.devices()` (`api.ts:492`, `GET /api/devices`)
  has no role restriction but only returns the *caller's own* paired
  devices. So: when `person.role` is `"owner"` or `"admin"`
  (`isOwnerOrAdminRole(person.role)`, already imported elsewhere from
  `@/lib/api`), call `api.robotDevices()`; otherwise call
  `api.devices()` and filter client-side to `kind === "robot"`. Either
  way you get `DeviceInfo[]` (`api.ts:174` - `id`, `kind`, `name`,
  `area`, `lastSeenAt`, `capabilities`). Render one card per robot:
  name, and `area` as a subtitle if present (mirror `PersonCard`'s
  shape below, not a data table). `capabilities` has no renderer yet
  (`devices.ts`'s own comment: "ROBOT-CARD-01 (not yet built) is what
  actually renders it") - don't build one now, just don't crash if
  it's empty.

## Files you own

All in `home-codex-2` (your worktree of `home`):
- `frontend/src/next/pages/NextPeoplePage.tsx` - **rename** to
  `frontend/src/next/pages/NextFamilyPage.tsx`, function renamed
  `NextFamilyPage` (keep `PersonCard` as an internal helper, unchanged
  except whatever wrapping the tabs need).
- `frontend/src/next/pages/NextAppsPage.tsx` - delete.
- `frontend/src/next/NextRoutes.tsx` - remove the `NextAppsPage`
  import and its `<Route path="tools" .../>`; remove `"/tools":
  "Tools"` from `titleByPath`; update the `NextPeoplePage` import and
  `<Route path="people" element={<NextPeoplePage .../>} />` line to
  `NextFamilyPage` (**keep the route path string `"people"` and the URL
  `/next/people` exactly as they are** - FAMILY-NAV-01 already points
  the sidebar's Family label at that same URL; don't rename the route,
  only the component); update `titleByPath`'s `"/people": "People"` to
  `"/people": "Family"`.
- `frontend/src/App.tsx` - remove the `<Route path="/apps"
  element={<LegacyNextRedirect />} />` line.
- `frontend/src/next/LegacyNextRedirect.tsx` - remove the `"/apps":
  "/tools"` line from the `aliases` map.
- `frontend/src/shell/nav.ts` - remove the `{ to: "/apps", icon:
  "layout-grid", label: "Apps" }` entry from `NAV_ENTRIES`; change `{
  to: "/people", ... label: "People" }` to `label: "Family"`. Re-read
  the file's header comment before you finish - it currently argues an
  ordering rule ("Home/Chat/Apps first... those three have to be
  first in the flattened entry list") that's about to be one entry
  shorter; fix the comment to describe the post-edit list truthfully,
  don't leave it asserting something no longer there.
- `frontend/src/shell/appCatalog.ts` - change the `/people` entry's
  `label: "People"` to `label: "Family"` (leave `description` and
  `keywords` - "family"/"household" are already apt).
- `frontend/src/shell/routeHeader.ts` - remove the `{ to: "/apps",
  title: "Apps", ... }` line from `ROUTE_HEADER_OVERRIDES`; its header
  comment ("Home itself, Apps, and the two header-reachable-only
  destinations") needs the same truthful update as nav.ts's comment
  above.
- `frontend/src/shell/search/providers.ts` - `pagesProvider` (line 34)
  only ever matched the `/apps` `NAV_ENTRIES` row, which you're
  removing; once that row is gone the function always returns an empty
  group. Delete `pagesProvider` itself and its one registration
  (`Promise.resolve(pagesProvider(query))`, currently line 135, inside
  whatever function aggregates the providers - re-read to confirm
  there's nothing else in that array depending on it before removing
  the line). Check `frontend/src/shell/search/providers.test.ts` (or
  wherever its tests live - `grep -rn pagesProvider frontend/src` to
  be sure you find every reference, tests included) and remove or
  update any test that exercised it.
- `frontend/src/apps/library/appPresentation.ts` - **do not touch.**
  The Explore pass that scoped this item flagged this file as sharing
  a "companion" kind label with the Tools listing; confirm with `grep
  -rn NextAppsPage frontend/src` that nothing except the route and the
  page file itself imports `NextAppsPage` before you delete it, and if
  `appPresentation.ts` turns out to be used only by the page you're
  deleting, say so in your done report rather than deleting it
  yourself - it's also read by `frontend/src/apps/library/` (the
  Library/Files page), which is a different, still-live feature this
  item must not touch.
- `home/docs/BACKLOG.md` - tick `FAMILY-TABS-01` (new item, same area
  as `PEOPLE-01`/`PEOPLE-EXPAND-01`; note explicitly that this is a
  narrower slice than `PEOPLE-EXPAND-01`'s own design pass, not a
  replacement for it - Pets here is browse-only, unconfirmed entities
  stay labeled as such, no merge/forget/relationship-inference UI, and
  Bots is a paired-device list, not the fuller household-entity
  browsing `PEOPLE-EXPAND-01` still reserves for its own design pass).

Do not touch anything in `commons`, `scripts/check.sh`, or either
`package.json`'s pins - that's FAMILY-NAV-01's lane. Do not touch
`frontend/src/apps/memory/PeopleAndThings.tsx` itself (read it, mirror
its convention, don't move or edit it - it stays dead code, out of
scope here). Do not touch `backend/` at all - both `/api/entities` and
`/api/devices*` already exist and do exactly what you need.

## Setup (step 0)

`cd ~/Developer/github.com/getmaipai/home-codex-2 && git status` -
confirm clean, then `git fetch origin && git merge --ff-only
origin/main` (it's 5 commits behind and was clean at last check; if
`git status` now shows anything uncommitted, stop and report a
question instead of merging over it).

## Steps

1. Read `frontend/src/next/pages/NextPersonProfilePage.tsx` (already
   open in the exploration that scoped this item, lines 1-50) for the
   exact `Tabs`/`useSearchParams` pattern to mirror: `activeTab`
   derived from `params.get("tab")`, an `onTabChange` that sets or
   deletes the `tab` param (`replace: true`), one tab with no query
   param (the default, "people") and the others named explicitly
   ("pets", "bots"). Also skim `NextSettingsPage.tsx` lines 75-103 for
   how conditionally-shown `TabsTrigger`s look (`Bots` is
   role-conditional per the "Why" section above; `People` and `Pets`
   are not).
2. Rename `NextPeoplePage.tsx` to `NextFamilyPage.tsx`. Wrap its
   existing return value (the `AsyncState`-wrapped grid, unchanged) in
   a `Tabs` with three triggers: "People" (default/no query param),
   "Pets", and "Bots" (only rendered when
   `isOwnerOrAdminRole(person.role)` is true for the *trigger itself* -
   if you'd rather always show the trigger and let a non-admin see an
   empty/appropriate state, don't: mirror the Settings pattern of
   hiding the trigger entirely when the viewer has nothing to see
   there, don't build a 403 state for a case avoidable at render time).
   `useDocumentTitle` becomes `"Family"` instead of `"People"`. The
   page's own top `CardTitle` (currently "People") becomes "Family".
3. Add the Pets tab content: a `useQuery` for `api.entities("pet")`,
   `AsyncState`-wrapped the same way the People grid already is, cards
   in the same `grid gap-4 ${GRID_COLUMNS.default}` layout as
   `PersonCard` (reuse `Card`/`CardContent` from
   `@maipai/ui/src/dashboard/components/ui/card`, same import already
   in this file). Each card: the entity's `name`, its `description` if
   present, and the "Unconfirmed" badge (mirror
   `PeopleAndThings.tsx`'s exact check and badge markup, cited above)
   when `source === "inferred" && !confirmed_by_person_id`. No avatar
   image - pets don't carry one in the spec; use a plain icon instead
   (check `@maipai/ui/src/icons`'s `getIcon` for something reasonable,
   e.g. a paw/animal icon if one exists there - if nothing fits, a
   generic icon is fine, this is not a design decision worth stalling
   on). Not clickable (no `/entities/:id` route exists) - a static
   card, unlike `PersonCard`'s `Link` wrapper.
4. Add the Bots tab content: the role-branched `api.robotDevices()` /
   `api.devices()` call described in "Why" above, same `AsyncState`
   wrapping, same grid, one card per `DeviceInfo` (`name`, `area`
   subtitle if present, a robot-ish icon from `getIcon`). Not
   clickable either (no per-device page exists in this shell yet).
   Empty state: reuse whatever `AsyncState` already shows for a
   zero-length array (check how the People grid behaves with zero
   entries today, or whether `AsyncState` needs an explicit empty
   message prop - match its existing convention, don't invent new copy
   style).
5. `NextRoutes.tsx`, `App.tsx`, `LegacyNextRedirect.tsx`, `nav.ts`,
   `appCatalog.ts`, `routeHeader.ts`, `search/providers.ts`: the exact
   edits are listed under "Files you own" above. Delete
   `NextAppsPage.tsx` last, after confirming (per that section) nothing
   else imports it.
6. Fix `NextPersonProfilePage.tsx`'s "Back to People" link (around
   line 68 as of the exploration pass - re-read to confirm) to read
   "Back to Family".
7. `PeopleCountCard.tsx` (`frontend/src/next/pages/dashboard/`) stays
   "People" - it's a count of household *people* specifically, not the
   Family section's label, and is out of scope for this item. Don't
   touch it.
8. Existing tests: `grep -rln NextPeoplePage frontend/src --include
   "*.test.tsx"` and update every hit to the new name and behavior
   (there is very likely a `NextPeoplePage.test.tsx` or similar to
   rename alongside the component and extend with tab coverage - match
   its existing structure, don't invent a new test harness). Add
   coverage for: the People tab's existing grid still renders
   (regression, not new); the Pets tab renders confirmed and
   unconfirmed entities with the badge shown only on the latter; the
   Bots tab calls `robotDevices()` for an owner/admin `person` fixture
   and `devices()` (filtered) for a non-admin one, and the Bots trigger
   itself is absent for the non-admin fixture. Also add or update a
   test asserting `/tools` and `/apps` no longer route anywhere real
   (however this app's existing route tests express "no route
   matches" today - follow that convention, don't invent a new
   assertion style for it).

## Acceptance evidence

- `bash scripts/check.sh` green in `home-codex-2` (paste the pass
  line and the scope it picked - this diff is frontend-only, so it
  should pick the frontend leg per the scoped-gate rule; say so if it
  picks something else and why).
- The new/updated test file(s) named above, passing, covering every
  case listed in step 8.
- A live check on `localhost:8787` is **not** possible from your
  worktree alone (per `home/AGENTS.md`'s pinning note, 8787 only
  reflects what's installed in the *main* checkout, and the sidebar
  label itself won't show "Family" there until FAMILY-NAV-01's pin
  bump also lands and `bun restart` runs in the main checkout) - the
  coordinator does that combined check once both lanes are in. Your
  own acceptance is the test suite plus a `bun run build` (or
  whatever `check.sh` already runs) succeeding, not a screenshot.
- `git diff --stat` against `origin/main` before you commit, read by
  you, confirming the file list matches "Files you own" above (plus
  new/renamed test files) and nothing under `commons`, `scripts/`, or
  either `package.json` pin appears in it.

## Exit checks

- `bash scripts/check.sh` green (paste it).
- Code review at `medium` effort on the diff (multiple routes removed,
  a role-gated data fetch, a renamed page - a real route/wire-shape
  change, not a config tweak) with an explicit target (`main...HEAD`
  in your worktree, per the org rule on reviewing in a worktree) -
  read back the reviewed path and branch before acting on any finding.
- Docs (`home/docs/BACKLOG.md`) in the same commit as the code.
- One commit, staged by name (`git add <file>` for each, never `-A`
  or `-u` given how many files this touches - list them all
  explicitly).
- Push your branch once green, or say you left it for the coordinator
  to merge.

## Reporting

Report **ready** first and wait for "start". Report **done** with:
commit hash, `check.sh`'s pass line and scope, the review's level/pass
count/findings and their disposition, the test file names and what
each new test asserts, and confirmation of the `git diff --stat`
file-list check above. Report **blocked** with the exact failing
assertion or error. Report **question** if `appPresentation.ts`'s
usage turns out ambiguous (per "Files you own" above), if no
"no-route-matches" test convention exists yet to extend, or if
`AsyncState`'s empty-state convention isn't obvious from how the
People grid already handles zero entries - don't guess on any of
those three.
