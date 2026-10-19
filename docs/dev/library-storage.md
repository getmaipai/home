# Library storage: one stored file per hash

Built 2026-10-18 as LIBRARY-DEDUP-01 (design: [library-2026-10-18.md](../design/library-2026-10-18.md) section 3.16).

## Model

- `file_contents`: one row per sha256 with the single `storage_path` of the stored bytes and their size.
- `attachments` (the spec `file` record): still one record per owner. Two people who upload the same bytes each get their own
  record; both point at the same `storage_path` and nothing is written twice. This replaces the old share pointer
  (`dedupe:same-bytes`) to the first uploader's record. Ahead of spec: a deduplicated record's `storage_path` names the first
  copy's folder, not the owner's.
- `file_references`: one row per holder of a record: `owner` (the person), `chat` (the conversation, while the record is tied to a
  turn), `share` (each share pointer) and `collection` (a media item that keeps a saved copy). `lib/fileContent.ts`
  `syncFileReferences(fileId)` recomputes them from the records that hold the file; call it after any change to the record, its
  shares or the media item. `referenceDrift()` reports rows that no record explains and records that lack a row.
- `file_blob_removals`: duplicate copies the migration folded into one path, removed by `lib/fileBlobs.ts`
  `reclaimQueuedBlobs()` in the background at startup and in the daily storage job (hashing is streamed, never on the boot
  path). The one stored file must exist and hash to the content row's sha256 before a duplicate is deleted; if it is missing
  or damaged, the duplicate with the right bytes is moved into its place instead. The daily job also repairs any reference row
  a write path missed (`syncAllFileReferences`).

## Byte lifetime

`purgeFileRecord(row)` drops the record, its shares and its references, then asks `releaseContent`. Bytes are returned for
unlinking only when no reference and no other record names the hash. So deleting one person's copy, a chat, or a share never
removes bytes that another owner, chat, collection or share still holds, in either order.

## Retention and "inherited" usage

Library retention frees a record's bytes only when it is the last record holding them, in the preview and in the run.
"Inherited" household usage counts only bytes that no active person also holds.

## Usage and caps

`personUsageBytes` and `householdUsageBytes` count each sha256 once (the Library line "Identical files count once").
`checkStorageCap(role, person, bytes, sha256)` adds nothing to a person's total for bytes they already hold, and nothing to the
household total for bytes the home already stores, so a second copy is never refused for space it does not use.

## Migration 0117

