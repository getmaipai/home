# PRO-LOOK-01 build map D: backend, spec, backlog, rule diffs, parity (2026-11-08)

Read-only audit of `docs/design/PRO-LOOK-01.md` (sections 11, 13, 14, 16, 20 to 25) against the code in the worktree
`competent-thompson-dfbe3a`. No repo file was written. Everything below is a proposal for the slice authors.

Order for any shared shape: commons `spec` first, then the hub, then the robot. No new spec record is needed. Two items touch the spec
(notification toggle keys, one optional person setting) and are marked.

## 0. Findings that change the plan

1. **Picture, video and song jobs are not in the unified job list.** `GET /api/jobs` (`routes/jobs.ts`, `lib/jobs.ts`
   `listJobsForViewerLive`) returns rows from the `jobs` table (backups, imports, schedules), projects, approvals, waiting chats and
   (admin only) model downloads. A picture job lives in `lib/pictures/jobStore.ts` (`PictureJob`), a clip in `lib/videos/jobs.ts`
   (`VideoJob`), a song in `lib/music/store.ts` (`MusicJob`). Only `startImageProducerJob` (`lib/jobProducers.ts`) writes a `jobs` row,
   and the apps do not use it. So "feed the strip the viewer's own generation jobs" needs a projector, not just a filter change.
2. **The dock reads `/api/jobs` only for admins** (`InstallDock.tsx`: `admin ? readJobs() : []`, then keeps `kind === "model_download"`).
   That poll is the "existing polling" the note wants to reuse; it must read `/api/jobs` for everyone (the server already limits a
   non-admin to their own rows).
3. **There is no "person is looking" signal on the server** (no presence or visibility tracking in `backend/src`). The section 23
   condition "sent only when the job ends while the person is not looking" cannot be a backend rule. Use the existing split: the type is
   `toast: false`; the bell list and `BrowserAlerts` still carry it; the strip's DONE form is the in-page signal (1.3).
4. **The six-pin cap is not in Home source.** A search of `frontend/src/shell` finds no limit; `docs/app-library.md` says "held with a
   reason while six are pinned". It most likely lives in the kit (`AppDirectory`, `AppRail`) in commons. Verify there before APPS-01 says
   "keep" or "raise".
5. **ISOLATION-03 is partly built in words.** `lib/jobQueueCopy.ts` already holds `JOB_QUEUE_COPY` (adult and child lines such as
   `behind_chat`, `bigger_job_ahead`) and `QueueJob` in `lib/jobs/householdQueue.ts` has `position`, `estimateSeconds` and `riseReason`.
   The BACKLOG row is open because one-heavy-job-per-person and round robin are not done. The note's waiting lines must be read from
   `JOB_QUEUE_COPY`, never rewritten.
6. **The mockups are in the main checkout, not this worktree:** `<org>/home/data-scratch/design/pro-look/`
   (73 files, 18 MB, git-ignored). Section 8 of the note names the path without saying which checkout.

## 1. Backend and spec changes the note implies

### 1.1 App pinning (section 16, LEFTNAV-APPS-01)

Exists: `ui.pinned_apps` in `backend/src/settings/uiKeys.ts` (person scope, JSON list, default `"[]"`, level expert);
`frontend/src/shell/usePinnedApps.ts` (optimistic write; `null` means never chosen); `defaultPinnedRoutes(rows)` in
`shell/appCatalog.ts`; `GET /api/apps` (`routes/apps.ts` -> `lib/apps.ts` `listApps(person)`: role, enabled, platform, capabilities, age
band, surface, `nav` flag; the client drops Incognito-blocked apps). `AppRow` already carries `category`, `keywords`, `icon`,
`description`, `pinned_by_default`, `pin_order`.

Backend change needed by the note: **none.** Item 8 (access) is already true: `listApps` is the filter and a pin never grants access.
Item 3 needs a category per app, which exists, so no new manifest field. Item 7 (Recents) needs a navigation history that is not stored
server side, so it is frontend-only or omitted (the note allows omission).

