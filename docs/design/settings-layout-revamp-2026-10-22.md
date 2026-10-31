# Settings layout revamp: a column you can read, pages that do not sprawl (2026-10-22)
> Status (2026-10-31): superseded in part by [RULES.md](RULES.md): S1 and S4 (2026-10-23), where they differ.

Status: design approved 2026-10-22 (section 7), nothing built. Owner words (Jesse, 2026-10-22): the Home settings left column "is difficult to read, recognize
where you are"; the Devices page "is so crowded and expanding a bit expands on the page"; other apps "have a better layout, use things
like tabs and modals".

This note is the layout half. [settings-ia-2026-10-18.md](settings-ia-2026-10-18.md) is the content half (which setting lives on which
page, the 9 household and 7 personal pages, the cap of 10 settings per page, search, badges). That note stays the plan for what goes
where; this one changes how the shell, the pages and the in-page detail are drawn, and re-orders the slices so the visible fixes land
first. Nothing here changes a rule: parts are the shipped kit's (rule 9), the shell stays the one `SettingsShell` (S4), copy stays
`describeSetting` (S5). Shell changes are a `commons` change first, then a pin bump (PINNING.md).

## 1. What is wrong today (read from the code and the 2026-10-18 captures)

1. **The column cannot be scanned.** Home settings is 15 sections under 15 group headings that each hold one item, so every entry
   is drawn twice ("General" over "General", "Search" over "Search"). That is 30 lines and about 1,250 px tall; the last five need a
   scroll at 900 px. The column title is the constant "Settings" for the personal page and the household page alike
   (`SettingsAreaPage.tsx`: `labels={{ columnTitle: "Settings" }}`), so nothing says which side you are on.
2. **"Where am I" is one faint highlight.** The active row is a slightly lighter pill; the page header repeats the section name but
   there is no trail (side, then group, then page) and no icon-plus-color cue strong enough to see at a glance. Several section icons
   are the same generic glyph.
3. **Pages are scrolls of everything.** Engines and AI is 4,582 px at 1440 (6,550 px on a phone): the pause switch, 13 identical model
   pickers, then 7 panels. Rows are 10 to 12 px apart and every row carries a two-line description at the same weight as its label.
4. **Detail opens in place.** A robot, a model, a voice or an add flow grows the page it sits on (`AddRobotSection` is 282 lines of
   inline steps; "Show N advanced settings" expands inside the card). The content below jumps and the page keeps getting longer. The
   robot list already drills in through `?device=<id>` (`HouseholdRobotsSection.tsx`), but the add, install and password flows stay
   inline and the 13 paired-robot keys stack under them.
5. **Chat settings is a third area** whose link rows point at other pages, so a person has three entrances for related things.

## 2. What the settings of other busy apps do (the patterns, not the pixels)

| App | What it does that we do not | Pattern to take |
|---|---|---|
| macOS System Settings | One icon-led, coloured sidebar of about 8 groups (rows separated by a thin rule, not a heading each); a search box that jumps to the exact pane; the right pane is a short stack of rounded groups; a row with more detail shows a ( i ) or a chevron that opens a sheet, never grows the page | Icon tile per row, a few real groups, detail in a sheet |
| iOS Settings and Android Settings | Master list then a detail screen; the top of a long list is a profile card plus the three things people open most; each row shows its current value on the right ("Wi-Fi: Home") so you rarely need to open it | Value on the row, a "common" group first, drill-in on a phone |
| Slack preferences | One modal with a fixed left list of 8 to 10 plain-word pages, a title for the side, and sub-tabs at the top of a long page (Notifications has 3) | Tabs inside a page for sibling topics |
| GitHub, Vercel, Linear | Settings pages sit under a page-level title and a short left list; a long page gets a sticky "On this page" list or tabs; dangerous actions sit in a red group at the bottom; "Add X" opens a dialog, a row's "Edit" opens a dialog or a side sheet | Dialogs for add and edit, danger zone last |
| Discord user settings | Left list is grouped under 3 or 4 small-caps headings with many items each (User, App, Activity); a search box on top; the active row is filled and bold; a persistent Esc to close | Few headings with many items, a filled active row, a close key |
| VS Code, Chrome | A search that filters the whole page live and shows "Modified" and "Recommended" markers; a left list that follows scroll | Search first; Changed and Recommended chips |
| Home Assistant (the closest peer: a self-hosted home hub) | A short settings list of about 10 tiles, each with an icon, a title and a one-line summary; Devices is a table with a filter, a row opens a detail page or a dialog, "Add device" is a dialog; Backups, Updates and Repairs are their own pages | Overview tiles with a summary line, table plus detail for devices |
| ChatGPT | A modal with a left list of about 9 items, each an icon and one word; nothing is nested; the owner's own reference for the chat area (SETTINGS-LOOK-01) | One flat list, one-word labels |

