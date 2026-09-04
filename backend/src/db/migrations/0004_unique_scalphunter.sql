CREATE TABLE `conversation_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`surface` text NOT NULL,
	`user_text` text NOT NULL,
	`reply_text` text NOT NULL,
	`source` text NOT NULL,
	`skill_id` text,
	`safety_flagged` integer DEFAULT false NOT NULL,
	`safety_action` text NOT NULL,
	`minor_speaker` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
