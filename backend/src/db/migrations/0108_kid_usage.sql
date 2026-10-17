CREATE TABLE `kid_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`day` text NOT NULL,
	`kind` text NOT NULL,
	`units` integer DEFAULT 1 NOT NULL,
	`prompt` text DEFAULT '' NOT NULL,
	`outcome` text DEFAULT 'asked' NOT NULL,
	`ref` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `kid_usage_person_day_idx` ON `kid_usage` (`person_id`,`day`);