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
--> statement-breakpoint
CREATE TABLE `package_installs` (
	`package_id` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`previous_version` text,
	`channel` text DEFAULT 'stable' NOT NULL,
	`source_commit` text NOT NULL,
	`permissions` text NOT NULL,
	`installed_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `store_index_state` (
	`role` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL,
	`updated_at` text NOT NULL
);
