ALTER TABLE `coding_sessions` ADD `pinned_at` text;--> statement-breakpoint
ALTER TABLE `coding_sessions` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `coding_sessions` ADD `last_opened_at` text;--> statement-breakpoint
UPDATE `coding_sessions` SET `last_opened_at` = `last_activity_at`;
