ALTER TABLE `attachments` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `attachments` ADD `trash_until` text;--> statement-breakpoint
CREATE INDEX `attachments_trash_until_idx` ON `attachments` (`trash_until`);