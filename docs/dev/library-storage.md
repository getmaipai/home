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
