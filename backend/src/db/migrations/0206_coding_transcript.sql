CREATE TABLE `coding_events` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`person_id` text NOT NULL,
	`at` text NOT NULL,
	`kind` text NOT NULL,
	`detail` text NOT NULL,
	`provenance` text NOT NULL,
	`hlc` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `coding_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `coding_events_session_idx` ON `coding_events` (`session_id`,`at`);--> statement-breakpoint
CREATE TABLE `coding_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`person_id` text NOT NULL,
	`seq` integer NOT NULL,
	`role` text NOT NULL,
	`parts` text NOT NULL,
	`created_at` text NOT NULL,
	`hlc` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `coding_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `coding_messages_session_idx` ON `coding_messages` (`session_id`,`seq`);