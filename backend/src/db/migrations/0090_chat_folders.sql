CREATE TABLE `chat_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`source` text DEFAULT 'hub' NOT NULL,
	`provenance` text NOT NULL,
	`hlc` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `chat_folders_person_idx` ON `chat_folders` (`person_id`);--> statement-breakpoint
ALTER TABLE `conversations` ADD `folder_id` text REFERENCES chat_folders(id);