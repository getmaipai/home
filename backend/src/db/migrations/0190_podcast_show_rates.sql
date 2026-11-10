CREATE TABLE `podcast_show_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`source_id` text NOT NULL,
	`rate` real NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`provenance` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `podcast_show_rates_person_source_idx` ON `podcast_show_rates` (`person_id`,`source_id`);