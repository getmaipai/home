CREATE TABLE `video_adapter_prefs` (
	`adapter_id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text
);
--> statement-breakpoint
CREATE TABLE `video_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`conversation_id` text,
	`turn_id` text,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`stack_job` text,
	`percent` integer DEFAULT 0 NOT NULL,
	`phase` text,
	`position` integer,
	`prompt` text NOT NULL,
	`request` text NOT NULL,
	`error` text,
	`files` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `video_jobs_person_id_idx` ON `video_jobs` (`person_id`);--> statement-breakpoint
CREATE INDEX `video_jobs_turn_id_idx` ON `video_jobs` (`turn_id`);