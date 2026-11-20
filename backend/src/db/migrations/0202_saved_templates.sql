CREATE TABLE `saved_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_person_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`category` text NOT NULL,
	`audience` text NOT NULL,
	`prompt` text NOT NULL,
	`settings` text,
	`aspect` text,
	`shared_with` text,
	`lock` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`provenance` text NOT NULL,
	FOREIGN KEY (`owner_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `saved_templates_owner_idx` ON `saved_templates` (`owner_person_id`);--> statement-breakpoint
CREATE INDEX `saved_templates_shared_idx` ON `saved_templates` (`shared_with`);