Backfill order: give an adult dedupe-pointer holder a record of their own (retention `kept`) and drop the pointer (a child's or
teen's pointer is left as it was, because owning a record would lift the audience gate on an adult-only file), create the content
rows at each hash's oldest record, point every record at that path and queue the other paths, then write owner, chat, share and
collection references. Dry run on a copy of the live database before release:

    sqlite3 <live>/hub.db ".backup <scratch>/hub.db"
    MAIPAI_DATA_DIR=<scratch> bun backend/src/db/migrate.ts

then compare `select count(*), sum(size) from attachments`, `from file_contents`, `file_references` by kind, `file_blob_removals`,
and `pragma integrity_check`.

## Known limits of this change

- Purging a file record (for example a departing person's fetched copy) removes the record and its references; a media item that
  still names that record keeps a dangling id exactly as before this change. References protect bytes between records, not records.
- Child and teen dedupe pointers from before migration 0117 stay pointers, so the first owner deleting the file still removes
  them; new uploads by a child or teen are separate records.
- A large streamed download (a saved podcast episode) is refused on its raw size at the start when the person or home is at its
  cap, even if the bytes turn out to be already stored. The hash is unknown before the fetch and the storage rule is to refuse a
  download that would not fit before it starts; duplicate-aware checks apply wherever the bytes are in hand (chat and Library
  uploads, small fetched assets).
## Trash (LIBRARY-REVAMP-10)

`lib/libraryTrash.ts`. `attachments.deleted_at` and `trash_until` (ahead of the spec): both set means in the owner's Trash; only
`deleted_at` set means a chat-only copy (the Library item was purged but a chat still shows the file). Neither state is listed,
shared, served or thumbnailed through the Library: `fileAccessSql` requires `deleted_at IS NULL` for everyone. Chat reads use
their own conversation check and are unchanged. Delete takes the item's companions along (edit versions, poster, cover).
Purge and expiry drop the owner reference; the record and its jobs go unless a chat still shows the file, and bytes go only at
zero references. A chat deleted while its file is in Trash does not take the file with it.

## Generated items outlive chats (LIBRARY-REVAMP-02)

`deleteAttachmentsForTurns` keeps (detaches from the turn) a file that is pinned, in Trash or generated (`isGeneratedFile` in
`lib/libraryProvenance.ts`: origin made, or a picture-gen, video-gen, video-poster, image-edit or music-gen note). Only a plain
chat attachment goes with its chat. The picture and music job records that name such a file survive too, so the Library keeps
its prompt and title. `generatedLibraryReport()` (`lib/libraryGenerated.ts`) is the read-only dry run: items and bytes
generated, pinned, following the storage rules, and still tied to a chat.

## Known limits

- A chat that shows a file keeps reading it through the conversation route after the Library item is in Trash or purged; that
  is the orphan-safe chat copy, not a leak. Restore brings the item back with the same shares; a share of an adult-only file
  to a minor stays unreadable because the audience gate runs on every read.
- A companion (an edit version, a poster, a cover) cannot be deleted alone; delete its picture, video or song.

- Storage rules never remove a file a live chat still shows (removing its Library reference would free nothing); it becomes a
  candidate when its chat is gone and the generated-file rule has detached it. If a rule removal ever meets a chat-held record it
  keeps the chat-only copy, like a Trash purge does.

## Only me filter (LIBRARY-REVAMP-01, 2026-10-19)

`GET /api/library` and `GET /api/library/summary` accept `shared=with-me|by-me|none`. Only me (`none`) requires the
caller to own the file and the file to have no rows in `shares`. Both household and person shares exclude it; removing the
last share includes it again. Shares have no deleted or revoked marker. The shared SQL base applies this filter before
paging, item counts and per-kind byte aggregation, with the existing access and audience predicate still in force.
Ownership retains its existing audience exemption for children and teens. Bytes still count each hash once, and items
still fold companions and versions. An unknown or empty `shared` value returns 400 with the allowed values.

## Streamed uploads (built 2026-10-19)

Home's listeners (`lib/homeListeners.ts`, `startHomeListeners`) do not set `maxRequestBodySize`, so Bun's default 128 MB
request limit remains for every route. Bun exposes this option on `Bun.serve`, not on a route or request. Reading
`request.body` does not exempt it. See [Bun's server options](https://bun.com/reference/bun/Serve/BaseServeOptions/maxRequestBodySize).
The 500 MB Library cap is therefore reached through chunk sessions, with no server-wide increase:

1. `POST /api/library/uploads` with JSON `{ "name": "notes.txt" }` returns `upload_id`, `chunk_bytes` (8 MB) and `max_bytes` (500 MB).
2. `PUT /api/library/uploads/{upload_id}?offset=0` streams raw bytes (`application/octet-stream`). Wait for the returned offset
   before sending the next chunk. Each chunk is at most 8 MB; offsets prevent reordered or repeated chunks from corrupting a file.
3. `POST /api/library/uploads/{upload_id}/finish` validates the type and returns the Library file. `DELETE /api/library/uploads/{upload_id}` cancels it.

`POST /api/library/upload` still accepts a single multipart `file` under Bun's default request limit. Its bounded multipart
reader streams the file; it bypasses automatic form validation because that would buffer the body. Larger files use the session
API. A child or guest gets “Ask a grown-up” before any file bytes are read. No new frontend upload control is part of this backend change.

`libraryUploadStream.ts` counts bytes and hashes sha256 as it writes a private staging file under the data directory. It checks
the running file cap and current person and household allowance before each write. A matching prefix of an already stored file
may continue when storage is full, so exact duplicates still cost nothing; finish checks the complete hash and allowance again.
Failed, aborted, over-cap and cancelled streams delete their staging directory without a Library record. Sessions belong to one
person, allow at most three simultaneous uploads per person, expire after one hour and do not survive a restart. Old crash
leftovers are removed when the next upload starts.

Finish detects types from disk and validates all text as UTF-8 without NUL bytes. Pictures use the shared chat cleaning pipeline
from disk, including its existing picture byte and pixel limits, HEIC conversion, orientation, 2000 px edge and EXIF removal.
The original file never needs to fit in a JavaScript buffer. `storeFile` promotes the staging file into the same single-instance
content store and synchronizes references. Duplicate integrity checks also hash in bounded blocks. Uploads stay `kept`.

## Recheck a picture's audience (built 2026-10-19)

`POST /api/files/{id}/recheck-audience` is available only to the adult, owner or admin who owns an adult-only picture. The role-only
`speakerAgeBand` applies; birthdate grants no access. Teens, children and other owners receive 404. The stored bytes go through
`pictures/ageCheck.ts` again. Its minor-viewer decision must allow the result, and the check must be confident. Sexual results,
missing results, doubt, timeout and errors leave the picture adult-only. Prompt words do not decide a recheck.

A pass updates only `audience` in the existing provenance JSON to `all-ages`; it preserves other metadata, shares and retention.
Existing audience and access rules then apply to every reader. The person and provenance are checked again after the asynchronous
check to avoid overwriting a concurrent change. The shared limiter allows a burst of 20 checks and refills at 20 per hour per
person. The existing hub log records person id, file id, before, after and result, without the picture or its prompt.

## New generated items follow storage rules (built 2026-10-19)

New picture, video, video-poster, picture-edit and song outputs use retention `conversation`, the existing unpinned storage-rule
value. Generation provenance makes them Library items that survive their chat; the name of that retention value does not make
them expire with the chat. Existing records are unchanged. There is no migration or backfill. Keep sets `kept` as before.
The nightly pass still skips kept items and live chat references, warns before removal, waits 24 hours and removes the oldest
eligible generated items first only above the configured type and generated thresholds. The adult-only prompt/style label
scope is unchanged.

Required companions (an edit's versions, a video's poster, a song's cover) have no storage lifetime of their own. A companion
whose parent is live is never a removal candidate; the parent's type, rule, warning and Keep decide for the whole family, and a
kept member keeps all of it. This holds for a cover generated long after its song. The multipart reader treats `CRLF--boundary`
as a delimiter only when it is followed by CRLF (a second part, refused) or `--` (the end); anything else, such as
`--boundary--NOT_A_DELIMITER`, is file data.
