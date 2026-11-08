# PRO-LOOK-01 build map A: Home frontend and package apps (audit 2026-11-08)

Read-only audit of worktree `competent-thompson-dfbe3a` (HEAD 24f91c671). Note: this worktree's `frontend/package.json` pins `@maipai/ui` ui-v0.5.464, while `origin/main` pins ui-v0.5.529 and tags up to ui-v0.5.533 exist in `commons-tags`. None of the new PRO-LOOK tokens exist even in 0.5.533 (`--surface-1`, `--surface-glass`, `--font-size-row`, `--font-size-hero`, `--gutter`, `--radius-thumb`, `accent-create`, `accent-companion` all absent; `--radius-card` is 16, `--radius-control` 10, `--font-size-body` 13.5, `--art-foreground` is `var(--foreground)` not the fixed light of note 24.2). The commons token slice is therefore fully ahead of us. Re-run counts after `git merge origin/main`.

Mockups dir: `.../pro-look-mockups/` (abbrev MK below). Files there: phone-home, phone-detail, phone-library, phone-apps, phone-drawer, phone-news, phone-news-reader, phone-wiki, phone-videos, phone-video-watch, phone-video-create, phone-music-create, phone-status-stack, desktop-home, desktop-detail, desktop-chat, desktop-video-create, desktop-music-create, desktop-photo-edit, desktop-status-stack, making-now, making-now-queue, status-cards, downloads-card, themes, before-after (.png and .html). The note also names `desktop-home-labelled-rail.png`, `phone-news-job.png`, `desktop-news-job.png`, which are NOT in the folder (only the 26 above), so slices that need them cite the nearest file.

## 0. Headline numbers (non-test frontend source, 494 .ts/.tsx files)

| Probe | Result |
|---|---|
| `text-destructive` | 81 hits in 47 files (settings 20, companionFlow 5, shell 5, shell/pages 4, shell/pages/settings 3, status 2, people 2, one each setup/reminders/notifications/memory/clock/chat). Matches note section 22 (47). |
| destructive `Alert` | 74 uses in 38 files (note says 73) |
| `toast.*` calls | 81 lines in 26 files; `toast.error` 62. Top: ChatPage 16, FilesPage 13, AmbientCompanionPane 6, chatProjects 5, StatusComponents 4, RepairsPage 4, ProjectsPage 4 |
| raw `error.message` shown | rendered directly: `shell/pages/StatusPage.tsx:87`, `shell/pages/CompanionsPage.tsx:211` (interpolated), `shell/pages/ChatPage.tsx:858` (toast, interpolated), `shell/pages/UiShowcasePage.tsx:170`, `apps/chat/chatErrorSlot.tsx:105` (GuardrailNotice title, rule 0 band copy: keep). 149 `.message` accesses in 77 files overall, most feed `setError` state |
| `failureCopy` users | 7 files, all import `@maipai/home-backend/src/lib/failureCopy`: AmbientCompanionPane, TurnErrorDetails, ChatPage, useChatAvailability, chatModelAdapter, chatThreadContexts, useMakingAvailability |
| Tailwind font-size classes (`text-xs..3xl`) | 670 hits in 138 files; arbitrary `text-[15px]` 1 (`apps/chat/chatHeaderBar.tsx:276`) |
| Hand radius/border/bg classes | `rounded-*` 68 in 37 files; `border` 82 in 46 files; `bg-card/muted` 25 in 15 files |
| `<Card` | 80 in 37 files (shell/pages 14, apps/settings 9, apps/setup 6, dashboard 3) |
| `ItemGroup variant="card"` | ~45 uses (settings, setup, library pages) |
| `<Badge` | 66 in 32 files |
| `variant="outline"` Buttons | 163 in 77 files (the "outlined rectangle" controls) |
| `size="row"` Buttons | 26 in 11 files |
| Icons | all via `getIcon` / `@maipai/ui/src/icons` (87 imports); zero `lucide-react` imports; ONE inline `<svg>`: `apps/chat/ChatThreadExtras.tsx:174` (data-URI SVG icons for slash commands, 7 hand-drawn paths). Note 19.2 wants zero. |
| `Skeleton` | 1 `<Skeleton` use, `RouteSkeleton` 24 hits / 9 files, `EmptyState` 88 / 32 files, `AsyncState` 143 / 42 files |
| `PhoneNav` | Home uses it once (`PackageAppPage.tsx:130`, `variant="floating"`); kit 0.5.533 already has `bar | floating | docked` |
| `role="alert"` / `role="status"` | 79 / 60 hits (error/notice spots without the card anatomy) |
| `<AlertDialog` family | 182 hits / 23 files (confirmations; unaffected but restyled by kit tokens) |

