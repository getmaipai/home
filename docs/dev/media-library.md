# Media library (MEDIA-LIB-01, MEDIA-PROGRESS-01, MEDIA-VIDEOS-01, MEDIA-PODCASTS-01)

Design: [media-apps-blend-2026-10-17.md](../design/media-apps-blend-2026-10-17.md) sections 7, 8, 10, 11 and 12. The
app packages (Videos, Shows, Music, Podcasts, Books) build on the routes below. Storage includes the shared Trash page.

## Tables (one migration, 0107, schema version 64)

| Table | Spec record | Identity and indexes |
|---|---|---|
| `media_sources` | `MediaSource` (`msrc-`) | `kind` `root` over `nas_mounts` or a hub folder; `root_path` is the real path; soft delete by `deleted_at` and `trash_until` |
| `media_items` | `MediaItem` (`media-`) | unique `(source_id, external_id)` and unique `(loc_root_id, loc_path)` (partial); `(source_id, kind)`, `(kind, band_ok)`, `(parent_id)`, `(size, title)` for duplicates |
| `media_progress` | `MediaProgress` (`mprg-`) | unique `(person_id, media_id)`; `(person_id, updated_at)` |
| `media_collections` | `MediaCollection` (`mcol-`) | `(person_id, kind)`; unique `(person_id, kind)` for `liked`, `watch_later`, `queue` |

