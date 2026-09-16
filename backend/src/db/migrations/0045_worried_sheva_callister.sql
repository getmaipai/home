CREATE TABLE `reply_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`turn_id` text NOT NULL,
	`person_id` text NOT NULL,
	`verdict` text NOT NULL,
	`reason` text,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	`hlc` text NOT NULL,
	FOREIGN KEY (`turn_id`) REFERENCES `conversation_turns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reply_feedback_turn_person_unique` ON `reply_feedback` (`turn_id`,`person_id`);