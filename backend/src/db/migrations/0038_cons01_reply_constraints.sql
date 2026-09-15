CREATE TABLE `reply_constraints` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`person` text,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`set_at` text NOT NULL,
	`set_by_turn` text,
	`hlc` text NOT NULL,
	FOREIGN KEY (`person`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reply_constraints_conversation_idx` ON `reply_constraints` (`conversation_id`);