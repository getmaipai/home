CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`person` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`state` text NOT NULL,
	`plan` text NOT NULL,
	`steps` text NOT NULL,
	`artifacts` text NOT NULL,
	`provenance` text NOT NULL,
	`error` text,
	`hlc` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`person`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
