CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`surface` text NOT NULL,
	`companion_id` text,
	`title` text,
	`status` text DEFAULT 'open' NOT NULL,
	`summary` text,
	`summary_through_turn` text,
	`source` text DEFAULT 'hub' NOT NULL,
	`hlc` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `conversations_person_surface_status_idx` ON `conversations` (`person_id`,`surface`,`status`);--> statement-breakpoint
CREATE TABLE `memory_embeddings` (
	`memory_id` text PRIMARY KEY NOT NULL,
	`space` text NOT NULL,
	`dims` integer NOT NULL,
	`vector` blob NOT NULL,
	`hlc` text NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memory_records`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pending_embeddings` (
	`memory_id` text PRIMARY KEY NOT NULL,
	`queued_at` text NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memory_records`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `conversation_turns` ADD `conversation_id` text REFERENCES conversations(id);--> statement-breakpoint
-- Backfill (restored from session-a-intelligence's original 0010/0013 migrations,
-- which this merge's `bun run db:generate` re-run replaced with plain ALTERs that
-- lose both the pre-existing-row backfill and the NOT NULL/no-DEFAULT SQLite
-- restriction they were written around): one conversation per existing
-- (person_id, surface) pair among rows that predate this column, so nothing in a
-- household's history is silently orphaned. randomblob(6) hex matches
-- conversation.schema.json's id pattern (`^conv-[a-z0-9]{6,}$`, hex digits are a
-- subset of a-z0-9); the hlc is a real, valid one (wall_ms from the current time,
-- node "backfill", matching setting-value.schema.json's
-- `^[0-9]+:[0-9]+:[a-z0-9]{6,}$` pattern) even though these rows predate hlc.ts
-- existing for this table, so a later sync compares against something real
-- rather than a sentinel. The counter is ROW_NUMBER() - 1, not a flat 0 (a code
-- review, 2026-09-05, found every backfilled row sharing the identical
-- wall_ms:0:backfill hlc when a household has more than one (person, surface)
-- pair predating this column, defeating hlc's whole point: distinguishing which
-- of two rows is newer).
INSERT INTO conversations (id, person_id, surface, status, source, hlc, created_at, updated_at)
SELECT
  'conv-' || lower(hex(randomblob(6))),
  person_id,
  surface,
  'open',
  'hub',
  (CAST(strftime('%s', 'now') AS INTEGER) * 1000) || ':' || (ROW_NUMBER() OVER (ORDER BY person_id, surface) - 1) || ':backfill',
  min(created_at),
  max(created_at)
FROM conversation_turns
WHERE conversation_id IS NULL
GROUP BY person_id, surface;--> statement-breakpoint
UPDATE conversation_turns
SET conversation_id = (
  SELECT c.id FROM conversations c
  WHERE c.person_id = conversation_turns.person_id AND c.surface = conversation_turns.surface
)
WHERE conversation_id IS NULL;--> statement-breakpoint
ALTER TABLE `conversation_turns` ADD `judge_status` text;--> statement-breakpoint
ALTER TABLE `conversation_turns` ADD `judge_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `conversation_turns` ADD `hlc` text NOT NULL DEFAULT '';--> statement-breakpoint
CREATE INDEX `conversation_turns_conversation_id_idx` ON `conversation_turns` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `conversation_turns_judge_status_idx` ON `conversation_turns` (`source`,`judge_status`);--> statement-breakpoint
ALTER TABLE `memory_records` ADD `hlc` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `memory_records` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `people` ADD `hlc` text NOT NULL DEFAULT '';--> statement-breakpoint
-- Backfill (restored from session-a-intelligence's original 0013 migration): SQLite
-- refuses to ADD a NOT NULL column with no DEFAULT to a table that already has
-- rows, so the three ALTERs above use a temporary '' placeholder; these three
-- UPDATEs replace it with a real, unique hlc for every pre-existing row (wall_ms
-- from right now, node "backfill") before anything else can write to these
-- tables. `rowid` (every one of these tables is a normal rowid table, none
-- declared WITHOUT ROWID) is already a unique, monotonically-assigned integer
-- per row - the same "real, unique counter per row, not a flat 0" fix the
-- conversations backfill above already needed, without needing that backfill's
-- own ROW_NUMBER()-over-a-window-in-an-INSERT shape here (a plain UPDATE can just
-- read the column SQLite already guarantees is unique). Safe only because
-- drizzle's own migrator runs every statement in one file inside a single
-- transaction: the '' placeholder is never visible to a concurrent connection,
-- and never committed on its own.
UPDATE conversation_turns SET hlc = (CAST(strftime('%s', 'now') AS INTEGER) * 1000) || ':' || rowid || ':backfill' WHERE hlc = '';--> statement-breakpoint
UPDATE memory_records SET hlc = (CAST(strftime('%s', 'now') AS INTEGER) * 1000) || ':' || rowid || ':backfill' WHERE hlc = '';--> statement-breakpoint
UPDATE people SET hlc = (CAST(strftime('%s', 'now') AS INTEGER) * 1000) || ':' || rowid || ':backfill' WHERE hlc = '';
