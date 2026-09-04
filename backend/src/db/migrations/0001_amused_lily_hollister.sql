CREATE TABLE `id_sequences` (
	`kind` text PRIMARY KEY NOT NULL,
	`next` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memory_records` (
	`id` text PRIMARY KEY NOT NULL,
	`record_kind` text NOT NULL,
	`text` text NOT NULL,
	`category` text NOT NULL,
	`tier` text NOT NULL,
	`status` text NOT NULL,
	`scope` text NOT NULL,
	`person` text,
	`source` text NOT NULL,
	`importance` real NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`sensitive` integer DEFAULT false NOT NULL,
	`uses` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text NOT NULL,
	`valid_from` text,
	`valid_to` text,
	`expired_at` text,
	`superseded_by` text,
	`embedding_space` text,
	FOREIGN KEY (`person`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
