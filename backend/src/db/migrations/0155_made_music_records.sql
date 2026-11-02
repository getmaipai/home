CREATE TABLE `song_styles` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text,
	`name` text NOT NULL,
	`origin` text NOT NULL,
	`body` text NOT NULL,
	`source` text DEFAULT 'hub' NOT NULL,
	`provenance` text NOT NULL,
	`hlc` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `song_styles_person_idx` ON `song_styles` (`person_id`);
--> statement-breakpoint
CREATE TABLE `made_artists` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text,
	`name` text NOT NULL,
	`origin` text NOT NULL,
	`body` text NOT NULL,
	`source` text DEFAULT 'hub' NOT NULL,
	`provenance` text NOT NULL,
	`hlc` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `made_artists_person_idx` ON `made_artists` (`person_id`);
