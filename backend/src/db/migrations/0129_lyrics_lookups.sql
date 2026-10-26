CREATE TABLE `lyrics_lookup_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`paused_until` integer DEFAULT 0 NOT NULL,
	`backoff_s` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `lyrics_lookups` (
	`item_id` text PRIMARY KEY NOT NULL,
	`looked_up_at` integer NOT NULL,
	`outcome` text NOT NULL
);