Takeaways that apply here: a flat, short, icon-led column with few headings; a trail that names the side and page; a short page with
its most common settings first; a value shown on the row so people do not open things to read them; **detail and add flows in
dialogs, sheets or a second screen, never inline**; tabs for sibling topics on one page; search that is always visible.

## 3. The design

### 3.1 The shell: one column, two sides, a visible trail

Everything below is `SettingsShell` (a `commons` ui change), so Home still writes no layout.

- **Header names the side.** The column title is the area's own: "Your settings" or "Household settings" (the audit's SETTINGS-IA-01).
  Under it, one line of reach in a muted Badge: "Only you" or "Applies to everyone at home". An admin sees a two-way switch at the top
  of the column (a `ToggleGroup`, "Mine | Household") so switching sides is one tap, not an avatar-menu trip.
- **Flat groups, three to five.** The group heading is shown only when a group holds two or more items; one-item groups lose their
  heading (that alone removes 15 of 30 lines). With the IA note's 9 household pages the column is 9 rows plus 3 small headings
  (for example Home, AI and media, System), about 520 px: it fits at 800 px high with no scroll.
- **A row is an icon tile, a label and, optionally, a value.** A 28 px rounded tile in the area's accent (a distinct glyph per page,
  tile colours from the theme tokens, never fixed colours) so a page is recognised by shape before it is read. A short one-line summary
  or state shows under the label only on the household side where it helps: "AI and models: 2 models installed", "Backups: last run
  today", "Devices: 1 robot". It reads from data the page already loads, never a new status store (S6).
- **The active row is unmistakable.** A filled row (selected-surface token), a 3 px accent bar at its left edge, label in the
  strong weight, and `aria-current="page"`. Everything else is regular weight. This is the "where am I" cue Discord and macOS give.
- **A trail above the page title.** Breadcrumb (kit `Breadcrumb`): `Household settings / AI and models / Model per job`, the last
  segment is the sub-tab or the open detail. Each earlier segment is a link. On a phone it collapses to a back arrow plus the parent's
  name.
- **Search stays at the top of the column and is always one keystroke away** (`/` focuses it), live-filters the column itself (rows
  with a match stay, others dim) and shows the setting list with its own breadcrumb as the IA note's 5.6 describes. A "Changed" chip
  beside it filters to what differs from default (waits on the SETTINGS-LOOK-01 answer, IA note section 8).
- **Width.** The column is 260 px, the content pane 760 px (today 288 and 728), so a two-line row label is not wrapped by a
  crowded control on the right. The content pane keeps `--settings-row-text-max` so descriptions stay about 60 characters wide.
- **Close and back.** The page keeps Esc to return to where settings was opened from (the Discord pattern). On a phone the column
  is the first screen and a section drills in under a back row, as today.

Wireframe, desktop, household side:

