# Session A hand-off, 2026-09-20 (Home UI lane, part b)

For the fresh session that takes the Home UI lane on Sonnet, after
HOME-UI-02. The coordinator is the `COORDINATOR` session over
cross-session messages; every item arrives from it and every result
goes back to it as `done <item>` with the commit hash(es), `git show
--stat HEAD`, each command's exit, and the review dispositions. Say
`ready` first and start only on its start message.

## Where the repos stand

`home` `main` on origin is `e8cd9c97` ("Bump check.sh's stale UI_PIN to
ui-v0.3.3"), on `eb814533` (the local model's SettingsPage 960px fix,
cherry-picked), on `a9cbbd23` (HOME-UI-02, the Apps page rebuilt as a
real things table over installed packages), on `fcd81a03` (HOME-UI-01's
own follow-up fixes). Working tree clean, no worktrees left open under
`home` for this lane (`home-a1`, `shared-a` both created and removed
today, twice). `home-c-stack4` still exists as a worktree folder (the
local model's fixed folder) but is detached at origin/main with no
branch of its own; leave it as is unless the local model's own next
brief needs it back on a branch.

`shared` `main` on origin is `0eea8b3` (`ui-v0.3.3`, four real a11y
bugs in `ThingsTable`/`FilterColumn`/`ListRow`/`ChipRow`, found by the
real screenshot pipeline's first run against the Apps page), on
`ff398f9` (`ui-v0.3.2`, `TypeBadge`, an async-safe `DetailsPane` confirm
step, `PhoneModeContext` actually wired to a live breakpoint), on
`c07639b` (`ui-v0.3.1`, the MetricCard contrast/touch-target fix from
HOME-UI-01's own follow-up). No worktree left open.

Both repos are on `main` (not detached) as of this note. Confirm that
before trusting anything you read on disk: `git branch --show-current`
in both `home` and `shared` should print `main`. See "The pin gap and
its fix" below for why this matters more than it sounds.

The primary `home` checkout is built and running on port 8787 (`bun
restart` was run after the last commit landed; `/apps` and `/settings`
both verified serving 200).

## The next items, in order

1. **HOME-UI-03 (M): Settings and Privacy to the section.** The
   "Settings (`/settings`) and Privacy (`/privacy`)" paragraph of
   [docs/design/home-pages-2026-09-20.md](../design/home-pages-2026-09-20.md):
   Settings is the settings workspace this spec already describes
   elsewhere (its own "Settings workspace reference" section) - the
   section list on the left, the form on the right rendered from the
   declaration, the three disclosure levels as the workspace's own
   toggle, not hand-built per field. Privacy is one page of panels,
   the "what leaves the house" table as a things table (the kit's
   `ThingsTable`, same as HOME-UI-02 just proved live - no filter
   column needed there unless the real row count earns one). Read
   `frontend/src/apps/settings/SettingsPage.tsx` and
   `frontend/src/apps/privacy/PrivacyPage.tsx` first: both already
   exist and are functional, this item restyles them onto the kit's
   own patterns, it does not invent the settings registry or the
   privacy connection list (`GET /api/settings`,
   `docs/SETTINGS.md`'s three-level renderer, `GET /api/privacy`
   already real). Watch for the same class of gap HOME-UI-02 found
   twice: a kit component with no real consumer yet (check whether the
   settings workspace's own kit renderer has ever been exercised by a
   running page) is a component that has not actually been proven.
2. **HOME-UI-04 (M): People, Memories and Lists.** The "People
   (`/people`), Memories (`/memories`), Lists (`/lists`)" paragraph of
   the same design doc: things pages in the same pattern as Apps - a
   row per person with avatar, role badge and presence pill; a row per
   memory with its kind badge and time; a list as a panel of rows with
   checkboxes. Each opens its details pane. Three routes, one pattern;
   consider whether they share one generic things-page wrapper in
   `frontend/src/apps/` the way `AppsPage.tsx` itself could become a
   thin instantiation of, rather than three hand-built pages - a real
   design call, not an assumption, since People's presence pill and
   Lists' checkboxes are each a real difference from Apps' own filter
   shape.
3. **HOME-UI-05 (M/L): the Engines page**, only once **HOME-STACK-04**
   lands from the Stack lane (`stack/docs/plans/home-adoption-2026-09-20.md`,
   item 4 in that doc's own ordered list: "the one human-facing surface
   over the Stack's declarations, every verb mapped to a route"; it
   depends on HOME-STACK-02 and 03 landing first, in that same doc).
   Ask COORDINATOR whether it has landed before starting; do not start
   building the page against a Stack surface that does not exist yet.
   The design doc's own "Engines, Packages, Updates, Repairs, Backups
   (Manage)" section has the composition once the data exists: the
   metric row (tier, memory in use of budget, engines running,
   updates), the components table with type badges and status pills
   and the per-row actions (Start, Stop, Restart, Install, Remove), the
   details pane with the engine's settings rendered by the settings
   renderer.

Same worktree pattern as today (`shared-a` off `shared/main` for kit
work, `home-a1` off `home/main` for Home's own code, both created only
when actually needed and deleted after merging); same gates and review
budget (below); captures at 1440 and 390, both themes, opened beside
the reference before calling anything done; restart 8787 after the
merge.

## The pin gap and its fix

`scripts/check.sh` pins `@maipai/core`, `@maipai/ui` and `@maipai/spec`
to exact versions (`CORE_PIN`/`UI_PIN`/`SPEC_PIN` near the top of the
file) and refuses to run if the `shared` checkout it finds does not
match. `UI_PIN` sat at `0.2.4` through all of `ui-v0.3.0`, `0.3.1` and
`0.3.2` today - neither HOME-UI-01 nor HOME-UI-02 ever bumped it, and
neither session ran `scripts/check.sh` end to end until the very end of
this one (gating the cherry-pick). Bumping `shared/ui`'s version is not
enough by itself: **every time a kit bump lands, update `UI_PIN` in
`scripts/check.sh` in the same commit**, and actually run the full gate
before calling the item done, not just `tsc`/`eslint`/`bun test` run by
hand against the individual repos. The current pin is `ui-v0.3.3`
(fixed today, `e8cd9c97`); after HOME-UI-03 or 04 lands another kit
version, this is the first thing to check.

Separately: today the primary `shared` checkout's `HEAD` got detached
at the stale `ui-v0.2.4` tag twice, mid-session, by the local coding
model's own tooling (it was running `git -C ../shared checkout
ui-v0.2.4` to satisfy a stale pin check of its own - COORDINATOR traced
this and says that lane's next briefs carry a hard rule against
checking out tags in the shared primary checkout directly, plus a real
fix in progress: every consumer's `check.sh` resolving its pin through
a per-tag worktree instead). If `shared`'s content looks stale or
missing when you go to use it, check `git branch --show-current` there
before assuming something is actually broken - `git checkout main` is
the safe, non-destructive fix if it has drifted again (confirm `git
status` is clean first).

## Known gaps and nits, not fixed this session

- **Filed as a real issue**, not a BACKLOG item: [getmaipai/home#123](https://github.com/getmaipai/home/issues/123),
  five tests (`NotificationBell.test.tsx`, `MemoryPage.test.tsx`,
  two crisis-overlay cases in `backend/tests/safety.test.ts`,
  `backend/tests/updates.test.ts`) that fail only under the full
  concurrent suite, never alone. Flaky tests are a finding, not noise
  - especially the two safety ones. Not this lane's to fix unless
  asked; read the issue before assuming a real gate failure in one of
  these five is actually your diff's fault.
- **STORE-01** (filed pickup-ready in `docs/BACKLOG.md`, "UI / shell"
  section): a real GET route to browse a trusted catalog index, and
  the settings it needs - the prerequisite for Apps' own "From the
  catalog" filter ever showing real content or a real Install action.
  Backend work, not this lane's unless reassigned.
- **Two nits for the next Home UI session** (COORDINATOR's own words,
  2026-09-20): the rail's hub card and the docs captures show the real
  machine name ("Jesses-MBP") - `scripts/screenshot.ts` should seed a
  demo hub name (a roster name, e.g. "Bramble hub") so no capture ever
  carries a real hostname, matching the persona-roster rule everywhere
  else demo data is seeded. And the footer's "1 repair need attention"
  needs the plural rule (singular/plural agreement on the count -
  compare how the footer's own "`<n>` updates available" segment
  already handles `n === 1` versus `n > 1`, if it does; if it does not
  either, both need the same fix in the same commit). Neither is
  blocking; fold whichever is cheapest into the next UI item that
  already touches the footer or the screenshot script, rather than a
  standalone item.

## The gate slot rule

One gate or live proof on the machine at a time when another session
is also running one. Check with COORDINATOR before starting
`scripts/check.sh`'s full run (it takes 5 to 6 minutes and exercises
the whole backend suite, real CPU) if another lane might be mid-gate;
editing and single-file `bun test tests/<file>.test.ts` runs are fine
regardless. `bun run screenshots` similarly reserves real memory and a
headless browser for several minutes; check before running the full
matrix.

## The review budget

`code-review` at level low for an S item or docs/config, medium for M
or anything touching a route, a kit component, or a wire shape; one
pass per commit with the explicit worktree target path (never the bare
repo name - the review runs in a forked subagent whose own working
directory can resolve to the wrong checkout); after fixes, re-review
the fix hunks only, never the whole diff again; never a third pass (a
second pass that still finds real defects is a finding about the
item's size, reported to the coordinator, not a reason to loop). Today,
three separate reviews found real issues on their first pass (the
`shared/ui` DetailsPane/Shell patch, that same patch's touch-target
math on a second round, and nothing on `home-a1`'s own diff) - each
got exactly one fix-hunks re-review after, no third pass anywhere. The
done report states the level, the pass count, and every finding's
disposition.

## Facts a fresh session needs that the docs do not say

- **`bun install --force`, not a plain `bun install`**, after any
  `shared/ui` (or `core`, or `spec`) version bump, in both `backend/`
  and `frontend/`: a plain install does not refresh a `file:`
  dependency's snapshot in bun's content-addressed store.
- **The kit components used for the first time by a real page are
  unproven until that page actually ships.** Every one of HOME-UI-01
  and HOME-UI-02's real bugs (MetricCard, PanelHeader, StatusPill,
  TypeBadge's underlying pill-tint math, PhoneModeContext,
  DetailsPane's confirm flow, ThingsTable/FilterColumn's touch
  targets, ListRow's raw Tailwind colors) were shipped in an earlier
  `ui-v0.3.x` tag with zero real consumers, and were only caught once
  a real Home page rendered them for the first time. Budget time in
  HOME-UI-03/04/05 for this: reading a kit component's source before
  trusting it, and running the real `bun run screenshots` matrix
  (never a hand-rolled capture) before calling a page done.
- Screenshots are generated only through `scripts/screenshot.ts`
  (`bun run screenshots` from the repo root); a scratch/throwaway
  Playwright script is fine for your own mid-task judging, never for
  the committed `docs/assets/screens/` set or anything shown to
  COORDINATOR as accepted evidence. COORDINATOR's standing policy as
  of today: judged captures stay on disk until accepted, never deleted
  or overwritten mid-review.
- `scripts/screenshot.ts`'s `ROUTES` array is not automatically kept
  in sync with `App.tsx` - its own header comment says so
  ("a route added later without an entry here is a real gap this file
  should close in the same commit"). `/apps` had been missing since
  the route itself existed; check any new route you add gets a `ROUTES`
  entry in the same commit.
- The memory file for this lane is
  `~/.claude/projects/-Users-jessetorres-Developer-github-com-getmaipai-home/memory/session-a-stack-refocus-2026-09-20.md`
  (despite the name, it covers this session's Home UI work too, since
  the lane moved from Stack to Home UI mid-session on 2026-09-20);
  `MEMORY.md` points at it. Read it, and update both at the next stop
  point.
