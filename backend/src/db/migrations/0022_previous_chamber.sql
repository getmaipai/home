CREATE TABLE `backup_health` (
	`id` text PRIMARY KEY NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`last_failure_at` text,
	`last_failure_message` text,
	`last_success_at` text
);
--> statement-breakpoint
CREATE TABLE `backup_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `received_backups` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`filename` text NOT NULL,
	`bytes` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