Spec objects (`location`, `artwork`, `chapters`, `advisory`...) are JSON text or flattened columns; `lib/media/model.ts` is the one place
a row becomes its spec record, always through the generated Zod schema. Hub-internal columns on items: `last_seen_scan`, `missing_since`,
`pages` (a PDF's page count; the spec item has no field for it), `probe_failed_fp`. A person leaving erases their progress and
collections (`erasePersonData`).

## Scan (`backend/src/lib/media/`)

`scan.ts` is the one orchestrator: an async pre-order walker, one interval per root (`syncMediaScanner`, started at boot), overlap
coalescing (a request while a root scans joins it and asks for one more pass), and the fast path (a file whose size and modified time
match its item is only marked seen). A root's `kinds` decide what a file may become: `ingest.ts` holds the rules, `parsers/` one parser
per kind (TV names, films and NFO, `music-metadata` tags including the iTunes advisory, EPUB OPF over a small zip reader, PDF, audiobooks).

- Audiobooks: an `.m4b`, or an audio file with two or more chapters or a spoken-word genre, is one `audiobook` with `chapters[]`
  (`embedded`). In a root with audiobooks and no tracks, the audio files of one folder are one audiobook whose files are `chapter`
  items with `parent_id`; in a root with both, a folder is a book when its first file's genre is spoken word. Series is the `grouping`
  tag, else the folder above the book when there are two folders above it (`Author/Series/Book`).
- A book and an audiobook of the same title in the same folder share a `subtitle` (the author); `GET /api/media/items/{id}` returns the
  other edition in `linked`.
- Prune guards: an item is trashed only after it is missing from two scans at least `pruneGraceMs` apart (30 minutes). Held back, and
  listed in the scan summary's `guards`: `prune_off`, `root_missing`, `root_empty` (the mount point is there but nothing is in it),
  `unattributable_root` (a removed root or a deleted mount), `unreadable_subtree` (items under it), `mass_missing` (20 or more items
  and over half gone at once). A removed root is never scanned and never loses items. A pruned item returns when its file does.
  An item a person removed is archived on the source (`archive`) and stays gone.
- Stream metadata: items start `playable: "unknown"`. After the walk, `probePending` asks the `Prober` (the Stack `media.probe` job
  through `getStackClient().submitJob`, `createStackProber`) for duration, size in pixels, codecs and chapters, at most 200 per scan, and
  stops after three "nothing answered". `decidePlayable` in `kinds.ts` is the original / transcode / none rule. A Stack on another
  computer yields no prober (it cannot read the path). The job's input is `{ path }` and its result is read by `probeResultFrom`
  (snake_case or camelCase); align both when the Stack service documents them.
- `band_ok` at ingest (`band.ts`): `adult` when the file is explicit, or when its words trip the KS-05 floor (`tripsMinorFloor`) or
  the household's sexual-word list (`lib/pictures/minorLine.ts`); otherwise `child`. The floor runs again at every read for a minor. A
  guest reads as a child. An adult's `PATCH band_ok` sets `verified_by_person_id` and survives rescans.

## Routes (`/api/media`)

Admin (owner, admin): `POST /sources`, `DELETE /sources/{id}`, `POST /sources/{id}/rescan`, `PATCH /items/{id}` (`hidden`, `band_ok`),
`DELETE /items/{id}`, `GET /duplicates`. Everyone signed in: `GET /sources`, `GET /items`, `GET /items/{id}`, `GET /items/{id}/content`
(Range, the item's media type), `GET /items/{id}/artwork`, `GET /groups`. Every read goes through `access.ts` (source `visible_to`,
band, not trashed, not hidden).

## Progress, collections and Pick up (MEDIA-PROGRESS-01)

`lib/media/progress.ts` holds `mergeProgress`, the one definition used by the online write, the offline batch, the robot and Go.
Newest wins by the server stamp: `correctedStamp` moves the device's `sampled_at` by `server now - client_now`, never into the future,
and a write with no clock readings is stamped on arrival. A rewind applies when newer. `completed` latches per kind (video, episode,
film 90 percent; podcast episode, audiobook, chapter 95; a book when the person says so or at 99 percent of the text; a track never,
it counts `finishes`) and only a newer explicit `completed: false` clears it. Marks union by `at_s`; absolute `counts` take the larger
(so replaying a batch counts nothing twice) and `event` adds one. A write older than the row still merges its counts, marks and a
finish, and reports `applied: false`.

- Routes never take a person id: a person writes only their own rows. A minor's row (child or teen) is also refused when the write
  names a `device_id` paired to someone else (`deviceMayWrite`): a TV signed in as a parent does not save the child's place.
- Coalescing: plain position ticks (no event, mark, count or `completed`) from one person for one title within 2 seconds of the last
  database write are held and replaced by the next tick; one database write follows when the window ends or on any read. A pause, a
  seek, an unload, a finish, or `immediate: true` stores at once. The held answer is the row as it will be.
- Collections (`collections.ts`): liked, watch later and up next are created once per person the first time they are asked for (a
  unique index enforces it); playlist, watchlist and pins are made on request. `resolveCollection` is own-only; `shared_to` lets
  others read (never change) a collection, with titles they may not read left out.
- Pick up: `lib/continue/registry.ts` is the provider registry (`registerContinueProvider`), `providers.ts` registers `chat` (the
  person's own last chats) and `media` (unfinished titles, not tracks, a folder audiobook's part shown as the book). The budget is three
  rows across both, newest first; a guest gets none. `GET /api/continue` returns them; HOME-ALIVE-01c draws the shelf from it. A media
  row's `href` is `/media/<item id>`; the shell resolves that to the app.

Routes: `PUT /api/media/progress/{media_id}`, `GET /api/media/progress/{media_id}`, `GET /api/media/progress?ids=`,
`POST /api/media/progress/batch`, `GET|POST /api/media/collections`, `GET /api/media/collections/shared`,
`GET|PATCH|DELETE /api/media/collections/{id}` (`id` may be `liked`, `watch_later` or `queue`),
`POST|PUT /api/media/collections/{id}/items`, `DELETE /api/media/collections/{id}/items/{media_id}`, `GET /api/continue`.

## Household trash (TRASH-01)

`lib/trash/registry.ts` is the one provider registry: `registerTrashProvider({ kind, label, list(person), restore(person, id),
purge(person, id), purgeExpired(now) })`. The media item and collection providers are registered in `providers.ts`. Items use
source ownership: admins manage household sources, people manage their own person-scoped sources. Source visibility and the
media band floor still apply. Collections are own-only, including for admins; minors' collection titles pass the child floor.
Guests get no rows. Unknown kinds, missing records and forbidden records all return 404 on changes.

`GET /api/trash` returns `{ rows }` with kind, id, title, deleted_at, trash_until and the two action flags. `POST
/api/trash/{kind}/{id}/restore` clears the envelope and source archive path within the keep window. `DELETE
/api/trash/{kind}/{id}` removes the row and its progress, preserving the archive. A folder audiobook's parts follow its action
when they were trashed together. Scanned root files are never deleted. A fetched saved copy is unlinked on purge only when no other item or Trash row references it.
Purging an expired scanner-pruned row also archives its path.
Purging also discards held progress ticks so a later timer cannot recreate progress for a removed item. A scan refreshes the
archive after parsing yields, and skips archived chapter paths as well as parent paths. The sweeper runs at boot and every six hours, independently per provider; a failed kind retries next time.

Storage links to `/storage/trash`, a data-declared kit SettingsShell with a kit item list and AlertDialog confirmation.
The page fetches only the current person's authorized rows and refreshes after a change. Tests: `tests/trash.test.ts` and
`frontend/src/shell/pages/TrashPage.test.tsx`.

Open: migrate Lists and Memories onto the envelope and register their providers. Media sources themselves are not providers
in this slice. Subscription polling is not shipped yet; its future writer must honor the same source archive.

## Media apps: the shared host (MEDIA-VIDEOS-01)

Every media app (Videos, Shows, Music, Podcasts, Books) is a catalog `app` package (manifest `kind: "app"`, pages in `pages/*.json`,
`contributes.data[]` of `rows: "list"`) whose pages bind to data ids served by one host. Videos is the first; the others add a package
and their own rows, never a store.

**Backend.** `backend/src/lib/media/appHost.ts` holds the rules and `backend/src/routes/mediaApps.ts` the wire. `MEDIA_APPS` is the one table
of app id to item kinds (`videos`: video; `shows`: episode and film; `music`: track; `podcasts`: podcast episode; `books`: book and
audiobook). `createMediaAppRoutes(appId)` returns the routes for one app; `app.ts` mounts one per id under `/api/plugins/<appId>` before
the generic `pluginsRoutes`, so an app that is not installed (or a data id the host does not know) falls through to the generic 404.
Gate: `mediaAppAllowed` is the existing `appVisibleTo` check on the package's manifest (role, smoke, capabilities, platform).

Routes (all POST, signed in): `data/:dataId`, `progress`, `watch-later`, `like`.

- `data/:dataId` body `{ id?, channel?, limit? }`; answer is a bare array of rows (the kit's `media_shelf` and `billboard` read an array),
  `[]` for nothing, an object for `item`, and `{ as_of, rows }` for `channels` (the kit picker reads `rows`).
- A row is `{ id, title, channel, summary, kind, thumbnail, backdrop, duration_s, progress? (0 to 1), completed?, copy_label }`.
  `copy_label` is "Saved" (the copy is on the hub) or "Not saved" (stream only). `thumbnail` and `backdrop` are the item's artwork route or
  null. `kind` lets the shell's `play` action find the owning app without another call.
- Data ids (Videos): `featured` (billboard: newest items with art), `continue` (unfinished, newest first), `new` (newest from followed
  sources: channel, feed or link, not library folders), `recent` (recently added), `more_from` (unfinished and unwatched from the channel
  the person watches most), `liked`, `again` (finished), `library` (by channel, then title; `channel` filters), `channels` (picker rows),
  `watch_later` (in saved order), `history` (newest progress first), `up_next` (the watch-later queue after this item, then the rest of its
  channel, then the newest), `item` (`{ ...row, src, subtitle, description, poster, chapters[{start_s,title}], captions, position_s?
  (absent once finished), liked, watch_later, up_next? }`; `[]` when the title is not readable), `item_actions` (the Like and Watch later
  rows for the item).
- `progress` body `{ media_id, position_s, duration_s, reason, device_id? }`. Numbers come from `call.args` placeholders as strings
  ("12.5"); `coerceNumber` turns them into numbers, then `writeProgress` (the one `mergeProgress` path). `reason` `ended` is a finish event;
  any reason but `interval` stores at once. Answers `{ ok, applied, completed }`.
- `watch-later` and `like` body `{ media_id, on? }`: `on: true` adds, `on: false` removes, absent toggles. Answers `{ ok, on, label }`.

**Bands and the child.** Every read goes through the person's band and each source's `visible_to` (`queryItems`, `readableIn`: `bandAllows`
runs again on the words for a minor). A child (and a guest, read as a child) is allowlist-only until MEDIA-KID-01 adds `media.allowlist_only`:
only library roots and sources an adult named for them (`visible_to` lists them), and `featured`, `new`, `recent` and `more_from` answer
`[]`. The item view of a child carries no `up_next`, so the Player never counts down to the next video on a child's screen.

**Shell** (`frontend/src/shell/`). `mediaApps.ts` maps an item kind to its app and play page (`playRoute`). `mediaHost.tsx`:
`MediaHostProvider` supplies the kit `MediaHostContext` next to the `AudioSessionProvider`; `onPlay(mediaId, row)` opens
`/apps/<app>/<page>?id=<id>` with the id as router state, and `/media/<id>` (the Pick up link) resolves to the same route.
`PackageAppPage` reads the query of a media app's page into the page state (the kit reads state from router state only), so a reload or a
shared link works; the first tab of a media app is named Home.

**Playback beyond the page (MEDIA-POLISH-01).** The provider also implements the kit's `MediaHost.mediaFor`: on a media app's route the
`player` node plays in an element the host creates (`createMediaStore`, one item at a time; a new item unloads the old one). The kit
Player adopts it while mounted and parks it in the kit's hidden `player-parking` node when it unmounts, never out of the document, so it
keeps playing. `PackageAppPage` draws the kit Player's `mini` layout with `placement="dock"` and that element once the person has started
it, on any page of a media app except the one playing it; Close unloads it. Other apps draw nothing (RULES S2, S6). `MediaPlayerRegistration`
registers the host's element with the audio session (`useAudioRegistration`, kind `video`) for as long as the host holds it: one playing
thing, the person's video speed, the sleep timer and the Media Session title. The dock reports progress to `/api/plugins/<app>/progress`.

**Look (MEDIA-POLISH-01).** Every Videos page sets `tone: "cinema"` (the kit token set, dark in both themes); shelves are `variant:
"plain"` with `hide_when_empty` and `see_all`; Watch is a `split_view` (`main`: the player with `details` and the Like and Watch later
`actions` toggles on the item's `liked` and `watch_later`; `aside`: Up next as a vertical shelf). A media app's header is the app's
name with icon buttons and chip tabs (`TabsList variant="pill"`); its play page has none. App pages sit outside `PageHeaderLayout`.

**Not built, and why.**

- Captions: the item's `subtitles` are file ids with no serving route yet, so `captions` is empty.
## Kid mode

MEDIA-KID-01 adds the backend policy and the minimum player hook. `media.allowlist_only` is a person key: on for Child controls,
off for Teen and Adult controls. A child or teen cannot set or reset it. An owner or admin may override one person's setting.
`access.ts` applies it to every source read: only household roots or sources whose `visible_to` explicitly includes the person
pass. Existing scope, visibility, `band_ok`, explicit advisory and text-floor checks still apply after any override. Search uses
that same library gate. `discoveryAllowed(person)` is the app-route gate for discovery shelves and chips; such rows must be empty
when it returns false. No discovery route or media player is shipped by this slice.

The daily budget reuses `allowance.media.daily_minutes`, read by `dailyMinutesAllowed(personId, "Media")`. There is no
`media.daily_minutes` key. Child and Teen controls cannot set or reset the allowance. Zero means no limit. An admin can set the
limit and add whole minutes for today with `POST /api/media/budget/:personId/extend {minutes}` (1 to 1440 per call). The response
only confirms the change; it reveals no usage. `GET /api/media/budget` returns the asking person's
`{limit_min, used_min, left_min, exhausted}`; `left_min: 0` with `exhausted: false` means unlimited. There is no admin usage route.

`watchTime.ts` meters accepted progress writes before coalescing, across all kinds and screens. Migration 0108 (schema version 65)
adds private `media_watch_days` totals (seconds, audio seconds, today's extension and notification latch) and
`media_watch_sessions` sample cursors. Both are erased when the person leaves. Session cursors survive a restart; duplicate or
older samples never count twice. Metering ignores the `playing`, `seeking` and event flags and the client stamp: between two writes of one cursor it counts the least of
server wall-clock elapsed, forward position advance and a 120-second ceiling per write (a client may tick as rarely as once a minute, so the ceiling is not the 10-second cadence). A jump bigger than elapsed plus slack is a seek and only the wall-clock part counts, kept to the tight 12-second cap (10-second cadence plus 2 seconds of slack), the same cap a reader tick (no seconds position) always gets; no forward movement counts nothing. The cursor key is server-derived: the hashed auth session
cookie plus the media item, never a request field, so rotating anything in the body cannot start a fresh baseline. Cursor rows older
than two days are dropped and each person keeps at most 200. The first write of a cursor is a baseline. Reader locator ticks use the bounded wall-clock time. The saved place still uses the skew-corrected sample stamp.

Days follow the household host's local calendar midnight, as other daily hub limits do. A crossing interval is split at midnight;
calendar dates handle daylight saving changes. Extensions and the notification latch expire with that day. Usage is derived
from accumulated seconds, never from the current position. `media.budget.exempt_bedtime_audio` is household/admin-only and off
by default. When on, today's music tracks, audiobooks and audiobook chapters are left out; podcasts, video and reader ticks still
count. Turning it off restores their counted seconds for today.

An exhausted progress write still saves the person's place immediately and returns `budget` alongside `progress` and `applied`.
Batch results include it for each accepted write too. The player must pause on `exhausted`. A child's exhaustion claims a durable
once-per-day latch and raises the passive `media_time_up` notification for household admins, who are the child's guardians. The
text names the child ("{name}'s daily screen time ran out...") so an admin with two children knows whose minutes to extend, and
carries `subjectPersonId`; it holds no media, source or activity detail. Teens with a budget get the same notice (same latch,
same text with the teen's name). Decision: a teen's budget is set by a guardian, so the guardian is told when it runs out; the
notice reveals that time ran out, never what was watched. Kid copy placeholders are in `MEDIA_KID_COPY`, awaiting the shared
kid-mode catalog.

Exhaustion is enforced on bytes too, not only reported in progress responses. For a child, teen or guest whose budget is
exhausted, `GET /api/media/items/{id}/content` returns 403 `{error: "Screen time is done for today. Ask a grown-up for more.",
code: "media_time_up"}` (`mediaTimeUpRefusal(person)` in `watchTime.ts`). Adults are never refused. The offline manifest and every offline file kind call it too (403 `media_time_up`, never `device_revoked`, so the browser keeps its copies).

Offline keeping (decision, 2026-10-17): offline copies play without the hub, so no server clock meters them. A minor whose
`allowance.media.daily_minutes` is above 0 cannot keep media offline: `minorMayKeepOffline(person)` in `watchTime.ts` returns
false for them (true for adults, and for a minor with no budget). The offline manifest and file routes call it and refuse with 403 `budget_keep_refused` and the kid line; `/status` and `/progress` still work for copies kept earlier. The offline progress batch meters under `d:<deviceId>` (paired device) or `s:<session hash>` (browser), never the shared `-` cursor. The simpler, safer rule was chosen over metering offline
time from corrected event stamps.

The Media allowance's guardian-only `control` is written once, on the key definition in `allowanceKeys.ts`; the registry takes it
from there because the shared spec snapshot still declares the key without it (drop the lookup when a commons spec tag carries
it). `discoveryAllowed(person)` has no caller in this slice by design: the discovery shelves that call it are the app slices'.

`frontend/src/lib/useMediaBudget.ts` reads the signed-in person's budget and returns `{exhausted, leftMinutes}`. Pass the person id
so changing profiles cannot reuse another person's allowance. Unknown or failed reads return exhausted. Players feed every
progress response's `budget` to `updateMediaBudget(queryClient, personId, budget)`; after an extension, invalidate that person's
`mediaBudgetQueryKey`. This uses React Query and progress responses, with no new status surface or polling loop.

Open: `media.allowed_hours` needs a shipped time selector (see `allowanceKeys.ts`); every app must wire pause, ticks, resume and
extension refresh; the ask-a-grown-up action must use the one Ask record. No second ask store or UI is added here. Also open: an
"Add minutes" action on the time-up notice. The notification registry has no `actions[]` support yet (NOTIFICATIONS.md declares
it), so the notice says an admin can add minutes and the extend route is `POST /api/media/budget/{personId}/extend`; the button
belongs with the Ask record work.

## Podcasts (MEDIA-PODCASTS-01)

Podcasts are `feed` records with `purpose: "podcast"` read by the ONE shelf poller (`lib/shelf/shelfPoller.ts`: conditional GET, one request
per host, backoff, the SSRF guard). Migration 0112 (schema version 69) adds `feeds.purpose` (default `news`), `attachments.origin` (default
`sent`) and `attachments.media_source_id`. `listFeeds(purpose?)`: the news shelf (`shelfRead`, `syncShelfFeeds`) asks for `news`, so a
podcast feed is never read as news and never deleted by the settings sync. `pollDueFeeds` polls both purposes; a podcast feed is polled while
it has a live, unpaused source (the news-shelf switch and tick-boxes do not apply), at the source's `poll_minutes`. The size cap is 8 MB for a
podcast feed (2 MB for news).

**One outbound path.** `guardedGet` (exported from the poller) is the shared GET: every hop through the guard, redirects by hand, per-host
pacing, honest user agent, no cookies or referrer. Feeds use bucket `feed` (one a minute per host), enclosure downloads `enclosure` (5, one
more every 10 s), the show's picture `art`. Tests inject an in-memory `deps.fetch` and a stub DNS;
the guard is unchanged. A route-triggered poll or Save uses `__setPodcastFetchDepsForTests` in tests.

**Ingest** (`lib/media/podcasts.ts`, `ingestPodcastFeed`): the poller hands the body over; feedsmith parses RSS, Atom or JSON feeds; each episode
with an enclosure becomes a `media-item` (kind `podcast_episode`, `subtitle` the show, location `{url}` stream-only, `external {extractor:
"rss", id: guid, published_at}`, `duration_s` from `itunes:duration`, season and episode, `advisory.explicit` from `itunes:explicit` (the show's
flag applies when an episode says nothing), `band_ok` through `bandOkAtIngest`, chapters from inline Podlove chapters or from `0:00 Title`
lines of the show notes (source `description`, three or more climbing lines from the start)). Identity is (source, guid); a re-poll updates,
never duplicates, and keeps a saved copy. The show's picture is fetched once (2 MB, image types) into the file store and every item points
at it. The source's label becomes the show title. A guid in `media_sources.archive`, or a trashed row, is skipped ("deleted stays gone":
`removeItem` and the trash purge archive the guid when there is no path).

**Files.** `lib/media/fetchedFiles.ts` writes `origin: fetched` copies (retention `kept`, `provenance.media_source_id`) into the same blob store
as chat uploads (same caps and reconcile job). Fetched files never get household shares. Files access ignores even old share pointers
for fetched files: only their owner or an admin may read them there. Other listeners use `serveItemBytes` or `serveItemArtwork`, which
reload `readableItem` before opening the saved file, enforcing the source audience and band. Fetched playback verifies sha256 with a
disk stream before serving, including Range requests. Removing a show does not expose its copies. `provenance` text is
`podcast:manual`, `podcast:auto` or `podcast:art`; dedupe requires fetched origin, the same owner, source and media type, so it cannot
adopt a private chat upload. A manual save outranks an auto one. `media_items` keeps `loc_url` beside `loc_file_id`: Save sets the file id, Unsave clears it and the item streams again.

**Save** (`saveEpisode`): adults only (`mayManageSaves`); the enclosure through `guardedGet` (https only, five redirects, 400 MB, 15 minutes),
content type from the response, `fingerprint` the sha256. An old http enclosure uses its https form for streaming and saving. The owner's
cap is checked against the feed's declared size before GET and Content-Length before reading the body. Unknown or incorrect lengths are
bounded during the stream too. Downloads go to a private temporary file while hashing, then rename into the store; failures cancel the
reader and remove the temporary file. No full enclosure buffer is built. **Keep rules** (`applyAutoRules`, after each poll, including a 304, and when a rule changes): `auto.save: "audio"`
with `keep_latest` N saves the newest N and releases auto copies that fell outside N; `remove_watched` releases an auto copy when everyone who
has progress finished it. A copy a person saved by hand is never released by the rules. Polling only queues work on a serial background lane, so a slow enclosure
does not hold the ten-feed tick. A per-source in-flight guard coalesces overlapping runs. Jobs recheck the live source and item after
downloading, so an unsubscribe during a download cannot attach a new saved copy.

**Unsave and Trash.** Only the file owner or an adult admin may remove a saved copy. Unsave returns the episode to streaming and places
a snapshot in the existing household Trash registry as `podcast_copy`, using a trashed `media_items` envelope (30 days, no migration).
It keeps the bytes and their storage charge until purge; restore reattaches them when the original episode is readable and has no copy.
The ordinary media-item provider excludes these snapshots, so it cannot bypass copy ownership or archive the live episode. A purge
unlinks only when no item, including another Trash row, uses the file. Automatic pruning uses the same Trash path. Unsubscribe removes
the show's fetched art and clears its artwork references; legacy shared art is removed after the last show releases it. Saved
episode files remain private.

**Host extension.** `appHost.ts` exports its helpers and gains `registerMediaAppData(appId, hook)` and `registerItemView(appId, hook)`;
`laterKindOf(appId)` names the standing list (Watch later, or the queue for Podcasts); `rowOf` draws a podcast row's second line as
"Today · The show"; an item view's `src` is the enclosure URL for a stream-only item (the person's own device plays it; the hub relays
nothing). `lib/media/podcastApp.ts` registers `shows`, `episodes` (newest first, `channel` filters by show), `saved`, `bookmarks` and the
item fields `saved`, `queued`, `speed`, `skip_intro_s`, `skip_outro_s` (a first listen starts at `skip_intro_s`; `saveProgress` treats
`position >= duration - skip_outro_s` as finished and sends `completed`). `routes/podcastApp.ts` adds under `/api/plugins/podcasts`:
`queue` (toggle), `save` (`on: false` removes the copy), `bookmark` (`media-progress.marks`), and for an adult admin `subscribe`,
`unsubscribe`, `source` (speed, skip seconds, `auto`, `paused`, `visible_to`), `opml/import` (`{ opml }`) and `GET opml/export`.
OPML uses feedsmith's reader and writer; the export holds feed addresses only. Import does not poll each new show: the new feeds are
already due for the normal tick (at most ten per tick). News settings sync skips addresses already owned by Podcasts and reports a
closed typed event without an address or record identifier; a sync failure is isolated so due podcast polling continues.

**Package** `backend/packages/podcasts` (pages index, shows, episodes, queue, saved, play; the first tab reads "Listen now", `homeLabelOf` in
`shell/mediaApps.ts`). The privacy row is `platform:podcast-feeds` (hosts of followed shows). It also discloses automatic keep-rule downloads and the home IP
seen by episode, picture, CDN and redirect hosts.

Focused verification without servers or real network: `cd backend && bun test --config=./bunfig.podcasts.toml tests/podcasts.test.ts`.
This lane uses a disposable data directory under the worktree, fake Stack responses, fake feed responses, and rejects server starts
and uninjected fetch calls. The normal test lane uses its usual preload.

**Not built, and why.** Adding a show and importing OPML have no form on a package page (no text input node), so they are API only, as media
sources are. Per-show speed is stored and listed but the audio session applies the person's own podcast speed (a session override needs the
shell to stop writing the show's speed back as the person's). Transcripts, persons and `podcast:chapters` JSON files have no field on
`media-item` and would need another request per episode. The list tiles are the kit's 160 px vertical rows (the mockup's compact rows with
a Play and a Save button each need a kit size and a row actions slot). Directory search is later by the design.



## Keep a record on this device (KEEP-OFFLINE-01)

`backend/src/lib/offline/registry.ts` registers `{ kind, manifest(person, id), file(person, entryId, request) }`.
A provider checks the person's access on every call, including artwork and captions, and serves only bytes already on Home.
`providers.ts` registers media first. Its manifest and byte logic moved out of `routes/mediaOffline.ts` into `offline/media.ts`;
the media routes are compatibility adapters and retain their paths and scope for Go. Status and progress keep their existing routes.

`GET /api/offline/manifest?kind=media&id=` and `GET /api/offline/file/:kind/:entry` use `requireDeviceScope("offline.records")`.
Unknown kinds and unreadable records answer 404. Generic media manifests have the same fields as the media manifest, with asset
URLs under the generic route so a token with only `offline.records` can follow them. The entry for media bytes is the item id;
artwork and subtitles use an encoded `artwork:<id>` or `subtitle:<id>` entry (captions retain `?track=`). Range, If-Range,
fingerprint, retry and band checks use the same implementation. Both scopes carry guardian-only grants for minors and refuse
robots, TVs and pods, including a forced scope row.

The shell exports `keepOnThisDeviceAction({ kind, id })` from `frontend/src/shell/offlineActions.ts`: a label and an async `run`
handler returning the shared offline result. An app supplies it to its kit action control and shows failure copy in the form's
existing Alert. `keepOnDevice` now takes `{ kind, id }` and reads the generic manifest. No cache is added: all kinds use the
existing `maipai-media-v1:<personId>` bucket, owner handshake, quota and sign-out wipe. Media's old index keys still work; other
kinds use a kind-qualified key, so equal record ids do not collide. The worker serves both file paths inside the same Chromium
gate. WebKit and Firefox still have no fetch interception. Reconciliation uses generic manifests for new copies and the media
status route for old media copies. Devices is declared through SettingsShell; copies in this browser are sorted and labelled by
kind, with Remove all covering every kind. Other devices' private copy inventories are not collected by the hub.

Open: `backend/src/lib/news/` contains quality and ranking helpers, but no existing function reads a saved story's cached body
and picture. No `news_story` provider or offline News reader is added. Reference pages and conversation exports need their own
providers and app use sites too. Media remains the sole built-in provider. Backend route test execution needs the normal test preload's
TCP fixture support; the restricted sandbox cannot reserve its port. The registry unit test also runs through the frontend harness without that fixture. No live service requests are used for these tests.

## Music (MEDIA-MUSIC-01)

The `music` package is a `plugin` package that contributes Music pages beside its chat artist lookup (handler, opt-in network
permission and Deno smoke test are kept; like News, it stays off where Deno is missing). App data reads only authorized
root-library `track` items. Albums group by `album_artist` (falling back to artist) and album; artists group by artist. No new
tables. Album order is disc, track, title and id, with unnumbered tracks last. A minor never sees an explicit track.

Pages use the shipped kit variants (ui-v0.5.263): Albums and Artists are `layout: grid` (artists `art_shape: circle`), Listen
now's radio shelf is round art, track lists (Songs, Liked, Album, Artist, Playlist, Up next) are vertical `density: compact` rows
with `item_meta_field` running time, `item_highlight_field: playing` (the track the person's queue points at) and, on album and
playlist pages, `item_index_field: track_number` (a playlist numbers by its own order). Album, Artist and Playlist pages open with
a `billboard` bound to the one `header` data id (`scope` = album, artist or playlist). The package declares 16 data ids, the cap.

`POST /api/plugins/music/queue` accepts `{ id, mode, shuffle?, seed_kind? }`. Modes are track, album, artist, playlist and radio.
A button that carries only an id may say more in it: `shuffle:<id>` shuffles, `radio:<artist|album|genre|track>:<seed>` starts
radio. Radio candidates come only from readable library tracks and rank by same artist, album artist, genre, then decade.
Queue changes use the person's standing collection; finishing a song advances its pointer. The shell requests audio autoplay and
registers Music with the audio session's music kind.

`POST /api/plugins/music/playlist` takes `{ op: "new" }`, `{ op: "add", media_id }` (onto the newest playlist) or
`{ op: "remove", media_id, playlist_id }` (the person's own playlist only). A package page may not use the schema `form` node, so
rename and reorder stay on `/api/media/collections`. A minor never sees a track whose artist, album, album artist or genre trips
the minor floor (`bandAllows` reads them at every read), and a playlist or its header is another person's secret.

Kit gaps (recorded, not faked): no shuffle or radio icon (Shuffle uses `refresh-cw`, Start radio `audio-waveform`); row actions
sit under the caption, not trailing as in the mockup, so track lists carry none (Like lives on Now playing); compact art is 72 px
(mockup 48); the audio Player has rewind and forward 15 s and speed where the mockup has shuffle, previous and a sleep moon, no
full-bleed art backdrop, no "Playing from" line; tile sizes follow the kit budget (about 4.3 across at 1280, mockup 6).
Phone rail instead of a drawer is MOBILE-RAIL-01 (shell). Explicit title masking belongs to MEDIA-KID-01; today a minor never
sees an explicit track at all.
