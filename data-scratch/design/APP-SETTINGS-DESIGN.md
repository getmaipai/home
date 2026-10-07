# App settings: one settings shell, a settings area per app, Home settings for admins

Status: design, 2026-10-06. Author: Opus architect-designer. Slices: [APP-SETTINGS-SLICES.md](APP-SETTINGS-SLICES.md).
Needs architect verdicts before dispatch (the S1 amendment in section 7 is NEEDS-RULE-CHANGE, owner-approved by the order below).

Owner's order (Jesse, 2026-10-06), verbatim: "you still need to build out chat settings which should be separate from home
settings. For every app we have (chat, music, video, etc) they all have their own settings. This saves us from having one
massive settings area for users. Every settings area should look like ChatGPT's: see this screenshot and implement exactly.
That means move our Home settings to a separate menu item under an admin's profile. Also remove Customize since we'll have
skills under our chat settings."

Reference: `data-scratch/chat-ab/settings-reference/chatgpt-settings.png` (ChatGPT desktop app, dark, 3456 x 2234 device
pixels at 2x, so 1728 x 1117 CSS px). All measurements in section 4 were taken from its pixels, not estimated by eye.

Sources read: `docs/design/RULES.md` (rule 9 a to c, S1 to S3), `docs/design/ELEMENTS-DECISIONS.md`, org
`docs/SETTINGS.md`, `docs/PACKAGES.md`, `docs/UI.md`, `MASTER-DESIGN.md`, `CHAT-UI-SPEC.md`, `DATA-MODEL.md` section 3,
`ELEMENTS-MASTER-PLAN.md`, the spec registry at the pinned tag (`spec-v0.1.87`, 103 keys), the kit at `ui-v0.5.123`
(`dashboard/components/ui/sidebar.tsx`, `item.tsx`, `elements/settings-panel.tsx`, `settings/*`, `tokens.css`), and Home's
`NextSettingsPage.tsx`, `next/pages/settings/*`, `ChatColumn.tsx`, `RailProfile.tsx`, `NextRoutes.tsx`,
`LegacyNextRedirect.tsx`, `backend/src/lib/search/providers.ts`, `backend/src/settings/*`.

---

## 1. Decisions in one page

1. **One shell, many areas.** Every settings screen is the same kit part, `SettingsShell` (new, in `commons` ui), drawn
   to the right of the 56 px rail: a 288 px settings column (title, search, grouped section list) and a content pane
   (page title, section headings, rounded cards of rows, centered 728 px column). Home passes data, routes and copy only.
2. **An area is data, not code.** A settings area (`chat`, `account`, `home`, later `library`, `music`, `video`) is a
   `SettingsArea` record from the spec: its title, its sidebar groups, its sections, and for each section the cards it
   shows. A card is one registry group (`lives_in`) at one scope. Central and core-app areas live in
   `spec/settings/areas.json`; a catalog app package declares its area in `contributes.settings_area` with the same
   schema. Each registry group is placed in exactly one card, so each key has one home (principle 4).
3. **Three kinds of area.** App areas (Chat now; Library, Music, Video as their keys land) open from the app's own gear.
   **Account** ("Settings" in the profile menu) holds person-level settings that do not belong to one app: profile,
   appearance, notifications, voice, data and privacy, this device. **Home settings** (admins only, a new profile menu
   row) holds household settings: general, people, search, integrations, AI, robots, storage and backups, maintenance,
   developer tools.
4. **Routes:** `/settings/<area>/<section>`. `/settings/<area>` opens the first section the viewer may see.
   `/settings` goes to `/settings/account`. Every old URL redirects (section 5).
5. **Search** in the settings column searches that area only, over what the viewer may see, and shows live, editable
   rows with a section breadcrumb. The rail's global Search keeps finding settings everywhere and now links to
   `/settings/<area>/<section>#<key>`.
6. **Customize is removed** from the chat history column. Skills becomes Chat settings > Skills; the companion
   (Personality) goes to Chat settings > Personalization; voice to Account > Voice; look to Account > Appearance.
   `/customize` redirects to `/settings/chat/skills`.
7. **Profile menu per role:** admins and the owner gain "Home settings"; "Settings" opens Account for everyone;
   Incognito leaves the profile menu for the rail More menu (RAIL-03). One S1 amendment carries both changes.
8. **Visual parts:** shadcn `Sidebar` (static, `collapsible="none"`) for the column, `Item`/`ItemGroup` for the cards,
   `Switch`, `Select`, `Button`, `Input`, `Badge`, `Empty`, `Collapsible` as they ship. The look is reached by additive
   kit variants and tokens (section 4.3), never by overrides in Home. assistant-ui's `settings-panel` Element stays
   NO-FIT (ED-013): it is a 384 px model, system-prompt and temperature card, nothing like this page.
9. **Records that are not settings stay their own pages** (Users, Models, Backups, Updates, Repairs, Performance,
   Status, Storage, Privacy, Voices, Commands, Devices, Engines). Settings reach them through link rows. Moving any of
   them inside the shell is later work (owner question Q1).

---

## 2. Architecture

### 2.1 The `SettingsArea` record (spec first)

