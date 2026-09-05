CREATE TABLE `memory_embeddings` (
	`memory_id` text PRIMARY KEY NOT NULL,
	`space` text NOT NULL,
	`dims` integer NOT NULL,
	`vector` blob NOT NULL,
	`hlc` text NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memory_records`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pending_embeddings` (
	`memory_id` text PRIMARY KEY NOT NULL,
	`queued_at` text NOT NULL,
	FOREIGN KEY (`memory_id`) REFERENCES `memory_records`(`id`) ON UPDATE no action ON DELETE no action
);
