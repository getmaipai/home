# PRO-LOOK-01 build map: what to change, in what order, and how we know it matches the mockups (2026-11-08)

Status: proposed, for Jesse's review. Design and plan only; no code. It turns the approved note
[PRO-LOOK-01.md](PRO-LOOK-01.md) into slices a builder can start, from four read-only audits made the same day (frontend, kit,
themes, backend and process), kept whole under [assets/pro-look-2026-11-08/audit/](assets/pro-look-2026-11-08/audit/). The pictures to
match are in [assets/pro-look-2026-11-08/](assets/pro-look-2026-11-08/README.md).

Jesse's ask: audit every place that needs updating, map out everything to build and how, including themes, and make sure the code
builds exactly what the mockups show.

## 1. How the code will equal the mockups

1. **The pictures are the spec, minus the parts that need a rule change.** `docs/design/assets/pro-look-2026-11-08/` holds every mockup (40 pictures), the generator
   and the icon list. A slice cites the pictures it must match by name; the README maps each picture to a slice. A slice matches only the parts RULES.md allows as written; the parts that need a
   rule edit are listed in section 1a and are built only by the slice that follows the edit. No slice starts for a screen that has no picture
   (every screen in the note's section 9 now has one).
2. **Numbers, not only eyes.** Each picture states values (title 34 pt phone and 40 desktop, row 76, thumbnail 64, card radius 20,
   gutter 16, rail 56 icon-only, tab bar 68, avatar 36, pill height 44). A slice writes a test that asserts the values it owns with
   `getComputedStyle`-style checks or the kit's own tests, so a drift fails `bun test` and not only review.
3. **One parity procedure per slice** (section 3), run by the author, with captures and measured numbers in the commit message.
4. **Done means the displayed result,** in light and dark and two Looks, in child mode through Nova, with every state the picture draws
   made by the seed and not stubbed (org verification rule).
5. **Text never cramps** (note section 27): each slice's test asserts the text floor (200 px or 12 characters) and no one-word wraps next to a
   control, at the largest ease step and at 320, 402, 744 and 1440 wide.
6. **Nothing visual lands without its gate:** token resolution over 8 Looks times 2 schemes, the AA contrast check, `lint:ui-rules`,
   and the new lints of PRO-LOOK-LINT-01. A screen not yet converted sits in a shrink-only baseline and cannot get worse.

### 1a. Parts of the pictures that are rule-change options (built only after the named edit)

| Part drawn | Pictures | Rule it needs changed | Built by | Until then the slice builds |
|---|---|---|---|---|
| Icon-only 56 px rail (labelled rail dropped by Jesse, 2026-11-08) | every `desktop-*` picture | none: this is S1 as it is | NAV-01 desktop, no rule edit needed | the same |
| Main apps in a floating phone bar | every `phone-*` picture with a bar at Home, Chat, Media, Library | S1 (phone has no rail, the drawer is the switcher) | NAV-01 phone, after the S1 edit | The app's own sections in the floating bar (P2), the drawer for apps |
| Large page title below the header row | phone pictures | S2 (title lives in the header row), option (e) | HOME-01 only if Jesse takes (e) | The title in the header row, larger by tokens |
| Hero art behind the header row | `phone-detail`, `desktop-detail`, hero pages | S2 reserved-row reading | MEDIA-01, after decision 6 | The hero starting below the row |
| Activity page, the cross-app jobs list, the queue stack, the Activity entry and its dot | `making-now-queue`, `desktop-status-stack`, `phone-status-stack`, `phone-drawer-activity`, `activity-indicator` | S6 (option i) | ACTIVITY-01 only, after the S6 edit | Nothing: the cards appear only in lists that exist today |

The README repeats this table beside each picture so a builder sees it with the picture.

## 2. What the audits changed in the plan

These correct or sharpen the note; the note's section 26 records them.

1. **Home is 69 tags behind the kit.** Home pins `ui-v0.5.464`; commons is at `ui-v0.5.533`. A pin bump is slice 0, judged in the dev
   hub first. Several parts the note needs already exist after it: `Button variant="inverse"`, `shape="pill"`, `Input shape="pill"`,
   `PhoneNav` floating, docked and trailing, `MediaShelf` `seeAll` and `hideWhenEmpty`, `Sidebar variant="inset"`.
2. **Type is not driven by `--font-size-*`.** Only the setup wizard reads them; the kit sets text with Tailwind `text-sm`, `text-base`
   (about 870 uses). So re-valuing the tokens moves almost nothing. The lever is Tailwind v4's `--text-*` theme variables plus semantic
   utilities (`text-title`, `text-section`, `text-row`, `text-body`, `text-supporting`, `text-badge`, `text-hero`), gated behind
   `html[data-pro-look]` until Home is converted. The ease generator (`scripts/gen-ease-tokens.ts`) must learn the new names and the
   phone and desktop split, or its `data-ease-text` blocks silently override a media query.
3. **The 8 Looks are not in `tokens.css`.** They are 16 hand-set blocks (`.style-<look>` and `.dark .style-<look>`) in the kit's
   `dashboard/css/globals.css`. The existing `--surface-*` tokens are navy literals that ignore the Look. The new `surface-0..2` and
   glass are therefore `color-mix` derivations of `--background`, `--card` and `--muted`, which gives all 16 pairs from one rule and one
   resolution test.
4. **`--art-*` is Look-following today, the opposite of the note's text-over-art rule,** so in a light Look the art text is dark.
   Making it fixed light text on a fixed dark scrim is a visible value change (Player, Billboard, tile badges), not additive. It needs
   Jesse's yes and a rewritten `contrast.test.ts`.
5. **There is no kit gallery.** Only two settings showcases are mounted (`/dev/ui`). The gallery of section 19 of the note is new work
   and lands before the token slices so each has its picture.
6. **The kit touch floor is 48, the note says 44.** Keep a 48 hit area behind a 44 visible control (the kit's `hitArea()` pattern),
   or Jesse lowers the floor.
7. **Rail, header row, menu button and drawer are commons parts, not Home code** (`AppRail` 56 px with 20 px icons and no labels,
   `FullLayout` header, `MobileNavDrawer`). Home only mounts them in `shell/Routes.tsx`. Two Home hard-codes break under the labelled
   rail: `GlobalMiniPlayer.tsx` (`md:start-14`) and the companion avatar in `Routes.tsx` (48 px rounded, not the 36 pt circle).
8. **Picture, video and song jobs are not in `GET /api/jobs`.** They live in `lib/pictures/jobStore.ts`, `lib/videos/jobs.ts` and
   `lib/music/store.ts`. Feeding the progress strip needs a `generationJobsForViewer` projector in `lib/jobs.ts` (owner only, rule 6a),
   the dock must read `/api/jobs` for everyone (today admins only), and the stop route must reach the three cancel functions.
9. **The server has no "person is looking" signal,** so the bell's "only when away" rule cannot be a backend rule. The bell types are
   `generation.done` and `generation.failed`, audience person, configurable, no toast; the strip's DONE card is the in-page signal.
10. **The waiting lines already exist** in `JOB_QUEUE_COPY` and `QueueJob` (position, estimate, rise reason). The card reads them and
    never rewrites them; ISOLATION-03 (open) must land position and estimate before the queue display.
11. **The six-pin cap is not in Home source;** it is probably in the kit (`AppDirectory`, `AppRail`). Locate it before APPS-01.
12. **Studio scope conflicts with one Look.** `[data-surface="studio"]` (near-black, lime primary, whatever the Look) must be reworked
    or retired in STUDIOS-01. `MusicWorkspacePage.tsx` is the worst hand-drawn screen (forced dark class, own bar, tiles, pills).
13. **Bypass counts to drive to zero** (non-test frontend source, 494 files): 47 files with `text-destructive`, 81 toast lines, 74
    destructive Alerts, 5 raw `error.message`, 7 files using `failureCopy`; 758 `text-xs` to `text-4xl` uses in 141 files; 83
    `rounded-*`; 1 forced dark class; 2 `dark:` utilities (opacity only); 1 inline SVG (`ChatThreadExtras.tsx:174`); raw colors 0
    outside a 5-entry allowlist. Baselines to hold or shrink: class overrides 10, wrappers 24, CSS overrides 48 selectors (about 20 are
    rail rules NAV-01 can delete), hand-built chat 18.
14. **Only two screens use the boxed shelf** (`HomeShelves`, `MediaHomePage` with `MediaShelf variant="card"`); the 96 package-page
    shelves already use `plain`, so the shelf change is small.
15. **Dark mode defects in the mechanism:** every dark override is written three times in the kit; dark Olive `--muted-foreground`
    equals its light value and probably fails 4.5:1 (estimated, to be measured); 5 `prefers-color-scheme` CSS blocks and 7 TS sites
    plus two duplicates of `appearanceResolve` (`ThemeToggle`, `FaceEnrollmentPage`).

## 3. Parity procedure (every slice)

1. `bash scripts/wt.sh start <slice>`; source `data-scratch/bin/https-git.env` of the main checkout before any git step.
2. Kit parts: open the gallery page for the part in the commons worktree, capture 402 by 874 and 1440 by 900, light and dark, Neutral
   and Navy (the other six Looks by the token-resolution test). Open the capture beside the picture and judge. Tag, then
   `bash scripts/pin.sh commons ui-vX.Y.Z`.
3. Home screens: `bun run dev` in the worktree, never the live hub or 8787. Sign in as Sage, open the screen in the built-in browser
   at 402 by 874 and 1440 by 900, read the console, switch Appearance and Look, open child mode through Nova.
4. Measure: read the computed numbers the picture uses and compare; paste them in the commit message.
5. States: open every state the picture draws; make missing ones with the seed (`scripts/seed.ts`).
6. Cramp check: open the screen at the largest text step and at 320 wide and confirm labels never wrap to a single word beside a control.
7. Overflow and smoke: `scripts/panelOverflow.ts`, `scripts/mobileSmoke.ts`.
8. Land with `bash scripts/land.sh`; put captures and numbers in the commit message and the backlog row's status line.

## 4. Decisions only Jesse can make (needed before the slice named)

| # | Decision | Needed before | Recommendation |
|---|---|---|---|
| 1 | Touch floor: keep 48 hit area behind a 44 visible control, or lower the floor | KIT-01a | Keep 48 behind 44 |
| 2 | Art tokens fixed light on dark in every Look (changes Player, Billboard, tiles in light Looks today) | TOKENS-01 ART | Yes, it is the stated fix |
| 3 | Retire `[data-surface="studio"]` (lime, near-black) for `accent-create` and the cream primary | STUDIOS-01 | Retire |
| 4 | ~~S1 edit: labelled narrow rail~~ dropped: the rail stays icon-only at 56 px (Jesse, 2026-11-08, later the same day) | NAV-01 desktop | No rule change needed |
| 5 | S1 edit: main apps in a floating phone bar (option a) | NAV-01 phone | Yes, to match his references |
| 6 | S2 reading: hero art may sit behind the transparent header row | HOME-01 hero pages | Yes |
| 7 | S6: progress strip carries the viewer's own generation jobs; bell types; Activity page (option i) | JOB-01, ACTIVITY | Strip and bell yes (architect allowed); Activity when he wants it |
| 8 | Six-pin cap: keep, or raise (option h) | APPS-01 | Raise, scrolling rail |
| 9 | Home "Your apps" row (option f), drawer Recents (option g) | APPS-01 | No for both |

## 5. Themes build (8 Looks times light, dark and auto)

The mechanism today: `ui.appearance` (system, light, dark) adds `html.dark` or `html.light`; `ui.look` adds `body.style-<look>`; the accent
sets `body[data-accent]`; ease sets five `data-ease-*` attributes; `first-paint.js` sets the class and `firstPaintPalette.ts` the Look
before first frame; Home's `shell/tokens.css` adds the cyan primary and `--shell-*` tones as `color-mix` on `body`. Child mode
(`data-mode`, KID-MODE-02) does not exist yet. Ordered tasks (full detail in `audit/C-themes.md`):

1. **Kit tokens, additive** (TOKENS-01a): add the note's space, radius, type, surface-0..2, glass, hairline, accent-app, accent-create,
   accent-companion and motion tokens; derive surfaces on `body` by `color-mix` from `--background`, `--card`, `--muted` and `--foreground`
   (never from the navy `--surface-*`); extend the ease generator and its parity test.
2. **16-pair resolution and contrast test** (commons): resolve every token for each Look and scheme (an oklch and `color-mix` resolver)
   and assert AA for text pairs and 3:1 for accents; measure the suspect pairs (dark Olive, light Stone, light Taupe) and fix their
   hand-set values.
3. **Art family re-value** (TOKENS-01 ART, after decision 2): `--art-foreground`, `--art-scrim`, `--art-overlay` fixed light on dark on
   `:root, body`; rewrite the art contrast tests over all 16 pairs.
4. **Triple-dark cleanup:** collapse the three copies of each dark override into one rule so a new token is written once.
5. **Gallery** with the matrix: neutral and navy in light and dark at both sizes in captures; the other six Looks by test.
6. **Home plumbing** (HOME-01): set `data-pro-look` on `<html>`, add the new surface tokens to the first-paint palette so auto mode and
   every Look paint right on the first frame, delete the duplicate `appearanceResolve` copies, and fix `theme-debug.html` to report
   the new tokens.
7. **Lint extension** (LINT-01): extend `colorLints` with font-size, radius and spacing literals and the `text-xs` to `text-4xl`
   utilities (758 uses become token classes screen by screen), add the icon-import check, run the hand-drawn check as UI-LINT-01 to 03.
8. **Leak fixes then screens:** remove the forced dark class (`MusicWorkspacePage.tsx:186`), the two `dark:` opacity utilities
   (`MusicVisualizerSection:54`, `GlobalMiniPlayer:139`), the `prefers-color-scheme` TS sites, then convert screens in the order below.
9. **Final audit:** a script lists every remaining literal and baseline entry; the gate fails if one grows.

## 6. Ordered slices

Each slice is its own worktree and landing; kit slices are commons worktrees with a tag and a Home pin. "Pic" is the reference picture.
Sizes are S, M, L.

| Order | Slice | Repo | What | Key files | Needs | Pic |
|---|---|---|---|---|---|---|
| 0 | PRO-LOOK-PIN-00 (S) | Home | Bump the kit pin from 0.5.464 to the newest tag; judge the dev hub | `frontend/package.json`, pin files | none | none |
| 1 | PRO-LOOK-GALLERY-01 (M) | commons + Home | Kit gallery `/dev/kit` with every part in every state and a token page; capture script for 402 and 1440, light and dark, Neutral and Navy | `elements/KitGalleryShowcase.tsx`, `scripts/screenshotShowcase.ts` | 0 | all |
| 2 | PRO-LOOK-TOKENS-01a (M) | commons | Additive tokens, generator, 16-pair resolution and contrast test | `src/tokens.css`, `scripts/gen-ease-tokens.ts`, `looks-resolution.test.ts` | 1 | themes |
| 3 | PRO-LOOK-TOKENS-01b (M) | commons | `html[data-pro-look]` re-values and semantic text utilities; art family re-value | `tokens.css`, `globals.css`, `contrast.test.ts` | 2, decision 2 | themes, phone-home |
| 4 | PRO-LOOK-LINT-01 (M) | Home | Lint extension and baselines | `frontend/src/dev/colorLints.ts` and baselines | 3 | none |
| 5 | PRO-LOOK-KIT-01 a to j (L, ten small PRs) | commons | Button glass and control sizes; Chip strip; pill fields and PromptBar pill; flat Card; shelf, tile and row variants; Skeleton and EmptyState; PhoneNav glass; hero header and glass-on-scroll header; labelled rail (a prop, Home does not enable it); icons | per `audit/B-kit.md` section 7 | 3; decision 1 before KIT-01a | gallery |
| 6 | PRO-LOOK-HOME-01 (L) | Home | Set `data-pro-look`; first-paint palette; front page (greeting, shelves, weather and summary cards, empty shelf removal); shell chrome (36 pt circle companion avatar, header row, menu button glyph, `GlobalMiniPlayer` offset) | `shell/pages/HomePage*`, `HomeShelves`, `shell/Routes.tsx`, `GlobalMiniPlayer.tsx`, `firstPaintPalette.ts` | 5 | phone-home, desktop-home |
| 7 | PRO-LOOK-JOB-01 (L) | commons + Home + backend | Shared status-card anatomy and state treatment on Alert, JobProgress, VideoPlayer, image-generation and the song card; strip feed (one card, the existing strip); generation notifications; the stack and Activity pictures are not built here | `elements/status-card.tsx`, `lib/jobs.ts` `generationJobsForViewer`, `InstallDock.tsx`, `notificationTypes.ts` | 5, ISOLATION-03 for queue lines | making-now, status-cards, downloads-card, news-job |
| 8 | PRO-LOOK-ERRORS-01 (L) | Home | Convert 47 files, 81 toasts, 5 raw messages to cards and `failureCopy`; lint | `apps/settings/*`, `ChatPage.tsx`, `FilesPage.tsx` | 4, 7 | status-cards, stacks |
| 9 | PRO-LOOK-NAV-01 (M, one slice per width) | commons + Home | Icon-only rail kept (56 px, tooltips); phone floating bar with the main apps; delete rail CSS overrides | `AppRail`, `RailEntries`, `PhoneNav`, `shell/Routes.tsx` | decisions 4, 5 and the RULES.md edit | desktop-home, phone-home |
| 10 | PRO-LOOK-APPS-01 (M) | Home | Launcher (favorites shelf, grid, Edit, move up and down) | `AllAppsPage.tsx`, `usePinnedApps.ts`, `appCatalog.ts` | 9 if taken, else today's rail and drawer; decision 8 | phone-apps |
| 11 | PRO-LOOK-STUDIOS-01 (L) | Home | Music, Video, Images create pages on `PromptBar`, `accent-create`, tiles and rows; retire the studio surface | `MusicWorkspacePage.tsx`, videos and images `pages/*.json` | 5, 7, decision 3, VIDEO-UI-01 | create and edit pictures |
| 12 | PRO-LOOK-MEDIA-01 (L) | Home | Media home, Music browse, Videos, Shows and Films, Podcasts, Books, detail pages with the hero header | `MediaHomePage`, package `pages/*.json`, `CreationHeader` | 5, 6, decision 6 for art behind the header row | phone-detail, desktop-detail, phone-videos, phone-video-watch |
| 13 | PRO-LOOK-LIBRARY-01 (M) | Home | Library and Photos | `FilesPage.tsx` | 5 | phone-library |
| 14 | PRO-LOOK-CHAT-01 (M) | Home | Chat by tokens and kit variants only (rule 9) | `apps/chat/*` | 3, 5 | desktop-chat |
| 15 | PRO-LOOK-NEWS-01 (M) | Home | News and the encyclopedia reader | News and Kiwix pages | 5 | phone-news, phone-news-reader, phone-wiki |
| 16 | PRO-LOOK-SETTINGS-01 (L) | Home | Settings, account, family, companions, people (kit `SettingsShell` as is) | `apps/settings/*`, `PeoplePage`, `CompanionsPage` | 5, SETTINGS-LOOK-01 | desktop-settings, phone-settings, desktop-family, phone-family, phone-profile, desktop-profile (section 28) |
| 17 | PRO-LOOK-REST-01 (M) | Home | Weather, clock, reminders, notifications, sign-in, setup, admin pages | weather package, clock, reminders, sign-in and setup pages | 5 | phone-weather, phone-reminders, signin, setup, notifications |
| 18 | PRO-LOOK-ACTIVITY-01 (M) | Home + backend | Activity page, the jobs list and stack, the entry with status dots (option i) | new page, `ui.activity_seen_at` | decision 7 and the RULES.md S6 edit (Owner-approved) | activity-indicator, stacks |
| 19 | PRO-LOOK-AUDIT-01 (S) | Home + commons | Remove the `html[data-pro-look]` gate and the old type values so one scale remains; final audit script and gate: zero literals, empty baselines, per-screen capture set | `tokens.css`, `frontend/src/dev/*` | all | all |

Folded rows: PHONE-01, 03, 05, 06, CHAT-PHONE-01, KID-MODE-02, MEDIA-DETAIL-01 and 05, MOBILE-SWEEP-01, NEWS-LOOK-02, VIDEO-UI-01,
VIDEO-CREATE-02, MUSIC-STUDIO-01, CHAT-CARDS-11, ISOLATION-03, SETTINGS-LOOK-01, LEFTNAV-APPS-01. Draft backlog rows for every slice
are in `audit/D-backend-process.md` section 2; each slice adds its own row when it starts.

## 7. Backend and spec changes (from audit D)

1. `lib/jobs.ts`: `generationJobsForViewer` projecting `PictureJob`, `VideoJob` and `MusicJob` into the job list, owner only; the stop route
   dispatches to the three cancel functions; tests per producer.
2. `InstallDock.tsx` reads `/api/jobs` for everyone, with a faster delay while a job runs (the existing poll, not a second loop); install
   items keep the everyone audience, generation items owner only; one card at a time. Rule 6a guard: for a non-admin the route returns
   only install items and the viewer's own generation jobs; every other job kind and every other person's row (including `startedBy` and
   `forPerson`) stays admin only. Tests cover an adult, a teen and a child, and an unsigned request.
3. `lib/notificationTypes.ts`: `generation.done` and `generation.failed`, audience person, configurable, no toast, fired from the three
   producers on the `project.done` pattern. Possible commons spec tag for the toggle keys (check `settings-ahead-of-spec.json`).
4. The card reads waiting lines from `JOB_QUEUE_COPY` and `QueueJob`; ISOLATION-03 lands position and estimate first.
5. Pinning needs no backend change (`listApps` already filters; `AppRow` has `category`). Find the six-pin cap in the kit first.
6. Activity page (decision 7): `ui.activity_seen_at` person setting and one S6 row.
7. No new spec record. Order for any shared shape stays commons `spec`, then hub, then robot.

## 8. Rule edits (proposals; only Jesse changes a rule; the commit carries `Owner-approved: <date>`)

Drafts of the exact RULES.md text are in `audit/D-backend-process.md` section 3: (the labelled-rail edit is dropped, the rail stays 56 px icon-only); S1 phone floating bar with the main apps; S2 hero art behind the header row; S6 the strip's new feed
and Activity. Each gets its own architect ruling before the commit.

## 9. Risks and what is not covered

- The kit is far behind (69 tags); the pin bump may itself change screens and must be judged first.
- The art re-value and the type utilities touch every screen that uses them; both are gated behind `data-pro-look` until HOME-01 flips it.
- Theme values for six Looks are checked by tests and measurement, not by eye in every screen; two Looks are captured in full.
- Mockups use generated art, so a build is judged on layout, type, spacing, surfaces and states, never on the pictures themselves.
- The image engine did not make these pictures; if Jesse wants engine-made hero art, that is a separate step with a model download.
