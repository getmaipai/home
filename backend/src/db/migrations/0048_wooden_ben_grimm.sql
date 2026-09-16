CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_person_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`media_type` text NOT NULL,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`storage_path` text NOT NULL,
	`retention` text DEFAULT 'conversation' NOT NULL,
	`provenance` text NOT NULL,
	`created_at` text NOT NULL,
	`hlc` text NOT NULL,
	FOREIGN KEY (`owner_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`turn_id`) REFERENCES `conversation_turns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `attachments_owner_person_id_idx` ON `attachments` (`owner_person_id`);--> statement-breakpoint
CREATE INDEX `attachments_conversation_id_idx` ON `attachments` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `attachments_turn_id_idx` ON `attachments` (`turn_id`);