New schema `spec/schemas/settings-area.schema.json`, new data file `spec/settings/areas.json`, and a new
`contributes.settings_area` property on `manifest.schema.json` (its `contributes` description already names "settings
sections" and "admin sections" as blueprint kinds). Shape:

```jsonc
{
  "id": "chat",                       // route segment; unique; not one of the reserved ids below
  "title": "Chat settings",           // column title
  "app": "/chat",                     // the nav entry that owns it (absent for account and home)
  "audience": { "min_role": "guest" },          // who sees the area at all
  "groups": [                                    // sidebar groups, in order
    { "label": "Chat", "sections": ["general", "personalization", "skills", "shortcuts"] },
    { "label": "Related", "sections": ["voice", "notifications", "memories", "household"] }
  ],
  "sections": [
    {
      "id": "general", "label": "General", "icon": "settings",
      "kind": "keys",                            // keys | view | link
      "cards": [
        { "group": "person.chat",   "scope": "person", "label": "Chat",   "bands": ["teen", "adult"] },
        { "group": "person.search", "scope": "person", "label": "Search" }
      ],
      "keywords": ["photos", "pictures", "safe search"]
    },
    { "id": "skills", "label": "Skills", "icon": "sparkles", "kind": "view", "view": "chat.skills",
      "bands": ["teen", "adult"] },
    { "id": "voice", "label": "Voice", "icon": "mic", "kind": "link", "href": "/settings/account/voice" },
    { "id": "household", "label": "Household chat", "icon": "house", "kind": "link",
      "href": "/settings/home/ai", "min_role": "admin" }
  ]
}
```

Fields on a section and a card: `min_role` (the role ladder `owner, admin, adult, teen, child, guest`), `bands`
(`child | teen | adult`), `needs` (capability ids, for example `robot.paired`, `wakeword.assets`), `collapsed` (a card
that starts folded), `order`. A `link` section draws the ChatGPT arrow row (`ArrowUpRight`) and navigates; its `href`
may hold `{self}` for the viewer's id. A `view` section names an entry in Home's view table (2.5); the spec lists the
allowed view ids so a package cannot name one Home does not have.

Reserved area ids (static legacy routes already own them): `users, models, backups, voices, commands, devices, repairs,
updates, health`. The manifest lint refuses a package id equal to one.

Conformance tests in `spec/` (the definition of "one definition, one place"):

- every registry group at every scope that holds a basic or advanced key appears in exactly one card of one area;
- expert keys appear only in a `developer` section (SETTINGS.md rule 4);
- every card's group exists at that scope; every section id is unique within its area; every `view` id is in the list;
- robot-only `hello` keys (`robot.hello`) are excluded (the robot renders them).

Why groups and not single keys: the registry already groups by `lives_in`, Home's renderer and the kit's
`groupSettings()` already draw one card per group, and the bot does not read `lives_in` for layout. Placing groups
keeps the record small and leaves existing keys untouched except the ten moves in 3.5.

### 2.2 Routes

| Path | Who | What |
|---|---|---|
| `/settings/:area/:section` | per area and section audience | the shell with that section open |
| `/settings/:area` | same | desktop: replace to the first visible section; phone: the section list |
| `/settings` | everyone | replace to `/settings/account` |
| `/settings/home/*` | owner, admin | others replace to `/settings/account`, with no household request made first |
| a section the viewer may not see, or an unknown one | | replace to the area's first visible section; the response never says the section exists |

The settings routes sit under `FullLayout rail` but outside `NextPageHeaderLayout`: like ChatGPT's page, they draw no
slim title bar; the column title is the page's heading. No rail item is highlighted on a settings page (the reference
shows none). Browser back returns to where the person came from; the rail is always there (S1).

Settings areas only ever read and write the viewer's own person scope (`person:<self>`), the household scope (Home
settings, admins), and this device. No settings route takes a person id. A parent reaches a child's settings from
Family > the child > Limits, as today; an admin never reaches a teen's (owner ruling 2026-09-30).

### 2.3 Entry points

- **Chat:** the gear already in the history column header (`CHAT_SETTINGS_PATH`, CHAT-SETTINGS-01) points to
  `/settings/chat`. Tooltip "Chat settings".
- **Any other app:** the app's header gets the same gear when its area exists and has at least one section the viewer
  may see. The shell finds the area by `area.app` matching the nav entry. No area, no gear.
- **Profile menu:** "Settings" opens `/settings/account`; "Home settings" opens `/settings/home` (owner and admin only).
- **Global search (rail):** setting results link to `/settings/<area>/<section>#<key>`, computed from `areas.json`
  in `backend/src/lib/search/providers.ts` (today it builds `/next/settings?tab=...&section=<lives_in>`). The
  result is filtered by the same audience rules, so a child never sees a household key as a result.

### 2.4 Search inside an area

The column's search field (`SidebarInput`, 36 px pill) searches only the open area: key labels, help text, option
labels, section labels and each section's `keywords`, over the keys and sections the viewer may see. Typing replaces
the content pane with "Results" (page title) and the matching rows, grouped under breadcrumb headings
("General / Search"), each row live and editable. `?q=` holds the query so a result list is a deep link; Escape or
clearing returns to the open section. No match shows the kit `Empty` with "No settings match". The matching function is
a pure kit helper, `searchSettings(area, registry, values, viewer, query)`, next to `groupSettings()`.

