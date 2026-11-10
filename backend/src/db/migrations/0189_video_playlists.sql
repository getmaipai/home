ALTER TABLE `media_collections` ADD `media_kind` text DEFAULT 'music' NOT NULL;--> statement-breakpoint
ALTER TABLE `media_collections` ADD `members` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `media_collections` ADD `cover_file_id` text;