| Change | File and function | Test |
|---|---|---|
| Pin storage and filtering: none | `settings/uiKeys.ts`, `lib/apps.ts` `listApps` | keep `frontend/src/shell/leftNavApps.test.tsx`, `pages/AllAppsPage.test.tsx`; add one case in the apps backend test: a role that may not open an app gets no row even when its route is in the stored pins |
| Launcher redraw (Favorites shelf, Edit with move up and move down, category chips) | `shell/pages/AllAppsPage.tsx`; kit `AppDirectory` additive variant (commons first) | extend `AllAppsPage.test.tsx`: order after move buttons saves the whole list; stale route ignored |
| Reorder without a sortable list | `usePinnedApps.ts`: add `movePin(navTo, delta)` calling the same mutation with a reordered array | optimistic order, rollback on a failed save |
| Cap (only if Jesse raises it, option h) | the kit file holding the limit (find in commons), `docs/app-library.md` | kit test for the new number |
| Activity dot on an entry (section 25) | S1 status dots source, see 1.5 | token contrast over 16 Look and scheme pairs |

### 1.2 The progress strip data path (section 23)

Today: Stack job list -> `lib/installStatus.ts` `getInstallStatus()` (1.5 s cache, `summarizeInstall`, `summarizeBackground`) ->
`GET /api/install` (`app.ts`) -> `InstallDock.tsx` `buildDock(status, jobs)` -> `DockItem` (key, words, label, state, bytes, `job?`) ->
`InstallDockRow.tsx` (kit `JobProgress` compact, only when an admin job row exists). `InstallStrip.tsx` (`ShellInstallStrip`, wizard,
Home ask box) reads the same status. Installs are "everyone, while it runs". The dock card itself is hand-built (`rounded-md border`).

What the note needs, in order:

