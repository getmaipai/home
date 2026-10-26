# Home page layouts: a person picks one, a gear on Home opens the choice (2026-10-25)

Status: proposed, owner direction given in chat 2026-10-25; architect verdict in `data-scratch/architect/HOME-LAYOUT-2026-10-25.verdict`. Design note only; no code. Mockups:
[docs/design/assets/home-page-redesign-2026-10-25/index.html](assets/home-page-redesign-2026-10-25/index.html) (four options, desktop and
phone, light and dark, placeholder content).

Jesse, 2026-10-25: "we need a completely redesigned home page - ours is ugly." Later the same day: let people choose which layout
they want in Settings, Appearance, with a settings icon on the dashboard that jumps to that choice.

It extends [home-page-2026-10-17](home-page-2026-10-17.md), which fixed the blocks, the widget contract, the budget (four Today
cards, six blocks before "More") and hide-a-card. That note's "option C" (ask first, bounded glance) is the page as built; its
blocks are the parts every layout below draws. Names here are the mockup letters, not that note's.

## 1. What is wrong today (seeded dev hub, 2026-10-25)

- A Today card reads "Sorry, that didn't work. Try again in a moment." The 2026-10-17 rule says a failed card drops out.
- Two more Today cards are empty states ("Your shopping list is empty", "No news lists are turned on for you").
- The weather card sits alone on its own row under the three cards.
- Getting started (admins) is the tallest block, so setup chores push the day down.
- Nothing is personal or alive: no pictures, no media to resume, no sign of the family beyond a greeting.

## 2. Research that bears on this

From the 2026-10-17 table (17 products) plus a 2026-10-25 check:

- Per-person home choices from a fixed list are accepted (Linear's default home view, Notion's per-section hide and reorder);
  freeform editors (YAML, Gridstack, Take control) are resented.
