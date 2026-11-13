CREATE TABLE `creation_cast` (
	`creation_id` text NOT NULL,
	`subject_id` text NOT NULL,
	`synth_id` text,
	PRIMARY KEY(`creation_id`, `subject_id`),
	FOREIGN KEY (`creation_id`) REFERENCES `creations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `creation_cast_synth_id_idx` ON `creation_cast` (`synth_id`);--> statement-breakpoint
CREATE TABLE `creations` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`kind` text NOT NULL,
	`parent_id` text,
	`review` text DEFAULT 'pending' NOT NULL,
	`made_audience` text DEFAULT 'all-ages' NOT NULL,
	`lock` text DEFAULT 'off' NOT NULL,
	`file_ids` text DEFAULT '[]' NOT NULL,
	`job_ids` text DEFAULT '[]' NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`provenance` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `creations_person_id_idx` ON `creations` (`person_id`);--> statement-breakpoint
CREATE INDEX `creations_parent_id_idx` ON `creations` (`parent_id`);