```
+--------------------+----------------------------------------------------------+
| Household settings |  Household settings / AI and models                      |
| [Applies to all]   |  AI and models                       [ Find a setting  ] |
| [Mine | Household] |  ------------------------------------------------------- |
| [ Find a setting ] |  [ Overview ] [ Models ] [ Engines ] [ Advanced ]        |
|                    |                                                          |
| HOME               |  +----------------------------------------------------+  |
| (o) Household      |  | Pause chat for everyone                    ( off ) |  |
| (o) Privacy+safety |  | Chat is on. 2 of 3 AI jobs ready.                  |  |
|                    |  +----------------------------------------------------+  |
| AI AND MEDIA       |  | Chat model            Qwen3.8 27B          Change > |  |
| |#| AI and models  |  | Pictures              Standard             Change > |  |
| (o) Pictures+video |  | Voice                 Astro                Change > |  |
| (o) Voice          |  +----------------------------------------------------+  |
| (o) Search+web     |                                                          |
|                    |  Models on this computer            [ Add a model ]      |
| SYSTEM             |  Chat 27B   installed   16 GB         ...  >             |
| (o) Apps+devices   |                                                          |
| (o) Backups        |                                                          |
| (o) Advanced       |                                                          |
+--------------------+----------------------------------------------------------+
|#| = filled row with accent bar
```

### 3.2 A page: a short summary, tabs for siblings, one level of detail

