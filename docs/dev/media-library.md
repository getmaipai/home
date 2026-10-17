# Media library (MEDIA-LIB-01, MEDIA-PROGRESS-01)

Backend only. Design: [media-apps-blend-2026-10-17.md](../design/media-apps-blend-2026-10-17.md) sections 7, 8, 10, 11 and 12. The
app packages (Videos, Shows, Music, Podcasts, Books) build on the routes below; nothing here draws a page.

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
