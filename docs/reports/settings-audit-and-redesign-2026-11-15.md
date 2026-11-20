# Settings audit and redesign: the personal side and the home side (2026-11-15)

Status: analysis and design only. Nothing here is built. Owner's ask (Jesse, 2026-11-15): "audit the rest of the settings
(personal and home) and revamp them like you did AI and models", then "also need the settings names, descriptions, etc to be
optimized and optimal grouped". Mockup: [Settings redesign: personal and home](https://claude.ai/artifact/4LrpvGXjbpwVdtucK41KBB)
(16 boards). The AI and models work this copies: [queue-tiers-and-ai-models-audit-2026-11-15.md](queue-tiers-and-ai-models-audit-2026-11-15.md),
section 5.

Evidence: every page and tab was driven on the dev workbench (worktree `reverent-kare-bf0c9b`, `main` at `5d594e9ef`, spec
`v0.1.406`, signed in as Sage the owner, seeded household Sage, Marlow and Nova) at 1440 px and 375 px with a DOM extractor
that recorded every heading, row, control and value, plus screenshots. The registry read is `spec/settings/areas.json` (16
sections, 14 `not_placed` groups, 1 device card) and `keys.json` (337 keys in 69 groups).

## 1. The short answer

1. **Settings has no front page and no status.** `/settings` jumps to Profile. Nothing anywhere says what is broken, missing or
   not set up: no backups, web search with no address, a robot that never connected and a face sign-in never enrolled are
   each buried on one page, and the page itself does not say so. The one list that does (Finish setting up, nine rows) sits
   on top of Household › General where only an admin who scrolls finds it.
2. **One area is unreachable.** "Backups, storage and updates" in the Settings column redirects out of Settings to the Backups
   page (`settingsRedirects.ts:69`), so its five storage limits and the Updates, Repairs, Performance and Status links can
   never be opened from the column.
3. **Values are hidden or raw.** The reader sees "inherit", "Preset", "Tier 1", "Stt model choice", "not offered:
   musicBandEditAllowed", "(bytes)", a timestamp drawn as a setting, and sixteen Telegram switches whose names each repeat
   "Telegram me when". Thirteen rows carry "Reset to default" although the owner ruled it out (SETTINGS-LOOK-01).
4. **The same thing lives in two or three places.** Offline books: a rail item, a link on Search, and three keys under
   Apps and devices › Integrations. Face recognition: Your data › Data and Your data › Developer tools (a stray card). Voice
   print: two switches on Profile. Quiet hours for the home: under Integrations › Telegram. Signed-in devices: Profile and
   Your data. Commands: both sides.
5. **The redesign:** a Settings home with a Needs attention strip and one tile per area with a dot and a few words; every
   page as a state line, tabs that each answer one question, value rows, one sheet per item; one place per setting; a search
   that finds a setting by what it does; and a wording pass over names, descriptions and groups (section 6). Ten home areas
   become nine (Offline data folds into Search and web). Phone: three taps from the drawer to a setting, down from five.

## 2. What is wrong today, by area

Counts are from the extractor; heights are the content column at 1440 px.

### Personal side (6 areas)

