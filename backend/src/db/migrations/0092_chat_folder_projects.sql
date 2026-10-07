CREATE TABLE `chat_folder_shares` (
	`folder_id` text NOT NULL,
	`person_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`folder_id`, `person_id`),
	FOREIGN KEY (`folder_id`) REFERENCES `chat_folders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `chat_folder_shares_person_idx` ON `chat_folder_shares` (`person_id`);--> statement-breakpoint
ALTER TABLE `chat_folders` ADD `color` text DEFAULT 'neutral' NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_folders` ADD `icon` text DEFAULT 'folder' NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_folders` ADD `description` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_folders` ADD `instructions` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_folders` ADD `pinned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `chat_folders` ADD `pinned_at` text;--> statement-breakpoint
ALTER TABLE `chat_folders` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `chat_folders` ADD `memory_mode` text DEFAULT 'shared' NOT NULL;