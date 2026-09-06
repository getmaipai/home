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
