# Settings information architecture: one household page set a person can read (2026-10-18)
> Status (2026-10-31): superseded in part by [RULES.md](RULES.md): S1 and S4 (2026-10-23), where they differ.

Status: design and audit only, queued behind music (MUSIC-GEN) by the owner's one-thing-at-a-time rule. Nothing here is built.
Priority inside the queue: first after music, because Jesse called the current page overwhelming. Owner words (Jesse, 2026-10-18,
testing v0.2.17): "You are putting household settings on the user settings page." and "We need a better household settings page:
there are so many and it's hard to clearly navigate: it's very overwhelming."

Architect verdict: the author's own line that stood here (2026-10-18, no architect agent run) is stale and is not a verdict. The architect agent ruled on this note's items together with the layout revamp on 2026-10-22; the records are in `data-scratch/architect/` (SETTINGS-IA-02, -04, -05, SETTINGS-UX-03b, SETTINGS-UX-03-detail). Read the Supersedes section at the end before building from this note.

Evidence: the scope audit script and live captures were run on 2026-10-18 against origin/main `49d5b73f` (Home v0.2.17 plus one fix),
pinned `@maipai/spec` v0.1.175 and `@maipai/ui` v0.5.265, on a scratch Home (own data directory, port 8874, owner plus a teen and a
child, no engine installed). Captures are in [assets/settings-ia-2026-10-18/](assets/settings-ia-2026-10-18/).

## 1. The short answer

1. **Jesse's first complaint has a literal cause.** The household page and the personal page are drawn by the same shell and both
   wear the same title, "Settings". `SettingsAreaPage.tsx` passes `labels={{ columnTitle: "Settings" }}` for every area, so the left
   column of Home settings (15 household sections) is headed "Settings", exactly like the personal page. The area's own title ("Home
   settings") is never shown there. Nothing on the screen says "this applies to everyone in the home" or "this is only you".
2. **By declaration the split is almost clean, with 4 real exceptions and 3 borderline groups** (section 3.3). No registry key declared
   `household` is drawn on an Account page. The exceptions are the News app's gear (12 household keys in an app page every person
   opens, against SETTINGS.md rule 1), household quiet hours filed under Integrations, 11 admin-only system alert toggles drawn on every
   adult's Notifications, and the Voice keys filed under Engines and AI.
3. **The household side is overwhelming because it has 15 sections in 15 one-item groups, 122 household keys, and one page (Engines
   and AI) that stacks 35 keys and 7 whole panels into 4,582 px at 1440 and 6,550 px at 390.** Nothing says what matters first. Search
   exists only inside one area, takes no plain words, and the "Changed", "New", "Recommended" and install states do not exist.
4. **Proposed shape: two clearly named sides, 9 household pages and 7 personal pages, at most 10 visible settings per page, advanced
   folded, a Find a setting box on both sides.** A new key lands in the right place from its declaration alone, and a test fails when
   it cannot.

## 2. How a setting reaches a screen today (so the mapping below is checkable)

- A key is declared in Home (`backend/src/settings/*.ts`, 24 files, plus package manifests `config[]`) or in the pinned spec
  (`spec/settings/keys.json`, 210 of the 219 keys; 9 are declared by Home or a package manifest rather than the tag: `search.brave_api_key`, `maps.*`, `news.my_mix`,
  `news.reader_open`, `news.digest`, `weather.*`).
- Each key says `scope` (household, person, device), `level` (basic, advanced, expert) and `lives_in` (a group such as
  `household.ai`). It never says which page it is on.
- The page is chosen by the spec's `areas.json`: an area holds sections, a section holds cards, a card is `group` plus `scope`. A key
  draws on the card whose group and scope match. `checkAreas` (commons `spec/settings/areas-check.ts`) already fails a group that has no
  card and is not in `not_placed`, a group in two cards, an expert key outside a developer section, and a card broader than its area.
  **It never checks that a card's scope matches the kind of area it sits in**, which is the missing lint (section 6.9).
- Sections of kind `view` draw a Home component instead of keys (`settingsViews.tsx`: People, Commands, Voices, Engines console,
  Models and storage, Pictures library and others). Those hold controls that are not registry keys, so key counts understate pages.
- A package may add its own area with `contributes.settings_area` (News, Weather, Music, Podcasts, Videos today). Nothing stops that
  area from holding household cards: News does.
- Search: `SettingsShell` has a per-area search (kit `searchSettings`), and the Home search palette links a key through
  `placeSetting` in `backend/src/lib/settingsAreas.ts`. SETTINGS.md rule 5's `@modified`, `@app:`, `@level:` filters are not built.

## 3. A. Scope audit

### 3.1 Totals

219 declared keys: 122 household, 90 person, 7 device. By level: 150 basic, 57 advanced, 12 expert. 27 are drawn on no settings
page by design (the four `not_placed` groups plus the maps keys that wait for a package area): 20 person (18 on the child's Family
page Limits tab, 2 maps) and 7 device keys the robot draws on its own screen.

### 3.2 Per page today

Keys by the page that draws them (declaration), then what the live page held for an admin on the scratch Home. "Controls" counts
switches, dropdowns and text boxes; "Rows" counts kit list rows; both include the view panels. Hidden advanced folds are inside the key
counts. The scratch Home has no engine, robot or reference library installed, so live counts are lower than a full household's.

Household side, `/settings/home/<section>` (122 household keys including the News shelf):

