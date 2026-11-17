CREATE TABLE `content_ratings` (
	`subject_kind` text NOT NULL,
	`subject_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`rater` text NOT NULL,
	`rater_version` integer NOT NULL,
	`level` text NOT NULL,
	`source` text NOT NULL,
	`reasons` text,
	`label` text,
	`rated_at` text NOT NULL,
	PRIMARY KEY(`subject_kind`, `subject_id`)
);
--> statement-breakpoint
CREATE INDEX `content_ratings_kind_level_idx` ON `content_ratings` (`subject_kind`,`level`);