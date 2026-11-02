CREATE TABLE `adult_mark_log` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_id` text NOT NULL,
	`via` text NOT NULL,
	`at` text NOT NULL,
	`hlc` text NOT NULL,
	`provenance` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `adult_mark_log_item_idx` ON `adult_mark_log` (`item_id`,`at`);--> statement-breakpoint
CREATE INDEX `adult_mark_log_actor_idx` ON `adult_mark_log` (`actor_id`,`at`);
