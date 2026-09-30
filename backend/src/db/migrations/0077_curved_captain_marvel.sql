CREATE TABLE `maintenance_windows` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`components` text NOT NULL,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`cancelled_at` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`hlc` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `status_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`posted_by` text NOT NULL,
	`posted_at` text NOT NULL,
	`expires_at` text,
	`cleared_at` text,
	`cleared_by` text,
	`hlc` text NOT NULL
);
