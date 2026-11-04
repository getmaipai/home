CREATE TABLE `music_dj_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL REFERENCES `people`(`id`) ON DELETE CASCADE,
	`media_id` text NOT NULL,
	`position` text NOT NULL,
	`audio_path` text NOT NULL,
	`words_count` integer NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`hlc` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `music_dj_lines_person_idx` ON `music_dj_lines` (`person_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `music_dj_lines_media_idx` ON `music_dj_lines` (`person_id`,`media_id`,`position`);
