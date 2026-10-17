CREATE TABLE `news_interests` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`followed` integer DEFAULT false NOT NULL,
	`affinity` real DEFAULT 0 NOT NULL,
	`inferred` integer DEFAULT false NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`provenance` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `news_interests_person_channel_idx` ON `news_interests` (`person_id`,`kind`,`key`);--> statement-breakpoint
CREATE TABLE `news_reads` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`item_id` text NOT NULL,
	`story_id` text NOT NULL,
	`opened_at` text NOT NULL,
	`read_s` integer DEFAULT 0 NOT NULL,
	`finished` integer DEFAULT false NOT NULL,
	`feedback` text,
	`hlc` text NOT NULL,
	`provenance` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `news_reads_person_item_idx` ON `news_reads` (`person_id`,`item_id`);--> statement-breakpoint
CREATE TABLE `news_saves` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`item_id` text NOT NULL,
	`story_id` text NOT NULL,
	`canonical_url` text NOT NULL,
	`title` text NOT NULL,
	`publisher` text NOT NULL,
	`saved_at` text NOT NULL,
	`offline` integer DEFAULT false NOT NULL,
	`hlc` text NOT NULL,
	`provenance` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `news_saves_person_item_idx` ON `news_saves` (`person_id`,`item_id`);