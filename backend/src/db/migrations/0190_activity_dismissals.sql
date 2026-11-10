CREATE TABLE `activity_dismissals` (
	`person_id` text NOT NULL,
	`row_key` text NOT NULL,
	`dismissed_at` text NOT NULL,
	PRIMARY KEY(`person_id`, `row_key`),
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
