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
  `reclaimQueuedBlobs()` at startup and in the daily storage job. The one stored file is confirmed on disk first; if it is
  missing, a queued copy is moved into its place instead of deleted.

## Byte lifetime

`purgeFileRecord(row)` drops the record, its shares and its references, then asks `releaseContent`. Bytes are returned for
unlinking only when no reference and no other record names the hash. So deleting one person's copy, a chat, or a share never
removes bytes that another owner, chat, collection or share still holds, in either order.

## Usage and caps

`personUsageBytes` and `householdUsageBytes` count each sha256 once (the Library line "Identical files count once").
`checkStorageCap(role, person, bytes, sha256)` adds nothing to a person's total for bytes they already hold, and nothing to the
household total for bytes the home already stores, so a second copy is never refused for space it does not use.

## Migration 0117

Backfill order: give a dedupe-pointer holder a record of their own (retention `kept`) and drop the pointer, create the content
rows at each hash's oldest record, point every record at that path and queue the other paths, then write owner, chat, share and
collection references. Dry run on a copy of the live database before release:

    sqlite3 <live>/hub.db ".backup <scratch>/hub.db"
    MAIPAI_DATA_DIR=<scratch> bun backend/src/db/migrate.ts

then compare `select count(*), sum(size) from attachments`, `from file_contents`, `file_references` by kind, `file_blob_removals`,
and `pragma integrity_check`.