- Every AI chat app opens on a greeting and a composer, and people punish apps that hide recents.
- Pushed content is the loudest complaint everywhere; Home has none and should say so by showing only what the household installed.
- Family hubs (Skylight, Hearth, Echo Show) win on a shared day view with lists and photos; they lose on subscriptions and ads.
- Apple and Google are moving their home hubs toward proactive, glanceable summaries (Apple's rumored hub, Gemini for Home); the
  2026-10-25 search found no hub redesign teardown worth citing beyond that.

## 3. The four options

One block library, four arrangements (the mockup draws all four from the same markup).

| Option | Arrangement | Strongest when | Weak when |
|---|---|---|---|
| A. Ask first | Greeting with a one-line day summary, large Ask with starters, Pick up (3 rows), Today as chips, family and admin line | Most visits start with a question; a child's screen | A wide screen is mostly empty by design |
| B. Today board | Bento grid: weather hero, Ask, Pick up, lists, News, Family; Getting started as one slim bar | The household opens Home to see the day | Needs the card budget as packages grow |
| C. Shelves | Slim Ask, Continue hero, day card, New in your library, Made at home | Media and made-at-home items are in daily use | Day one, before media exists (falls back to A) |
| D. Family screen | Clock, family schedule, lists, photo, now playing, Ask | A counter tablet, the TV, the robot | Needs calendar and chores packages that do not exist |

## 4. Decision

1. **A person picks A, B or C** in Settings, Appearance, with the setting `ui.home_layout` (person scope, `select`, values `ask`,
   `board`, `shelves`). The default is `shelves`, owner-approved in chat 2026-10-25 (Jesse: "start with shelves"). That reverses the 2026-10-17
   decision 1 (option C there, ask first) for the default, with his yes. With no media and nothing made, `shelves` draws the `ask`
   arrangement (decision 5), so a new household still opens on a full page. D is not offered: it is a
   shared-screen mode for a device, filed for when a calendar and a chores package exist (its own note then).
2. **A gear on the Home header** (the kit's icon `Button`, a link) goes to the Appearance page with the `ui.home_layout` row in view.
   It is the only new control on Home. A guest does not see it (a guest has no settings). A child sees it and lands on the disabled
   row with its reason (decision 4). It is a deep link to one row, like Chat's own settings link, not a second Settings entry
   (rule S2). "Hide from Home" (HOME-PAGE-04) stays on each card's own menu.
3. **One page, three arrangements.** `DashboardPage` composes the same blocks (`Greeting`, `AskBox`, `PickUp`, `TodaySection`,
   `Family`, `GettingStarted`, admin links) and the layout only chooses order, grid and which blocks collapse to chips. No block is
   written twice. The mockup's "Apps" block in option B is dropped: the rail already draws the person's pinned apps and an app never draws a second
   copy of app switching (rule S2). App tiles on Home would be a rule change for Jesse to decide, not a layout option. A layout never adds a gate or removes one; the server filters exactly as in the 2026-10-17 note (section 4 and 10).
4. **A child's Home is always the `ask` arrangement, and the registry says so.** `ui.home_layout` is disabled for the child band in
   the settings spec, and the generic renderer shows the row disabled with the reason from spec copy (rule S5; no page writes the
   reason). The page has no resolver that overrides a stored value; a child's stored value is never written. Rule 0 is unchanged: the
   gate list, not the layout, decides content. If the key schema cannot express "disabled for a band", that is added in HOME-LAYOUT-01.
5. **Day-one fallback.** C with no media and nothing made draws A. B draws only cards that have data (failed or empty cards drop
   out, per the 2026-10-17 rule); that is also the fix for the empty and failed cards in section 1.
6. **Every layout obeys the 2026-10-17 budget and rules**: no person's activity (rule 6a), Ask opens `/chat?ask=` unsent, Incognito
   hides Pick up and Family.

## 5. Supersedes

- 2026-10-17 note section 5 and decision 1: it chose ask-first over a dashboard. The default is now `shelves` (owner-approved 2026-10-25), falling back to `ask` while there is
  nothing to show; `board` and `ask` are layouts a person picks.
- 2026-10-17 section 6 item 6 (Today as up to four `Card`s) and item 8 (Getting started as one card): in the `ask` layout Today is
  chips that open the full card, and in `board` Getting started is one slim bar. In `ask` the full cards stay one tap away.
- 2026-10-17 section 9 (Recently made is an opt-in block): `shelves`, the default, shows "Made at home" (owner-approved 2026-10-25).
- Nothing in RULES.md.

## 6. Rule check

- **Rule 0 and 6a:** the layout is presentation; the server's role, band and output filters are untouched. No cross-person content in any layout.
- **Rule 9 and 9b:** every block is a kit part or an answer block through `answer-block.tsx` (`Card`, `Item`, `Avatar`, `Button`,
  `InputGroup`, `Collapsible`, the `weather_card` Element). Grid classes go on Home's own container `div`s, never on a kit part;
  no wrapper around an Element. Chips are kit `Button`s or `Badge`s as they ship. A gap goes to `commons` first (rule 9, part c).
- **S1, S2:** Home stays an app on the rail; no status copy is added to the page.
- **S4, S5:** the choice is a registry key drawn by the generic settings renderer in Appearance; Home writes no settings layout.
  The gear is a link to that row, not a second place that edits the setting.
- **Platform principle 1 and 4:** one page, one block set, one setting; D and any per-layout block are not built twice.
- **Colors:** every color follows the user's theme tokens; the mockup's gradients stand in for package pictures and weather art.

## 7. Reuse check

Looked at first: `usePinnedApps.ts` (the person-setting read and write pattern), the generic settings renderer and `areas.json`
(`profile.appearance`), `DashboardPage.tsx` and `dashboard/*` (all existing blocks), `GET /api/widgets`, `GET /api/continue`
(Pick up and media rows), the Media hub's `GET /api/media/home` (`continue`, `new`, `made_at_home`: the one source for every shelf in C), `orderHomeCards`
(HOME-PAGE-02). Considered and rejected: four separate pages (breaks one definition), a drag-and-drop board (the editor people
resent), a per-package layout choice (the page, not the package, owns arrangement). The shelves are the kit's `MediaShelf` (`@maipai/ui/src/primitives/MediaShelf`, as `MediaHomePage.tsx` uses it). Not yet
named to a shipped part, so each is a commons variant first (rule 9, part c) if the shipped parts cannot draw it: the Continue hero and
the one-bar Getting started. Hand-built code: three arrangement containers only.

## 8. Items

HOME-LAYOUT-01 (spec: `ui.home_layout` in `commons`), HOME-LAYOUT-02 (the three arrangements, after
HOME-PAGE-03's blocks), HOME-LAYOUT-03 (the gear and its deep link). Filed in `docs/BACKLOG.md` under HOME-PAGE-04. All code is
dispatched to Codex (`scripts/wt.sh run codex`, then `wait`), read, gated and landed by the dispatcher.

## 9. Open items for Jesse

None block the filing. Whether C ships with A and B or after the Media hub's pictures are real; with `shelves` the default, C should ship with the first layout.
