CREATE TABLE `commands` (
	`id` text PRIMARY KEY NOT NULL,
	`creator_id` text NOT NULL,
	`trigger` text NOT NULL,
	`min_role` text NOT NULL,
	`action_kind` text NOT NULL,
	`action_data` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`creator_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `conversation_turns` ADD `command_id` text;