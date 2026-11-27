# Dropping Home's old LoRA tables (STACK-LORAS-01 slice 6)

Home no longer keeps LoRAs. The Stack holds the library; Home reads it. Three old tables are left in a hub's database until the hub starts on this code:
`loras`, `video_adapter_prefs` and `picture_adapter_prefs`. `lora_people` (the named adults of a style) and `adult_mark_log` stay in Home.

## What runs, and when

Migration `0213_drop_legacy_loras` is a marker: it changes nothing, because an SQL migration cannot ask the Stack anything. The drop is
`backend/src/lib/loras/legacyDrop.ts`, started in the background at every hub start (`legacyDropRun.ts`, called from `index.ts`). It does this, in order:

1. None of the three tables exists: it does nothing. (This is every start after the first, and every fresh install once the empty tables are dropped.)
2. `loras` has rows: it reads the Stack's library, live and trash. If the Stack cannot be read, or any `loras` id is not listed, it refuses and keeps all three tables.
   It logs `[loras] old Home LoRA tables kept (<reason>)`. An unreachable Stack is tried again after 30 seconds and 2 minutes; a missing id is not.
3. It writes every row of the three tables to `<data dir>/legacy-archive/loras-legacy-<time>.json` (mode 600, read back and checked by sha256).
4. In one transaction it copies the rows into `legacy_table_archive`, copies each style's `availability.people` into `lora_people` (an existing row there is kept),
   and drops the three tables. Any failure rolls the transaction back and keeps the tables.

Empty tables are dropped without asking the Stack and without a file. It deletes no file on disk. The log line on success is
`[loras] old Home LoRA tables archived and dropped: {...}`.

## Check after the next ship

Hub log has the "archived and dropped" line, or "kept" with a reason. Then, on the live hub's database (read only):

```
sqlite3 -readonly <data dir>/hub.db "select source_table, count(*) from legacy_table_archive group by 1"
sqlite3 -readonly <data dir>/hub.db "select count(*) from lora_people"
```

The live data from the slice 5 import held 3 styles (one picture, two video), so expect `loras|3` and the picture and video preferences that existed.

## Rollback

Before any rollback, stop the hub. Home code from before this slice (the commit before the one that landed this note) reads the `loras` table; the Stack keeps its records either way.

1. Restore the tables from the archive table inside the same database. Run this with the hub stopped, on the live hub's `hub.db`:

```sql
CREATE TABLE loras (id text PRIMARY KEY NOT NULL, record text NOT NULL, media text NOT NULL, kind text NOT NULL, base_model text NOT NULL, audience text NOT NULL, availability_who text NOT NULL, sha256 text NOT NULL, removed_at text, trash_until text, added_at text NOT NULL, created_at text NOT NULL, updated_at text NOT NULL, hlc text NOT NULL, provenance text NOT NULL);
CREATE INDEX loras_media_removed_idx ON loras (media, removed_at);
CREATE INDEX loras_audience_idx ON loras (audience, availability_who);
CREATE INDEX loras_sha256_idx ON loras (sha256);
CREATE INDEX loras_trash_idx ON loras (trash_until);
INSERT INTO loras SELECT json_extract(row_json,'$.id'), json_extract(row_json,'$.record'), json_extract(row_json,'$.media'), json_extract(row_json,'$.kind'), json_extract(row_json,'$.base_model'), json_extract(row_json,'$.audience'), json_extract(row_json,'$.availability_who'), json_extract(row_json,'$.sha256'), json_extract(row_json,'$.removed_at'), json_extract(row_json,'$.trash_until'), json_extract(row_json,'$.added_at'), json_extract(row_json,'$.created_at'), json_extract(row_json,'$.updated_at'), json_extract(row_json,'$.hlc'), json_extract(row_json,'$.provenance') FROM legacy_table_archive WHERE source_table = 'loras';
CREATE TABLE video_adapter_prefs (adapter_id text PRIMARY KEY NOT NULL, enabled integer NOT NULL DEFAULT 1, updated_at text NOT NULL, updated_by text);
INSERT INTO video_adapter_prefs SELECT json_extract(row_json,'$.adapter_id'), json_extract(row_json,'$.enabled'), json_extract(row_json,'$.updated_at'), json_extract(row_json,'$.updated_by') FROM legacy_table_archive WHERE source_table = 'video_adapter_prefs';
CREATE TABLE picture_adapter_prefs (adapter_id text PRIMARY KEY NOT NULL, enabled integer NOT NULL DEFAULT 1, updated_at text NOT NULL, updated_by text);
INSERT INTO picture_adapter_prefs SELECT json_extract(row_json,'$.adapter_id'), json_extract(row_json,'$.enabled'), json_extract(row_json,'$.updated_at'), json_extract(row_json,'$.updated_by') FROM legacy_table_archive WHERE source_table = 'picture_adapter_prefs';
```

2. Re-ship the Home release from before this slice (`bash scripts/ship.sh <sha>`; the schema version is unchanged, so the older build opens the database).
3. If the database itself is lost or the archive table is missing, use the JSON file in `<data dir>/legacy-archive/` (its `tables` object holds each table's rows by column name),
   or the slice 5 dump `loras-table-dump.json` (rows of `loras` and `adult_mark_log`) and insert its `loras` rows by column name.
4. Do not roll back the hub and keep the new code: the new code never reads the tables, and it will drop them again at the next start (it refuses only when the Stack lacks an id).
   To keep them for a test, leave the hub stopped.

The Stack's own library is untouched by all of this. Its records, files and the unified `loras/manifest.json` are the Stack's backup concern.

## Last manual step: legacy files in the Stack's data folder (not part of this slice, nothing deletes them yet)

Do this only after the hub has restarted on this code, the log shows the drop, and one picture and one video style still resolve. Folder: the live Stack's data directory.
The Stack merged these two manifests into `loras/manifest.json` and leaves them in place; the `.safetensors` files stay (the unified library still uses them).

| Path under the Stack data dir | sha256 at the slice 5 dry run (2026-11-26) |
|---|---|
| `images/loras/manifest.json` | `db1b2d1f881f2d0670c9d4564696555a9d5928de747067a83116b6095ee66917` |
| `video/loras/manifest.json` | `1aed43c1c96bab153995e1d989dcedb7f15e185f41973d3dc1b7e08bac2ccfec` |

Keep for good (do not delete): `loras/manifest.json` (unified, `012d8641f6a964fbfed2b45db556dc9931d30953aa412910d934ec2846dc7cd0` before the live import), and the three files
`images/loras/lora-09b1b45ceed02029.safetensors` (`09b1b45c...577f`), `video/loras/lora-d4791eae00c79cf0.safetensors` (`d4791eae...7a92`),
`video/loras/lora-ff873a5beada3c57.safetensors` (`ff873a5b...5e95`). The full backup is `/tmp/loras-slice5/live-backup-20261126-151800/` (temporary; copy it somewhere
lasting first).

Steps: `shasum -a 256` both manifests; if a hash differs from the table, stop and compare (the Stack may have rewritten it); copy them to the archive folder; delete; restart the Stack;
`GET /stack/v1/loras` must still list the same ids. To undo, copy the two files back.
