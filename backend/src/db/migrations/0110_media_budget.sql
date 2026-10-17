CREATE TABLE `media_watch_days` (
	`person_id` text NOT NULL,
	`day` text NOT NULL,
	`used_s` real DEFAULT 0 NOT NULL,
	`audio_s` real DEFAULT 0 NOT NULL,
	`extended_min` integer DEFAULT 0 NOT NULL,
	`notified` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`person_id`, `day`),
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `media_watch_sessions` (
	`person_id` text NOT NULL,
	`session_key` text NOT NULL,
	`media_id` text NOT NULL,
	`device_id` text,
	`position_s` real,
	`sampled_at` text NOT NULL,
	`playing` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`person_id`, `session_key`),
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
