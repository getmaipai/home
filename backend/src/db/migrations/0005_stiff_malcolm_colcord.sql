CREATE TABLE `model_download_jobs` (
	`model_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`phase` text NOT NULL,
	`completed_bytes` integer DEFAULT 0 NOT NULL,
	`total_bytes` integer DEFAULT 0 NOT NULL,
	`error` text,
	`post_load_check` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
