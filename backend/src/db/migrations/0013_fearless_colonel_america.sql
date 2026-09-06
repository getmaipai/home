ALTER TABLE `conversation_turns` ADD `hlc` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `memory_records` ADD `hlc` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `memory_records` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `people` ADD `hlc` text NOT NULL DEFAULT '';--> statement-breakpoint
-- Backfill (step 10, session-a-intelligence.md): SQLite refuses to ADD a
-- NOT NULL column with no DEFAULT to a table that already has rows, so
-- the three ALTERs above use a temporary '' placeholder; these three
-- UPDATEs replace it with a real, unique hlc for every pre-existing row
-- (wall_ms from right now, node "backfill") before anything else can
-- write to these tables. `rowid` (every one of these tables is a normal
-- rowid table, none declared WITHOUT ROWID) is already a unique,
-- monotonically-assigned integer per row - the same "real, unique
-- counter per row, not a flat 0" fix a code review already found
-- necessary for migration 0010's own conversations backfill, without
-- needing that migration's own ROW_NUMBER()-over-a-window-in-an-INSERT
-- shape here (a plain UPDATE can just read the column SQLite already
-- guarantees is unique). Safe only because drizzle's own migrator runs
-- every statement in one file inside a single transaction (a review,
-- 2026-09-05, flagged this as worth stating explicitly): the '' placeholder
-- is never visible to a concurrent connection, and never committed on its
-- own. A future migration copying this exact shape under a runner that
-- does NOT wrap a whole file in one transaction would need a different
-- approach - the placeholder would then be a real, briefly-persisted,
-- pattern-invalid hlc value.
UPDATE conversation_turns SET hlc = (CAST(strftime('%s', 'now') AS INTEGER) * 1000) || ':' || rowid || ':backfill' WHERE hlc = '';--> statement-breakpoint
UPDATE memory_records SET hlc = (CAST(strftime('%s', 'now') AS INTEGER) * 1000) || ':' || rowid || ':backfill' WHERE hlc = '';--> statement-breakpoint
UPDATE people SET hlc = (CAST(strftime('%s', 'now') AS INTEGER) * 1000) || ':' || rowid || ':backfill' WHERE hlc = '';
