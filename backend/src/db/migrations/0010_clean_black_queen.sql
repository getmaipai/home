CREATE TABLE `issues` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`key` text NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`detail` text NOT NULL,
	`fix` text,
	`learn_more` text,
	`created_at` text NOT NULL,
	`resolved_at` text,
	`dismissed_at` text,
	`hlc` text NOT NULL
);
