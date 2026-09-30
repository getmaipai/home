CREATE TABLE `status_events` (
	`id` text PRIMARY KEY NOT NULL,
	`component` text NOT NULL,
	`state` text NOT NULL,
	`at` text NOT NULL,
	`source` text NOT NULL,
	`detail` text,
	`hlc` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `status_events_component_at_idx` ON `status_events` (`component`,`at`);--> statement-breakpoint
CREATE TABLE `status_heartbeat` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_seen_at` text NOT NULL
);
