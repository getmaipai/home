CREATE TABLE `settings_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`scope` text NOT NULL,
	`actor_role` text NOT NULL,
	`value` text NOT NULL,
	`previous` text,
	`direction` text NOT NULL,
	`changed_at` text NOT NULL,
	`hlc` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `settings_changes_changed_at_idx` ON `settings_changes` (`changed_at`);