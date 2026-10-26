CREATE TABLE `likeness_asks` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_person_id` text NOT NULL,
	`requester_person_id` text NOT NULL,
	`medium` text NOT NULL,
	`way` text NOT NULL,
	`state` text NOT NULL,
	`prompt_sha256` text NOT NULL,
	`prompt` text,
	`count` integer DEFAULT 1 NOT NULL,
	`style_name` text,
	`style_ids` text DEFAULT '[]' NOT NULL,
	`job_id` text,
	`source` text NOT NULL,
	`expires_at` text,
	`decided_at` text,
	`decided_by` text,
	`consumed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	FOREIGN KEY (`subject_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requester_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `likeness_asks_subject_state_idx` ON `likeness_asks` (`subject_person_id`,`state`);--> statement-breakpoint
CREATE INDEX `likeness_asks_requester_subject_idx` ON `likeness_asks` (`requester_person_id`,`subject_person_id`,`created_at`);