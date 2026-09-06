CREATE TABLE `lists` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text DEFAULT 'household' NOT NULL,
	`person` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`items` text DEFAULT '[]' NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`hlc` text NOT NULL,
	FOREIGN KEY (`person`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
