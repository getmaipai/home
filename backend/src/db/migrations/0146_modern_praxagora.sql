CREATE TABLE `reference_saves` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`book` text NOT NULL,
	`path` text NOT NULL,
	`title` text NOT NULL,
	`saved_at` text NOT NULL,
	`offline` integer DEFAULT false NOT NULL,
	`hlc` text NOT NULL,
	`provenance` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reference_saves_person_book_path_idx` ON `reference_saves` (`person_id`,`book`,`path`);
