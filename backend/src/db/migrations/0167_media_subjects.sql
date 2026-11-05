CREATE TABLE `media_subjects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_person_id` text NOT NULL REFERENCES `people`(`id`),
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`shared_with` text NOT NULL DEFAULT '[]',
	`look` text NOT NULL,
	`reference_ids` text NOT NULL DEFAULT '[]',
	`real` integer NOT NULL DEFAULT 0,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`provenance` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `media_subjects_owner_idx` ON `media_subjects` (`owner_person_id`);