Baselines in `frontend/src/dev` (all shrink-only; they bound the debt that slices must NOT grow and may shrink):
- `color-lint-allowlist.json`: 5 entries (FaceEnrollmentPage black and bg-black/60, `lib/media/artPalette.ts` rgba, `AudioVisualizer.tsx` rgba and #000). Stays; camera and art-driven canvas colors are legitimate exceptions.
- `kit-classname-override-baseline.json`: 6 files, 10 component entries, all chat: `chatDateDivider`, `chatHeaderBar` (Input h-8, Button h-12/h-9 hit-area), `chatThreadSlots` (ElementsButton, ReasoningText), `chatToolUis`, `composerVoiceControls`, `shell/pages/ChatPage.tsx`. All reason "NO REASON: to be removed (cleanup item 6)", ED-035.
- `kit-css-override-baseline.json`: 2 files, 48 selectors. `shell/pages/chatTouchTargets.css` (hit-area, ED-030) and `shell/tokens.css` (ED-029/032/033/040): sidebar collapsed-rail rules (about 20 selectors, ED-033), incognito overrides (ED-032), chat user bubble (`.aui-user-message-content` background, radius, padding), `[data-slot="rail-page-header"] background`, destructive button/badge dark background (ED-040). The sidebar/rail ones disappear if the rail goes to kit variants.
- `kit-wrapper-baseline.json`: 15 files, 24 Home wrappers around kit parts (chat 10 files, `ModelsSection`, `ThemeToggle`, `ChatShortcutReference`, `TurnErrorDetails`, `ElementsAdoptionPanel`). 
- `hand-built-chat-baseline.json`: 11 files, 18 components (ChatThread, ChatThreadExtras, chatCitationLink, ChatHeaderBar, ChatComposerNotice, ChatWelcome, MessageDetailsReveal, ProducedArtifactCard, ProjectToolRender, ComposerAddMenu items, ChatShortcutReference, ChatPage, UiShowcasePage, TurnErrorDetails).
- Lint entry: `bun run lint:ui-rules` = `kitElementLints.test.ts handBuiltChat.test.ts colorLints.test.ts`. `colorLints.ts` (LITERAL_COLOR, NAMED_COLOR, PALETTE_CLASS, ARBITRARY_TOKEN_CLASS) is where font-size/radius/spacing literal checks (PRO-LOOK-LINT-01) and the error-text check (PRO-LOOK-ERRORS-01) slot in. Other guards: `uiRulesGuard.ts`, `statusColors.test.ts`.

## 1. Where the chrome really lives (important for slice sizing)

The rail, header row, drawer, and sidebar are NOT in Home. They are commons `ui` parts that Home mounts from `frontend/src/shell/Routes.tsx` (line 412, one very long `<FullLayout rail ... />`):

| Chrome | File (kit) | Draws today | Needs |
|---|---|---|---|
| Rail | `@maipai/ui/src/dashboard/layouts/full/vertical/rail/AppRail.tsx` (339 lines) | `--rail-width` default 56px; buttons `size-[var(--rail-button,40px)] rounded-lg`, icons `size-5` (20px), no labels, active `bg-foreground/10`; launcher button `app-rail-launcher` with 72-wide popover; pinned list `border-t border-border`; logo `size-7`; `HeaderSearch` in rail | PRO-LOOK-NAV-01 (labelled 80px rail, 22px icons, surface-2 active pill, no right border) plus token slice |
| Header row | `.../full/FullLayout.tsx:96` | `<header data-slot="rail-page-header" ... h-13 border-b border-border px-5 sticky>`, fallback title span, right slot, `rail-top-right` for companion | transparent over hero, glass on scroll, no border; 36pt avatar slot; kit variant |
| Mobile drawer + menu button | `.../rail/MobileNavDrawer.tsx` (51 lines) | `size-12 rounded-full border border-border bg-sidebar shadow-sm` fixed top-left, `Menu` icon `size-5`; `SheetContent bg-sidebar`; sections `border-t`; foot `border-t` + settings | 44pt glass circle, back-on-detail behavior (note 23); drawer foot per MK `phone-drawer` |
| Legacy header | `.../header/Header.tsx` (213 lines) | `bg-background border-b border-border`, violet incognito pill `rounded-full` | glass variant |
| Rail profile | `rail/RailProfileMenu.tsx` + Home `shell/RailProfile.tsx` (66 lines) | profile menu, incognito | restyle only |
| Sections bar | `@maipai/ui/src/PhoneNav.tsx` | already `variant="floating"` with `trailing` and `more` | tokenize, pill active, 64pt, labels rule |
| Section tabs on wide | `PackageAppPage.tsx` (`Tabs` `variant="pill"` and `"line"`, `data-slot="app-section-tabs"`) | three Tabs renderings (lines ~210, 228, 244) | one chip strip style |
| App column | `@maipai/ui/src/primitives/SectionSidebar.tsx` (`standalone density="compact"`) used by PackageAppPage:183, FilesPage:337 (Library), MediaHubFrame | bordered column | `Sidebar variant="inset"` per note 6.1 |

Home-side shell files that wire it: `shell/Routes.tsx` (517 lines; only 4 `className=`, all in the ambient avatar buttons), `shell/drawerSections.tsx`, `shell/phoneMenuLinks.tsx` (More links; `min-h-12 rounded-lg ... hover:bg-foreground/5`), `shell/appCatalog.ts` (`railApps`), `shell/usePinnedApps.ts`, `shell/useAppCatalog.ts`, `shell/allAppsPath.ts`, `shell/pages/AllAppsPage.tsx` (30 lines, wraps kit `primitives/AppDirectory.tsx`), `shell/pageHeaderTitle.tsx`, `shell/routeHeader.ts`, `shell/pages/packageAppHeaderBar.tsx` (header left/center/right: `AppSearch`, `Button size="icon-lg"`, star, more menu, gear `max-md:hidden`), `shell/useAppSidebar.ts`, `shell/appHeaderModes.ts`, `shell/ambientHeaderContext.ts`.

Companion avatar (Routes.tsx lines ~277-299): `ambientTrigger` and `ambientAvatar` are `<button className="flex size-12 ... ${botRingClass}">` with `rounded-xl ring-2 ring-muted-foreground/50 | ring-primary/60 | ring-primary`. Note 6.3 wants 36pt circle, ring role `accent-companion`, 3:1. Today: 48px, rounded-xl (not a circle), ring uses `primary` and `muted-foreground`. Also `shell/ambientRing.tsx` (57 lines), `shell/AmbientCompanionPane.tsx` (320, 6 toasts, 1 destructive, `failureCopy` already), `shell/useAmbientCompanion.tsx`.

A structural hit: `shell/GlobalMiniPlayer.tsx:88` hard-codes `md:start-14` (the 56px rail). A labelled 80px rail (NAV-01) requires this to read a token (or the kit `--rail-width`); also `MusicVisualizerSection.tsx:52` backdrop `top-13` (header height). The mini player also draws its own gradient `style={{ background: linear-gradient(... palette.corners) }}` (audio-art-driven, legit) and a `text-destructive` start-failed span.

## 2. Inventory by screen group

Legend per group: **Files** / **Draws today** / **Kit parts used** / **Hand-drawn** / **Errors/status** / **Mockups**.

### 2.1 Home front page (`/`)
- **Files:** `shell/pages/DashboardPage.tsx` (65), `shell/pages/dashboard/{Greeting,AskBox,TodaySection,HomeShelves,GettingStarted,homeBlocks}.ts(x)`, `apps/home/greeting.ts`, `apps/home/*` (1 file), `shell/InstallStrip.tsx` (139, shown pinned bottom via Routes.tsx ~168), `shell/InstallDock.tsx` (240), `shell/pages/status/*` not here.
- **Draws today:** `grid gap-6 md:grid-cols-2 lg:grid-cols-12`; blocks from `homeBlocks(layout)` (3 layouts `ask | board | shelves`, default `shelves`): greeting, admin nav (two `Button variant="outline" size="row"` Updates and Repairs), `AskBox`, Continue and New and Made-at-home shelves, Today cards, Getting started.
- **Kit parts:** `Card/CardHeader/CardTitle` (dashboard ui), `Item/ItemGroup`, `MediaShelf variant="card"` (HomeShelves:37 and MediaHomePage:69, the only two `variant="card"` shelf uses, the "card around each shelf with the black accent bar" of note audit 4), `AnswerBlockView block compact` (weather card), `InputGroup` + `HitField`, `AsyncState`, `RouteSkeleton`, `SafeImage`, `Avatar` primitive, `Collapsible`.
- **Hand-drawn:** `TodaySection` (116) draws Today cards as `Card size="sm"` with Item lists (hero card duplicated in two places), `Button variant="outline" size="sm"` chips for the `today_chips` layout, a `grid sm:grid-cols-2 lg:grid-cols-3` of cards, `h2 text-base font-medium` section titles (Tailwind sizes, not tokens); `FamilyShelf` = `Card` with `flex-wrap gap-4` avatar links `size-12` + `text-sm` (target: Household row); `ContinueShelf` = `Card` + `ItemGroup`; `AskBox` = `InputGroup` + three starter `Button variant="outline" size="row"` with `gap-x-2 gap-y-5` (target: one pill field + one chip strip, `PromptBar`); warming art `<img src="/setup-art/warming-up.webp" className="h-auto w-24 ...">`.
- **Errors/status:** `<p role="alert" className="text-sm text-muted-foreground">Could not load Home cards...</p>` (DashboardPage:48), same pattern in FamilyShelf, TodaySection ("Could not load Today"); `AsyncState errorMessage=` strings in HomeShelves (4). `installPlaceholder` pulls the install line into the ask placeholder (S6 surface; keep). Empty blocks already return null (good; matches "drop the shelf").
- **Status/jobs:** InstallStrip (see 2.12).
- **Header/rail/drawer:** rendered by Routes FullLayout; Home has no sections bar.
- **MK:** `phone-home`, `desktop-home` (+ `before-after`). Household row from `desktop-home-labelled-rail` (missing file).
- **Tests existing:** `DashboardPage.test.tsx`, `AskBox.focus.test.tsx`, `homeBlocks` tests (grep), `TodaySection` tests.

### 2.2 Shell and navigation
- **Files:** `shell/Routes.tsx`, `shell/{drawerSections,phoneMenuLinks,appCatalog,useAppCatalog,usePinnedApps,allAppsPath,nav,mediaNav,mediaApps,leftNavApps tests,appRailIcons tests,railCollapsePreference}.ts(x)`, `shell/pages/AllAppsPage.tsx`, `shell/RailProfile.tsx`, `shell/NotificationBell.tsx` (266), `shell/StatusIndicator.tsx` (54), `shell/ThemeToggle.tsx`, kit AppRail/FullLayout/MobileNavDrawer/Header.
- **Hand-drawn:** `NotificationBell.tsx:218` popover `rounded-lg border border-border bg-card p-2 shadow-lg`, `divide-y divide-border` list, `Badge variant="destructive|secondary"` count (note: no badge on companion; bell badge is its own, S6), `text-primary underline` link. `phoneMenuLinks.tsx` rows `rounded-lg px-3 min-h-12`. `StatusIndicator` `rounded` pill. `useAppearance/useLook/useAccent/useEase` + `firstPaintPalette.ts` + `first-paint.js` (no-flash per note 24.4, tokens used before first paint must include surface-1 and foreground).
- **Pinned apps:** `usePinnedApps.ts` (`ui.pinned_apps`), `appCatalog.ts` `railApps()`, `pinned_by_default` manifest flag. Cap of six: `docs/app-library.md`. All apps = `AllAppsPage` -> kit `AppDirectory` (search, Favorites first, star). `AppDirectory` is a kit primitive: all of PRO-LOOK-APPS-01 (category chip strip, rounded-square 64pt icons, 4-col grid, Edit with up/down) is a commons change plus Home passing `category` (already in `DirectoryApp`) and the reorder handler.
- **Errors/notices:** `Routes.tsx` 2 toasts (`toast.*`), `RailProfile.tsx` 1 toast; `shell/BrowserAlerts.tsx`, `shell/AlarmRinger.tsx` (204; `alarmRinger.module.css` 13 lines).
- **Icons:** all `getIcon`. Rail glyph sizes live in kit (`size-5`); drawer glyph is `Menu` (matches note 23).
- **MK:** `phone-drawer`, `phone-apps`, `desktop-home` (rail), `before-after`.

### 2.3 Chat (`/chat`, `/chat/projects*`)
- **Files:** `shell/pages/ChatPage.tsx` (1930 lines, 17 toasts, 3 `.message`, `failureCopy` 1), `ChatColumn.tsx`, `ChatShortcutReference.tsx`, `chatTouchTargets.css`, `chatReplyMarkdown.css`, `apps/chat/*` (85 files, 24 non-test tsx), `apps/chat/{chatHeaderBar,chatThreadSlots,chatToolUis,chatErrorSlot,ChatThread,ChatThreadExtras,chatActionBar,composerAddMenu,composerVoiceControls,MusicCardView,chatProjects}.tsx`.
- **Kit parts:** assistant-ui Elements (`elements/thread*`, `composer`, `chat-header`, `empty-state`, `follow-up-suggestions`, `image-generation`, `video-player`, `job-progress`, `guardrail-notice`, `tool-error`). Rule 9 applies: tokens and kit variants only.
- **Hand-drawn / baselined:** `ChatWelcome` (chatThreadSlots, hand-built baseline; `text-muted-foreground text-center text-sm` Incognito line); `chatHeaderBar.tsx` (Input `h-8`, Button `h-12/h-9 min-w-12 text-[15px] font-medium`, `size-[18px]` icons) all in classname baseline; `chatToolUis.tsx` `ProducedArtifactCard`, `ProjectToolRender`; 14 `rounded-*` and 19 Tailwind text sizes in `apps/chat`; `tokens.css` overrides `.aui-user-message-content` (background, radius, padding) which the note wants as `surface-2` + radius 20 via tokens/kit variant; inline SVG slash-command icons (ChatThreadExtras:174).
- **Errors/status:** `chatErrorSlot.tsx:105` (GuardrailNotice, keep: rule 0/9), `chatConnectionBanner.tsx` (wrapper baseline), `ChatComposerNotice`, `Alert` 6 in apps/chat (MusicCardView 6). ChatPage 17 toasts are the single biggest toast block: companion switch, branch, delete, export, project moves. `chatActivity.ts` consumes `runningNow.ts` ("Making now" in the chat activity list).
- **Jobs:** chat media (image/video/song) cards = kit `image-generation`, `video-player`, `MusicCardView`, via `chatToolUis.tsx` and `chatActivity.ts`.
- **MK:** `desktop-chat`, `status-cards`, `making-now`, `making-now-queue`, `phone-status-stack`.

### 2.4 Media hub and package apps (Videos, Music, Shows and Films, Podcasts, Books, News, Weather)
Package apps are schema documents drawn by kit `SchemaPage` through Home's `shell/pages/PackageAppPage.tsx` (395 lines). Backend pages (counts of schema nodes):

| Package | Pages | Nodes used | Header/sidebar contributes | Notes for PRO-LOOK |
|---|---|---|---|---|
| videos 0.1.5 | 9 (index, library, watch, watch-later, history, create, make-video, creations, search) | media_shelf 16 (plain), billboard 1 banner, split_view 2, player 2, prompt_bar 2, creation_header 1, section 2, list 3, empty_state 10, picker 1, search 1 | `header.modes` Browse/Create, `sidebar.groups` play/create, search | YouTube look MK phone-videos, phone-video-watch; Create = VIDEO-UI-01 |
| music 0.3.14 | 23 (index, radio, songs, albums, album, artists, artist, playlists, playlist, liked, play, search, create, studio, stems, remix, creations, edit, make-album, make-band, make-song, make-style, station) | media_shelf 41 (plain, mostly square), track_rows 3, billboard 2, quick_tiles 1, category_tiles 1, top_result 2, creation_header 7, section 5, tabs 1, split_view 1, player 2, search 2, empty_state 24 | `header.modes` Browse/Create, sidebar groups play/create | most tile and row candidates; Create pages are separate Home routes (2.5) |
| shows 0.1.0 | 7 | billboard 3, media_shelf 11 (poster), picker 3, split_view, player | none (sections only) | poster grid per MK note; Apple TV look |
| podcasts 0.2.12 | 10 | media_shelf 17, picker 8, billboard 2, list 2, search 3, split_view, player | none | |
| books 0.1.0 | 8 | media_shelf 11, empty_state 7, reader 1, player 1 | none | reader keeps serif/reader tokens |
| news 0.3.0 | 7 (index, mix, following, saved, channel, story, search) | answer_blocks 6, search 6, list 3, tabs 1, empty_state 6 | sidebar groups, widgets (Home Today) | NEWS-LOOK-02 tokens; MK phone-news, phone-news-reader |
| weather 0.3.9 | 1 | picker 1, answer_blocks 1, empty_state 1 | widgets | page is the kit `WeatherForecastPage` through PackageAppPage helpers |

Across these seven: `media_shelf` is used 156 times (`variant="plain"` 96, `aspect` square 60 / wide 22 / poster 14, `layout="grid"` 13, `density="compact"` 15). `MediaShelf` already supports `seeAll`, `hideWhenEmpty` and a plain frameless variant (primitives/MediaShelf.tsx lines 57-78), so shelf conversion is mostly a kit-side visual restyle plus per-page JSON adding a see-all target (only books/index.json and videos/index.json mention see-all today). `empty_state` icons: 47 uses across 19 icon names (note 7 wants a 96pt gradient tile per app accent: kit part change plus an optional `accent` prop in the node schema, which lives in `commons/spec`).

- **Home files:** `shell/pages/PackageAppPage.tsx` (395), `packageAppHeaderBar.tsx`, `packageAppNews.css` (42 lines; reader-ish News phone CSS), `shell/mediaHost.tsx` (317), `MediaHubFrame.tsx`, `mediaApps.ts`, `pages/MediaHomePage.tsx` (78), `MediaSearchPage.tsx`, `shell/media/{NowPlayingStage,AudioVisualizer(596),MinimizeButton,SleepMenu,VisualizerMenu,MusicVisualizerSection,useMediaAnalyser}`, `GlobalMiniPlayer.tsx` (145), `MediaPlayerRegistration.tsx`, `reader/{ArticleCard,ReaderArticle,SearchResults,saves}`, `newsListen.ts`, `pages/NewsDiscussPage.tsx`, `MusicLikeThisPage.tsx`.
- **Hand-drawn:** `PackageAppPage.tsx:~156` `VideoDetails` = `rounded-lg bg-muted p-4 text-sm` description box with `text-xl font-bold`; weather status `<p role="status" text-sm text-muted-foreground>`; three different Tabs renderings; `MediaHomePage` card shelves; `ArticleCard.tsx` (71) `rounded` x3 `border` `bg` x2 (should be kit story-card/StoryFeed).
- **Errors:** `AsyncState errorMessage` strings; `PackageAppPage` `errmsg 1`; `mediaBudgetGuard`/`mediaBudgetToast` (toast).
- **Jobs/status in media:** `runningNow.ts` (205), RunningNow kit primitive (`primitives/RunningNow.tsx`) is the old Making now card; VIDEO-UI-01 removes it per the note.
- **MK:** `phone-videos`, `phone-video-watch`, `phone-news`, `phone-news-reader`, `phone-wiki`, `phone-detail`, `desktop-detail`, `phone-library` (shared tile/row), `making-now`.

### 2.5 Creation studios (Music, Video, Images) and photo editor
- **Files (Home):** `shell/pages/MusicWorkspacePage.tsx` (196), `MusicStudioPages.tsx` (210), `MusicStudioView.tsx` (145), `MakeSongPage.tsx` (191), `MusicWaveform.tsx` (46), `MusicLikeThisPage.tsx`, `shell/media/MusicVisualizerSection.tsx`; Video Create is `videos/pages/{create,make-video,creations}.json` through the kit `prompt_bar` and `VideoPlayer` Elements; image generation is chat + `apps/settings/PicturesLibrary.tsx` (settings side) and `lib/picturesApi.ts`; photo editor is the kit `image-editor.tsx` Element (`media-editors-2026-10-31.md`).
- **Hand-drawn (worst offenders):** `MusicWorkspacePage.tsx`: line 186 `<section className="dark bg-background ... lg:rounded-3xl" style={lime}>` forces a `dark` class and sets `--accent-lime` to `--hue-yellow` and overrides `--primary`; song tile `bg-card ... rounded-2xl border-2 border-(--accent-lime)`; play circle `bg-(--accent-lime) ... rounded-full size-12`; duration pill `bg-background/80 ... rounded-full px-2 py-0.5 text-xs`; progress bar; `ToolTiles` `bg-card rounded-2xl border-2`; starter style tiles `bg-card rounded-2xl px-5 py-4`; docked bar line 158 `bg-card/95 sticky ... bottom-20 ... rounded-t-3xl border-t p-4 backdrop-blur` (should be kit `PromptBar`); `text-4xl font-black uppercase` titles; `Header` `text-xl font-black tracking-wide uppercase`; engine chip `bg-muted rounded-full px-3 py-1 text-xs`. `MusicStudioView.tsx`: `bg-card border-b`, `bg-(--track)/10 ... h-24`, `rounded` x3, 6 `border`. `MakeSongPage.tsx`: Alert x3, `text-xs/sm` labels. `MusicStudioPages.tsx`: `text-2xl font-semibold` page headers, 11 Tailwind sizes.
- **Errors:** `MakeSongPage` 3 `Alert` + 2 `.message`; `MusicWorkspacePage` 2 `Alert` + `role="alert"` plain muted line "Your songs could not be loaded..."; a "Music model: not running" chip (resource-ish wording audit needed, `noResourceWordsInUserCopy.test.ts` exists).
- **MK:** `desktop-music-create`, `phone-music-create`, `desktop-video-create`, `phone-video-create`, `desktop-photo-edit`.
- **Slice reality:** note 9a/18 says Video is already built by VIDEO-UI-01 rev 7 and `0e61c2427 VIDEO-INPUTS-01` landed on this branch; do not redo it, only token/accent props.

### 2.6 Library (`/files`) and Photos
- **Files:** `shell/pages/FilesPage.tsx` (403; 13 toasts), `shell/library/{LibraryItems(152),LibraryViewer(129),LibraryUploads(80),LibraryStorage,LibraryTrash(50),LibraryShareDialog(76),libraryModel,libraryOrigin,librarySidebarPreference,useLibraryActions}`, `pages/TrashPage.tsx` (64), `pages/StoragePage.tsx` (218), `apps/library/appPresentation` (single small file; the "app library" of package kinds, not the media Library).
- **Kit parts:** `SectionSidebar standalone`, `FileGrid/FileTile/FileGridShowcase`, `DataTable`, `BatchBar`, `CardSizeSlider`, `StorageBar`, `Dropzone`, `media-viewer`, `Skeleton`.
- **Hand-drawn:** header row `flex flex-wrap items-center gap-3` + `h1 truncate text-2xl font-semibold tracking-tight` + `text-base text-muted-foreground` headline (FilesPage:344-345), Upload `Button` with icon, controls spread over rows (note 3.6), `LibraryTrash` `rounded x2 border bg-card`, `LibraryItems` `rounded x1`.
- **Errors:** 13 `toast.*` (largest non-chat toast file), `LibraryViewer` 1 toast + `.message`, `LibraryUploads` `.message`; uploads progress uses `JobProgress` (LibraryUploads).
- **MK:** `phone-library`, `desktop-detail`/`phone-detail` (viewer hero).

### 2.7 Settings (all areas), Account, Home settings
- **Files:** `shell/pages/settings/*` (15 tsx: `SettingsAreaPage` 310, `SettingsRenderer` 270, `SettingField` 273, `SettingsSectionContent` 165, `settingsViews` 163, `WebSearchSettings` 150, ...) plus `settingsTokens.css` (`--settings-content-max: 1080px`, `--settings-row-text-max: 560px`), and `apps/settings/*` (45 tsx files, about 7270 lines: `UsersSection`, `PicturesLibrary`, `VideoLibrary`, `ModelsSection` (kit-wrapper + classname baseline), `ModelsAndStorageSection`, `AiGlance`, `CodingSettings`, `BackupsSection`, `Robot*`, `HuggingFaceTokenSection`, `EngineLinkCredentialSection`, `FreeUpSpaceDialog`, `StackChanInstallDialog`, ...). 
- **Kit:** `@maipai/ui/src/settings/*` `SettingsShell`, `describeSetting`, `HitField` (S4/S5). Rule: note says shell unchanged, restyle by tokens.
- **Debt:** `apps/settings` alone = 41 of the 81 `text-destructive`, 30 `<Alert`, 52 `.message`, 226 Tailwind font-size classes. Worst: `PicturesLibrary` (dest 5, text 18), `CodingSettings` (dest 4), `VideoLibrary` (dest 3), `CommandsSection`, `EngineLinkCredentialSection`, `AddRobotSection`, `UsersSection` (errmsg 7, text 13), `ModelsSection` (text 24, rounded 2, border 2).
- **Errors/status:** the S6 "form or action failed" row is `Alert variant="destructive"` in about 20 of these files, plus `text-destructive` inline text. `JobProgress` users: ModelsSection, PicturesLibrary, ReferenceLibrarySettings, VideoLibrary, ModelsAndStorageSection, StackChanInstallDialog, CodingSettings, AiGlance (downloads card, MK `downloads-card`).
- **MK:** `themes` (settings card look in all Looks); no dedicated settings mockup file exists (note 7 "Settings" paragraph only).

### 2.8 People, Family, Companions, profile
- **Files:** `shell/pages/FamilyPage.tsx` (158), `PersonProfilePage.tsx` (181; 14 Tailwind text sizes), `CompanionsPage.tsx` (360; `Alert` 7, `.message` 12, text 9), `CompanionAudienceDialog.tsx`, `companionFlow/*` (8 files: `CreateCharacterStep` 278 with dest 2 / text 12 / rounded 3, `CustomizeStep` dest 3, `AnimateStep` dest 1, `KeyframeEditor`, `DraggablePicture`, `CompanionFlowDialog`, `CompanionFlowPage`), `apps/people/*` (ProfileForm, NewPersonForm, Face/VoiceEnrollment; 3 `text-destructive`, 21 text sizes, 6 `border`, FaceEnrollmentPage uses black camera base via allowlist), `apps/memory/PersonMemories.tsx` (443).
- **Hand-drawn:** `FamilyPage` card `Link className="block rounded-xl transition-shadow hover:shadow-md"` (hover shadow on cards; note says no borders/shadows other than glass), `badge rounded-full bg-muted px-1.5 py-0.5 text-xs`; avatars `size-16`.
- **Kit:** `companion-profile-header`, `companion-card`, `character-hero`, `companion-stage`, `Avatar`, `CharacterTile`. Mostly already kit-driven; PersonProfile hero header (avatar 96, name 40, stats row) needs the kit hero header part.
- **Errors:** CompanionsPage:211 interpolates `${error.message}`; `chatError` state shown as text.
- **MK:** `phone-detail`, `desktop-detail` (person hero is not separately mocked).

### 2.9 Weather, Clock, Reminders, Notifications, Wikipedia
- `apps/clock/*` (9 tsx: ClockPage, AlarmsTab, TimersTab, StopwatchTab, WorldClocksTab, AlarmEditor...; 15 Tailwind sizes, 5 `border`, 2 dest). `apps/reminders/*` (7 tsx, 10 `border`, 3 `rounded`, 15 sizes). `apps/notifications` (NotificationsPage 224 lines, 1 dest). `shell/pages/WikipediaPage.tsx` (194; text 8; MK `phone-wiki`), `ReferencePage.tsx` (54). Weather: schema page + kit `WeatherForecastPage`/`weather-card` + Home `AnswerBlockView compact` on the front page. `clock-and-reminders-redesign-2026-10-30` already removed hairline rows in CLOCK-02.
- **MK:** none dedicated (note 9 "Hero card per accent"); closest `desktop-home`.

### 2.10 Sign-in and setup
- **Files:** `shell/pages/SignInPage.tsx` (213; `bg-accent` page, `rounded-lg p-3 hover:bg-muted` person tiles `Avatar size-16`, `text-destructive` x2, 9 text sizes); `apps/setup/*` (SetupWizard 507, StorageStep, PlanStep, AwayFromHome, CloseAppsStep, PerformanceStep, HostTuneStep, WebSearchStep, CheckGrid, PlanDiskSummary, `preview/` fixtures and `scripts/setup-preview*.mjs`); setup has 29 `<Alert` and 47 Tailwind sizes; `ItemGroup variant="card"` x6; Wizard = kit `primitives/Wizard`.
- **MK:** none dedicated (note 9 "Sign-in and setup" paragraph); `themes`.

### 2.11 Admin and status pages
- `UpdatesPage` (216; dest 2, 2 `.message`), `RepairsPage` (174; 4 toasts, 4 `.message`; the "Repairs item with Try again"), `StatusPage` (113; **raw `runChecks.error.message` rendered at line 87**) + `status/{StatusBoard,StatusComponents,StatusApps}` (34 text sizes, 6 toasts, 6 `.message`), `EnginesPage` (281), `PerformancePage` (173), `BackupsPage`, `UsersPage`, `CommandsPage`, `PrivacyPage` (15 text sizes), `TurnTracePage`, `TurnErrorDetails` (failureCopy; raw-error allowlist per rule 6), `MicTestPage`, `UiShowcasePage` (191; the Home-side gallery at `/dev/ui`, only a chat showcase), `performance/{EnginesHealthBody,LayersBody}`, `status/statusBanner.css`, `statusLegend.css`.
- These are admin-only and low user impact; they carry most of the error-copy debt.

### 2.12 Status, job and notice surfaces (S6) today
| Surface | File | Draws today | Note target |
|---|---|---|---|
| Install strip (inline in Home ask) | `shell/InstallStrip.tsx` (139) | `JobProgress` kit Element when failed or stalled, else a plain `flex-col text-sm text-muted-foreground` line + `Progress` bar (lines 63-68 and 106-112), `Link text-sm underline` Details | JobProgress card variant (downloads-card) |
| Install dock (pinned bottom for everyone signed in) | `shell/InstallDock.tsx` (240), `InstallDockRow.tsx` | `rounded-md border bg-background shadow-sm`, own `Progress`, toggle button `rounded-md`, failure group with `<p text-sm>` + muted `<p>` + `Link underline Repairs`, `retryError` as `text-destructive` `<p role=alert>` (line 222) | one docked status card (note 23), reuse same anatomy |
| Companion Review button | `AmbientCompanionPane.tsx` | kit Button; keep | keep (S6) |
| "Not ready" lines | `apps/chat/useChatAvailability.ts`, `useMakingAvailability.ts` | one-line text/disabled control | stay a line, tokens only |
| Notification bell | `NotificationBell.tsx` | popover list (above) | one new `audience:"person"` type for job end (backend `lib/notifications.ts`, `settings/notificationKeys.ts`; Home `NotificationBell.test.tsx` references types) |
| Running now | `shell/runningNow.ts`, kit `RunningNow`, `chatActivity.ts` | old Making now card | per note removed by VIDEO-UI-01; state treatment is JOB-01 |
| Job cards | kit `image-generation`, `video-player`, `job-progress`, `generation-stage`, song card `MusicCardView.tsx` (Home: `Alert` x6) | each their own | additive shared props (state word, ring, action) |
| Recovery toast | sonner via `@maipai/ui/src/ui/sonner` | 81 toast lines | one variant, errors never only toast |

## 3. Tests and gallery that exist (to extend, not invent)
`frontend/src/dev/{colorLints,kitElementLints,handBuiltChat,uiRulesGuard,statusColors}.test.ts`, `shell/Routes.test.tsx`, `leftNavApps.test.tsx`, `appRailIcons.test.ts`, `AllAppsPage.test.tsx`, `PackageAppPage.test.tsx`, `DashboardPage.test.tsx`, `InstallStrip.test.tsx`, `InstallDock.test.tsx`, `NotificationBell.test.tsx`, `ambientRing.test.tsx`, `appearanceResolve.test.ts`, `useAccent.test.ts`, `GlobalMiniPlayer.test.ts`, `lib/noResourceWordsInUserCopy.test.ts`, `main.palette.test.ts`; kit side `ui/src/{contrast,appearance-contrast,ink-contrast,text-opacity-contrast,fixedColors,ease-tokens,settings-tokens}.test.ts`, `PhoneNav.test.tsx`, `tabs-bottom.test.tsx`, gallery showcases in `elements/*Showcase.tsx` and `ui/*Showcase.tsx`. `bun run screenshots` is for docs only; gallery captures come from the commons gallery and `/dev/ui`.

## 4. Proposed build slices (ordered by impact, names as in the note)

Rule for every slice: commons part first (own worktree, tag, then `bash scripts/pin.sh commons ui-vX.Y.Z`), then Home; open the dev hub (`bun run dev`) at 402 and 1440 in light and dark and judge captures; extend baselines only downward; mark backlog row extended.

### S1. PRO-LOOK-TOKENS-01 (commons, no Home files)
- **Files:** commons `ui/src/tokens.css` (+ `dashboard/css/globals.css` bridge), `ease-tokens`, `fixedColors`; Home only: `frontend/package.json` pin, `shell/tokens.css` (look overrides), `shell/firstPaintPalette.ts` + `public/first-paint.js` (add surface-1, foreground tiers), `shell/useEase.ts`/`easeRows.ts`/`easeResolve.ts` (new sizes as steps of the generator).
- **Kit parts needed:** none; tokens: `--font-size-title/section/row/body/supporting/badge/hero`, `--space-1..7`, `--gutter`, `--radius-thumb/-card/-pill`, `--surface-0..2`, `--surface-glass`, `--shadow-float`, `--scrim`, `accent-hero`, `accent-app/create/companion`, `subtle-foreground`, `--art-foreground` fixed light + `--art-scrim` fixed dark (all 8 Looks x 2 schemes = 16 pairs).
- **Tests:** commons token-resolution test over 16 pairs, AA contrast, ease-tokens (child values untouched), `main.palette.test.ts`, Home `appearanceResolve`/`useAccent` tests.
- **Mockups:** `themes`, `before-after`, all (global).

### S2. PRO-LOOK-LINT-01 (Home) right after S1
- **Files:** `frontend/src/dev/colorLints.ts` (+ `.test.ts`) add font-size/radius/spacing literal classes and an icon-import check; new `dev/*-baseline.json` for current counts (670 text-size hits, 68 `rounded-*`, 1 `<svg>`); `uiRulesGuard.ts`; `package.json` `lint:ui-rules` already runs the three suites (add new suite name there only if a new test file is created).
- **Kit parts:** none.
- **Tests:** fixtures-based tests like `colorLints.test.ts`; baseline shrink-only assertion.
- **Mockups:** n/a. Order note: baselines with 670 entries must be generated by script and per-file counts not per-line, otherwise first run is unreadable.

### S3. PRO-LOOK-KIT-01 (commons)
- **Parts to add or variant:** pill `Button`/`Chip` (`ui/button.tsx`, `primitives/Chip.tsx`), round glass icon button, `Tile` (extend `IconTile`/`FileTile`/`MediaShelf` square), `Row` (extend `primitives/List.tsx` or `Item`: 64pt thumb, badge slot, trailing menu), shelf header with See All (extend `MediaShelf` plain frame), card surface variant (`ui/card.tsx`, `dashboard/components/ui/card.tsx`), hero header (extend `creation-header`/`PlayerDetails`/`character-hero`), floating `PhoneNav` token pass (pill active, 64pt, label rule, mini player dock), `Skeleton` + `tw-shimmer`, `EmptyState` gradient tile (`primitives/EmptyState.tsx`, `elements/empty-state.tsx`), glass `Sheet`/popover surface, `Sidebar variant="inset"` check, `AppDirectory` (APPS), `Alert` anatomy variant (JOB-01).
- **Home files touched:** none beyond the pin (this is the point of rule 9b); then S4+ adopt props.
- **Tests:** per-part tests + showcases in commons gallery, `PhoneNav.test`, `tabs-bottom.test`, `touch-target-floor.test`.
- **Mockups:** `phone-home`, `phone-library`, `phone-detail`, `desktop-detail`, `phone-videos`, `phone-apps`, `status-cards`.

### S4. PRO-LOOK-HOME-01 (Home front page and shell chrome) highest visible impact
- **Files:** `shell/pages/DashboardPage.tsx`, `dashboard/{Greeting,AskBox,TodaySection,HomeShelves,GettingStarted,homeBlocks}`, `Routes.tsx` (ambient avatar buttons lines ~277-299 to 36pt circle + `accent-companion`, mini-player, topRight slot), `GlobalMiniPlayer.tsx` (`md:start-14` to rail token), `pageHeaderTitle.tsx`, `drawerSections.tsx`, `phoneMenuLinks.tsx`, `NotificationBell.tsx` (popover surface), `ambientRing.tsx`, `AmbientCompanionPane.tsx` (glass popover/preview styling only), `RailProfile.tsx`.
- **Kit parts:** glass header variant + hero-capable `FullLayout`, `MobileNavDrawer` 44pt glass menu, Shelf header, Tile, Card variant, `PromptBar` for ask (Home passes props only), chip strip, `Button variant="inverse"` for primary, `WeatherCard` hero tile, household row (Avatar + Add; kit part or an `Avatar` group).
- **Tests:** update `DashboardPage.test.tsx`, `AskBox.focus.test.tsx`, `homeBlocks` tests (empty shelf removal), `Routes.test.tsx`, `ambientRing.test.tsx`, `GlobalMiniPlayer.test.ts`, `MobileNavDrawer` kit test; new: empty-front-page invitation test, companion avatar size/position test (36pt, reserved row).
- **Mockups:** `phone-home`, `desktop-home`, `phone-drawer`, `before-after`.

### S5. PRO-LOOK-JOB-01 + PRO-LOOK-ERRORS-01 (Home consumes the status-card anatomy)
- **Files:** `shell/InstallStrip.tsx`, `InstallDock.tsx`, `InstallDockRow.tsx`, `lib/installStatus.ts` (path per note; check: file is `lib/installStatus` under shell? find at build time), `shell/runningNow.ts`, `apps/chat/chatActivity.ts`, `apps/chat/MusicCardView.tsx` (6 Alert), `apps/chat/chatToolUis.tsx`, `NotificationBell.tsx`, backend `lib/notifications.ts` + `settings/notificationKeys.ts` (new person-audience job types, not frontend but needed), plus the error sweep: 47 `text-destructive` files, 78-81 toast lines (esp. ChatPage 17, FilesPage 13, AmbientCompanionPane 6), 5 raw messages (StatusPage:87, CompanionsPage:211, ChatPage:858, UiShowcasePage:170), `colorLints.ts` extension, new gallery captures per failure path.
- **Kit parts:** `Alert`/`Status`/`JobProgress` anatomy variant (lead, state word small caps, one cream action), toast variant for recovery, `job-progress.tsx`, `video-player.tsx`, `image-generation.tsx`, `generation-stage.tsx`, `ErrorState`/`error-state.tsx`.
- **Tests:** `InstallStrip.test`, `InstallDock.test`, `NotificationBell.test`, a lint test that fails on rendered `error.message`, on `text-destructive` text outside kit parts and on error-only toasts (baselines shrinking), `noResourceWordsInUserCopy.test.ts`.
- **Mockups:** `status-cards`, `making-now`, `making-now-queue`, `downloads-card`, `phone-status-stack`, `desktop-status-stack`, `phone-news-job`/`desktop-news-job` (missing).
- **Split advice:** do the anatomy and install strip/dock first (visible on every page), then convert error files screen by screen with each app slice (the note says so), not one 47-file commit.

### S6. PRO-LOOK-NAV-01 (needs Jesse's S1 rule edit; one slice per width)
- **Files:** kit `AppRail.tsx`, `FullLayout.tsx`, `MobileNavDrawer.tsx`, `PhoneNav.tsx`, `RailProfileMenu.tsx`; Home `Routes.tsx` (FullLayout props lines 412), `GlobalMiniPlayer.tsx`, `MusicVisualizerSection.tsx` (`top-13`), `shell/tokens.css` (about 20 `[data-slot="sidebar"]...collapsed .sidebar-box` selectors in the css-override baseline can be deleted if unused), `usePinnedApps.ts`, tests `leftNavApps.test.tsx`, `appRailIcons.test.ts`, `railCollapsePreference.test.ts`.
- **Kit parts:** labelled 80px rail (`--rail-width: 80px` default; icon 22px, 11pt label, surface-2 active pill, no border), floating bar with main apps + More (note 14 item 2, optional).
- **Tests:** rail width/label tests, hit-area, ease clause (width follows target-min token), S3 test at 80px; phone: app switcher in bar.
- **Mockups:** `desktop-home`, `phone-home`, `phone-drawer`, (`desktop-home-labelled-rail` missing).

### S7. PRO-LOOK-APPS-01 (launcher)
- **Files:** Home `shell/pages/AllAppsPage.tsx` (30 lines: add `category`, Edit/reorder handlers, move up/down), `usePinnedApps.ts` (reorder write), `appCatalog.ts` (`category` already carried); kit `primitives/AppDirectory.tsx` (+test): pill search, category chip strip, Favorites shelf of 64pt rounded-square icons, 4-col A-Z grid; `docs/app-library.md` update; add one backlog row.
- **Kit parts:** `AppDirectory` rewrite, `IconTile` accent art (`profileAccent.ts`), chip strip; UI-DECISIONS row not needed as long as reorder is buttons.
- **Tests:** `AllAppsPage.test.tsx`, `leftNavApps.test.tsx`, `usePinnedApps` reorder test, access filtering test (`GET /api/apps` already filters).
- **Mockups:** `phone-apps`, `phone-drawer`.

### S8. PRO-LOOK-STUDIOS-01 (Music, Video, Images)
- **Files:** `shell/pages/MusicWorkspacePage.tsx` (replace forced `dark`, `--accent-lime`, docked bar, tiles, ToolTiles, starter tiles with kit `PromptBar`, Tile, Row, Chip), `MusicStudioView.tsx`, `MusicStudioPages.tsx`, `MakeSongPage.tsx`, `MusicWaveform.tsx`, `shell/media/MusicVisualizerSection.tsx`; backend `packages/music/pages/{create,studio,stems,remix,creations,make-*}.json`, `packages/videos/pages/{create,make-video,creations}.json` (prompt_bar props, `accent-create`); commons `prompt-bar.tsx` (added props), `video-player.tsx`, `image-editor*.tsx`.
- **Kit parts:** `PromptBar`, Tile, Row (waveform slot), Chip, pill Button inverse, `accent-create` token, checkerboard stage from tokens (photo editor).
- **Tests:** `MusicWorkspacePage.test.ts`, `MusicStudioPages.test.ts`, `MusicStudioView.test.ts`, `promptBarNode.test.tsx`, a lint: no `dark` class literal and no `--accent-lime` anywhere in `src`.
- **Mockups:** `desktop-music-create`, `phone-music-create`, `desktop-video-create`, `phone-video-create`, `desktop-photo-edit`.
- **Sequencing:** only after VIDEO-UI-01 rev 7 and MUSIC-STUDIO-01 finish (the note says so).

### S9. PRO-LOOK-MEDIA-01 (Media home, Music browse, Videos, Shows/Films, Podcasts, Books, details)
- **Files:** Home `pages/MediaHomePage.tsx` (drop `variant="card"`, remove card/accent bar, add see-all), `MediaSearchPage.tsx`, `MediaHubFrame.tsx`, `PackageAppPage.tsx` (VideoDetails, Tabs renderings to one chip strip, header modes, Sections bar), `packageAppHeaderBar.tsx`, `NowPlayingStage.tsx`, `GlobalMiniPlayer.tsx`, `ArticleCard.tsx`; backend `packages/{videos,music,shows,podcasts,books}/pages/*.json` (see_all targets, aspects, `billboard size` to hero, `empty_state` accent), manifests (`contributes.header.modes`, `sidebar`); `commons/spec` only if a node prop is added (e.g. `empty_state.accent`, `media_shelf.see_all`).
- **Kit parts:** Shelf/Tile/Row, hero header (`creation_header` 8 uses, `billboard` 11), `Player`, `Sidebar variant="inset"`, floating `PhoneNav`, Skeleton at exact tile size.
- **Tests:** `MediaHomePage.test.tsx`, `PackageAppPage.test.tsx`, `mediaApp.test.tsx`, `mediaNodes.test.tsx`/`mediaVariants.test.tsx`, backend page-schema validation in `backend/tests` and `rules-baseline.json` (check no baseline drift).
- **Mockups:** `phone-videos`, `phone-video-watch`, `phone-detail`, `desktop-detail`, `phone-library`, `making-now`.

### S10. PRO-LOOK-LIBRARY-01 (Library and Photos)
- **Files:** `shell/pages/FilesPage.tsx` (403), `shell/library/*`, `TrashPage.tsx`, `StoragePage.tsx` (footer card), `LibraryViewer.tsx` (hero viewer with glass buttons, `media-viewer` kit).
- **Kit parts:** chip row, pill header search, Tile/Row, storage footer card (`StorageBar`), EmptyState tile, glass icon buttons.
- **Tests:** `FilesPage.test.tsx`, `libraryModel.test.ts`, `StoragePage.test.tsx`.
- **Mockups:** `phone-library`, `phone-detail`.

### S11. PRO-LOOK-CHAT-01 (tokens and kit variants only, rule 9)
- **Files:** `shell/tokens.css` chat selectors (`.aui-user-message-content`, `.aui-thread-viewport-footer`, `[data-slot="rail-body"]:has([data-slot="chat-shell"])`: ED-029/032/033), `apps/chat/{chatThreadSlots,chatHeaderBar}.tsx`, commons `thread`, `composer`, `suggestions`, `follow-up-suggestions`, `chat-header` variants; chat welcome at 34pt via kit token.
- **Tests:** `chatLayout.test.tsx`, `ChatThread.test.tsx`, `kitElementLints`/`handBuiltChat` baselines shrink, welcome-contrast test.
- **Mockups:** `desktop-chat`.
- **Dependency:** do not grow `kit-classname-override-baseline.json` (10 entries) or `hand-built-chat-baseline.json` (18).

### S12. PRO-LOOK-NEWS-01
- **Files:** backend `packages/news/pages/*.json` (7), `packageAppNews.css` (42 lines), `shell/reader/*`, `newsListen.ts`, `NewsDiscussPage.tsx`, commons `StoryFeed`, `ArticleView`, `story-card` tokens (`[data-slot="story-card"][data-phone-card]` already in tokens.css).
- **Tests:** `newsNodes.test.tsx`, `articleview-phone-css.test.ts`, `storyfeed-phone-css.test.ts`, `newsListen.test.ts`.
- **Mockups:** `phone-news`, `phone-news-reader`, `phone-wiki` (Encyclopedia: `WikipediaPage.tsx`, kiwix reader).

### S13. PRO-LOOK-SETTINGS-01 (settings, account, family, companions, people)
- **Files:** `shell/pages/settings/*`, `apps/settings/*` (45 files; error-card conversion of 20 text-destructive files and 30 Alerts belongs here via ERRORS), `FamilyPage.tsx`, `PersonProfilePage.tsx` (hero), `CompanionsPage.tsx`, `companionFlow/*`, `apps/people/*`, `apps/memory/PersonMemories.tsx`.
- **Kit parts:** `SettingsShell` surface-1 group cards, 56pt rows, hero header (person), card variant.
- **Tests:** `SettingsAreaPage` tests, `settings-tokens.test.ts` (kit), `FamilyPage.test.tsx`, `PersonProfilePage.test.tsx`, `CompanionsPage.test.tsx`.
- **Mockups:** `themes`, `desktop-detail`/`phone-detail` (person hero), no dedicated settings mockup.

### S14. PRO-LOOK-REST-01 (weather, clock, reminders, notifications, sign-in, setup, admin pages)
- **Files:** `apps/clock/*`, `apps/reminders/*`, `apps/notifications/NotificationsPage.tsx`, `SignInPage.tsx`, `apps/setup/*` (29 Alerts), `UpdatesPage`, `RepairsPage`, `StatusPage` + `status/*`, `EnginesPage`, `PerformancePage`, `BackupsPage`, `UsersPage`, `PrivacyPage`; backend `packages/weather/pages/index.json`.
- **Tests:** per-page tests listed in 2.9-2.11, plus setup-preview bundle test `test:setup-preview:bundle`.
- **Mockups:** `themes`, `status-cards` (Repairs), none dedicated.

## 5. Biggest findings
1. The rail, header row, drawer and phone menu button are commons parts (AppRail 56px/20px icons, FullLayout `h-13 border-b`, MobileNavDrawer `size-12 border bg-sidebar shadow-sm`). Most "shell" work is commons slices, not Home edits; Home hard-codes the 56px rail only in `GlobalMiniPlayer.tsx` (`md:start-14`).
2. No PRO-LOOK token exists even in ui-v0.5.533; worktree still pins ui-v0.5.464 while main pins 0.5.529.
3. `MusicWorkspacePage.tsx` is the single biggest hand-drawn violator (forced `dark` class, `--accent-lime`, own docked bar, tiles, pills).
4. Error debt matches the note (47/74/81/5/7) and is concentrated in `apps/settings` (41 of 81 `text-destructive`) and `ChatPage`/`FilesPage` toasts (29 of 81).
5. Only two Home call sites use the boxed `MediaShelf variant="card"` (HomeShelves, MediaHomePage); 96 package-page shelves already use `plain`.
6. Only one inline SVG and no direct lucide imports: the icon rule is nearly met.
7. Missing mockups: `desktop-home-labelled-rail`, `phone-news-job`, `desktop-news-job`; no mockups exist for Settings, Clock, Reminders, Weather, Sign-in, Setup, Family.
8. Baselines to hold: classname-override 10, wrapper 24, css-override 48 selectors (about 20 are sidebar/rail rules that NAV-01 can delete), hand-built chat 18.