What ChatGPT's own settings search does on input is not visible in the screenshot (UNVERIFIED); the behavior above
follows SETTINGS.md rule 6 ("search results with breadcrumbs").

### 2.5 Rendering: what is kit, what is Home

| Layer | Owner | Notes |
|---|---|---|
| `SettingsShell` (column, search, groups, arrow rows, content pane, page title, phone drill-in) | kit, new | built from `Sidebar*` and `Item*`; Home passes `area`, `activeSection`, `onNavigate`, `searchQuery`, children |
| Card per group, row per key, selector-to-control table, advanced fold, reset, value plus Change rows | kit `SettingsRenderer` and `SettingRow`, refreshed | today's kit copies import dead `@/kit/*` paths; Home's `NextSettingField` (with `min-h-12 w-64` overrides) and `PersonMultiSelect` move into the kit and are deleted from Home |
| Grouping and search | kit `groupSettings()`, new `searchSettings()` | pure functions |
| Area definitions | spec `areas.json`, package manifests | data |
| Fetching registry and values, writes, the per-key hooks (browser alert permission before `notifications.browser.enabled`) | Home hook `useSettingsScope()` | no markup |
| View table (`account.profile`, `account.device_appearance`, `chat.skills`, `chat.shortcuts`) | Home, one map from view id to the existing component | the components already exist; their own restyles are Elements cleanup items |
| Routes, redirects, copy | Home | |

Home writes no settings component: no `SettingsSectionFrame`, no `LinkCard`, no `Card` around a renderer. A link row
inside a card is the kit `Item` rendered as a router link (`render`) with a trailing chevron, as it ships.

### 2.6 Phone and narrow widths

Below the kit's `lg` breakpoint (960) the shell drills in, as ChatGPT's phone app does: `/settings/chat` shows the
column full width (title, search, groups); choosing a section pushes `/settings/chat/general`, which shows the content
with a back row ("Chat settings") at the top. The rail stays (S1). Rows keep the control on the right; helper text
wraps; targets reach 48 px through the kit hit area (`hitArea48`, K03), not by growing the control; body type follows the
kit's phone token. From `lg` up the two panes sit side by side; between 960 and 1100 the card column is fluid with 24 px
side room.

---

## 3. What lives where

Audience notation: A = owner and admin, Ad = adult, T = teen, C = child, G = guest. "Today" says where the item is now,
so the move is traceable; nobody gains or loses access in this change.

### 3.1 Chat settings (`/settings/chat`, title "Chat settings", gear in the chat history column)

