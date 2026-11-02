ALTER TABLE `media_items` ADD `made_artist_id` text;
--> statement-breakpoint
CREATE INDEX `media_items_made_artist_idx` ON `media_items` (`made_artist_id`);
