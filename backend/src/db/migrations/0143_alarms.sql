CREATE TABLE `alarms` (
	`id` text PRIMARY KEY NOT NULL,
	`person` text NOT NULL REFERENCES `people`(`id`),
	`time` text NOT NULL,
	`days` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`tag` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`skip_until` text,
	`sound` text NOT NULL,
	`snooze_minutes` integer,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`hlc` text NOT NULL
);
