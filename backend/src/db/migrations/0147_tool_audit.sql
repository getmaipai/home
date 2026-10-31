CREATE TABLE `tool_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`tool` text NOT NULL,
	`action` text NOT NULL,
	`decision` text NOT NULL,
	`band` text NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tool_audit_person_at_idx` ON `tool_audit` (`person_id`,`at`);
