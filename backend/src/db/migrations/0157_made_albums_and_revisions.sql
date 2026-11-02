CREATE TABLE `made_albums` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text,
	`name` text NOT NULL,
	`origin` text NOT NULL,
	`body` text NOT NULL,
	`source` text DEFAULT 'hub' NOT NULL,
	`provenance` text NOT NULL,
	`hlc` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `made_albums_person_idx` ON `made_albums` (`person_id`);
--> statement-breakpoint
CREATE TABLE `made_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`record_id` text NOT NULL,
	`person_id` text,
	`body` text NOT NULL,
	`reason` text NOT NULL,
	`provenance` text NOT NULL,
	`hlc` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `made_revisions_record_idx` ON `made_revisions` (`kind`,`record_id`,`created_at`);
