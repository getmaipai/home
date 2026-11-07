ALTER TABLE `media_productions` ADD `show` text DEFAULT 'null' NOT NULL;--> statement-breakpoint
ALTER TABLE `media_sources` ADD `production_id` text;