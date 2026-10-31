CREATE TABLE `tool_undo` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`turn_id` text,
	`tool` text NOT NULL,
	`action` text NOT NULL,
	`inverse_json` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tool_undo_person_idx` ON `tool_undo` (`person_id`);
