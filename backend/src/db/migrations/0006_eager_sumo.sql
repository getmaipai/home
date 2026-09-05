CREATE TABLE `cloned_voices` (
	`id` text PRIMARY KEY NOT NULL,
	`creator_id` text NOT NULL,
	`label` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`creator_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
