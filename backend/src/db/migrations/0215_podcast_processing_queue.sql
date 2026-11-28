CREATE TABLE `podcast_segment_records` (
	`sha256` text NOT NULL,
	`pipeline_version` text NOT NULL,
	`state` text NOT NULL,
	`record_id` text,
	`job_id` text,
	`record` text,
	`reason` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`sha256`, `pipeline_version`)
);
--> statement-breakpoint
CREATE TABLE `podcast_show_keys` (
	`source_id` text PRIMARY KEY NOT NULL,
	`show_key` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `podcast_show_keys_show_key_unique` ON `podcast_show_keys` (`show_key`);