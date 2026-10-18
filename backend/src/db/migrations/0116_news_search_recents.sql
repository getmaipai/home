CREATE TABLE `news_search_recents` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`q` text NOT NULL,
	`at` text NOT NULL,
	`hlc` text NOT NULL,
	`provenance` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `news_search_recents_person_q_idx` ON `news_search_recents` (`person_id`,lower("q"));