CREATE TABLE `music_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`conversation_id` text,
	`turn_id` text,
	`task` text NOT NULL,
	`request` text NOT NULL,
	`stack_job` text,
	`state` text NOT NULL,
	`stage` text,
	`progress` real DEFAULT 0 NOT NULL,
	`eta_seconds` real,
	`position` integer,
	`error_code` text,
	`error_line` text,
	`file_id` text,
	`parent_file_id` text,
	`seed` integer,
	`duration_s` real,
	`lrc` text,
	`chosen_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `music_jobs_person_id_idx` ON `music_jobs` (`person_id`);--> statement-breakpoint
CREATE INDEX `music_jobs_turn_id_idx` ON `music_jobs` (`turn_id`);--> statement-breakpoint
CREATE INDEX `music_jobs_person_conversation_idx` ON `music_jobs` (`person_id`,`conversation_id`);--> statement-breakpoint
CREATE INDEX `music_jobs_file_id_idx` ON `music_jobs` (`file_id`);