CREATE TABLE `film_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`production_id` text,
	`idea` text NOT NULL,
	`plan_json` text,
	`state` text NOT NULL,
	`stage` text,
	`done_steps` integer DEFAULT 0 NOT NULL,
	`total_steps` integer DEFAULT 0 NOT NULL,
	`film_file_id` text,
	`note` text,
	`error_line` text,
	`go_ahead` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `film_runs_person_idx` ON `film_runs` (`person_id`);--> statement-breakpoint
CREATE INDEX `film_runs_state_idx` ON `film_runs` (`state`);