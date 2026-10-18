CREATE TABLE `news_story_summaries` (
  `story_id` text NOT NULL,
  `band` text NOT NULL,
  `summary` text NOT NULL,
  `updated_at` text NOT NULL,
  `hlc` text NOT NULL,
  `provenance` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `news_story_summaries_story_band_idx` ON `news_story_summaries` (`story_id`, `band`);
