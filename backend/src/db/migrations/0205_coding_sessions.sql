CREATE TABLE `coding_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`title` text NOT NULL,
	`repo` text NOT NULL,
	`environment_id` text NOT NULL,
	`mode` text NOT NULL,
	`state` text NOT NULL,
	`tier` text DEFAULT 'standard' NOT NULL,
	`network` text NOT NULL,
	`mounts` text,
	`model_id` text,
	`usage` text NOT NULL,
	`changes` text NOT NULL,
	`created_at` text NOT NULL,
	`last_activity_at` text NOT NULL,
	`deleted_at` text,
	`trash_until` text,
	`provenance` text NOT NULL,
	`hlc` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `coding_sessions_person_idx` ON `coding_sessions` (`person_id`);
