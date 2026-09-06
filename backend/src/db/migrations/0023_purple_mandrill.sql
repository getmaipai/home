CREATE TABLE `nas_mounts` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`path` text NOT NULL,
	`scan_paths` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
