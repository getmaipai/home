CREATE TABLE `pending_memory_work` (
	`memory_id` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`queued_at` text NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memory_records`(`id`) ON UPDATE no action ON DELETE no action
);
