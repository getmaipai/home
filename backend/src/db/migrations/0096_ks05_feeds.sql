CREATE TABLE `feeds` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`title` text NOT NULL,
	`publisher` text NOT NULL,
	`band` text NOT NULL,
	`package_id` text,
	`person_id` text,
	`etag` text,
	`last_modified` text,
	`poll_interval_s` integer NOT NULL,
	`next_poll_at` text NOT NULL,
	`fail_count` integer DEFAULT 0 NOT NULL,
	`quiet_until` text,
	`enabled` integer DEFAULT true NOT NULL,
	`hlc` text NOT NULL,
	`provenance` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feeds_url_idx` ON `feeds` (`url`);--> statement-breakpoint
CREATE INDEX `feeds_package_id_idx` ON `feeds` (`package_id`);