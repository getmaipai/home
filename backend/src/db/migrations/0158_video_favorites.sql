CREATE TABLE `video_favorites` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`file_id` text NOT NULL,
	`created_at` text NOT NULL,
	`hlc` text NOT NULL,
	`provenance` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `video_favorites_person_file_idx` ON `video_favorites` (`person_id`,`file_id`);
