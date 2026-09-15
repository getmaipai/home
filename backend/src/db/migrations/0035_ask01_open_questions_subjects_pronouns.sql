CREATE TABLE `open_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`person` text NOT NULL,
	`conversation_id` text,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`subject_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	`asked_at` text,
	`resolved_at` text,
	`hlc` text NOT NULL,
	FOREIGN KEY (`person`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `conversation_turns` ADD `subjects` text;--> statement-breakpoint
ALTER TABLE `entities` ADD `pronouns` text;