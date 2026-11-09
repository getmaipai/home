CREATE TABLE `production_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`production_id` text NOT NULL,
	`owner_person_id` text NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`json` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`approved` integer DEFAULT false NOT NULL,
	`provenance` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	FOREIGN KEY (`owner_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `production_documents_slot` ON `production_documents` (`production_id`,`kind`,`key`);--> statement-breakpoint
CREATE INDEX `production_documents_owner_idx` ON `production_documents` (`owner_person_id`);--> statement-breakpoint
ALTER TABLE `film_runs` ADD `parent_id` text;--> statement-breakpoint
ALTER TABLE `film_runs` ADD `scene_key` text;--> statement-breakpoint
CREATE INDEX `film_runs_parent_idx` ON `film_runs` (`parent_id`);