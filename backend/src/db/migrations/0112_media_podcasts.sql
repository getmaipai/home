ALTER TABLE `attachments` ADD `origin` text DEFAULT 'sent' NOT NULL;--> statement-breakpoint
ALTER TABLE `attachments` ADD `media_source_id` text;--> statement-breakpoint
ALTER TABLE `feeds` ADD `purpose` text DEFAULT 'news' NOT NULL;