Every page follows one template (all kit parts; the IA note's cap of 10 visible settings stays):

1. **Summary strip (optional).** One card at the top with the page's state and its most common action ("Chat is on. 2 of 3 AI jobs
   ready." with the pause switch). This replaces the pause switch buried above 13 pickers and the Finish setting up checklist stacked
   on General: the checklist becomes a collapsed "Finish setting up, 3 left" row that opens a dialog.
2. **Tabs for sibling topics** (`Tabs`, line style, at most 5, at the top of the content pane, reflected in the URL as `?tab=` so a
   link and the back button work). A page with one topic has no tabs. Examples: AI and models: Overview, Models, Engines, Advanced;
   Pictures, videos and music: Pictures, Video, Music; Apps and devices: Apps, Devices, Integrations; Notifications (personal):
   This device, Telegram.
3. **Value rows, not editors.** A setting with a short value shows it on the row ("Chat model: Qwen3.8 27B  Change >"). A boolean is
   a switch on the row. A choice with more than 4 options, any text field with a secret, and anything with a unit opens a small
   dialog (`Dialog`; a `Drawer` on a phone) with the control, its help sentence and Save and Cancel. Selects stay inline only when
   they have 2 to 4 options. The 13 role pickers become one row each in the Models tab with the value showing, which also deletes the
   13 identical help sentences.
4. **Detail is a second level, never inline.** A row with its own settings (a model, a voice, a robot, an app, a backup target) has a
   chevron and opens a **detail screen**: a route (`/settings/home/devices/<id>`), the same shell, the trail extended
   (`... / Devices / Astro`), a back link, and the detail's own tabs. This is the iOS and Home Assistant pattern, and it already
   exists in a rough form (`?device=`); this makes it the rule. Short confirmations and forms (name a robot, add a voice) are
   dialogs. A long edit (the robot's 13 settings) is a detail screen, never an expander.
5. **"Show advanced" is a tab or a row that opens a detail screen, not an in-place expander.** The in-place fold that pushes content
   down is retired. Expert keys stay on Advanced and Developer tools.
6. **Danger last.** A card headed "Remove or reset" at the bottom of a detail screen holds "Forget this robot", "Delete this
   voice" and similar, each through `DestructiveConfirm` as today.
7. **Sticky page header** with the title and the trail, so the "where am I" cue never scrolls away; the page content scrolls under it.

### 3.3 The Devices page, concretely

Today: the robot list, the StackChan install dialog, Add a robot (a multi-step form inline), the robot password and, once a robot is
paired, up to 13 robot keys all stack on one page, and opening anything makes it longer.

New (Household settings > Apps and devices > Devices tab, `/settings/home/devices`):

- **A list card, one row per device**: icon tile for the kind (robot, phone, browser, pod), name, area, a state chip (Connected,
  Last seen 3 h ago, Needs update), battery when it has one. A search or filter box appears only past 6 rows. `[ Add a device ]`
  sits in the card header and opens a **dialog** with the existing steps as a stepper (kind, then the one-time code or QR, then
  done), so the page does not grow while someone pairs. The StackChan install is the same dialog's robot branch.
- **A row opens the device's detail screen** (`/settings/home/devices/<id>`) with tabs: Overview (state, battery, link health, the
  robot card actions: restart, live view), Behaviour (the 13 robot keys in two cards, quiet hours and watch level first, the
  rest in an Advanced tab), and Access (name and area edit as a dialog, the off-LAN switch). The danger card at the bottom of
  Overview holds Unpair or Forget.
- **The robot password** moves out of the page into Apps and devices > Integrations or the Access tab as one row that opens a
  dialog, since it is set once.
- **A person's own phones and browsers** (`DevicesSection`) are the same list on the personal side under "Sign-in and devices", with
  Sign out as a row action behind a confirm, as now.

Wireframe:

```
Household settings / Apps and devices / Devices
Apps and devices        [ Apps ] [ Devices ] [ Integrations ]
+------------------------------------------------------------+
| Devices                                   [ Add a device ] |
| (R) Astro        Living room   Connected   battery 82%   > |
| (P) Dad's phone  This account  3 h ago                   > |
| (B) Kitchen tab  Browser       today                     > |
+------------------------------------------------------------+
   (tap a row) ->  Household settings / Apps and devices / Devices / Astro
                   [ Overview ] [ Behaviour ] [ Access ]
```

### 3.4 The Engines and AI page as the worked example of "not crowded"

Today: 35 keys and 7 panels in one scroll. New: four tabs. Overview (pause switch, one value row per job, the install state, "Add a
model"), Models (one list, a row per installed or available model with size and a Needs install or Installed chip; a row opens the
detail; Add opens a dialog), Engines (the console, read mostly), Advanced (context overrides, Hugging Face token). No tab holds more
than 10 rows; the longest page drops from about 5 screens to about 1.5. Install state shows through the existing progress strip
(S6), never a new banner.

### 3.5 Phone

Unchanged in spirit and better in practice: the column is the first screen, each row shows its icon tile and value, a page drills in
under a back row with the trail as the title, tabs become a horizontally scrolling strip, dialogs become bottom drawers, and the
detail screen is one more drill-in. The Mine and Household switch sits above the list. A 44 px minimum target holds (ease.targets).

## 4. What needs a commons change first (rule 9)

| Change | Where | Size |
|---|---|---|
| Area title and reach Badge as props, Mine and Household switch slot, hide a one-item group heading, icon tile row, optional per-row summary, active row style, 260 and 760 px widths | `commons/ui` `SettingsShell`, `SectionSidebar`, the `--settings-*` tokens | M |
| Breadcrumb trail and sticky header in the content pane | `SettingsShell` (kit `Breadcrumb`) | S |
| Page tabs declared as data: a section may list `tabs` (id, label, and the cards or view each holds) in `areas.json`, drawn by the shell and kept in `?tab=` | `commons/spec` `areas.json` schema and `areas-check`, `SettingsShell` | M |
| Value row: a `SettingRow` variant that shows the current value and opens a Dialog or Drawer to edit; used for selects with more than 4 options, text and secrets | `commons/ui` `SettingsRenderer`, `SettingRow` | M |
| Detail route: a section may declare a `detail` view with a path parameter; the shell extends the trail and shows Back | `areas.json`, `SettingsShell`, Home route table | M |
| Retire the in-place advanced fold in favour of the Advanced tab | `SettingsRenderer` | S |

Home-side work after the pin bump: the Devices list, add dialog and detail screen (recompose `HouseholdRobotsSection`,
`AddRobotSection`, `RobotPasswordSection`; no new data), the Engines tabs, and the IA note's page moves.

## 5. Order of work (supersedes the IA note's slice order, same slices)

Visible relief first, big content moves second. Each slice is its own landing.

| Slice | What | Why this order |
|---|---|---|
| SETTINGS-UX-01 (S, Home) | Column title from the area, reach Badge, remove one-item group headings, fix `/settings/home/voice`, a non-admin gets an explanation not a silent redirect (this is the IA note's SETTINGS-IA-01 plus the heading fix) | Fixes the "column is hard to read" complaint with no spec change |
| SETTINGS-UX-02 (M, `commons` ui, then pin) | Icon tile rows, strong active row, trail and sticky header, 260 and 760 widths, Mine and Household switch | "Recognize where you are" |
| SETTINGS-UX-03a (S, `commons` ui) | Sides switch selected state, a choice of more than four edits in a dialog (in `ui-v0.5.313`) | Built |
| SETTINGS-UX-03b (M, `commons` spec then ui, then Home pin) | Page tabs and detail views declared as data, area scope and checks; moves UX-04 and UX-05 onto them (see the architect ruling) | Removes the in-place sprawl everywhere at once |
| SETTINGS-UX-04 (M, Home) | Devices: list, Add a device dialog, device detail screen with tabs, password row | The page Jesse named |
| SETTINGS-UX-05 (M, Home) | AI and models in four tabs; the 13 role choices as value rows | Biggest page |
| SETTINGS-IA-04 to -06 (the IA note) | The 9 household pages and 7 personal pages, News shelf move | Content moves land on the new template |
| SETTINGS-UX-06 (S) | Verification: captures at 1440 and 390, light and dark, owner, adult, teen and child; a11y matrix; the user doc page | Done means opened and judged |

UX-01 and UX-02 do not depend on the spec; UX-03 and the IA-02 spec work share one `areas.json` change and should be one tag.

## Supersedes

This note overrides these parts of [settings-ia-2026-10-18.md](settings-ia-2026-10-18.md) (that note carries the matching list):

- Its "each page is one scroll" (5.2) and "one Show advanced row per page" (5.5, backlog SETTINGS-IA-03): replaced by summary strip, page tabs, value rows and detail screens; nothing expands in place.
- Its slice order (section 9): replaced by section 5 of this note.
- Its 10-per-page cap: counted per tab.
- The `?device=<id>` drill-in of the robot list: replaced by a detail route, with `?device=` redirecting to it.
- ENGINES-AI-01's single-page Engines and AI layout: replaced by four tabs.

## Architect ruling (2026-10-22) and what it changes in this plan

The architect found the design conforming on the merits (S4, rule 9c) and required: (1) tabs are declared as data in `areas.json` and drawn by `SettingsShell`
(a controlled tab prop; Home passes `?tab=`), one tab mechanism only; (2) a view never places settings keys, and the keys that today are split across three
Engines and AI tabs by hand-picked lists get their own registry groups (`lives_in`, one per tab) so every group stays in exactly one card; (3) detail screens
declare their own tabs in data, `?device=` redirects to the new path, and a detail screen is not a page in the page-count check; (4) the page-count check applies
to `home` and `account` only, and the package household-card check is allowlisted until SETTINGS-IA-06. The hand-written tabs landed in SETTINGS-UX-04 (Devices)
and SETTINGS-UX-05 (Engines and AI) move onto the data tabs in the same Home change that bumps the pin; until then they are a known S4 gap
(`SettingsSectionContent.tsx` hides the `household.ai` card and `settingsViews.tsx` redraws its keys).

## 6. Risks and open points

- **Tabs plus 9 pages could hide things.** Mitigation: search covers every tab, and the cap of 10 settings per page counts all
  tabs together unless a tab is its own topic (Models); the lint (IA note 6.5) counts per tab.
- **Detail screens add routes.** Each is one new path under the existing `/settings/<area>/<section>`; the redirect table test (IA 6.7)
  covers them.
- **Reset to default** is still the open owner question in the IA note, section 8; nothing here depends on it.
- **Rule 9** applies to every step: no `className` that changes shape or layout on an Element in Home; anything missing is a
  `commons` prop first.

## 7. Decisions (Jesse, 2026-10-22)

1. Order: readability first (UX-01 to UX-05), then the IA note's page moves.
2. Add and quick edits in dialogs (a bottom drawer on a phone); anything with many settings on its own detail screen. Nothing expands the page.
3. Admins get the Mine | Household switch at the top of the column; the avatar menu entries stay.
