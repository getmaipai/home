CREATE TABLE `git_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`kind` text NOT NULL,
	`host` text NOT NULL,
	`account` text NOT NULL,
	`status` text NOT NULL,
	`expires_at` text,
	`token_encrypted` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text,
	`last_checked_at` text,
	`provenance` text NOT NULL,
	`hlc` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `git_connections_person_idx` ON `git_connections` (`person_id`);
