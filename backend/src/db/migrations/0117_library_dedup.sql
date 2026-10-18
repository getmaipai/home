CREATE TABLE `file_blob_removals` (
	`storage_path` text PRIMARY KEY NOT NULL,
	`queued_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `file_contents` (
	`sha256` text PRIMARY KEY NOT NULL,
	`storage_path` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_contents_storage_path_unique` ON `file_contents` (`storage_path`);--> statement-breakpoint
CREATE TABLE `file_references` (
	`id` text PRIMARY KEY NOT NULL,
	`sha256` text NOT NULL,
	`file_id` text NOT NULL,
	`kind` text NOT NULL,
	`holder_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`sha256`) REFERENCES `file_contents`(`sha256`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_references_holder_idx` ON `file_references` (`file_id`,`kind`,`holder_id`);--> statement-breakpoint
CREATE INDEX `file_references_sha256_idx` ON `file_references` (`sha256`);--> statement-breakpoint
-- LIBRARY-DEDUP-01 backfill. 1) A person whose identical upload was once a share pointer to the first uploader's row gets
-- their own file record for the same bytes (the pointer is dropped below), so deleting the first copy never takes theirs.
INSERT INTO `attachments` (`id`, `owner_person_id`, `conversation_id`, `turn_id`, `media_type`, `size`, `sha256`, `storage_path`, `retention`, `provenance`, `origin`, `media_source_id`, `created_at`, `hlc`)
SELECT 'file-' || lower(hex(randomblob(6))), s.`to`, NULL, NULL, a.`media_type`, a.`size`, a.`sha256`, a.`storage_path`, 'kept', a.`provenance`, 'sent', NULL, s.`created_at`, s.`hlc`
FROM `shares` s
JOIN `attachments` a ON a.`id` = s.`file_id`
JOIN `people` p ON p.`id` = s.`to` AND p.`deleted_at` IS NULL
WHERE s.`provenance` = 'dedupe:same-bytes' AND s.`to` <> a.`owner_person_id`
  AND NOT EXISTS (SELECT 1 FROM `attachments` b WHERE b.`owner_person_id` = s.`to` AND b.`sha256` = a.`sha256` AND b.`origin` = 'sent');
--> statement-breakpoint
DELETE FROM `shares` WHERE `provenance` = 'dedupe:same-bytes'
  AND EXISTS (SELECT 1 FROM `attachments` b JOIN `attachments` a ON a.`id` = `shares`.`file_id` WHERE b.`owner_person_id` = `shares`.`to` AND b.`sha256` = a.`sha256` AND b.`origin` = 'sent');
--> statement-breakpoint
-- 2) One content row per sha256, at the oldest record's path.
INSERT INTO `file_contents` (`sha256`, `storage_path`, `size`, `created_at`)
SELECT `sha256`, `storage_path`, `size`, `created_at` FROM (
  SELECT `sha256`, `storage_path`, `size`, `created_at`, ROW_NUMBER() OVER (PARTITION BY `sha256` ORDER BY `created_at`, `id`) AS rn FROM `attachments`
) WHERE rn = 1;
--> statement-breakpoint
-- 3) Other copies of the same bytes are queued for removal from disk and every record points at the one path.
INSERT OR IGNORE INTO `file_blob_removals` (`storage_path`, `queued_at`)
SELECT DISTINCT a.`storage_path`, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM `attachments` a JOIN `file_contents` c ON c.`sha256` = a.`sha256` WHERE a.`storage_path` <> c.`storage_path`;
--> statement-breakpoint
UPDATE `attachments` SET `storage_path` = (SELECT c.`storage_path` FROM `file_contents` c WHERE c.`sha256` = `attachments`.`sha256`)
WHERE `storage_path` <> (SELECT c.`storage_path` FROM `file_contents` c WHERE c.`sha256` = `attachments`.`sha256`);
--> statement-breakpoint
-- 4) References: every record has an owner reference; a record still tied to a turn has a chat reference; every share
-- pointer and every media item that holds a copy is a reference.
INSERT INTO `file_references` (`id`, `sha256`, `file_id`, `kind`, `holder_id`, `created_at`)
SELECT 'fref-' || lower(hex(randomblob(8))), `sha256`, `id`, 'owner', `owner_person_id`, `created_at` FROM `attachments`;
--> statement-breakpoint
INSERT INTO `file_references` (`id`, `sha256`, `file_id`, `kind`, `holder_id`, `created_at`)
SELECT 'fref-' || lower(hex(randomblob(8))), `sha256`, `id`, 'chat', `conversation_id`, `created_at` FROM `attachments` WHERE `turn_id` IS NOT NULL AND `conversation_id` IS NOT NULL;
--> statement-breakpoint
INSERT INTO `file_references` (`id`, `sha256`, `file_id`, `kind`, `holder_id`, `created_at`)
SELECT 'fref-' || lower(hex(randomblob(8))), a.`sha256`, a.`id`, 'share', s.`id`, s.`created_at` FROM `shares` s JOIN `attachments` a ON a.`id` = s.`file_id`;
--> statement-breakpoint
INSERT OR IGNORE INTO `file_references` (`id`, `sha256`, `file_id`, `kind`, `holder_id`, `created_at`)
SELECT 'fref-' || lower(hex(randomblob(8))), a.`sha256`, a.`id`, 'collection', m.`id`, a.`created_at` FROM `media_items` m JOIN `attachments` a ON a.`id` = m.`loc_file_id`;