| Area | Seen | What is wrong |
|---|---|---|
| Profile and sign-in | 2,900 px, 6 cards, no tabs (the "PIN / Password" segmented control reads as tabs) | A form, then Language, a three-field password form inline, Two-step, three empty lists (away sign-ins, devices, offline copies), sessions, a Voice recognition card and then a second "Voice print enrollment" switch for the same thing (`settingsViews.tsx:78` draws the card; the `person.voice_print` registry card draws the switch again). Face sign-in is not here; it is on Your data. No state line: nothing says two-step is off or face is not set up. |
| Look and ease | 1,663 px, 13 selects | "Look on this device = inherit" (a raw value). Ten ease rows read "Preset" instead of saying they follow the Comfort style. "Reset to default" under rows (`SettingRow.tsx:439`; SETTINGS-LOOK-01 says remove). Two "Change" buttons open dialogs for Look and Text size while the other rows are inline selects: two patterns for one kind of row. |
| Chat and AI | General 982 px; Personalization 1,545 px; Skills 4,588 px | Skills is a list of 55 items with raw gate names as badges ("not offered: musicBandEditAllowed", "not offered: not measured") and internal sentences ("keep this package id for saved-file provenance"), `ChatSkillsSection.tsx`. Music playback (DJ, crossfade, sound preset, lyrics) sits under "Chat and AI › Personalization › Music". Coding tab shows only with a grant (correct). |
| Voice and robot | Voice 900 px; Robot 900 px | The spec declares three tabs (voice, device, robot) but "This device" is never drawn: `?tab=device` falls back to the page root, so the one `device.voice` key (wake word on this device) is unreachable. "Commands › Create a command" links to the household Commands page: a household control on the personal side. |
| Notifications | 900 px | Telegram is one folded row holding sixteen switches, eleven of them admin-only events shown to every adult (the IA note's item 2, still true). "Show alerts on this device" is off with no state line saying so. Quiet hours: two time inputs with "Use household hours" buttons, no sentence saying what the home's hours are. |
| Your data and apps | Data 1,075 px; Developer 900 px | The page opens with the memories list and its toolbar under no heading ("Showing 0 of 0 memories", Select, Clear all, Faded). "Apps" lists no apps (Weather places, News reading, Podcasts, Maps are elsewhere or not placed). Face recognition is here, not on sign-in. The Developer tools tab draws nothing but a second copy of the face card (`SettingsSectionContent.tsx:163` draws it for every tab of `data`); the expert session-lock keys it is meant to hold never render. |

### Home side (10 areas, AI and models excluded)

| Area | Seen | What is wrong |
|---|---|---|
| Household and people | General 2,018 px (2,546 px on a phone); People 900 px | The nine-row Finish setting up checklist is the whole first screen; the household keys come after it. "Preview the coming companion features" is a developer switch among them. "Internet check" (4 keys) is diagnostics, not household. The People tab is two bare links (Users, Family): the list it should show is a view that exists (`home.users_admin`) but is not placed. Nothing says who has no PIN or when someone was last seen. |
| Privacy and safety | 900 px, 2 selects, 1 link | Two teen topic rows and a link. The child and teen web rules, DuckDuckGo for minors and the blocked sites (12 keys) live on Search; the teen gate grain lives on AI and models › Advanced; what children can make lives on Pictures. A parent cannot see the whole picture anywhere. |
| Pictures, videos and music | Pictures 1,129 px; Music 1,498 px; Styles 1,093 px | Good bones (VIDEO-SETTINGS-03 and 05). "Level when nobody says" is a puzzle of a name. "Clear 0 locks" shows a button with nothing to clear. The Styles tab holds the Hugging Face and Civitai keys with no dot saying whether they work. Models by level are on AI and models with nothing here that says which level is ready. |
| Voice (home) | Voices 900 px; Commands 900 px | Named "Voice" next to the personal "Voice and robot". Commands is an empty inline form with placeholder text ("Trigger phrase, e.g. movie night", a Child select, two text boxes) before any list. The speech keys (natural sounds, start early, talk over, overlap, HF token) are on AI and models › Advanced under `household.ai_advanced`. |
| Search and web | 2,066 px, 23 buttons | A status line ("Home's own search service, and DuckDuckGo") above an empty SearXNG address box with Test and Save, then a "Use SearXNG" switch that is on although no address exists: the page says on, the service cannot answer. Two folds ("Show 7 advanced settings", "Show 9 advanced settings") hide 16 of 23 keys. The `household.news` card (12 keys) is declared on this section. "Offline books" is a link to a separate rail item. |
| Offline data | 1,624 px, 8 switches | A good page on its own (presets, shelves, badges "For children"). It is the third entrance to the same thing (see Search and Integrations). Every switch reads "off" with no line saying nothing is downloaded and how much space the set takes. |
| Apps and devices | Devices 1,759 px (2,363 px on a phone); Integrations 1,180 px | Devices: the robot list ("Rover, Waiting for first report"), then a page-level "Robot password: Not set" section, then a "Robots" switch with a visible Reset to default, then 13 flat robot and safety-alarm keys ("Spoken offer tiers = Tier 1", "Offer acceptance phrases = Default"). The person's own phones and browsers are not here. Integrations: Home Assistant (token "Set", URL "Change", no Connected or Not connected dot), then "Telegram" holding the home's quiet hours and the bot token, then "Reference library" (three offline-book keys). |
| Backups, storage and updates | redirects to `/backups` | Unreachable as an area (`settingsRedirects.ts:69`, comment "pointing this at /settings/backups looped it"). The Backups page has no storage limits, no update state and no Repairs. The `household.storage` card with five keys is drawn nowhere. |
| Advanced | Developer 900 px; Network 900 px | Developer holds only "Plugin routing" statistics; its two cards (`media.budget`, `household.ai_developer`) are expert keys and `includeExpert` is true only on the Network tab (`SettingsSectionContent.tsx:104`), so they never draw. Network is fine and small; its "Set up away access" button sits under the keys rather than on the Away row. |

### Across every page

- **No state line and no attention strip.** No page says in one line what is set and what is wrong. The dot vocabulary the AI
  and models redesign introduced (Ready, Missing, Problem, Off) exists nowhere else.
- **No Settings home.** `/settings` redirects to Profile (`SettingsEntryRedirect.tsx`). On a phone the list of areas is a
  back step from every page: drawer, Settings, back, area, row, sheet: five taps to a setting, measured on Notifications.
- **Search is per area and by label only** (kit `searchSettings`); "backups" typed on the personal side finds nothing.
- **Two row patterns.** Selects with more than four options and secrets open a dialog ("Change"), the rest edit inline, so one
  card mixes both and a reader cannot predict a tap.
- **Admin-only visibility is by role, correct;** a teen and a child see no household rows (not re-verified this session; the
  `settingsMinorSnapshot` test covers it).

### Already covered by backlog rows

SETTINGS-IA-02 (spec fields: `scope`, `recommended`, `added_in`, `search_terms`), IA-03 (kit badges and side-wide search),
IA-04 and IA-05 (the household and personal page sets), IA-06 (News shelf to Household settings), IA-07 (Changed view),
IA-08 (New and Recommended markers), IA-09 (verification), SETTINGS-UX-03b (tabs and detail views as data), UX-04 (Devices
list, add dialog, detail screen), UX-06 (captures), SETTINGS-LOOK-01 (ChatGPT-like rows, no Reset), PROFILE-TOUCH-01 (48 px
targets on Profile). This report does not duplicate them; section 7 says which it folds into and what is new.

## 3. What the research says

Patterns taken, each from a product a non-expert parent already uses:

- **A short overview first, values on the row.** Android's settings guidance: an overview page shows "the most important and
  frequently used settings and their values", and a row carries secondary text for its status; group under a subscreen past
  about fifteen settings; prefer a dialog or radio screen over a dropdown for a choice
  ([developer.android.com settings patterns](https://developer.android.com/design/ui/mobile/guides/patterns/settings),
  [Android settings design guidelines](https://source.android.com/docs/core/settings/settings-guidelines)).
- **A repairs inbox with a count, and severity words.** Home Assistant raises a Repairs issue when something needs a person,
  shows the count on the Settings entry, and grades items critical, error or warning, with a one-click fix flow when one
  exists ([Repairs](https://www.home-assistant.io/integrations/repairs),
  [developer docs: repairs platform](https://developers.home-assistant.io/docs/core/platform/repairs)). Home has the same
  store (`lib/issues.ts`, rule S6); the strip reads it.
- **A health word, not a gauge.** Synology's Storage Manager shows "Healthy", "Warning" or "Critical" per drive and an
  overview with status, usage and scheduled tasks
  ([Storage Manager](https://kb.synology.com/en-id/DSM/help/DSM/StorageManager/StorageManager_desc?version=7),
  [abnormal drive statuses](https://kb.synology.com/en-me/DSM/tutorial/Drive_in_abnormal_statuses)). Time Machine's menu shows
  the date and time of the latest backup and nothing else when idle ([Back up your Mac](https://support.apple.com/en-az/104984)).
  The Backups tile reads "Last night at 2:10" or "None yet" the same way.
- **Problems grouped by kind, each with its items.** 1Password Watchtower lists weak, reused and compromised items under
  category headings, each with "Show items" ([Watchtower](https://support.1password.com/watchtower/),
  [Insights](https://1password.com/blog/announcing-insights)). The attention strip groups the same way when it grows past
  about six items.
- **Family controls: a per-child page, and quick buttons.** Apple's redesigned parental controls show, under a child's name,
  quick buttons for device use and daily Screen Time, and some controls are on by default and cannot be removed
  ([What's new with parental controls](https://support.apple.com/guide/child-safety/k6zl0kw9zbgr/web),
  [Family Sharing overview](https://support.apple.com/119854)). Google Family Link puts Controls, Location and an
  at-a-glance Highlights tab side by side ([Android Central](https://www.androidcentral.com/apps-software/google-gives-family-link-a-new-look-and-plans-new-supervision-tools),
  [Tom's Guide](https://www.tomsguide.com/news/google-family-link-just-got-a-redesign-and-new-parental-controls-what-you-need-to-know)).
  Microsoft Family Safety opens a member's profile to enable reporting, limits and filters
  ([Getting started](https://support.microsoft.com/en-au/account-billing/family-3c29c2ec-f1e3-43a3-a5a6-a899bb1d8233)).
  Home already keeps a child's limits on the Family page (rules 0 and 8); the Privacy and safety page adds the one grid a
  parent reads before going there, and the People list shows each child's state.
- **A privacy page that lists what left the device and why.** Apple's App Privacy Report shows how often each app touched
  sensitive data over seven days and which domains it contacted ([About App Privacy Report](https://support.apple.com/102188));
  Android's Privacy Dashboard shows permission use on a timeline
  ([Tom's Guide on Android 16](https://www.tomsguide.com/phones/android-phones/android-16-is-copying-this-privacy-feature-from-the-iphone)).
  Home's "What connects to the internet" list becomes the "What leaves the home" tab with a dot per service and the setting
  that allows it.
- **Labels before search, and search by plain words.** GitLab's settings redesign found vague section labels forced guessing and
  fixed the labels first ([GitLab case study](https://awskws.duckdns.org/blog/quantifying-ux-validating-the-redesign-of-gitlabs-settings-pages/));
  put frequent settings first and treat search as a supplement because people do not know the term
  ([saasframe](https://www.saasframe.io/blog/saas-settings-page-design-examples)); search every label and alias with fuzzy
  matching ([settings architecture](https://www.techinterview.org/post/3233475401/build-settings-page-architecture-that-scales/?format=md)).
  Hence section 6 (wording) lands before the search, and the search reads `search_terms`.

Not found this session: a design write-up of UniFi's or Plex's health pages; nothing in the design depends on them.

## 4. The design

The visual language is the AI and models canvas: dark, calm, one dot and one word per state, red only on the word and the
dot, kit parts as shipped (rule 9), copy from the spec (S5), status from the existing surfaces (S6).

### 4.1 The Settings home (board 1, phone on board 15)

- `/settings` becomes a page, not a redirect. Title, one line ("Yours, and the home's · Sage, owner · checked just now"), the
  search box, the Needs attention strip, then tiles in two groups: **Yours** (6) and **The home** (9, owner and admins only).
- A tile is the kit `Item` with an icon tile, the area name and one line of state: a dot only when something is Missing,
  Problem, Off or Not set up, and a few words ("No backups yet · 782 GB free · up to date"). No dot means fine. The words come
  from data each page already loads (S6): backups record, health, install status, the device link state, the setup
  checklist, the search service check, the Telegram and Home Assistant link checks.
- The column keeps the same two groups and names, with the dot beside the row (SETTINGS-UX-02's per-row summary).
- **Search** is one box on the home and in the column, finds settings on both sides the viewer may open, by label, help, page
  name and `search_terms` (IA-02 and IA-03), and shows the breadcrumb with the control in place. The `/` key focuses it.

### 4.2 The Needs attention strip (board 2)

At the top of the home and of every area page. Empty state: "Everything is fine. Checked just now." Items: one dot, one
short sentence naming the thing a person recognises, the consequence in plain words, one button. Sources: Repairs issues,
the Finish setting up checklist, install status, engine health, the backups record, the device link state, the search
service check. It adds no poll, banner or toast (S6): it is a view over those stores, aggregated once by one backend
function (`GET /api/settings/attention`, filtered by role and band). The count in the title equals the count on the tile.
Five dot words, used identically everywhere: Ready, Missing, Problem, Off, Not set up. A child never sees the strip; a teen
sees only items about their own settings.

### 4.3 The page template (every area)

1. Breadcrumb, title, a row of state chips ("Only you", "Two-step off", "Face not set up").
2. Tabs declared as data (SETTINGS-UX-03b), at most four, each a different question a parent asks.
3. The attention strip for this area.
4. Cards of value rows: label, one-sentence help, the value readable on the row; a switch for a yes or no; a chevron that
   opens one sheet (kit `Sheet`, a drawer on a phone) with the control, its sentence and Save. No inline forms, no in-place
   folds, no "Reset to default" on rows.
5. Advanced is a tab or a sheet section, never a fold that pushes content.

### 4.4 The areas, tab by tab

Personal side (6 areas; names changed for two):

| Area | Tabs | What moves in or out |
|---|---|---|
| P1 Profile and sign-in (board 3) | Profile · Sign-in · Devices | In: face sign-in (from Your data), session lock for admins (from Your data › Developer). Merge the two voice-print switches into one row. Devices: signed-in sessions, paired devices, away sign-ins, offline copies, with Sign out per row. |
| P2 Look and ease (board 4) | Look · Ease of use | Comfort style first; rows say "From Comfort style" or "Custom"; one "Back to Standard" at the foot. Out: Reset to default. |
| P3 Chat and AI | Chat · Personality and companions · Skills · Shortcuts · Coding (when granted) | Out: Music playback (to P4). Skills: two groups (In chat, Not in chat) with plain reasons, a filter box. Safe search and page clean-up stay on Chat. |
| P4 Voice, sound and robot (renamed) | My voice · Listening and playback · Robot | In: Music DJ, crossfade, sound preset, lyrics (from P3); wake word on this device (the undrawn `device.voice` key); audio speeds. Out: the Commands link (household). |
| P5 Notifications (board 5) | Where · What · Quiet hours | Where: This device, Telegram (with a Connected or Not connected dot and the chat link), A robot. What: one row per event with a chip per place; events about the home's computer show only to owner and admins. Quiet hours: "Following the home's 22:00 to 07:00" until set. |
| P6 Your data and apps (board 6) | Your data · Memory · Apps | Memory gets its heading. Apps: one row per app with your settings (Weather, News, Podcasts, Maps, show in the sidebar). Out: face recognition, signed-in devices, the Developer tab. In: your Home Assistant presence (today not placed). |

Home side (10 areas become 9):

| Area | Tabs | What moves in or out |
|---|---|---|
| H1 Household and people (board 7) | People · The home · Finish setting up | People is the user list with state per person (band, sign-in kind, no PIN, last seen) and a Family page link. In: the home's quiet hours (from Apps › Integrations). Out: the internet check (to H9), the companion preview switch (to H9). The checklist is its own tab and feeds the strip. |
| H2 Privacy and safety (board 8) | Children and teens · Blocked sites · What leaves the home | In: child and teen web rules and DuckDuckGo for minors (from Search), blocked sites (12 keys, from Search), the teen gate grain (from AI › Advanced), the internet connections list (from Your data and Privacy links), the internet check (from Household). A by-band grid shows the whole picture; a cell is the same setting shown in one more place, read-only where the age gate decides. |
| H3 AI and models | done | Out: the voice speech keys (to H5), host guard (to H9). |
| H4 Pictures, videos and music (board 9) | Pictures · Videos · Music · Styles | Shape kept; each tab shows models by level read from H3; "Clear locks" only when there are locks; a dot on the Hugging Face and Civitai rows. |
| H5 Voices and commands (renamed, board 10) | Voices · Commands · How Home speaks | Commands: list first, Add opens a sheet. In: natural speech sounds, start early, talk over, overlap, voice-cloning token (from H3 Advanced). |
| H6 Search and web (board 11) | Where answers come from · Offline books · Advanced | In: the whole Offline data area as a tab; the three reference-library keys (from Apps › Integrations). Out: child and teen rules and blocked sites (to H2, still shown read-only here); the News card (to H7). The search service row reads "No address" with a Problem dot while the switch is on. |
| H7 Apps and devices (board 12) | Devices · Connections · Apps | Devices: every device, robots and people's phones and browsers, one row each with a state, Add a device as a dialog, a robot's own screen with Overview, Behaviour, Access (SETTINGS-UX-04). Connections: Home Assistant and the Telegram bot with a dot each; the safety alarm sensors with the alarm sheet. Apps: the News shelf and the Podcasts and Radio directories (IA-06). Out: quiet hours, reference library. |
| H8 Backups, storage and updates (board 13) | Backups · Storage · Updates and repairs | A real page: three state tiles, then the five storage keys as GB rows, the backup key as a state ("Saved on", "Not saved"), the Repairs list and the version. The `/backups`, `/storage`, `/updates`, `/repairs` pages stay and the tabs link to them. |
| H9 Advanced (board 14) | Network and access · Checks · Developer | In: internet check, host guard (restart the Mac), companion preview switch. Developer draws its expert keys with a sentence each. |

Removed as an area: Offline data (becomes H6 › Offline books). Every old URL keeps working through `settingsRedirects.ts`.

### 4.5 Phone (board 15)

The Settings home is the list: search, the strip (three items and "And 1 more"), the two groups as rows with a dot and
a few words. A page keeps the strip on top, tabs scroll sideways, sheets become bottom drawers, rows are 48 px. Three taps
from the drawer to a setting.

## 5. Old place to new place, every group

Today's place is the area, section and tab from `areas.json` v0.1.406; "n/p" means `not_placed`. Key counts are from
`keys.json`. Nothing is dropped; retired and internal groups stay unplaced.

| Group (keys) | Scope | Today | New |
|---|---|---|---|
| `person.profile` (2) | person | profile (locale in a Language card; enrollment sounds in the face card on data) | P1 Profile (language) · P1 Sign-in, inside the Face sign-in sheet (enrollment sounds) |
| `person.voice_print` (1) | person | profile (drawn twice) | P1 Sign-in › Voice recognition, one row |
| `person.privacy` (2) | person | n/p | `person.voice.match` P1 Sign-in › Voice recognition sheet · `scene.ha_person_entity` P6 Your data › Privacy |
| `person.security` (2, expert) | person | data › developer (never drawn) | P1 Devices › Lock after inactivity, admins |
| `profile.appearance` (4) | person | appearance | P2 Look |
| `profile.ease` (11) | person | appearance | P2 Ease of use |
| `profile.appearance.internal` (7, expert) | person | n/p | stays unplaced (UI state) |
| `person.chat` (4) | person | chat › general | P3 Chat |
| `person.search` (2) | person | chat › general | P3 Chat ("Safe results", "Clean up web pages before reading them") |
| `person.persona` (1), `person.companions` (3), `synths` person (3) | person | chat › personalization | P3 Personality and companions |
| `person.music` (4) | person | chat › personalization | P4 Listening and playback |
| `person.coding` (7) | person | n/p (account coding view) | P3 Coding, unchanged view |
| `person.voice` (5) | person | voice › voice | P4 My voice (`tts.voice_id`) · P4 Listening and playback (the four speeds) |
| `device.voice` (1) | device | voice › device (never drawn) | P4 Listening and playback › Wake word on this device |
| `person.robot` (7) | person | voice › robot | P4 Robot |
| `person.notifications` (5) | person | notifications | P5 Where (device, robot, muted senders) · P5 Quiet hours |
| `person.telegram` (16) | person | notifications, folded | P5 Where › Telegram row (chat id) · P5 What, one row per event with place chips; admin events owner and admin only |
| `person.podcasts` (2) | person | n/p (Podcasts page) | stays in the Podcasts app; P6 Apps links to it |
| `person.topics` (6), `person.allowance` (10), `person.likeness` (1), `person.storage` (2) | person | n/p (Family page, admin) | unchanged; H1 People shows each child's state |
| `household.system` (4) | household | household › general | H1 The home |
| `household.status` (4) | household | household › general | H9 Checks |
| `household.notifications` (3) | household | apps › integrations (Telegram card) | quiet hours H1 The home · bot token H7 Connections |
| `household.topics` (2) | household | privacy | H2 Children and teens |
| `household.blocked_sites` (12) | household | search, folded | H2 Blocked sites |
| `household.search` (12) | household | search | `search.web.child_mode`, `search.web.teen_mode`, `search.ddgs_for_minors` H2 Children and teens (read-only mirror on H6) · `search.source_mode`, `search.searxng_url`, `search.web_sources`, `search.source_mode.*`, `search.wayback_fallback`, `search.wikipedia_fallback` H6 Where answers come from · `search.dictionary_fallback`, `search.fetch_cache_gb`, `research.max_web` H6 Advanced |
| `household.news` (12) | household | search (card) | H7 Apps › News |
| `household.reference` (3) | household | apps › integrations | H6 Offline books |
| `household.chat_pause` (2), `household.ai_models` (6), `household.ai_chat`, `household.ai_coding`, `household.ai_music`, `household.ai_pictures` (4), `household.ai_videos` (2), `household.ai_vision`, `household.ai_voice`, `household.ai_wakeword`, `household.ai_runtime`, `household.ai_tiers` (20), `household.coding` (8), `household.coding_people`, `household.coding_limits` (7) | household | ai | H3 unchanged (the AI and models redesign) |
| `household.ai_advanced` (12) | household | ai › advanced | `voice.hesitations`, `voice.hf_token`, `voice.speculative_start` H5 How Home speaks · the rest H3 |

Talk before I finish was retired on 2026-11-20; its settings keys were removed from the shared spec and Home.
| `household.resources` (27) | household | n/p (H3 Performance) | `host.guard.*` (4) H9 Checks · the rest H3 Performance |
| `household.ai_developer` (2, expert), `media.budget` (1, expert) | household | advanced › developer (never drawn) | H9 Developer |
| `household.ai_retired` (4), `household.media_retired` (1), `household.media_styles_old` (2) | household | n/p | stay unplaced |
| `household.media_pictures` (2), `household.media_kids` (4), `household.media_videos` (2), `household.media_music` (2), `household.media_online` (3), `household.media_lookups` (7), `household.media_styles` (3), `synths` household (3) | household | media | H4 unchanged tabs; `media_kids`, `media_online` and `talent.minors.make` also appear read-only on the H2 grid |
| `household.voice` (1) | household | n/p (Voices view) | H5 Voices, the default badge, unchanged |
| `home.robots` (1), `robot.settings` (13) | household | apps › robot (flat) | H7 Devices › Rules for every robot (join, offers, safety alarm, live view, look when asked, tailnet); the per-robot rows on the robot's Behaviour tab |
| `household.integrations` (3) | household | apps › integrations | `home.base_url`, `home.access_token` H7 Connections › Home Assistant · `safety.alarm.sensors` H7 Rules › Safety alarm sheet |
| `household.storage` (5) | household | backups › storage (unreachable) | `backup.max_total_gb` H8 Backups · `backups.emergency_kit_saved_at` H8 Backups as a state row · `storage.household.cap_bytes`, `storage.person.default_cap_bytes`, `storage.critical_free_gb` H8 Storage, in GB |
| `household.network` (2), `household.network_port` (1) | household | advanced › network | H9 Network and access |
| `robot.hello` (17, device card) | device | the robot's own screen | unchanged; the robot's own tab on its detail screen |
| `app.pin:*` views | person | each app's gear | P6 Apps |

Link cards today (Manage: Users, Family, What connects to the internet, Signed-in devices, Storage, Backups, Updates,
Repairs, Performance, Status) become rows on the pages above; none is a separate card.

## 6. Names, descriptions and grouping (the owner's second ask)

Rules, then the table. Full before-and-after on board 16.

1. **A name says the thing in a parent's words.** No ids, engine names, units or internal words: "Stt model choice" is
   "Listening"; "Household storage cap (bytes)" is "Storage for the whole home" edited in GB; "Spoken offer tiers = Tier 1"
   disappears into one "Robots may offer things on their own" row.
2. **A description is one sentence on what it does for the reader** (S5), never how it is stored or which gate decides. A
   reason line appears only when the row is disabled for this person.
3. **A value is a word a person would say.** Never "inherit", "Preset", "Default" as a bare value: "Follows your settings",
   "From Comfort style", "Same as the home".
4. **A group is the question a parent asks**, not the table the keys live in: "Who can make pictures" then "How pictures are
   made"; "Where alerts reach you" then "What"; "Who can reach Home" then "Checks Home runs".
5. **A state is not a setting.** `backups.emergency_kit_saved_at` and the voice-print sample count are shown as state rows
   with the action, not as editable rows.

| Today | New name | New description |
|---|---|---|
| Voice (home side) | Voices and commands | Every voice Home can speak with, the phrases it answers to, and how it talks. |
| Voice and robot | Voice, sound and robot | Your speaking voice, playback speeds and music, and what a robot may do with you. |
| Offline data | Search and web › Offline books | Books kept on this Home, like Wikipedia, that work with no internet. |
| Apps and devices › Integrations | Connections | Other systems Home talks to: Home Assistant and the Telegram bot. |
| Level when nobody says | Usual quality level | Used when the person does not pick one. Standard is everyday; Boost makes other big jobs wait. |
| Look on this device (inherit) | Look on this browser | Overrides your look here only. "Follows your settings" unless you change it. |
| Spacing, Contrast, Motion and color, ... (Preset) | same names | Value "From Comfort style", or the value with "Custom". |
| Robot initiative · Spoken offer tiers · Offer acceptance phrases · Maximum offers per hour | Robots may offer things on their own | Up to N an hour, said out loud. The sheet holds how many, which kinds are spoken, and the words that mean yes. |
| Allow vision when requested | A robot may look when asked | Someone can ask what the robot sees; it uses its camera for that one answer. |
| Page text check | Clean up web pages before reading them | Strips menus and adverts so answers quote the article, not the page. |
| Household storage cap (bytes) · Default per-person storage cap (bytes) | Storage for the whole home · Storage per person unless set | Shown and edited in GB. |
| Warn when free disk space drops below (GB) | Warn when space runs low | Home tells an admin before the disk is full. |
| Backup key saved (a timestamp) | Backup key | "Saved on 3 Nov" or "Not saved", with Download. |
| Reference library location · Reference download time · Reference update speed limit (MB/s) | Where offline books are kept · When books download · Download speed limit | One sentence each; the limit in MB per second only inside the sheet. |
| Synths have lives · Made shows · Children and teens can make shows | Synths carry on between chats · Made shows · Children and teens can make shows | Each with one sentence on what a child sees. |
| Stt model choice · Tts model choice · Wakeword model choice · Embed, Judge, Rerank, Router, Turn Signal model choice | Listening · Speaking · Wake word · Search and memory · Judge · Rerank · Router · Turn signal | The AI and models helper names; the registry labels follow them. |
| Telegram me when a Stack engine reports an open warning or critical problem (and 15 like it) | An engine has a problem (one row per event) | The place is a chip on the row (Here, Telegram, Robot), so the name no longer carries it. |
| not offered: musicBandEditAllowed (Skills badge) | Not in chat: music editing is off for you | A gate name never reaches the page; "Not measured yet" where that is the reason. |
| Check whether the internet is reachable (+ three advanced) | Is the internet reachable | A tiny check so Home can say "offline" instead of failing quietly. Address and name in the sheet. |
| Restart the Mac when it stops responding | same | Moves from AI › Performance to Advanced › Checks: it is about the computer. |
| Safety alarm line · repeat interval · voice · volume · sensors | Safety alarm (one row, one sheet) | What a robot says and how loud when a sensor trips. |
| Adults allowed to view the robot camera · Allow robot live view | Live view of a robot's camera | Off, or on for the adults you name. |
| Finish setting up (a card on General) | Finish setting up (a tab) | Same nine steps, Open and Not now, feeding the attention strip. |

Every label and help change is a spec copy change (`keys.json` `label` and `help`, S5), checked by COPY-LINT-01.

## 7. Build plan

Order of landing. Each is its own landing; sizes S, M, L.

| Row | Size | Where | What | Depends on |
|---|---|---|---|---|
| SETTINGS-FIX-02 | S | Home | The defects that need no design: `/settings/backups` becomes a page again (restore the area, keep `/backups` as a link); the stray face card on Your data › Developer; the duplicate voice-print switch; the undrawn Voice › This device tab; "Clear 0 locks" hidden at zero; the People tab places `home.users_admin`; raw values "inherit" and "Preset" read as words; Skills badges carry plain reasons. Tests beside each. | none |
| SETTINGS-WORDS-01 | S | `commons` spec, then the pin | The section 6 table applied to `keys.json` labels and help; COPY-LINT green. | none |
| SETTINGS-SPEC-03 | M | `commons` spec, then the pin | `areas.json`: the moves of section 5, Offline data folded into Search and web, tabs as data (SETTINGS-UX-03b), `search_terms` (IA-02), a `status` source id per area and tab, the new `not_placed` reasons. `checkAreas` fails a key placed twice. Folds IA-02 and the data half of UX-03b. | SETTINGS-UX-03b ruling (done 2026-10-22) |
| SETTINGS-KIT-02 | M | `commons` ui, then the pin | `AttentionList` Element (shared with the AI and models page: dot, sentence, consequence, one button, empty state), the area tile with summary and dot for `SettingsShell`, state chips under a page title, side-wide search with `search_terms` (IA-03). Additive props only. | SETTINGS-SPEC-03 |
| SETTINGS-HOME-01 | M | Home | The Settings home page at `/settings`; `GET /api/settings/attention` over Repairs, the checklist, install status, health, backups, device links, the search check, filtered by role and band; the column dots; the redirect table. | SETTINGS-KIT-02 |
| SETTINGS-PERSONAL-03 | M | Home | The six personal pages on the template (section 4.4), Chat skills grouped, Notifications by place and event, the Devices tab. Replaces IA-05. `settingsMinorSnapshot` on every page. | SETTINGS-SPEC-03, KIT-02 |
| SETTINGS-HOUSEHOLD-03 | L, in slices | Home | One slice per page: Household and people; Privacy and safety (the by-band grid, read-only where the gate decides); Search and web with Offline books; Apps and devices (uses SETTINGS-UX-04); Backups, storage and updates; Voices and commands; Advanced. Replaces IA-04; IA-06 lands inside the Apps slice. | SETTINGS-SPEC-03, KIT-02 |
| SETTINGS-UX-06 | S | Home | Captures at 1440 and 390, light and dark, owner, adult, teen, child, opened and judged; the user doc page. | all above |

Not started; nothing is dispatched. IA-07 (Changed view) and IA-08 (New and Recommended markers) stay as they are and land
after HOME-01.

### What needs a spec or kit change first

- Spec (`commons/spec`): the `areas.json` moves, tabs as data, `search_terms`, per-area `status` source, the label and help
  changes, and three new `not_placed` reasons. All additive; one tag.
- Kit (`commons/ui`): `AttentionList`, the tile summary and dot props on the shell row, state chips, side-wide search. No
  Home wrapper and no `className` on a kit Element (rule 9); the status dot is a token colour on the kit `Badge`.
- Rules: none. Age and surface gates are untouched: the Privacy grid shows a setting in one more place and locks a cell the
  gate decides; moving the child and teen web rules between pages changes no gate. S4 holds (one shell, each group in one
  card). S6 holds (no new status surface; the strip is a view over existing stores).

## 8. Questions for Jesse

Decided on my own recommendation and written into the design; each is reversible with a one-line change to the plan.

1. **Fold Offline data into Search and web as a tab** (one place instead of three). Alternative: keep the rail item and remove
   the other two entrances.
2. **Rename "Voice" (home) to "Voices and commands" and "Voice and robot" to "Voice, sound and robot"**, with music playback
   moving from Chat and AI. Alternative: keep the names and leave music under Chat and AI.
3. **Show the eleven admin-only alert events only to the owner and admins** on Notifications › What. Alternative: show them to
   every adult as today.
4. **No Reset to default on rows; one "Back to Standard" on Ease of use and one Reset per row inside the Changed view**
   (the IA note's section 8, SETTINGS-LOOK-01). Alternative: Reset on every row.

Everything else in sections 4 to 7 is a build decision and needs no ruling.
