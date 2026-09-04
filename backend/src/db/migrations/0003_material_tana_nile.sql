CREATE TABLE `scheduled_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`package_id` text NOT NULL,
	`job` text NOT NULL,
	`person_id` text,
	`inputs` text NOT NULL,
	`when` text NOT NULL,
	`recurring` integer DEFAULT false NOT NULL,
	`next_run_at` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`last_run_at` text,
	`last_error` text,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