| Group | Section | Contents | Who | Today |
|---|---|---|---|---|
| Chat | General | card "Chat": Send photos in chat (`chat.photo_uploads`), Show pictures in answers (`reference.images`), Show advanced reply stats (`ui.show_turn_stats`, advanced fold). Card "Search": Safe search level (`search.safe_search`) | Chat card: Ad, T, A. Search card: all | Me > Chat; Me > Appearance > Advanced; `reference.images` was not shown anywhere |
| Chat | Personalization | card "Personality": `persona.active_id`. Later: "About me" and "How to answer me" (CHAT-CUSTOMIZE-01b, spec first) | all | Me > Chat; Customize row |
| Chat | Skills | view `chat.skills` (SKILLS-PAGE-01 content: Included and Added to this home, used in chat or not) | Ad, T, A (teen's private) | `/customize` on the projects branch |
| Chat | Keyboard shortcuts | view `chat.shortcuts`, drawn from `next/pages/chatShortcuts.ts` (the one definition; Cmd+/ keeps working) | all | Cmd+/ sheet only |
| Related | Voice (arrow) | links to `/settings/account/voice` | all | |
| Related | Notifications (arrow) | links to `/settings/account/notifications` | all | |
| Related | Memories (arrow) | links to `/people/{self}?tab=memories` | all | Family > me > Memories |
| Related | Household chat (arrow) | links to `/settings/home/ai` | A | |

Not added: "Data controls" (delete all chats, archived chats) and a model default (`person.chat.model_id`) have no
feature or key yet; they arrive as cards when their keys land in the spec. No new key is introduced by this design.

### 3.2 Account (`/settings/account`, title "Settings", profile menu "Settings")

Kept separate from Chat because each of these serves more than one app: the speaking voice is used by chat read-aloud,
the robot and the pods; notifications come from every app; appearance and profile are the person's everywhere.

| Group | Section | Contents | Who | Today |
|---|---|---|---|---|
| Personal | Profile | view `account.profile` (ProfileForm, face enrollment) and card "Face enrollment": `ui.enrollment_sounds` | all | Me > Profile |
| Personal | Appearance | card "Appearance": `ui.appearance`, `ui.look`; view `account.device_appearance` ("On this device only") | all | Me > Appearance |
| Personal | Notifications | card "Alerts": `notifications.browser.enabled`, `notifications.time_sensitive.robot`, `notifications.file_shared.muted_senders`, quiet hours (`person.quiet_hours.*`). Card "Telegram" (collapsed): chat id and the per-event switches | all (as today) | Me > Notifications |
| Personal | Voice | card "Voice" (`tts.voice_id`, rendered as "Speaking voice" for a distinct landmark); view `account.voice`: each person's built-in voice selection and cloned recordings; adult+ link "Create a command" (`/commands`) | own voice controls: all; command creation: adult+ | Me > Voice and AI |
| Personal | Data and privacy | card "Your data": link rows Signed-in devices (`/devices`), Storage (`/storage`), What connects to the internet (`/privacy`) | all | Me > Privacy and data (the Status link goes: Status is in the profile menu) |
| Devices | This device | card "Wake word": `voice.wakeword.enabled` (device scope) | Ad and up, `needs: wakeword.assets` | Settings > This device tab |
| Devices | Robot | card "Robot": `person.robot.*`, `person.vision.*` | Ad, T, A; `needs: robot.paired` | not shown anywhere |
| Developer | Developer tools | expert person keys: `ui.pinned_apps`, `security.session_lock_*` | A | not shown |

### 3.3 Home settings (`/settings/home`, title "Home settings", profile menu "Home settings", owner and admin only)

| Group | Section | Contents | Today |
|---|---|---|---|
| Household | General | card "Household": `household.family_name`, `household.home_place`, `household.locale`. Card "History": `household.conversation_retention_days`. Card "Internet check": `status.internet_probe.*` | Household > General |
| Household | People | card "Manage": link rows Users (`/users`), Family (`/people`) | Household > People |
| Household | Search | card "Web search": `search.searxng_url`, `search.wikipedia_fallback`, `search.brave_api_key` (hosted key, off by default, with what it sends) | Household > Integrations, Advanced AI |
| Household | Integrations | card "Home Assistant": `home.base_url`, `home.access_token`, `safety.alarm.sensors`. Card "Telegram": bot token, household quiet hours. Card "Reference library": `reference.library_dir` | Household > Integrations |
| AI | AI | card "Chat": `chat.teen_gate_grain` and the engine overrides (advanced fold); card "Manage": link rows AI models (`/models`), Engines (`/engines`) | Household > AI |
| Household | Voices | view `home.voice_catalog`: browse the shared community voice catalog (`/settings/home/voices`) | owner and admin; each person keeps their own voice pick and cloned recordings in Account > Voice | `/voices` |
| Household | Commands | view `home.commands`: household command list and deletion (`/settings/home/commands`) | owner and admin; adult creation stays in Account > Voice | `/commands` |
| Robots | Robot | card "Robot": the household `robot.settings` keys (initiative, greetings, live view, alarm, vision on request) | `needs: robot.paired`; not shown today except quiet hours |
| Care | Storage and backups | card "Limits": `household.storage` keys and `backup.max_total_gb`; card "Manage": Backups, Storage | Household > Storage and backups |
| Care | Maintenance | card "Manage": Updates, Repairs, Performance, Status | Household > Maintenance |
| Care | Privacy | card "Manage": What connects to the internet (`/privacy`) | rail Privacy entry |
| Developer | Developer tools | household expert keys: `chat.model_id`, `engines.stack.*` | not shown |

`VoiceCatalogSection` in Home settings browses the shared community catalog; the existing API has no shared download or
delete operation, so those controls are not invented here. The route and server enforce owner/admin access. The
person's own voice pick and cloned recording controls remain in Account > Voice; no teen mode account's private settings
or entries are exposed to admins.

### 3.4 Library, Music, Video and every later app

An app area is declared by its package (`contributes.settings_area`) or, for a core app, in `areas.json`, and needs no
Home code: the gear appears in that app's header when the area has a visible section. The first ones arrive with their
keys: Library with `media.edits`, `media.background_index`, `media.place_precision`, `media.acoustid.enabled`
(MEDIA-INT-02, -05b); a household key in an app area is shown in that app's area only to admins, in its own card, and
the area's "Household" arrow row is not needed. Family has no keys of its own today, so it has no area.

### 3.5 Registry group moves (spec first, then Home's key declarations)

Each move changes only `lives_in` so a group fits one card. Nothing changes scope, default, level or who may write.

| Key(s) | From | To | Why |
|---|---|---|---|
| `ui.show_turn_stats` | `profile.appearance` | `person.chat` | it changes chat replies only |
| `reference.images` | `household.reference` (person scope) | `person.chat` | a person-scope key under a household group; chat-only |
| `ui.enrollment_sounds` | `profile.appearance` | `person.profile` (new group) | it sits beside face enrollment |
| `person.quiet_hours.from`, `.to` | `robot.settings` (person) | `person.notifications` | quiet hours are a notification setting |
| `household.quiet_hours.from`, `.to` | `robot.settings` (household) | `household.notifications` | same, for the household |
| `notifications.telegram.chat_id` and the 15 `notifications.*.telegram` | `person.notifications` | `person.telegram` (new group) | the collapsed Telegram card |
| `backup.max_total_gb` | `household.system` | `household.storage` | storage limits card |
| `status.internet_probe.*` (4) | `household.system` | `household.status` (new group) | its own card |
| `search.brave_api_key` (Home-only today) | `household.integrations` | `household.search` | with the other search keys; spec entry via SEARCH-KEYS-SPEC-01 |

Group titles move from the kit's `sectionTitle()` map into the card `label` in `areas.json` (one place).

### 3.6 Profile menu by role (S1 amendment)

Rows in order. Identity block on top for everyone, unchanged.

| Role | Notifications | System status | Settings | Home settings | Help | Log out |
|---|---|---|---|---|---|---|
| Owner, admin | yes | yes | yes | yes | yes | yes |
| Adult | yes | yes | yes | no | yes | yes |
| Teen | yes | yes | yes | no | yes | yes |
| Child | yes | only while all is good (today's rule, CHAT-CALM-ERRORS-01d) | yes | no | yes | yes |
| Guest | as today | as today | yes | no | yes | yes |

Incognito is in the rail More menu (owner ruling 2026-10-06, RAIL-03), not in this menu. Children and teens see the
same entries they had, minus Incognito's move. The kit `RailProfileMenu` takes an additive `homeSettings` prop
(`{ href, label }`); Home passes it only for owner and admin.

### 3.7 Visibility rules the tests hold

- An area, section or card is drawn only when its audience matches; a keys section with no visible card is hidden; an
  area with no visible section has no gear and its route replaces to Account.
- The server stays the gate: every write is re-checked (`backend/src/lib/settings.ts`); hiding is presentation.
- Search, global search and deep links obey the same filter: a hidden key never appears as a result, a breadcrumb or a
  scroll target.

---

## 4. Visual specification

### 4.1 Measurements from the screenshot

Method: the PNG converted to BMP and read pixel by pixel; device px divided by 2 gives CSS px. Coordinates below are
device px in the original image. Dark theme only; no light reference exists (Q2).

| # | What | Evidence (device px) | CSS px |
|---|---|---|---|
| M1 | Rail width | x 2 to 102, fill (42,41,41) | about 50 (ours is 56, S1, unchanged) |
| M2 | Settings column width | x 104 to 680, fill #1f1f1e | 288 |
| M3 | Column right divider | x 680, (59,59,58), 1 device px | hairline |
| M4 | Column side padding | row fills start at x 120 and end at 663 | 8 each side; rows and search 272 wide |
| M5 | Column title "Settings" | glyph box x 137 to 274, y 192 to 225 (S cap to g descender, 34) | about 18, semibold; left inset 16; cap top about 19 below the column top |
| M6 | Search field | y 258 to 329 (72), x 120 to 663, fill #313030, no border, corner curve 30+ px | 36 tall, pill radius 18, placeholder muted |
| M7 | Group label "Personal" | glyph y 373 to 393, max color (177,177,176) | about 14 to 15, regular, muted (foreground about 70 percent), left inset 16 |
| M8 | Selected row "General" | fill y 422 to 481 (60), x 120 to 663, #313030 (same as search), corner curve 16 px | 30 tall, radius 8, same weight as other rows |
| M9 | Row pitch | text baselines 36 display px apart (62 device px) | about 31 (30 row, about 1 gap) |
| M10 | Row text and icon | "General" glyphs x 186 to 281, y 441 to 462; icon x 139 to 164 | text 14 to 15 regular white; icon glyph 13 in a 16 box, 10 from the row edge; icon to text 8 to 9 |
| M11 | Arrow on link rows | trailing glyph near x 620 to 650, max color (104,104,103) | 14 glyph, foreground about 40 percent, right inset about 12 |
| M12 | Group spacing | last row of one group to next label | about 46 including the 30 px label row |
| M13 | Content background | x 681 to 3429, #181818 | equals `--shell-main` |
| M14 | Card column | card x 1328 to 2783 (1456); content center 2055.5, card center 2055.5 | 728 wide, centered |
| M15 | Page title "General" | glyphs x 1330 to 1516, y 318 to 358 (cap 41) | 28, semibold; cap top about 82 below the content top; left edge = card edge |
| M16 | Title to first section heading | cap top 318 to heading top 469 | about 75 |
| M17 | Section heading "Permissions" | glyphs y 469 to 490, white | 14, medium (13.5 to 14) |
| M18 | Heading to card | glyph bottom 490 to card top 532 | about 21 from glyph bottom (12 from the line box) |
| M19 | Card | border y 532, fill (35,35,35) #232323, border (53,53,53) #353535, 2 device px | 1 px border, fill #232323 |
| M20 | Card radius | outer edge reaches x 1328 at y 558 from 1353 at y 532 | 12 to 13; use 12 |
| M21 | Row separator | y 685, x 1362 to 2749, #353535, 2 device px | 1 px, inset 16 from each inner edge |
| M22 | Row heights | one helper line: 1201 to 1320 (120); two lines: 1048 to 1198 (151); three lines: 687 to 871 (185) | 60, 75.5, 92.5: padding 12 top and bottom, title line 20, helper lines 16 |
| M23 | Row title | "Default permissions" y 566 to 590, white | 14, medium |
| M24 | Helper text | lines at y 759, 791, 823 (32 apart), color (178,178,178) | 13 regular, line height 16, foreground about 70 percent |
| M25 | Helper width | helper right edge at x 2318 from left 1364 | wraps at about 480 to 496; controls keep the right side |
| M26 | Row inner padding | text starts at x 1364, card inner edge 1330 | 16 left; switch right edge 2749 = 16 right |
| M27 | Switch | track x 2686 to 2749 (64), y 1484 to 1523 (40); knob 32; on (57,131,247) #3983f7; off (57,57,57) #393939 | 32 x 20, knob 16, inset 2 |
| M28 | Dropdown button | y 1234 to 1289 (56), fill (42,42,42) #2a2a2a, border (59,59,59) #3b3b3b | 28 tall, 1 px border, radius about 8, text 14, chevron 12, optional leading icon |
| M29 | "Change" button | y 1097 to 1152 (56), x 2629 to 2741, fill (46,46,46) #2e2e2e, no border | 28 tall, about 57 wide, radius about 8, text 14 |
| M30 | Path value | monospace, muted, middle ellipsis, left of "Change" | 13 mono |
| M31 | Card to next heading | card bottom 873 to heading top 983 | about 55 |
| M32 | Inline link "Learn more" | blue, same size as helper | link color token |

### 4.2 Mapping to kit parts and tokens

| Piece | Kit part as it ships | Variant or token it needs |
|---|---|---|
| Column | `Sidebar collapsible="none"` inside a `SidebarProvider` | width token `--settings-column-width: 288px`; `SidebarProvider keyboardShortcut={false}` (additive) so a second provider does not take Cmd+B |
| Column title | `SidebarHeader` with the kit heading type | `--settings-column-title: 18px / 600` |
| Search | `SidebarInput` with the search icon | `variant="pill"`: 36 tall, radius 18, fill `--settings-fill`, no border |
| Group label | `SidebarGroupLabel` | `--settings-group-label: 14px / 400`, muted |
| Section row | `SidebarMenuButton isActive` with icon and label | `size="settings"`: 30 tall, radius 8, padding-x 10, gap 8, text 14 regular when active, active fill `--settings-fill`; menu gap 1 |
| Arrow row | `SidebarMenuButton` plus `SidebarMenuAction`-free trailing `ArrowUpRight` | `external` prop on the kit shell item (renders the icon, `aria-describedby` "Opens another page") |
| Content pane | new layout in `SettingsShell` | `--settings-content-max: 728px`, `--settings-content-top: 82px`, side room 24 minimum |
| Page title | `SettingsShell` title slot | `--settings-page-title: 28px / 600` |
| Section heading | `SettingsShell` section slot | `--settings-section-heading: 14px / 500`, 12 to the card, 56 between a card and the next heading, 75 from the title |
| Card | `ItemGroup` | `variant="card"`: gap 0, 1 px `--settings-card-border`, radius `--radius` (12), fill `--settings-card`, overflow hidden |
| Row | `Item` with `ItemContent`, `ItemTitle`, `ItemDescription`, `ItemActions` | `Item size="setting"`: padding 12 x 16, minimum 60, gap 16, actions vertically centered; `ItemDescription clamp={false}` (the shipped `line-clamp-2` cuts the three-line rows); content max `--settings-row-text-max: 496px`; title 14/500, helper 13/16 muted |
| Separator | `ItemSeparator` | `variant="inset"`: margin 0 16, 1 px `--settings-card-border` |
| Toggle | `Switch` | `size="md"`: 32 x 20, knob 16; checked color token `--switch-checked` (default `--primary`; the Neutral look sets #3983f7) |
| Dropdown | `Select` / `SelectTrigger` | `size="row"`: 28 tall, radius 8, 1 px `--settings-control-border`, fill `--settings-control` |
| Change, Reset, Set | `Button variant="secondary"` | `size="row"`: 28 tall, radius 8, padding-x 10, fill `--settings-button` |
| Path or URL value | `ItemActions` text | mono 13 muted, middle ellipsis (kit `SettingRow` for `text` values) |
| Number, time | `Input` | `size="row"` 28 tall |
| Person picker | `Combobox` | moves from Home's `PersonMultiSelect` into the kit row |
| Advanced fold | `Collapsible` with an `Item` trigger row ("Show 3 advanced settings") inside the card | none |
| Link row inside a card | `Item render={<Link/>}` with a trailing chevron | none ([a] hover already ships) |
| Empty search | `Empty` | none |
| Save error | `Alert` inline above the cards | none |
| Phone drill-in back row | `SidebarMenuButton` with a chevron | none |

Neutral dark values the tokens must produce (sampled; other looks keep their tint by the same mixes, light mirrors the
order until a reference exists): page #181818 (`--shell-main`), column #1f1f1e (`--shell-history`), card #232323
(background mixed toward foreground 10.4 percent), card border and separators #353535 (17.9 percent), active row and
search fill #313030 (16.3 percent), dropdown fill #2a2a2a with border #3b3b3b, button fill #2e2e2e, switch off #393939,
helper and group label about #b2b2b2 (foreground 70 percent; the Neutral `--muted-foreground` #a1a1a1 is 17 units
darker, so the kit adds `--settings-helper`), arrow icon #686867.

### 4.3 Kit gaps, all additive in `commons`

1. Settings tokens in `tokens.css` (the list above), declared for light and dark and every look. The shell tones they
   build on (`--shell-main`, `--shell-history`, `--shell-divider`) move from Home's `shell/tokens.css` into the kit with
   cleanup items 4 and 8 (ED-032, ED-033); until then the settings tokens reference the same mixes directly.
2. `ItemGroup variant="card"`, `Item size="setting"`, `ItemSeparator variant="inset"`, `ItemDescription clamp`.
3. `Switch size="md"` and `--switch-checked`.
4. `size="row"` on `Button`, `SelectTrigger`, `Input`; `SidebarInput variant="pill"`; `SidebarMenuButton size="settings"`.
5. `SidebarProvider keyboardShortcut` prop.
6. `SettingsShell` composite and `searchSettings()`.
7. `SettingsRenderer` and `SettingRow` refreshed onto the dashboard primitives (replacing the stale `@/kit/*` copies).
8. `RailProfileMenu homeSettings` prop.

Each lands in `commons` with a tag before the Home slice that uses it (rule 9 c). Home adds no `className` to any of
these parts beyond placement, and no CSS aimed at a kit `data-slot`.

### 4.4 Standards notes (flags, not blockers)

- UI.md sets a 16 px body floor on phone and desktop; the kit's `--font-size-body` is already 13.5 px and ChatGPT's
  rows are 14 and 13. This design follows the kit on desktop and the kit's phone type on phones. The org text and the
  kit disagree already; the coordinator should file that as a standards issue.
- Targets: rows are 60 px; 28 px controls get the kit 48 px hit area on coarse pointers, as the chat controls do.

---

## 5. Customize removal and redirects

Removed: the Customize row in `ChatHistoryPanel` (`ChatColumn.tsx` lines 431 to 440 at 372f7dad: `CustomizeIcon`, the
Link to `/settings?tab=me`, its tooltip "Your companion, voice and look"), its `tokens.css` comment, and the row in
CHAT-UI-SPEC section 2 item 3, section 9's table and MASTER-DESIGN sections 1 and 2.2. The fixed rows become Projects and
Artifacts. Where its content went:

| Was under Customize | Now |
|---|---|
| Skills (`/customize`, SKILLS-PAGE-01 on `opus/projects`) | Chat settings > Skills (view `chat.skills`, same component, same API) |
| Companion (Personality) | Chat settings > Personalization |
| Voice | Account > Voice (Chat settings has a Voice arrow row) |
| Look | Account > Appearance |
| "About me", "How to answer me" (planned) | Chat settings > Personalization, when CHAT-CUSTOMIZE-01 lands |

Redirect table (each row a test; `replace`, query and hash kept where they map):

| Old | New |
|---|---|
| `/settings` (no query) | `/settings/account` |
| `/settings?tab=me` | `/settings/account` |
| `?tab=me&section=profile` | `/settings/account/profile` |
| `?tab=me&section=appearance` | `/settings/account/appearance` |
| `?tab=me&section=chat` | `/settings/chat/general` |
| `?tab=me&section=voice-ai` | `/settings/account/voice` |
| `?tab=me&section=notifications` | `/settings/account/notifications` |
| `?tab=me&section=privacy-data` | `/settings/account/data` |
| `?tab=household` (admin) | `/settings/home/general` |
| `?tab=household&section=general / people / ai / integrations / storage / maintenance` | `/settings/home/general / people / ai / integrations / storage / maintenance` |
| `?tab=household...` (not admin) | `/settings/account` |
| `?tab=device` | `/settings/account/device` |
| `?section=<lives_in>` (old search links) | the area and section that hold that group, `#<first key>` |
| `/next/settings?...` | same mapping |
| `/customize` | `/settings/chat/skills` (a child goes to `/settings/chat`) |
| `/settings/users`, `/models`, `/backups`, `/voices`, `/commands`, `/devices`, `/repairs`, `/updates` | unchanged (static redirects already in `LegacyNextRedirect`) |

Also repointed: `NextPersonProfilePage` "Edit profile" link, `liveVoiceSession` "Voice settings" link
(`/settings/voices` today, to `/settings/account/voice`), `NextChatPage` `onOpenSettings`, `shell/nav.ts` and
`appCatalog.ts` Settings entries, `nextPageHeaderTitle.tsx` and `NextRoutes.tsx` titles.

---

## 6. Migration and boundaries

Order: spec record and group moves, then kit parts (two tags), then Home routes and page, then menu and chat column,
then embeds and deletions, then screenshots and docs. Full list with sizes, lanes and tests: APP-SETTINGS-SLICES.md.

File ownership:

- **This program owns** `frontend/src/next/pages/settings/**`, `NextSettingsPage.tsx` (deleted), the new settings route
  file, the settings lines of `NextRoutes.tsx`, `LegacyNextRedirect.tsx`, `shell/RailProfile.tsx`, the Customize lines
  and `CHAT_SETTINGS_PATH` in `ChatColumn.tsx`, `backend/src/lib/search/providers.ts` (settings hrefs), and the
  `lives_in` strings in `backend/src/settings/*.ts`.
- **Elements program keeps** `apps/settings/**` (ModelsSection, cleanup item 9), the chat column's list and CSS
  (ELT-T1-20, cleanup item 3), `shell/tokens.css` shell tones (items 4 and 8), and everything under `apps/chat/**`.
  Cleanup item 11's settings sites under `next/pages/settings/**` and ED-037's `next/pages/settings/*` half are retired by
  this program's deletions, not by item 11; the baselines shrink in APP-SET-05.
- **Projects and Skills agent (a3f0fac5099361c58)** owns the Skills content: `GET /api/plugins/skills`, the skills list
  component and its tests. This program only registers it as view `chat.skills`. If that agent lands Skills first as a
  section of today's frame, APP-SET-04 moves the registration, not the component. `ChatColumn.tsx` is edited by both:
  APP-SET-04 rebases on PROJECTS-01b and touches only the Customize lines and the gear path.
- **Rail and Incognito (RAIL-03)** owns the More menu. One S1 amendment (section 7) covers both changes; whichever lands
  first carries it, the other cites it.

---

## 7. Rules and records this touches

**RULES.md S1 amendment (NEEDS-RULE-CHANGE, owner-approved by his order of 2026-10-06 and his Incognito ruling the same
day).** Replace "the profile control whose menu holds Notifications, System status, Incognito, Settings, Help and Log
out (owner-approved 2026-10-06)" with: "the profile control whose menu holds Notifications, System status, Settings,
Home settings (owner and admin only), Help and Log out; Incognito is in the rail's More menu (owner-approved 2026-10-06)".
New S4: "**Every settings screen is the one kit settings shell.** An app's settings, Account and Home settings are
settings areas declared as data (spec `areas.json` or a package's `contributes.settings_area`) and drawn by the kit's
`SettingsShell`; Home writes no settings layout, and each registry group is placed in exactly one card." The commit
carries `Owner-approved: 2026-10-06`.

**Org `docs/SETTINGS.md` (in `.github`) conflicts with the owner's order and must be updated by the coordinator:** rule
1 says an app's gear "opens the right pane or a sheet with household and personal settings together, plus a 'for
everyone / just me' toggle"; the order makes it a separate page per app with household settings in Home settings. Rule
2's "Profile" and "Household" central pages become "Account" and "Home settings". Flagged here; the repo file does not
silently override the org file.

**ELEMENTS-DECISIONS.md:** ED-013 (settings-panel) gains "reconsidered 2026-10-06 against the ChatGPT settings
reference: still no fit; the settings shell is the dashboard Sidebar and Item". ED-037 is retired for
`next/pages/settings/*` by APP-SET-05. No new row: nothing here declines a shipped Element.

**CHAT-UI-SPEC.md, MASTER-DESIGN.md, DATA-MODEL.md:** Customize row removed; profile menu rows updated; DATA-MODEL
section 3 lists the ten group moves and the new `SettingsArea` record.

---

## 8. Owner questions (genuinely his)

**Q1. Pages like Users, AI models and Backups: link to them from settings, or rebuild them inside the settings look now?**
- **Link to them now, move them in later (Recommended):** settings ship in about a week of slices; those pages open as
  they are today from rows in Home settings.
- Rebuild them inside settings now: everything looks like ChatGPT at once, but it adds roughly ten more slices first.

**Q2. There is no light-mode ChatGPT screenshot. How should light settings look?**
- **Mirror the dark measurements with our light colors (Recommended):** ships now; you can send a light screenshot
  later and we retune colors only.
- Wait for a light screenshot before building light mode: light settings keep the old look until then.

**Q3. ChatGPT has "Parental controls" in settings. Where should a parent change a child's chat switches (photos,
pictures, safe search)?**
- **On the child's page in Family, with a "Parental controls" row in Chat settings that opens it (Recommended):** one
  place per child; teens stay private as ruled.
- A Parental controls section inside Chat settings listing each child: quicker to find, but a second place for the same
  switches.

---

## 9. Risks

- Two `SidebarProvider`s on one page (the app rail's and the settings column's): mitigated by the `keyboardShortcut`
  prop and by the column using `collapsible="none"`; a kit test renders both.
- Group moves change `lives_in` on about 30 keys; anything reading a group id (`only=[...]` call sites: Storage page,
  person Limits, FaceEnrollmentCard; backend search provider) is inventoried in APP-SET-01 and APP-SET-05.
- The legacy static routes under `/settings/*` and the new dynamic `/settings/:area` share a prefix; React Router ranks
  static first, and the reserved-id lint keeps a package from colliding.
- A key with no card would vanish from the UI: the spec conformance test fails on any unplaced basic or advanced key.

## Owner decisions (2026-10-06)

- Order: every app has its own settings area in one shell; Home (household and admin) settings move to a separate admin-only "Home settings" item in the profile menu; the Customize row is removed and Skills live under Chat settings.
- Q1: Home pages (Users, Models, Backups, Updates, Repairs, Status) are linked from Home settings first and rebuilt into the shell one by one afterwards.
- Q2: light mode mirrors the dark measurements now and is adjusted if the owner sends a light reference.
- Q3: a parent changes a child's chat switches on the child's Family page. Chat settings carries a "Parental controls" row that points there. The row shows only to owner, admin and adult accounts that have a child, and never concerns a teen.
- Account's Robot card shows to adults and admins only (teens see no more than before).

## Supersedes

This note supersedes, where they disagree:
- CUSTOMIZE-01 (the Customize row and page) and CHAT-SETTINGS-01's gear target (`/settings?tab=me&section=chat` becomes `/settings/chat`).
- `docs/plans/settings-redesign-2026-09-30.md` for the settings layout.
- The Customize rows in `data-scratch/design/CHAT-UI-SPEC.md` and `MASTER-DESIGN.md`.
- RULES S1's profile-menu list (Incognito moves to the More menu; Home settings is added for owner and admin).
- The org `SETTINGS.md` rules 1 and 2 (gear opens that app's own settings page; Profile becomes Account; Household becomes Home settings).
- DATA-MODEL section 3 where it places settings groups.
- The global search provider's `/next/settings?tab=` links.
- ED-037 in `docs/design/ELEMENTS-DECISIONS.md` for `next/pages/settings/*` (retired for the settings pages once APP-SET-05 lands).
