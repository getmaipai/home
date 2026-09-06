CREATE TABLE `package_status` (
	`package_id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'enabled' NOT NULL,
	`last_smoke_at` text,
	`smoke_ok` integer,
	`smoke_message` text
);
