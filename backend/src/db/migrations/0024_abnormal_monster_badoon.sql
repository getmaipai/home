CREATE TABLE `app_update_state` (
	`id` text PRIMARY KEY NOT NULL,
	`checked_at` text NOT NULL,
	`latest_version` text,
	`latest_url` text,
	`latest_summary` text,
	`error` text,
	`notified_version` text
);
