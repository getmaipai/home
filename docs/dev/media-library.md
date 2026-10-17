# Media library (MEDIA-LIB-01, MEDIA-PROGRESS-01)

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
when they were trashed together. No file on disk is deleted. Purging an expired scanner-pruned row also archives its path.
Purging also discards held progress ticks so a later timer cannot recreate progress for a removed item. A scan refreshes the
archive after parsing yields, and skips archived chapter paths as well as parent paths. The sweeper runs at boot and every six hours, independently per provider; a failed kind retries next time.

Storage links to `/storage/trash`, a data-declared kit SettingsShell with a kit item list and AlertDialog confirmation.
The page fetches only the current person's authorized rows and refreshes after a change. Tests: `tests/trash.test.ts` and
`frontend/src/shell/pages/TrashPage.test.tsx`.

Open: migrate Lists and Memories onto the envelope and register their providers. Media sources themselves are not providers
in this slice. Subscription polling is not shipped yet; its future writer must honor the same source archive.