1. **Backend projector** (new, in `lib/jobs.ts`, `generationJobsForViewer(actor)`): read the viewer's unfinished and just-finished picture,
   video and music jobs and return `HomeJob` rows with `kind` in `picture | video | song | stems | edit` (map from `PictureJob.kind`
   generate/variation/edit, `VideoJob.kind` generate/animate/edit, `MusicJob.task`). Call it from `listJobsForViewer` so `GET /api/jobs`
   and `HomeJobSchema` carry them with no new route. Rule 6a: only `personId === actor.id`, admins included (`visibleJobFor` already gives
   admins only `durationSeconds` of others' rows). Incognito jobs (`temporary`) are the viewer's own and listed only to them.
2. **Row shape** (1.4 lists what each record can fill): `state`, `title` (the prompt, one line, truncated), `progress`
   `{ percent, etaSeconds, position, phase }`, `waitingReason` (a `JobQueueReason` key), `errorKind`, `resultRef`, `provenance.app` (route to
   open), `actions` (`["stop"]` via `canStopJob`). The stop route in `routes/jobs.ts` today stops only `jobs` rows; it must dispatch to
   `cancelPictureJob`, the video cancel and `cancelMusicJob`.
3. **Wording on the server:** add `waitingLine` and `failureLine` (in `progress` or a sibling `copy` object) from
   `JOB_QUEUE_COPY[reason][audience]` (audience from `speakerAgeBand`) and `lib/failureCopy.ts` (`plainFailure`, `plainVideoFailure`,
   `plainMusicFailure` exist). The client writes no sentence (S5, section 22 item 5). Children: `visibleJobFor` already strips `eta_seconds`
   for non-adults; also drop `position` numbers for a child.
4. **Frontend:** `InstallDock.tsx` calls `readJobs` for everyone (drop the `admin ?` guard; keep file details admin-only). `buildDock` gains
   `kind: "install" | "generation"` on `DockItem` and a `done` state (8 s, then removed) beside `failed`. One card shows (existing `primary`
   rule: running, stalled, paused, queued). Draw it with the kit `JobProgress` anatomy variant (`PRO-LOOK-JOB-01`), not the hand-built
   card. Cadence: 2 s while a generation job is `running`, else the current 15 s. Same loop, different delay.
5. **`makingNotice`:** `makingNotice` (`lib/failureCopy.ts`, `MakingKind = "image" | "video"`) is S6's "Pictures and video are not ready" line
   and stays one line on the control; do not use it as a job failure card. A failure that coincides with a not-ready state is reported as
   that state (S6), so the projector returns `errorKind: "not_ready"` when `roleHealth` says `image` or `video` is unavailable, and the card
   shows that line. Do not add a `song` kind to `MakingKind` (music is not a `roleHealth` row today).

Tests: `backend/src/lib/jobs.test.ts` (owner sees own picture, clip and song; an admin never sees another adult's prompt; a child gets the
child line and no eta; Incognito job hidden from others; cancelled job dropped); stop-route test per producer;
`frontend/src/shell/InstallDock.test.tsx` (generation item shown to a non-admin, one card only, DONE form leaves, install keeps
"everyone"). `InstallStrip.test.tsx` unchanged. No extra Stack call (the 1.5 s cache stays).

### 1.3 Notification types for job end (section 23, the bell)

Files: `backend/src/lib/notificationTypes.ts` (array of `NotificationType`), `lib/notifications.ts` (`trigger(typeId, vars, opts)`),
`settings/notificationKeys.ts` (toggle keys derive from `configurable: true` types), the three producers.

- Add two declared types mirroring `project.done` and `project.failed` (level `time_sensitive`, audience `"person"`, `configurable: true`,
  `defaultChannels: ["in_app"]`): `generation.done` ("{title} is ready.") and `generation.failed` ("{title} could not finish: {next_step}").
  One pair covers picture, video and song (principle 1). `toast: false` so the page never shows a toast beside the strip's DONE card; the
  bell list and `BrowserAlerts` still deliver.
- Fire sites (terminal transition only, once): `lib/pictures/jobs.ts`, `lib/videos/jobs.ts`, `lib/music/jobs.ts`, with the `fireAndLog`
  pattern of `lib/projects/post.ts` line 163, `personId` of the owner. Not on the owner's own cancel; an admin stop already has
  `jobs.admin_stopped`.
- Child copy: `template` is one string, so the sender builds `title` and `next_step` from the child column of `JOB_QUEUE_COPY` and
  `minorLine` before `trigger`. A child's title is the child-safe label, never the prompt.
- Spec: `scripts/settings-ahead-of-spec.json` lists keys Home declares before the spec has them. Check whether `notifications.generation.*`
  keys need an entry there first, then a commons `spec` `settings/keys.json` tag and the Home pin (`docs/PINNING.md`). If
  `notificationKeys.ts` generates them locally and no gate complains, no spec change.
- Tests: `notificationTypes` test (ids declared, audience person, configurable, toast false); per-producer test that one terminal event
  fires one notification for the owner and none for anyone else; child line; `NotificationBell.test.tsx` opens the result route.

### 1.4 Shared job state: what each record has

| Field the card needs | PictureJob (`pictures/jobStore.ts`) | VideoJob (`videos/jobs.ts`) | MusicJob (`music/types.ts`) | Gap |
|---|---|---|---|---|
| state | `queued, running, done, failed, cancelled` | same | `MusicState` | map to WAITING, MAKING NOW, DONE, COULD NOT FINISH, PAUSED; PAUSED comes from `JobQueueState` `paused_chat`, not a record state |
| prompt or title | `prompt` | `prompt` | none on the job (in `request`) | project a `title` from `request`; never put lyrics in the strip |
| percent | `percent` | `percent` | `progress` | rename on projection |
| eta | none | `estimateSeconds` | `etaSeconds` | pictures have none: show the ring without time, do not invent |
| queue position | `position` | `position` | `position` | present on all |
| waiting reason | none stored | `riseReason`, `phase` `held:<reason>` | none stored | store `riseReason` on picture and music as video does, then map to `JOB_QUEUE_COPY` |
| error line | `error` (plain) | `error` (plain) | `errorLine`, `errorCode` | add the "next step" half from `FAILURE_ADVICE` |
| result | `files[]` | `files[]` | `fileId` | `resultRef` |
| cancel | `cancelPictureJob` | video cancel | `cancelMusicJob` | one stop route dispatching by kind |

Kit side (`PRO-LOOK-JOB-01`): additive props on `VideoPlayer`, the `image-generation` Element and the song card for state word, line,
action and ring; `JobProgress` gets the anatomy variant. Home passes data only. ISOLATION-03 owns queue behaviour; JOB-01's queue display
waits for its `position` and eta.

### 1.5 The Activity page (option i, sections 20 and 25), if taken

Not proposed as built. The data is the same projector as 1.2 with no strip filter.

- Backend: reuse `GET /api/jobs` (already per viewer); no new table, no new route; order stays `updatedAt` descending.
- Frontend: `shell/pages/ActivityPage.tsx` with the status-card anatomy; an entry in `shell/appCatalog.ts`, `nav.ts`, `Routes.tsx`; a
  `useActivityDot()` reading the same `["jobs"]` query as the strip and returning idle, running, needs a look, finished and unopened.
  "Finished, not opened" needs a per-person last-opened time: a person setting `ui.activity_seen_at` (spec first: a `ui.*` key in commons
  `settings/keys.json`, or `settings-ahead-of-spec.json` meanwhile), cleared when the page opens.
- Tests: dot precedence (amber wins), reduced motion keeps a steady dot, guest and shared screen get no entry, child sees child lines.
- This is an S6 change (3.4).

### 1.6 Spec order

1. commons `spec`: notification toggle keys only if the gate needs them (1.3); `ui.activity_seen_at` only for option (i).
2. No new record. `HomeJob` and `HomeJobView` are Home-local; `HomeJobSchema` in `routes/jobs.ts` takes `progress` as a free record. Document
   the optional fields and run `bun run gen:api-docs` (check.sh fails on `docs/api` drift).
3. Hub: 1.1 to 1.5. 4. Robot: no consumer of the strip; it reads notifications by type id and must ignore unknown ids (verify with one test).

## 2. Backlog rows (`docs/BACKLOG.md`, shape of `.github/docs/BACKLOG-FORMAT.md`)

Item template: objective, file pointers, a file to mirror, acceptance, out of scope, reuse check, exit check. Sizes S, M, L. Put them under a
new heading `## Professional look (owner, 2026-11-08)` after the `## UI / shell` section. L rows need an architect verdict before dispatch
(PRO-LOOK-01 is the design pass). Every kit part: commons worktree first, own tag, then `bash scripts/pin.sh commons ui-vX.Y.Z`. Common exit
set: `bash scripts/check.sh --pre`, `cd frontend && bun run lint:ui-rules`, the named `bun test` files, and the dev-hub capture of section 4.

- [ ] **PRO-LOOK-TOKENS-01: type, space, radii, four surface layers, glass and accents, all Looks** (M, `getmaipai/commons` `ui/`, then one Home pin; owner 2026-11-08; [design](design/PRO-LOOK-01.md) sections 5, 19, 24). Objective: section 5 values live only in `tokens.css`, defined for 8 Looks x light and dark; `--art-foreground/scrim/overlay` re-valued; first-paint palette updated. Files: `ui/src/tokens.css` and the Look token files, the token gallery page, Home `firstPaintPalette.ts` and `first-paint.js`. Mirror: how `--art-*` landed in ui-v0.5.257. Acceptance: token-resolution test and AA contrast pass over 16 pairs; gallery at 390 and 1440, neutral and navy, light and dark, opened and judged; no layout moves. Out of scope: any component. Reuse check: extends the shipped tokens file. Exit: commons token tests, `lint:ui-rules`, `check.sh --pre`. Folds into: KID-MODE-02 (type scale per mode), PHONE-01 (card surface), SETTINGS-LOOK-01 (row tokens).
- [ ] **PRO-LOOK-KIT-01: pill button and chip, round glass icon button, tile, row, shelf header, card variant, hero header, floating `PhoneNav`, skeleton** (L, `commons` `ui/`; after TOKENS-01). Objective: each part once, as an additive variant of the shipped part (`Button variant="inverse"`, `MediaShelf`, `MediaTileOverlay`, `Billboard`, `CardGrid`, `PhoneNav`, `Skeleton`, `CreationHeader`), a `UI-DECISIONS.md` row only where a part is outside the shadcn registry. Acceptance: a gallery page per part at 390 and 1440, light and dark, child mode; 44 pt targets; reduced motion for the skeleton. Out of scope: Home pages. Reuse check: the list in section 10 of the note. Exit: commons tests, gallery captures. Folds into: PHONE-01, PHONE-03, PHONE-05 (sections bar), PHONE-06 (one bar), MEDIA-DETAIL-01 and 05 (hero).
- [ ] **PRO-LOOK-LINT-01: lints for type, radius, space, icon imports and hand-built cards** (S to M, `home` frontend; right after TOKENS-01). Objective: extend `colorLints`, `kitElementLints`, `handBuiltChat` in `lint:ui-rules` with font-size, radius and spacing literals and a kit-icons-only import check, shrink-only baselines. Files: the `lint:ui-rules` scripts, the baseline JSON, `scripts/ui-rules-precommit.sh`. Mirror: how the color baseline was added. Acceptance: a new literal fails; baselines only shrink; about one second. Reuse check: extends the existing lints, no parallel family. Exit: `bun run lint:ui-rules`, `bun test scripts/uiRulesPrecommit.test.ts`. Folds into: UI-LINT-01 to 03 (rule 9b).
- [ ] **PRO-LOOK-JOB-01: one job and status-card treatment on the existing Elements, the strip feed and the job-end notification** (L, Home backend and frontend, `commons` `ui/`; after TOKENS-01 and KIT-01; queue display waits for ISOLATION-03). Objective: additive state props on `VideoPlayer`, `image-generation`, the song card, `Alert`, `Status`, `JobProgress`; `generationJobsForViewer`; dock reads jobs for everyone; `generation.done` and `generation.failed`. Files: sections 1.2 to 1.4 of this map. Acceptance: a non-admin sees their own running clip on the strip from the News page; the DONE form leaves after 8 s; Cancel works; another person never sees it; a child gets the child line and no eta; one notification per ended job. Out of scope: the Activity page, any new polling loop, a global tray. Reuse check: `JobProgress`, `InstallDock`, `lib/notifications.ts`, `JOB_QUEUE_COPY`; no new status surface. Exit: `bun test src/lib/jobs.test.ts src/lib/notificationTypes.test.ts` (backend), `bun test src/shell/InstallDock.test.tsx` (frontend), dev-hub capture. Folds into: CHAT-CARDS-11 (the chat `job` block keeps its own design pass), VIDEO-UI-01 feed entry (statuses unchanged), ISOLATION-03 (copy source), MUSIC-STUDIO-01 (song card state).
- [ ] **PRO-LOOK-APPS-01: the launcher** (M, Home frontend plus a kit `AppDirectory` variant; after NAV-01). Objective: pill search, category chips, Favorites shelf, Edit mode with move buttons, A to Z grid. Files: `shell/pages/AllAppsPage.tsx`, `usePinnedApps.ts` (`movePin`), `shell/appCatalog.ts`. Acceptance: pins in order, star on icon, long press on touch, the cap as built, stale pins ignored, an app the role may not open is absent. Out of scope: Recents in the drawer, a Home "Your apps" row, a raised cap (options f, g, h). Exit: `bun test src/shell/pages/AllAppsPage.test.tsx src/shell/leftNavApps.test.tsx`, capture at 402 and 1440. Folds into: LEFTNAV-APPS-01 (`docs/app-library.md`).
- [ ] **PRO-LOOK-STUDIOS-01: Video, Music and Images creation pages onto shared tokens and parts** (M, Home frontend; after or inside VIDEO-UI-01 rev 7, VIDEO-CREATE-02, MUSIC-STUDIO-01). Objective: `PromptBar`, `accent-create`, tiles, rows; remove the Music page's forced `dark` class and drawn bar. Acceptance: flows unchanged; VIDEO-UI-01's decisions untouched (chosen card accent border, Generate button); four captures per page. Exit: the studio page tests, `lint:ui-rules`. Folds into: those three rows and phone-minimal P9.
- [ ] **PRO-LOOK-MEDIA-01: Media home, Music, Videos, Shows and Films, Podcasts, Books and their detail pages** (M, Home frontend; hero art behind the header row needs 3.3). Exit: page tests, captures. Folds into: MEDIA-DETAIL-01 and 05, MOBILE-SWEEP-01 (media apps), NEWS-LOOK-02 (shared reading tokens).
- [ ] **PRO-LOOK-LIBRARY-01: Library and Photos** (M, Home frontend). Exit: Library tests, captures. Folds into: MOBILE-SWEEP-01 (library), `library-2026-10-18.md` phone controls.
- [ ] **PRO-LOOK-CHAT-01: chat tokens, welcome, history column, phone bar** (M, Home frontend, rule 9 slice: tokens and kit variants only; read the chat turn rules first; needs its own architect verdict like CHAT-PHONE-01). Exit: chat tests, `lint:ui-rules`, captures. Folds into: PHONE-06, CHAT-PHONE-01.
- [ ] **PRO-LOOK-NEWS-01: News on the new tokens** (S to M; after NEWS-LOOK-02). Exit: News package page tests, captures. Folds into: NEWS-LOOK-02, NEWS-03, PHONE-02.
- [ ] **PRO-LOOK-SETTINGS-01: settings, account, family and companions pages** (M; S4 holds: `SettingsShell` only). Exit: settings tests, captures. Folds into: SETTINGS-LOOK-01, SETTINGS-IA-07, the person hero header of `companion-three-screens-2026-10-28.md`.
- [ ] **PRO-LOOK-HOME-01: front page (greeting, shelves) and shell chrome (header, drawer button glyph)** (M, Home frontend; after KIT-01). Exit: shell and dashboard tests, S3 rail test at 360, 402, 874 x 402, 744, 1440, captures. Folds into: PHONE-05, `home-layouts-2026-10-25.md` (its four layouts keep working).
- [ ] **PRO-LOOK-NAV-01: labelled narrow rail and phone floating bar** (M, commons `AppRail` and `PhoneNav` then Home; BLOCKED until Jesse edits S1; one slice per width). Acceptance: S3's test updated to about 80 px and the new bar; the drawer still reachable; ease.targets large follows the token. Exit: the S3 test file, captures at 402 and 1440. Folds into: PHONE-05, PHONE-06.
- [ ] **PRO-LOOK-ERRORS-01: no buried error messages** (L, Home frontend; after TOKENS-01 and the JOB-01 card variant). Objective: Home source fails the gate on a rendered `error.message`, on `text-destructive` text outside the kit `Alert`, field error and card parts, and on an error toast (extend the existing lints); convert 47 files, 78 toasts, 5 raw messages screen by screen with each app slice; one failure capture per screen. Baselines shrink only. Out of scope: chat refusals (rule 0, SAFETY-NOTICE-01). Exit: `lint:ui-rules`, per-screen tests.
- [ ] **PRO-LOOK-REST-01: weather, clock, reminders, sign-in, setup** (S to M). Exit: page tests, captures. Folds into: CLOCK-02 (already hairline-free), `clock-and-reminders-redesign-2026-10-30.md`.

Fold map: PHONE-01/03 -> KIT-01; PHONE-05 -> HOME-01, NAV-01; PHONE-06 and CHAT-PHONE-01 -> CHAT-01, NAV-01; KID-MODE-02 -> TOKENS-01;
MEDIA-DETAIL-01/05 -> MEDIA-01; MOBILE-SWEEP-01 -> every app slice; NEWS-LOOK-02 -> NEWS-01; VIDEO-UI-01, VIDEO-CREATE-02, MUSIC-STUDIO-01 ->
STUDIOS-01; CHAT-CARDS-11 and ISOLATION-03 -> JOB-01; SETTINGS-LOOK-01 -> SETTINGS-01; LEFTNAV-APPS-01 -> APPS-01.

## 3. Proposed RULES.md edits (proposals only; only Jesse changes a rule; the commit carries `Owner-approved: <date>`)

Add to the "App shell" preamble: `Owner-approved 2026-11-08 (PRO-LOOK-01): <the items he takes>; his words: "<quote>".`

### 3.1 S1 desktop: labelled narrow rail (Jesse's choice, section 14 item 1)

```diff
-    every page from 640 px wide as a fixed 56 px icon rail. It never
-    expands, has no labels or fold control, and names each icon through
-    its accessible name and a tooltip. On a phone (narrower than 640, or
+    every page from 640 px wide as a fixed icon rail about 80 px wide. It never
+    expands and has no fold control. Each icon carries an 11 pt text label
+    under it (also its accessible name) and a tooltip, and the open app sits
+    on a surface pill. On a phone (narrower than 640, or
...
-    The rail is 56 px at the standard target size. When the person's
-    resolved ease.targets is large, its width follows the kit
-    target-minimum token, still icons only, still never expanding, and
-    S3's test runs at that width too.
+    The rail is about 80 px at the standard target size. When the person's
+    resolved ease.targets is large, its width follows the kit
+    target-minimum token, still labelled, still never expanding, and
+    S3's test runs at that width too.
```
Same commit: the preamble phrase "a permanent 56 px icon rail" becomes "a permanent narrow rail"; `docs/app-library.md` ("The phone keeps the
same 56px rail"); any 56 in the rail tests under `frontend/src/shell`. The mockup that draws this rail must be named by file (the note cites
`desktop-home-labelled-rail.png`, which is not in the mockup folder).

### 3.2 S1 phone: floating bar with the main apps

```diff
-    live in one slide-over drawer, the kit's sidebar in its off-canvas
-    mode, drawn from the same app list as the rail. A round menu button
+    live in one slide-over drawer, the kit's sidebar in its off-canvas
+    mode, drawn from the same app list as the rail. A floating glass bar at
+    the bottom holds the main apps (Home, Chat, Media, Library) and More;
+    More, every other app, the profile and Settings stay in the drawer. The
+    selected app's own sections sit in a steady chip strip under its header
+    row, not in the bar. A round menu button
```
and edit the drawer sentence ("the selected app's own sections") to match. Same commit: replace P2 in `design/phone-minimal-2026-10-25.md`;
add the bar to S3's phone list.

### 3.3 S2: hero art behind the header row

```diff
-    header row, ... The row is reserved, so
-    nothing sits under the avatar; an app that draws its own header places its
+    header row, ... The row is reserved: no content or control sits under the
+    avatar, though a hero picture may show behind the transparent row, which
+    turns to glass once the page scrolls; an app that draws its own header places its
```
Title, the app's buttons and the avatar never leave the row. Options (d) and (e) are not taken; no text drafted.

### 3.4 S6: the strip's new feed, and Activity (option i)

Strip (section 23; the architect already ruled it allowed; this removes the doubt):
```diff
-    | Background progress (engine setup, model downloads) | the progress strip, `InstallStrip.tsx` (...) | `lib/installStatus.ts` over the Stack's job list, `/api/install` | everyone, while it runs |
+    | Background progress (engine setup, model downloads, and the viewer's own picture, video and song jobs) | the progress strip, `InstallStrip.tsx` (...) | `lib/installStatus.ts` over the Stack's job list, `/api/install`; generation jobs from `lib/jobs.ts` `generationJobsForViewer`, `/api/jobs` | installs: everyone, while it runs; generation jobs: only their owner |
```
Activity (only if Jesse takes option i), a new row after "One job's progress":
```
    | A person's own jobs across apps (Owner-approved <date>) | one Activity entry in the app list (rail, drawer, All apps) opening one page of section 21 status cards in the order the list already has; the entry carries S1's status dot (idle none, running a soft pulse, needs a look amber, finished and unopened teal), no number | the same job records, the viewer's own rows only (rule 6a), `/api/jobs`, no new polling loop; the unopened state in the person setting `ui.activity_seen_at` | the person whose jobs they are; absent for a guest and a shared screen |
```
S2's "no badge on the avatar" stays unchanged.

### 3.5 Not drafted

(a) and (b) are 3.2 and 3.1. (c) is done. (d), (e) not chosen. (f) Your apps row, (g) Recents in the drawer, (h) a higher cap: not leaned to; if
(h) is taken the edit is in `docs/app-library.md` and the kit, not RULES.md.

## 4. Verification: building exactly what the mockups show

### 4.1 Reference set

Commit the proofs to `docs/design/assets/pro-look-2026-11-08/` (the repo already tracks 105 files under `docs/design/assets`, and
`scripts/gallery.sh` already lists that folder, so they appear in the gallery with no change):

```
docs/design/assets/pro-look-2026-11-08/
  README.md     mapping table (4.2) and capture commands
  build.py      generator (85 KB), icons.json (9 KB, lucide paths)
  html/         the mockup HTML files (embedded SVG art, no network)
  png/          the matching PNGs at 402x874 (phone) and 1440x900 (desktop)
```
Not committed: the eight reference screenshots (real creators and outlets, the note says so) and `v1/`.

Limits checked: `scripts/check.sh`, `standards/bin/check-core.sh`, `stray-files-check.sh`, `pii-scan.sh` set no image size limit. The practical
limit is repo weight: the PNGs are 0.5 to 1.1 MB each (folder 18 MB); existing asset folders run 0.1 to 4 MB. Compress with `pngquant` or
`oxipng` (verify the tool exists with `which`), commit only the PNGs a slice cites (about 20), at most 400 KB each and 6 MB for the set.
Rules that do apply: `prose-lint.sh` reads `git ls-files '*.md'`, so the README needs no em dash (U+2014) and no filler vocabulary;
`reading-level.ts` covers `docs/user/` only; `pii-scan.sh` runs `git grep -inwE` over every tracked file against
`~/.config/maipai/pii-words.txt` (HTML and `build.py` included, PNG bytes scanned as binary: a match prints "Binary file matches"); `gitleaks dir`
runs too (the long SVG data URIs are the only candidates). Mockups use persona names only (roster); keep it so. Run `bash scripts/check.sh --docs`
before the commit. `build.py` reads only `icons.json` beside it; keep it free of absolute paths.

### 4.2 README mapping (write at commit time)

| Mockup | Note section | Slice | Capture target |
|---|---|---|---|
| `desktop-home`, `phone-home`, `before-after` | 4, 6, 7 | HOME-01, TOKENS-01 | `/` |
| `phone-detail`, `desktop-detail` | 7, 9 | MEDIA-01 | media detail route |
| `phone-library` | 9 | LIBRARY-01 | `/library` |
| `desktop-chat` | 9 | CHAT-01 | `/chat` |
| `phone-news`, `phone-news-reader`, `phone-wiki`, `phone-videos`, `phone-video-watch` | 17 | NEWS-01, MEDIA-01 | the package app routes |
| `desktop-video-create`, `phone-video-create`, `desktop-music-create`, `phone-music-create`, `desktop-photo-edit` | 9a, 18 | STUDIOS-01 | the studio routes |
| `phone-apps`, `phone-drawer`, `phone-drawer-activity`, `activity-indicator` | 16, 23, 25 | APPS-01, NAV-01 | `/all-apps`, drawer open |
| `making-now`, `making-now-queue`, `downloads-card`, `status-cards`, `desktop-status-stack`, `phone-status-stack` | 20 to 22 | JOB-01 | kit gallery card page |
| `phone-news-job`, `desktop-news-job` | 23 | JOB-01 | start a clip, go to News |
| `themes` | 24 | TOKENS-01 | gallery, four Look and scheme pairs |

### 4.3 Parity procedure per slice (existing tooling)

1. `bash scripts/wt.sh start <slice>`; source `data-scratch/bin/https-git.env` of the main checkout before any git step.
2. Kit parts: in the commons worktree open the kit gallery page for the part, capture at 402x874 and 1440x900, light and dark, Neutral and
   Navy (the other six Looks by the token-resolution test). Open the capture next to the mockup PNG and judge. Tag, then
   `bash scripts/pin.sh commons ui-vX.Y.Z`.
3. Home screens: `bun run dev` in the worktree (`bash scripts/dev.sh url` prints the port). Never the live hub or 8787.
4. Capture with the built-in browser: `mcp__Claude_Browser__resize_window` with width 402 and height 874, then 1440 and 900 (the 375 preset
   is not the target), sign in as Sage with the secret `dev.sh start` prints, navigate, `read_page` for structure (state word, roles,
   labels), screenshot, then `resize_window` preset `desktop`. Switch Appearance (light, dark) and Look (`ui.look`: neutral, then navy).
   Read `read_console_messages`.
5. Measure, not only eyeball: `javascript_tool` reads `getComputedStyle` for the numbers the mockup uses (title size, row height 76, thumb
   64, card radius 20, tap target 44, rail width) and compares; put the numbers in the commit message. `scripts/panelOverflow.ts` and
   `scripts/mobileSmoke.ts` check overflow at phone width.
6. States: open every state the mockup draws (WAITING, MAKING NOW, DONE, COULD NOT FINISH, PAUSED; the failure card; an empty shelf; child
   mode through Nova). A missing state is made by the seed (`scripts/seed.ts`), not stubbed.
7. Documentation screenshots, when a slice changes a documented screen: `bun run screenshots` (`scripts/screenshot.ts`, 1440x900 plus phone,
   both themes, demo household) then the `maipai:verify-screenshots` skill. That is for docs, not for judging a change.
8. Optional smell test: ImageMagick `compare -metric RMSE` of a crop of the chrome (header, bar, card) against the mockup PNG at the same
   size. The mockups use gradient art, so never compare a full frame.
9. `bash scripts/land.sh`; captures and numbers go in the commit message and the backlog row's status line.

### 4.4 Coverage

Covered by gates: AA contrast and token resolution (TOKENS-01 adds), `lint:ui-rules` (colors, kit overrides, hand-built chat; LINT-01 adds
type, radius, space, icons), the S3 rail test at 360, 402, 874 x 402, 744, 1440, `verifyTokensCascade.ts`, `animationSettle.ts`. Not covered:
that a screen looks like its mockup. Close that gap by having each slice's test assert the measured values it names (heights, radii, label
present), so a regression fails in `bun test` and not only in review.

## 5. Open items for the caller

- Find where the six-pin cap lives (commons) before the APPS-01 text is final.
- Check whether `generation.*` toggle keys need a commons spec tag (`settings-ahead-of-spec.json`).
- Decide the Activity page (option i): it adds `ui.activity_seen_at` and an S6 row.
- ISOLATION-03 must land `position` and eta first for JOB-01's queue display.
- Name the mockup that shows the labelled rail.