| Section | Keys | basic / adv / expert | Live controls (switch, dropdown, text) | Live rows | Other panels on the page |
|---|---|---|---|---|---|
| General | 8 | 4 / 4 / 0 | 1, 1, 3 | 15 | Finish setting up checklist (up to 9 rows) |
| People | 0 | n/a | 0, 0, 0 | 2 | the user list view |
| Engines and AI | 35 | 20 / 9 / 6 | 2, 16, 20 | 22 | install plan, Models and storage, engine link, engines console, memory and model choices, model list, Hugging Face token |
| Pictures, videos and music | 11 | 11 / 0 / 0 | 11, 8, 30 | 17 | pictures library, styles, video library |
| Devices | 13 | 12 / 1 / 0 | 0, 0, 1 | 0 | Add a robot, robot password (keys appear once a robot is paired) |
| Search | 23 | 3 / 20 / 0 | 0, 3, 4 | 3 | Web search block, Blocked sites |
| Integrations | 9 | 4 / 5 / 0 | 0, 1, 4 | 9 | Home Assistant, Telegram, Reference library keys, household quiet hours |
| Commands | 0 | n/a | 0, 4, 3 | 0 | commands view |
| Voices | 0 | n/a | 0, 1, 0 | 0 | voice catalog view |
| Storage and backups | 5 | 3 / 2 / 0 | 0, 0, 4 | 7 | Limits, Manage links |
| Reference library | 0 | n/a | 0, 0, 0 | 14 | offline library sets view |
| Maintenance | 0 | n/a | 0, 0, 0 | 4 | links (Repairs, Updates, and others) |
| Privacy | 2 | 2 / 0 / 0 | 0, 2, 2 | 3 | Manage links |
| Developer tools | 2 | 0 / 0 / 2 | 0, 0, 0 | 0 | plugin routing stats |
| Network and access | 2 | 1 / 1 / 0 | 1, 1, 3 | 3 | Set up away access button |
| News shelf (inside the News app's gear) | 12 | 3 / 9 / 0 | not scanned | | list matrix |

Personal side, `/settings/account/<section>` (live counts for an owner; Device, Robot and Developer tools are gated and did not show):

| Section | Keys | basic / adv / expert | Live controls (switch, dropdown, text) | Live rows |
|---|---|---|---|---|
| Profile | 2 | 2 / 0 / 0 | 2, 1, 5 | 1 |
| Appearance | 16 | 14 / 0 / 2 | 1, 14, 15 | 15 |
| Notifications | 21 | 21 / 0 / 0 | 2, 1, 5 | 6 (the 16 Telegram toggles sit in one folded card) |
| Voice | 5 | 5 / 0 / 0 | 0, 1, 0 | 1 |
| Pictures and videos | 3 | 3 / 0 / 0 | 3, 0, 3 | 3 |
| Data and privacy | 0 | n/a | 0, 0, 0 | 3 (links) |
| This device, Robot, Developer tools | 0 + 7 + 2 | 0 / 0 / 0, 7 / 0 / 0, 0 / 0 / 2 | gated | gated |
| Chat settings (`/settings/chat`, a third area) | 8 | 5 / 3 / 0 | not scanned | |
| News reading, Weather places (app gears) | 3 + 3 | 6 / 0 / 0 | not scanned | |

### 3.3 Misplaced keys and groups

Decision rule: a key is misplaced when the person who sees it is not the person it governs, or when the page it is on is not the page
a reader would look on first. Scope is the declaration's word; "household" means it changes Home for everyone.

**Household content a person meets on a personal or app page (the first complaint), do not move yet:**

| # | What | Exact keys and files | Where it renders | Why it is wrong |
|---|---|---|---|---|
| 1 | The News shelf, 12 household keys | `news.shelf.enabled`, `news.poll_interval_s`, `news.retention_days`, `news.lists.child`, `news.lists.teen`, `news.lists.adult`, `news.feeds.child`, `news.feeds.teen`, `news.feeds.adult`, `news.full_text_prefetch`, `news.images`, `news.image_cache_mb` (`backend/src/settings/newsKeys.ts`; area in `backend/packages/news/manifest.json` section `shelf`, `min_role: admin`; `backend/src/lib/settingsAreas.ts` and `frontend/src/shell/pages/settings/settingsAreas.ts` filter the `household.news` card out of Home settings > Search "NEWS-03, spec-owed") | `/settings/news/shelf`, in the News app's gear, an area whose audience is `child` | SETTINGS.md rule 1: "household settings live in Home settings, not in the app's gear" (owner-approved 2026-10-06). NEWS-03 moved them the other way. |
| 2 | Admin system alerts as person toggles | `notifications.engines.problem.telegram`, `.engines.update_available.telegram`, `.engines.update_applied.telegram`, `.engines.update_failed.telegram`, `.backups.target_failing.telegram`, `.repairs.new.telegram`, `.updates.available.telegram`, `.model.download_failed.telegram`, `.model.download_ready.telegram`, `.memory.judge_failed.telegram`, `.approvals.requested.telegram` (`backend/src/settings/notificationKeys.ts`, group `person.telegram`, `areas.json` card "Telegram" at `account/notifications`) | every adult's Account > Notifications > Telegram | The key is rightly per person (each admin picks), but the events are about the household's machine; a non-admin adult sees toggles for alerts they can never receive. |
| 3 | Quiet hours, household | `household.quiet_hours.from`, `household.quiet_hours.to` (group `household.notifications`) | Home settings > Integrations | Household key, wrong household page: it is a household rule, not an integration. (Its personal twin `person.quiet_hours.*` is correct on Notifications.) |
| 4 | Voice keys under AI | `voice.hesitations`, `voice.hf_token` (`backend/src/settings/voiceKeys.ts`, group `household.ai`) | Home settings > Engines and AI | Right side, wrong page: a household voice choice among 35 engine rows. |
| 5 | Session lock | `security.session_lock_required`, `security.session_lock_timeout_minutes` (`securityKeys.ts`, group `person.security`; both are `ADMIN_ONLY_KEYS` in `settingsRegistry.ts`) | Account > Developer tools | Borderline: person scope but only an admin may set it, on a page named for developers. |
| 6 | Offline library | `reference.download.when`, `reference.library_dir`, `reference.update.max_mbps`, `reference.images` (household three and the person one) | Integrations (household), Chat settings (person) | Borderline: it is a search source, filed with Home Assistant. |
| 7 | Emergency pause | `chat.paused`, `chat.paused_message` | first two rows of Engines and AI | Borderline: the household's chat off switch is buried above 33 engine rows. |

Not misplaced, checked: every `Account` card is `person` or `device` scope; the `person.robot.*` keys on Account > Robot and the
household `robot.*` keys on Home settings > Devices share the group `robot.settings` and are split by scope, which is correct; the
guardian-set person keys (`allowance.*`, `topics.*`, `storage.person.*`, `media.allowlist_only`, 18 keys) are drawn only on the child's
own page for a parent, never on a settings page, and are listed `not_placed` with a reason.

**Personal keys on a household page: none.** `generation.kid_enabled` (person scope) is drawn on the child's Limits tab and in
Account > Pictures and videos for the guardian-controlled band; `likeness.*` is person scope and lives only on Account.

**Not settings at all:** `ui.pinned_apps` and `setup.checklist_dismissed` are person keys of level expert that store UI state. They
are never drawn but they sit in the registry and inflate the Developer card; they should leave it (SETTINGS-IA-05).

**Other defects the audit found:**

- `setupChecklist.ts` opens `/settings/home/voice` for "Choose a speaking voice". The section is `voices`. Checked live: the link
  silently lands on General. (Fix in SETTINGS-IA-01.)
- A non-admin who follows a Home settings link is redirected to Account with no sentence saying why (`SettingsAreaPage.tsx`,
  `Navigate to settingsPath("account")`).
- Thirteen `engines.<role>.choice` rows, each reading "Choose the model for the X role. Auto follows the selected setup plan. Only an
  admin can change this.", are 13 basic rows at the top of Engines and AI, next to the engines console that already shows every role.
- "Reset to default" is still drawn per row by the kit (`SettingRow.tsx`) although SETTINGS-LOOK-01 (owner, 2026-10-07) says remove it
  (section 8).

### 3.4 The new keys this week and where each landed

Why they landed there: a lane agent declares `lives_in` once, picks the nearest existing group, and `areas.json` already has a card for
that group, so the key appears with no review of the page it joins. Nothing counts the page's keys or checks its scope side.

| Keys | Count | Declaration group | Landed on | Chosen by | Verdict |
|---|---|---|---|---|---|
| `generation.picture_quality`, `generation.video_quality`, `generation.adults`, `generation.kids`, `generation.kids_daily_pictures`, `generation.kids_daily_videos`, `generation.adult_adapters`, `generation.video.adult_adapters`, `generation.video.enabled`, `generation.music.enabled`, `generation.people_prompts` | 11 household | `household.pictures` | Home settings > Pictures, videos and music | IMGGEN-SET-01, VIDEO-GEN-04, MUSIC, PEOPLE-PROMPTS-01 | right side and page; the card is "who can make" safety policy beside quality choices |
| `generation.kid_enabled`, `likeness.adults`, `likeness.adult_content` | 3 person | `person.likeness` | Account > Pictures and videos | LIKENESS-01 | right |
| `health.keep_warm` | 1 household | `household.ai` | Engines and AI | not recorded (copy pass aae0e09a) | right page, buried |
| `voice.hesitations`, `voice.hf_token` | 2 household | `household.ai` | Engines and AI | voice lanes (copy pass e8d7f3be) | wrong page (Voice) |
| `tts.voice_id`, `audio.speed.podcast`, `.audiobook`, `.video`, `.spoken_reply` | 5 person | `person.voice` | Account > Voice | VOICE-PICK-01, AUDIO-SESSION-01 | right |
| `news.*` household (12) and person (3) | 15 | `household.news`, `news` | News app gear | NEWS-02a, NEWS-03 | household half wrong (item 1) |
| `media.allowlist_only`, `allowance.*` (9) | 10 person | `person.allowance` | child's Limits tab | MEDIA-KID-01 | right |
| `media.budget.exempt_bedtime_audio` | 1 household, expert | `media.budget` | Home settings > Developer tools | media lanes | wrong: a media rule among developer controls |

## 4. B. The household navigation problem, as an admin sees it

Captures (scratch Home, owner signed in): [home-general-1440.jpg](assets/settings-ia-2026-10-18/home-general-1440.jpg),
[home-ai-1440.jpg](assets/settings-ia-2026-10-18/home-ai-1440.jpg), [home-nav-390.jpg](assets/settings-ia-2026-10-18/home-nav-390.jpg),
[home-ai-390.jpg](assets/settings-ia-2026-10-18/home-ai-390.jpg).

| Level | At 1440 | At 390 |
|---|---|---|
| 0. Reach the page | the avatar menu holds "Home settings"; the page header says "Settings" | the same; the list is the whole screen |
| 1. The rail | 15 sections under 15 group headings of one item each (30 lines, 1,246 px tall; the lower five need a scroll at 900 px high); heading and item often say the same word ("General", "General"; "Search", "Search") | 15 sections in a 1,346 px list; each tap drills in with a back arrow |
| 2. A page | 0 to 35 keys plus up to 7 panels; Engines and AI is 4,582 px tall (5 screens), 16 dropdowns, 20 text boxes, 28 buttons, 22 rows | the same page is 6,550 px (7.8 screens) |
| 3. Folds | "Show N advanced settings" opens in place only when a group has 3 or more advanced keys (Search hides 20 of 23) | the same |
| Find a setting | a Search box in the rail that searches this area only, by label and help | the same |

Findings: (a) the rail is a list of every storage place, not of jobs a parent does; (b) heading and item repeat; (c) the biggest page is
a stack of unrelated panels in one scroll, with no order of importance (the chat pause switch, then 13 model pickers, then the
installer); (d) install state (a model missing, an install running, 74 GB needed) lives in separate panels, not beside the setting it
affects; (e) nothing marks what is recommended, new or changed; (f) no sentence tells an adult why they cannot see the household
side.

## 5. C. The design

All parts below are shipped kit parts (`SettingsShell`, `SettingsRenderer`, `Item` and `ItemGroup`, `Card`, `Badge`, `Collapsible`,
`Empty`, `Alert`, `Command`, `DestructiveConfirm`) used as shipped (rule 9). Where the kit lacks a prop, the step is a `commons` change
first (SETTINGS-IA-03), never a Home override.

### 5.1 Two sides, named and marked

- The avatar menu offers **Your settings** and, for owner and admin, **Household settings**. The rail header shows the area's own
  title (today it is the constant "Settings"), and a page-top Badge states the reach: "Applies to everyone in the home" or "Only you".
  Both come from one new `scope` field on the area (section 6.1), so the label cannot drift from the content.
- A non-admin has no Household settings entry. A deep link to one shows an `Empty` card: "Only a parent or admin can change this.
  Ask <the owner's name>." (no silent redirect). A read-only value the person may see (for example "Chat is paused") keeps the
  kit's `lockedReason` row text.
- An admin who searches on the personal side and matches household settings sees one line under the results: "3 household settings
  match. Open Household settings." so the two sides explain each other.

### 5.2 Household settings: 9 pages

Each page is one scroll of at most about 10 visible settings (section 5.5), cards under plain headings, advanced folded.

| # | Page | What a parent does here | Holds |
|---|---|---|---|
| H1 | Household and people | Name the home, add people, set quiet hours | family name, home place, language, conversation retention, quiet hours, the People list, the Finish setting up checklist |
| H2 | Privacy and safety | Decide what children and teens can reach | teen topic levels, the teen gate grain, web search rules for children and teens, blocked sites, "what connects to the internet" link |
| H3 | AI and models | Check the AI works, install models, pause chat | chat pause (first), Models and storage with install state, where AI runs, engines console, memory and model choices; "Model per job" and the context overrides folded |
| H4 | Pictures, videos and music | Choose quality and who can make what | quality choices, who can make pictures and videos, styles, the libraries |
| H5 | Voice | Choose the voice the home speaks in | the voice catalog, speaking style, voice cloning token, household commands |
| H6 | Search and web | Choose where answers come from | source mode, web sources, the offline library and its downloads, keys |
| H7 | Apps and devices | Connect things | one card per app with household settings (News shelf), Home Assistant, Telegram, robots and Pods, safety alarms |
| H8 | Backups, storage and updates | Keep Home safe and current | backup place and key, storage limits, Repairs, Updates, Trash links |
| H9 | Advanced | Rarely needed | network and away access, status checks, developer controls, plugin routing |

### 5.3 Your settings: 7 pages

| # | Page | Holds |
|---|---|---|
| P1 | Profile and sign-in | profile, face and voice print, away sign-ins, signed-in devices; session lock for an admin |
| P2 | Look and ease | appearance, accent, on this device; ease presets first, the other ease options folded |
| P3 | Chat and AI | personality, companions, photo uploads, safe search, skills and shortcuts |
| P4 | Voice and robot | my voice, listening speeds, wake word on this device, my robot when one is paired |
| P5 | Notifications | alerts on this device, quiet hours, Telegram by event (admin events shown only to admins) |
| P6 | Pictures and videos | likeness consent and what the home may make that looks like me |
| P7 | Your data and apps | my data, storage, one link per app gear (Weather places, News reading, Maps) |

Chat settings stops being a third area: its sections fold into P3 and its link rows (Voice, Notifications, Household chat) go away
because the pages they pointed at are now one tap in the rail.

### 5.4 Old to new

| Old (area, section) | New page | Notes |
|---|---|---|
| home / General | H1 | Internet check (4 keys) moves to H9 |
| home / People | H1 | |
| home / Engines and AI | H3 | Voice keys and Hugging Face token to H5; 13 model choices fold into "Model per job" |
| home / Pictures, videos and music | H4 | |
| home / Robots (section id `robot`, labelled Devices) | H7 | keys appear when a robot is paired; the list, Add dialog and robot screen are built (SETTINGS-UX-04) |
| home / Search | H6 | Blocked sites and the web rules for children and teens to H2 |
| home / Integrations | H7 | Quiet hours to H1; Reference library to H6 |
| home / Commands | H5 | |
| home / Voices | H5 | |
| home / Storage and backups | H8 | |
| home / Reference library | H6 | |
| home / Maintenance | H8 | |
| home / Privacy | H2 | |
| home / Developer tools | H9 | `media.budget.exempt_bedtime_audio` to H4 |
| home / Network and access | H9 | |
| home / Media library (`media-library`) | H4 | drawn by its view; moves with Pictures, videos and music |
| home / Coding (`coding`) | H3 | Home mode Normal and Coding (2026-10-22); the `household.coding*` groups stay with the Coding view |
| account / Coding (`coding`) | P3 | the person's coding keys |
| news / Shelf (household, in the app gear) | H7, "News" card | the app gear keeps Reading only |
| account / Profile, Data and privacy (sign-in parts) | P1 | |
| account / Appearance | P2 | |
| account / Notifications | P5 | |
| account / Voice, This device, Robot | P4 | |
| account / Pictures and videos | P6 | |
| account / Data and privacy, Developer tools | P7, P1 | `ui.pinned_apps`, `setup.checklist_dismissed` leave the registry's drawn set |
| chat / General, Personalization, Skills, Shortcuts | P3 | |
| chat / Voice, Notifications, Memories, Parental controls, Household (links) | removed | each target is a rail item or a Family page link |
| news / Reading, weather / Places, maps | P7 as links | the apps keep their own gear for their own keys |

### 5.5 Progressive disclosure, cap and ordering

- **Basic is what shows.** A page shows only `basic` keys and panels. Every page with advanced keys ends with one "Show advanced"
  row (today the fold appears only for 3 or more advanced keys and per card). Expert stays in Advanced (H9) and Developer tools, admin
  only.
- **Cap: at most 10 visible settings per page** (SETTINGS.md rule 6 says about fifteen per screen; this note tightens it to 10 per
  page, an edit to `.github` SETTINGS.md and UI.md, listed in SETTINGS-IA-09). A view panel counts as one setting. A page over the
  cap demotes its lowest-`order` basic keys to advanced; the lint (6.9) fails the declaration that would push a page over.
  Pages over the cap today and what to demote: Engines and AI (20 basic, demote the 13 role choices into "Model per job" and the 3
  context overrides stay advanced: 7 left), Apps and devices (16 basic: demote 6, for example `robot.initiative.accept_phrases`,
  `robot.initiative.max_offers_per_hour`, `robot.initiative.tiers_spoken`, `safety.alarm.repeat_seconds`, `safety.alarm.volume`,
  `safety.alarm.child_line`), Pictures (11 basic: demote 1), Look and ease (14: show 4 ease presets, 10 fold), Notifications (21:
  Telegram by event is one folded card of 16 toggles), Voice and robot (12: demote 2).
- **Order inside a page:** cards in the area's order; keys by `order`, then declaration order; basic before advanced; a key with no
  `order` goes last in its card. The first card is always the one a parent most often needs (chat pause before model pickers).
- **A new key lands by declaration:** `scope` picks the side, the group's card picks the page, `level` picks visible or folded. A
  key whose group has no card, or whose scope disagrees with the side, or that makes its page exceed 10, fails the check before
  merge.

### 5.6 Search

One "Find a setting" box at the top of each side, shown on every page. It searches every setting on that side, by plain words: the
label, the help sentence, the page name, and a new `search_terms` list the declaration may carry ("slow", "cost", "kids", "backup").
A result shows the breadcrumb ("Household settings > AI and models > Model per job"), the control itself (it works in place) and a
link that jumps to the page with the row focused and its fold open (`#key`, supported today by `focusKey`). The kit's
`searchSettings` already ranks label and help; the additions are `search_terms`, one scope for the side instead of one area, and the
`@changed`, `@new` and `@advanced` words (the SETTINGS.md rule 5 filters, built for the first time). The Home search palette keeps
using `placeSetting`, which follows the new areas automatically.

### 5.7 Recommended, changed, new, install state

- **Recommended:** a `Badge` on the option or value the declaration marks `recommended`, with one sentence from the key's copy
  ("Quick pictures answer in seconds on most computers"). Hardware-dependent recommendations (Detailed video is Recommended on the
  128 GB plan, VIDEO-LTX-07) use the existing plan data, not a new store.
- **Changed from default:** a "Changed" chip on every page and in search lists every row whose value differs from its default
  (`resolved.source === "user"`, which the kit already knows), with the default shown beside the value. See section 8 for reset.
- **What is new:** a `Badge` "New" on a row and a dot on the rail item for settings whose `added_in` is the current or previous
  release. It clears when the person opens the page; the seen version is kept in the browser (a per-viewer convenience), so there is
  no new server record and no new status surface (S6).
- **Installed or needs install, inline:** a row whose choice needs a model or package not on disk shows "Needs install, 74 GB" with an
  Install button that starts the same job Models and storage starts, and shows progress through the existing progress strip
  (`InstallStrip`, `/api/install`); the row's value reads from the same Models and storage data. No banner, dot or polling loop of
  its own (S6). Where an install is refused or running the row says so in the failing call's own words (`lib/failureCopy.ts`).
- **Plain one-sentence descriptions:** every row's help stays the declaration's `copy` through `describeSetting` (S5) and passes
  COPY-LINT-01; the audit found the 13 identical role-choice sentences, which become one folded group sentence.
- **Admin-only visibility:** an area with `scope: household` has `audience.min_role: admin`, so a non-admin never loads a household
  request (the shell already skips the request for an area the viewer may not open).

## 6. Enforcement: the split is declared, then tested

6.1 `areas.json` gains `scope: "household" | "person"` on every area (required).
6.2 `checkAreas` fails a card whose `scope` is not the area's scope, except a `device` card inside the person area's "On this device"
section.
6.3 `checkAreas` fails a household-scope area whose `audience.min_role` is broader than `admin`, and a package `settings_area` that
declares a household-scope card (a package declares household settings through a new `contributes.household_settings`, which the shell
draws as a card on H7, so News keeps one declaration and Home settings holds the household half).
6.4 The key fields `recommended`, `added_in` and `search_terms` are added to `settings-key.schema.json`, additive.
6.5 `checkAreas` fails a page with more than 10 basic keys (counting a view as 1) and an area with fewer than 6 or more than 9 pages.
6.6 Home backend test `settingsScopeSplit.test.ts` loads `getRegistry()` and `getSettingsAreas()` and asserts for every key: a
household key is placed only in a household area, a person key only in a person area, each key is placed once or is in `not_placed`
with a reason. It starts with an explicit allowlist of today's exceptions (items 1 to 4 of section 3.3), which only shrinks.
6.7 A frontend test asserts every `href` in `setupChecklist.ts`, `InstallStrip`, Repairs and the old-URL table resolves to a real
page (this would have caught `/settings/home/voice`).
6.8 `check.sh --pre` runs 6.2 to 6.6 (they are quick) and `bun run lint:ui-rules` stays green (it passes today, 23 tests).
6.9 This is the lint that was missing: today a household key can be declared and drawn on a personal page if someone adds a card for
it, and no check fails.

## 7. Rule edit needed (owner only)

RULES.md S4 says every settings screen is the one kit settings shell and each registry group is placed in exactly one card. To make
Jesse's first complaint impossible to reintroduce it needs one more sentence: "A household-scope setting is drawn only in a
household-scope area (admins only), a person-scope setting only in a person-scope area, and the check fails otherwise." That is a rule
edit; it needs `Owner-approved: <date>` and his words in the commit. Until then 6.1 to 6.6 are checks, not a rule.

## 8. One decision for Jesse

SETTINGS-LOOK-01 (owner, 2026-10-07) says remove every "Reset to default" control, as ChatGPT has none. This request asks for a reset
beside each changed value and a "Changed from default" view. Recommended resolution: no reset control on ordinary rows (honouring
2026-10-07); reset exists only in the Changed view, one Reset per row and a confirmed "Reset all on this page". If Jesse prefers the
reset on every row he says so and SETTINGS-LOOK-01 is amended. SETTINGS-IA-07 waits for the answer; everything else does not.

## 9. D. Slice plan

Order is the order of landing. All are not started, queued after MUSIC; SETTINGS-IA-01 first.

| Slice | Size | What | Tests |
|---|---|---|---|
| SETTINGS-IA-01 | S | Named sides: rail title from the area, the scope Badge, the non-admin explanation card, fix `/settings/home/voice`, add `settingsScopeSplit.test.ts` and the href-resolves test with today's allowlist | the two new tests; `SettingsAreaPage.test.tsx` cases for title and explanation; lint:ui-rules |
| SETTINGS-IA-02 | M | `commons`: area `scope`, key `recommended`, `added_in`, `search_terms`, `contributes.household_settings`, `checkAreas` rules 6.2 to 6.5, tag; Home pin bump | `areas-check` tests per rule; the Home `check.sh` pin checks |
| SETTINGS-IA-03 | M | `commons` kit: row badges (Recommended, New, Needs install, Changed), the Changed filter, side-wide search with `search_terms` and `@changed`, per-page Show advanced | kit tests and showcase; Home lint:ui-rules |
| SETTINGS-IA-04 | L | Household side: new `areas.json` with 9 pages, view panels recomposed into cards (Engines and AI split into its own cards with install state inline), 13 role choices folded, cap demotions, old-section redirects | page tests per page; the old-to-new redirect table as tests; captures 1440 and 390 |
| SETTINGS-IA-05 | M | Personal side: 7 pages, Chat settings folded in, state keys leave the drawn set, admin-event Telegram toggles shown to admins only | the same; a child and a teen see no more than the old page showed them (`settingsMinorSnapshot`) |
| SETTINGS-IA-06 | M | News shelf and any package household setting move to H7 through `contributes.household_settings`; NEWS-03's filter lines go | News package tests; the split test allowlist loses items 1 to 4 |
| SETTINGS-IA-07 | S | Changed from default view with reset, after Jesse answers section 8 | tests for reset per band and the confirm |
| SETTINGS-IA-08 | S | New markers, Recommended badges, inline Needs install through Models and storage and `InstallStrip` | tests that no new status surface is added (S6) |
| SETTINGS-IA-09 | M | Verification and docs: seeded household captures at 1440 and 390, light and dark, owner, adult, teen, child, opened and judged; a11y matrix; `docs/user/` page; dev doc; generated settings reference; `.github` SETTINGS.md and UI.md cap sentence | `bash scripts/check.sh`, a11y run |

**Deep links and saved navigation.** The old URLs stay valid forever: `/settings/home/<section>[#key]`, `/settings/account/<section>`,
`/settings/chat/<section>`, `/settings/news/shelf`, the legacy `/settings?tab=&section=` form, and `/engines`, `/models`, `/voices`.
`legacySettingsTarget` and `retiredManagePageTarget` (`settingsRedirects.ts`) gain the old-to-new table of section 5.4; a `#key`
resolves through `placeSetting`, so a key lands on whatever page now draws it. Each row is a test. No settings navigation is saved
in browser storage today (checked), so there is no stored state to migrate; the "New" seen version is new and tolerant of absence.
**The setup wizard and Repairs** link by path: the seven checklist links (`/settings/home/people`, `storage` twice, `search`, `voice`
(already broken), `ai` twice), `InstallStrip`'s `/settings/home/ai`, `GettingStarted`, the away-access flow returning to
`/settings/home/network`, and the avatar menu's `/settings/home`. They keep working through the redirect table, and then
SETTINGS-IA-04 re-points each to its new page and the href test (6.7) proves it.

**Risks.**
1. Large change to the page every admin uses; mitigate by landing household first behind the redirect table, personal second, one
   release apart.
2. Hidden demotions: a key moved to advanced is harder to find; mitigate with search, the Changed view and the cap list in the PR.
3. Spec churn: five new fields and rules in `commons`; mitigate by additive schema and a tag per slice.
4. A child or teen must never see more: the existing minor snapshot test runs on every page, and every slice carries it.
5. The 2026-10-06 owner ruling (apps' gears) is bent for News only to the extent the household card moves out; the app gear still
   holds the person keys.
6. Churn in lanes: other lanes declare keys during the work; the split test allowlist and the cap lint make a bad declaration fail
   in that lane's own gate, not in review.

## 10. Appendix A: every declared key

Generated 2026-10-18 from `getRegistry()` and the pinned `areas.json`, 219 rows. "Today" is `area/section` for a drawn key.
"Verdict": ok, borderline or no (section 3.3). "Proposed" uses the page numbers of sections 5.2 and 5.3.

| Key | Scope | Level | Today | Verdict | Proposed page |
|---|---|---|---|---|---|
| `allowance.family.daily_minutes` | person | basic | person Limits tab | ok | Person page: Limits (guardian) |
| `allowance.fun.daily_minutes` | person | basic | person Limits tab | ok | Person page: Limits (guardian) |
| `allowance.health.daily_minutes` | person | basic | person Limits tab | ok | Person page: Limits (guardian) |
| `allowance.home.daily_minutes` | person | basic | person Limits tab | ok | Person page: Limits (guardian) |
| `allowance.info.daily_minutes` | person | basic | person Limits tab | ok | Person page: Limits (guardian) |
| `allowance.learning.daily_minutes` | person | basic | person Limits tab | ok | Person page: Limits (guardian) |
| `allowance.media.daily_minutes` | person | basic | person Limits tab | ok | Person page: Limits (guardian) |
| `allowance.robot_body.daily_minutes` | person | basic | person Limits tab | ok | Person page: Limits (guardian) |
| `allowance.utilities.daily_minutes` | person | basic | person Limits tab | ok | Person page: Limits (guardian) |
| `audio.speed.audiobook` | person | basic | account/voice | ok | P4 Voice and robot |
| `audio.speed.podcast` | person | basic | account/voice | ok | P4 Voice and robot |
| `audio.speed.spoken_reply` | person | basic | account/voice | ok | P4 Voice and robot |
| `audio.speed.video` | person | basic | account/voice | ok | P4 Voice and robot |
| `backup.max_total_gb` | household | advanced | home/storage | ok | H8 Backups, storage and updates |
| `backups.emergency_kit_saved_at` | household | basic | home/storage | ok | H8 Backups, storage and updates |
| `chat.context_size_override` | household | advanced | home/ai | ok | H3 AI and models |
| `chat.flash_attention_override` | household | advanced | home/ai | ok | H3 AI and models |
| `chat.kv_cache_override` | household | advanced | home/ai | ok | H3 AI and models |
| `chat.model_id` | household | expert | home/ai | ok | H3 AI and models |
| `chat.paused` | household | basic | home/ai | borderline: an emergency switch, buried at the top of Engines and AI | H3 AI and models |
| `chat.paused_message` | household | basic | home/ai | borderline: as chat.paused | H3 AI and models |
| `chat.photo_uploads` | person | basic | chat/general | ok | P3 Chat and AI |
| `chat.search_assist` | household | advanced | home/ai | ok | H3 AI and models |
| `chat.teen_gate_grain` | household | advanced | home/ai | ok | H2 Privacy and safety |
| `companions.allowed` | person | basic | chat/personalization | ok | P3 Chat and AI |
| `ease.contrast` | person | basic | account/appearance | ok | P2 Look and ease |
| `ease.explainers` | person | basic | account/appearance | ok | P2 Look and ease |
| `ease.motion` | person | basic | account/appearance | ok | P2 Look and ease |
| `ease.preset` | person | basic | account/appearance | ok | P2 Look and ease |
| `ease.read_aloud` | person | basic | account/appearance | ok | P2 Look and ease |
| `ease.reading_level` | person | basic | account/appearance | ok | P2 Look and ease |
| `ease.simple_mode` | person | basic | account/appearance | ok | P2 Look and ease |
| `ease.spacing` | person | basic | account/appearance | ok | P2 Look and ease |
| `ease.targets` | person | basic | account/appearance | ok | P2 Look and ease |
| `ease.text_size` | person | basic | account/appearance | ok | P2 Look and ease |
| `ease.word_help` | person | basic | account/appearance | ok | P2 Look and ease |
| `engines.chat.choice` | household | basic | home/ai | ok scope; thirteen near-identical rows, belong in one 'Model per job' fold | H3 AI and models |
| `engines.coding.choice` | household | basic | home/ai | ok scope; thirteen near-identical rows, belong in one 'Model per job' fold | H3 AI and models |
| `engines.embed.choice` | household | basic | home/ai | ok scope; thirteen near-identical rows, belong in one 'Model per job' fold | H3 AI and models |
| `engines.image.choice` | household | basic | home/ai | ok scope; thirteen near-identical rows, belong in one 'Model per job' fold | H3 AI and models |
| `engines.judge.choice` | household | basic | home/ai | ok scope; thirteen near-identical rows, belong in one 'Model per job' fold | H3 AI and models |
| `engines.music.choice` | household | basic | home/ai | ok scope; thirteen near-identical rows, belong in one 'Model per job' fold | H3 AI and models |
| `engines.rerank.choice` | household | basic | home/ai | ok scope; thirteen near-identical rows, belong in one 'Model per job' fold | H3 AI and models |
| `engines.router.choice` | household | basic | home/ai | ok scope; thirteen near-identical rows, belong in one 'Model per job' fold | H3 AI and models |
| `engines.stack.remote.allow_tailnet` | household | advanced | home/ai | ok | H3 AI and models |
| `engines.stack.remote.host` | household | basic | home/ai | ok | H3 AI and models |
| `engines.stack.remote.local_port` | household | advanced | home/ai | ok | H3 AI and models |
| `engines.stack.remote.ssh_port` | household | advanced | home/ai | ok | H3 AI and models |
| `engines.stack.url` | household | expert | home/ai | ok | H3 AI and models |
| `engines.stack.use_chat` | household | expert | home/ai | ok | H3 AI and models |
| `engines.stack.use_embeddings` | household | expert | home/ai | ok | H3 AI and models |
| `engines.stack.use_stt` | household | expert | home/ai | ok | H3 AI and models |
| `engines.stack.use_tts` | household | expert | home/ai | ok | H3 AI and models |
| `engines.stack.where` | household | basic | home/ai | ok | H3 AI and models |
| `engines.stt.choice` | household | basic | home/ai | ok scope; thirteen near-identical rows, belong in one 'Model per job' fold | H3 AI and models |
| `engines.tts.choice` | household | basic | home/ai | ok scope; thirteen near-identical rows, belong in one 'Model per job' fold | H3 AI and models |
| `engines.turn_signal.choice` | household | basic | home/ai | ok scope; thirteen near-identical rows, belong in one 'Model per job' fold | H3 AI and models |
| `engines.video.choice` | household | basic | home/ai | ok scope; thirteen near-identical rows, belong in one 'Model per job' fold | H3 AI and models |
| `engines.vision.choice` | household | basic | home/ai | ok scope; thirteen near-identical rows, belong in one 'Model per job' fold | H3 AI and models |
| `engines.wakeword.choice` | household | basic | home/ai | ok scope; thirteen near-identical rows, belong in one 'Model per job' fold | H3 AI and models |
| `generation.adult_adapters` | household | basic | home/pictures | ok | H4 Pictures, videos and music |
| `generation.adults` | household | basic | home/pictures | ok | H4 Pictures, videos and music |
| `generation.kid_enabled` | person | basic | account/pictures | ok | P6 Pictures and videos |
| `generation.kids` | household | basic | home/pictures | ok | H4 Pictures, videos and music |
| `generation.kids_daily_pictures` | household | basic | home/pictures | ok | H4 Pictures, videos and music |
| `generation.kids_daily_videos` | household | basic | home/pictures | ok | H4 Pictures, videos and music |
| `generation.music.enabled` | household | basic | home/pictures | ok | H4 Pictures, videos and music |
| `generation.people_prompts` | household | basic | home/pictures | ok | H4 Pictures, videos and music |
| `generation.picture_quality` | household | basic | home/pictures | ok | H4 Pictures, videos and music |
| `generation.video_quality` | household | basic | home/pictures | ok | H4 Pictures, videos and music |
| `generation.video.adult_adapters` | household | basic | home/pictures | ok | H4 Pictures, videos and music |
| `generation.video.enabled` | household | basic | home/pictures | ok | H4 Pictures, videos and music |
| `health.keep_warm` | household | basic | home/ai | borderline: engine upkeep under Engines and AI (fits AI) | H3 AI and models |
| `home.access_token` | household | advanced | home/integrations | ok | H7 Apps and devices |
| `home.base_url` | household | advanced | home/integrations | ok | H7 Apps and devices |
| `household.conversation_retention_days` | household | advanced | home/general | ok | H1 Household and people |
| `household.family_name` | household | basic | home/general | ok | H1 Household and people |
| `household.home` | household | basic | home/general | ok | H1 Household and people |
| `household.locale` | household | basic | home/general | ok | H1 Household and people |
| `household.quiet_hours.from` | household | basic | home/integrations | no: household key under Integrations | H1 Household and people |
| `household.quiet_hours.to` | household | basic | home/integrations | no: household key under Integrations | H1 Household and people |
| `likeness.adult_content` | person | basic | account/pictures | ok | P6 Pictures and videos |
| `likeness.adults` | person | basic | account/pictures | ok | P6 Pictures and videos |
| `maps.default_place` | person | basic | no page (package/maps) | ok | P7 Your data and apps |
| `maps.places` | person | basic | no page (package/maps) | ok | P7 Your data and apps |
| `media.allowlist_only` | person | basic | person Limits tab | ok | Person page: Limits (guardian) |
| `media.budget.exempt_bedtime_audio` | household | expert | home/developer | no: media rule under Developer tools | H9 Advanced |
| `network.hub_port` | household | expert | home/developer | ok: expert | H9 Advanced |
| `network.lan_exposure` | household | advanced | home/network | ok | H9 Advanced |
| `network.tailnet_access` | household | basic | home/network | ok | H9 Advanced |
| `news.digest` | person | basic | news/reading | ok | P7 Your data and apps |
| `news.feeds.adult` | household | advanced | news/shelf | no: household keys inside the News app's gear (SETTINGS.md rule 1) | H7 Apps and devices |
| `news.feeds.child` | household | advanced | news/shelf | no: household keys inside the News app's gear (SETTINGS.md rule 1) | H7 Apps and devices |
| `news.feeds.teen` | household | advanced | news/shelf | no: household keys inside the News app's gear (SETTINGS.md rule 1) | H7 Apps and devices |
| `news.full_text_prefetch` | household | advanced | news/shelf | no: household keys inside the News app's gear (SETTINGS.md rule 1) | H7 Apps and devices |
| `news.image_cache_mb` | household | advanced | news/shelf | no: household keys inside the News app's gear (SETTINGS.md rule 1) | H7 Apps and devices |
| `news.images` | household | advanced | news/shelf | no: household keys inside the News app's gear (SETTINGS.md rule 1) | H7 Apps and devices |
| `news.lists.adult` | household | basic | news/shelf | no: household keys inside the News app's gear (SETTINGS.md rule 1) | H7 Apps and devices |
| `news.lists.child` | household | basic | news/shelf | no: household keys inside the News app's gear (SETTINGS.md rule 1) | H7 Apps and devices |
| `news.lists.teen` | household | basic | news/shelf | no: household keys inside the News app's gear (SETTINGS.md rule 1) | H7 Apps and devices |
| `news.my_mix` | person | basic | news/reading | ok | P7 Your data and apps |
| `news.poll_interval_s` | household | advanced | news/shelf | no: household keys inside the News app's gear (SETTINGS.md rule 1) | H7 Apps and devices |
| `news.reader_open` | person | basic | news/reading | ok | P7 Your data and apps |
| `news.retention_days` | household | advanced | news/shelf | no: household keys inside the News app's gear (SETTINGS.md rule 1) | H7 Apps and devices |
| `news.shelf.enabled` | household | advanced | news/shelf | no: household keys inside the News app's gear (SETTINGS.md rule 1) | H7 Apps and devices |
| `notifications.approvals.requested.telegram` | person | basic | account/notifications | borderline: system event for admins, drawn on every adult's Notifications | P5 Notifications |
| `notifications.backups.target_failing.telegram` | person | basic | account/notifications | borderline: system event for admins, drawn on every adult's Notifications | P5 Notifications |
| `notifications.browser.enabled` | person | basic | account/notifications | ok | P5 Notifications |
| `notifications.engines.problem.telegram` | person | basic | account/notifications | borderline: system event for admins, drawn on every adult's Notifications | P5 Notifications |
| `notifications.engines.update_applied.telegram` | person | basic | account/notifications | borderline: system event for admins, drawn on every adult's Notifications | P5 Notifications |
| `notifications.engines.update_available.telegram` | person | basic | account/notifications | borderline: system event for admins, drawn on every adult's Notifications | P5 Notifications |
| `notifications.engines.update_failed.telegram` | person | basic | account/notifications | borderline: system event for admins, drawn on every adult's Notifications | P5 Notifications |
| `notifications.file_shared.muted_senders` | person | basic | account/notifications | ok | P5 Notifications |
| `notifications.file.shared_with_household.telegram` | person | basic | account/notifications | ok | P5 Notifications |
| `notifications.file.shared_with_you.telegram` | person | basic | account/notifications | ok | P5 Notifications |
| `notifications.memory.judge_failed.telegram` | person | basic | account/notifications | borderline: system event for admins, drawn on every adult's Notifications | P5 Notifications |
| `notifications.memory.updated.telegram` | person | basic | account/notifications | ok | P5 Notifications |
| `notifications.model.download_failed.telegram` | person | basic | account/notifications | borderline: system event for admins, drawn on every adult's Notifications | P5 Notifications |
| `notifications.model.download_ready.telegram` | person | basic | account/notifications | borderline: system event for admins, drawn on every adult's Notifications | P5 Notifications |
| `notifications.person.band_changed.telegram` | person | basic | account/notifications | ok | P5 Notifications |
| `notifications.repairs.new.telegram` | person | basic | account/notifications | borderline: system event for admins, drawn on every adult's Notifications | P5 Notifications |
| `notifications.telegram.bot_token` | household | advanced | home/integrations | ok | H7 Apps and devices |
| `notifications.telegram.chat_id` | person | basic | account/notifications | ok | P5 Notifications |
| `notifications.time_sensitive.robot` | person | basic | account/notifications | ok | P5 Notifications |
| `notifications.updates.available.telegram` | person | basic | account/notifications | borderline: system event for admins, drawn on every adult's Notifications | P5 Notifications |
| `person.quiet_hours.from` | person | basic | account/notifications | ok | P5 Notifications |
| `person.quiet_hours.to` | person | basic | account/notifications | ok | P5 Notifications |
| `person.robot.follow_up` | person | basic | account/robot | ok | P4 Voice and robot |
| `person.robot.greet_by_name` | person | basic | account/robot | ok | P4 Voice and robot |
| `person.robot.may_address` | person | basic | account/robot | ok | P4 Voice and robot |
| `person.robot.playful_clips` | person | basic | account/robot | ok | P4 Voice and robot |
| `person.robot.topics` | person | basic | account/robot | ok | P4 Voice and robot |
| `person.vision.gestures` | person | basic | account/robot | ok | P4 Voice and robot |
| `person.vision.watch` | person | basic | account/robot | ok | P4 Voice and robot |
| `person.voice_print.enrollment` | person | basic | account/profile | ok | P1 Profile and sign-in |
| `persona.active_id` | person | basic | chat/personalization | ok | P3 Chat and AI |
| `reference.download.when` | household | advanced | home/integrations | borderline: offline library under Integrations | H6 Search and web |
| `reference.images` | person | basic | chat/general | ok | P3 Chat and AI |
| `reference.library_dir` | household | basic | home/integrations | borderline: offline library under Integrations | H6 Search and web |
| `reference.update.max_mbps` | household | advanced | home/integrations | borderline: offline library under Integrations | H6 Search and web |
| `robot.barge_in.open_mic` | device | advanced | robot screen | ok | Robot screen (not hub) |
| `robot.camera.watch_level` | device | basic | robot screen | ok | Robot screen (not hub) |
| `robot.follow_up.seconds` | device | basic | robot screen | ok | Robot screen (not hub) |
| `robot.gestures.enabled` | device | basic | robot screen | ok | Robot screen (not hub) |
| `robot.greetings.mode` | household | basic | home/robot | ok | H7 Apps and devices |
| `robot.idle.level` | device | basic | robot screen | ok | Robot screen (not hub) |
| `robot.initiative.accept_phrases` | household | basic | home/robot | ok | H7 Apps and devices |
| `robot.initiative.allowed_here` | device | basic | robot screen | ok | Robot screen (not hub) |
| `robot.initiative.enabled` | household | basic | home/robot | ok | H7 Apps and devices |
| `robot.initiative.max_offers_per_hour` | household | basic | home/robot | ok | H7 Apps and devices |
| `robot.initiative.tiers_spoken` | household | basic | home/robot | ok | H7 Apps and devices |
| `robot.live_view.enabled` | household | basic | home/robot | ok | H7 Apps and devices |
| `robot.live_view.who` | household | basic | home/robot | ok | H7 Apps and devices |
| `robot.offlan.tailnet` | household | advanced | home/robot | ok | H7 Apps and devices |
| `robot.sleep.auto` | device | basic | robot screen | ok | Robot screen (not hub) |
| `safety.alarm.child_line` | household | basic | home/robot | ok | H7 Apps and devices |
| `safety.alarm.repeat_seconds` | household | basic | home/robot | ok | H7 Apps and devices |
| `safety.alarm.sensors` | household | basic | home/integrations | no: alarms are Devices, filed under Integrations | H7 Apps and devices |
| `safety.alarm.voice` | household | basic | home/robot | ok | H7 Apps and devices |
| `safety.alarm.volume` | household | basic | home/robot | ok | H7 Apps and devices |
| `search.blocklists` | household | advanced | home/search | ok | H2 Privacy and safety |
| `search.blocklists.adult` | household | advanced | home/search | ok | H2 Privacy and safety |
| `search.blocklists.child` | household | advanced | home/search | ok | H2 Privacy and safety |
| `search.blocklists.teen` | household | advanced | home/search | ok | H2 Privacy and safety |
| `search.brave_api_key` | household | advanced | home/search | ok | H6 Search and web |
| `search.dictionary_fallback` | household | advanced | home/search | ok | H6 Search and web |
| `search.fetch_cache_gb` | household | advanced | home/search | ok | H6 Search and web |
| `search.hosts.adult.allow` | household | advanced | home/search | ok | H2 Privacy and safety |
| `search.hosts.adult.deny` | household | advanced | home/search | ok | H2 Privacy and safety |
| `search.hosts.allow` | household | advanced | home/search | ok | H2 Privacy and safety |
| `search.hosts.child.allow` | household | advanced | home/search | ok | H2 Privacy and safety |
| `search.hosts.child.deny` | household | advanced | home/search | ok | H2 Privacy and safety |
| `search.hosts.deny` | household | advanced | home/search | ok | H2 Privacy and safety |
| `search.hosts.teen.allow` | household | advanced | home/search | ok | H2 Privacy and safety |
| `search.hosts.teen.deny` | household | advanced | home/search | ok | H2 Privacy and safety |
| `search.page_text_cleaning` | person | advanced | chat/general | ok: person | P3 Chat and AI |
| `search.safe_search` | person | basic | chat/general | ok | P3 Chat and AI |
| `search.searxng_url` | household | advanced | home/search | ok | H6 Search and web |
| `search.source_mode` | household | basic | home/search | ok | H6 Search and web |
| `search.source_mode.web` | household | advanced | home/search | ok | H6 Search and web |
| `search.source_mode.wikimedia` | household | advanced | home/search | ok | H6 Search and web |
| `search.wayback_fallback` | household | advanced | home/search | ok | H6 Search and web |
| `search.web_sources` | household | advanced | home/search | ok | H6 Search and web |
| `search.web.child_mode` | household | basic | home/search | ok | H2 Privacy and safety |
| `search.web.teen_mode` | household | basic | home/search | ok | H2 Privacy and safety |
| `security.session_lock_required` | person | expert | account/developer | borderline: person key, admin-set, in Developer tools | P1 Profile and sign-in |
| `security.session_lock_timeout_minutes` | person | expert | account/developer | borderline: person key, admin-set, in Developer tools | P1 Profile and sign-in |
| `setup.checklist_dismissed` | person | expert | account/appearance | no: state, not a setting | Not a setting (state key) |
| `status.internet_probe.dns_name` | household | advanced | home/general | ok household; belongs with diagnostics, not General | H9 Advanced |
| `status.internet_probe.enabled` | household | basic | home/general | ok household; belongs with diagnostics, not General | H9 Advanced |
| `status.internet_probe.tcp_address` | household | advanced | home/general | ok household; belongs with diagnostics, not General | H9 Advanced |
| `status.internet_probe.tcp_port` | household | advanced | home/general | ok household; belongs with diagnostics, not General | H9 Advanced |
| `storage.critical_free_gb` | household | advanced | home/storage | ok | H8 Backups, storage and updates |
| `storage.household.cap_bytes` | household | basic | home/storage | ok | H8 Backups, storage and updates |
| `storage.person_quota_gb` | person | advanced | person Limits tab | ok | Person page: Limits (guardian) |
| `storage.person.cap_bytes` | person | advanced | person Limits tab | ok | Person page: Limits (guardian) |
| `storage.person.default_cap_bytes` | household | basic | home/storage | ok | H8 Backups, storage and updates |
| `topics.bodies` | person | basic | person Limits tab | ok | Person page: Limits (guardian) |
| `topics.family_stories` | person | basic | person Limits tab | ok | Person page: Limits (guardian) |
| `topics.family_story_names` | person | basic | person Limits tab | ok | Person page: Limits (guardian) |
| `topics.health` | person | basic | person Limits tab | ok | Person page: Limits (guardian) |
| `topics.risk` | person | basic | person Limits tab | ok | Person page: Limits (guardian) |
| `topics.teen.bodies` | household | basic | home/privacy | ok | H2 Privacy and safety |
| `topics.teen.risk` | household | basic | home/privacy | ok | H2 Privacy and safety |
| `topics.violence` | person | basic | person Limits tab | ok | Person page: Limits (guardian) |
| `tours.autostart.enabled` | person | basic | account/appearance | ok | P2 Look and ease |
| `tts.voice_id` | person | basic | account/voice | ok | P4 Voice and robot |
| `ui.appearance` | person | basic | account/appearance | ok | P2 Look and ease |
| `ui.enrollment_sounds` | person | basic | account/profile | ok | P1 Profile and sign-in |
| `ui.look` | person | basic | account/appearance | ok | P2 Look and ease |
| `ui.pinned_apps` | person | expert | account/appearance | no: state, not a setting | Not a setting (state key) |
| `ui.reasoning_open` | person | advanced | chat/general | ok | P3 Chat and AI |
| `ui.show_turn_stats` | person | advanced | chat/general | ok | P3 Chat and AI |
| `vision.on_request.enabled` | household | basic | home/robot | ok | H7 Apps and devices |
| `voice.hesitations` | household | basic | home/ai | no: Voice key under Engines and AI | H5 Voice |
| `voice.hf_token` | household | advanced | home/ai | no: Voice key under Engines and AI | H5 Voice |
| `weather.default_place` | person | basic | weather/places | ok | P7 Your data and apps |
| `weather.places` | person | basic | weather/places | ok | P7 Your data and apps |
| `weather.unit` | person | basic | weather/places | ok | P7 Your data and apps |

## Supersedes (added 2026-10-22, on the architect's ruling)

[settings-layout-revamp-2026-10-22.md](settings-layout-revamp-2026-10-22.md) changes how the pages are drawn. Where the two notes disagree the revamp note wins:

- Section 5.2 and 5.5 "each page is one scroll" and "one Show advanced row per page" (and backlog SETTINGS-IA-03's per-page advanced): a page is a short summary plus tabs; advanced is its own tab or a detail screen; nothing expands in place (owner decisions 7.1 to 7.3 of the revamp note).
- Section 9's slice order: the revamp note's order applies (readability slices first, then IA-02, IA-04, IA-05).
- Section 5.1 "SETTINGS-IA-01" is built as SETTINGS-UX-01.
- The "cap of 10 visible settings per page" is counted per tab (a page's tabs may together exceed 10 only when each tab is its own topic); the lint counts per tab.
- Section 5.4's Engines and AI row: the page is built as four tabs (Overview, Models, Engines, Advanced) that move onto spec-declared tabs; the Voice and Hugging Face moves to H5 still apply when H5 is built.

Kept as written: the scope audit (section 3), the two sides and their names, search (5.6), the Recommended, Changed, New and install-state markers (5.7), enforcement (6), the one decision about reset (8).
