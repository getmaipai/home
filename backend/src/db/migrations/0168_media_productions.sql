CREATE TABLE `media_productions` (
  `id` text PRIMARY KEY NOT NULL,
  `owner_person_id` text NOT NULL REFERENCES `people`(`id`),
  `title` text NOT NULL,
  `summary` text NOT NULL DEFAULT '',
  `shared_to` text NOT NULL DEFAULT '[]',
  `cast` text NOT NULL DEFAULT '[]',
  `sets` text NOT NULL DEFAULT '[]',
  `props` text NOT NULL DEFAULT '[]',
  `episodes` text NOT NULL DEFAULT '[]',
  `clip_file_ids` text NOT NULL DEFAULT '[]',
  `picture_file_ids` text NOT NULL DEFAULT '[]',
  `music_line_ids` text NOT NULL DEFAULT '[]',
  `voice_line_ids` text NOT NULL DEFAULT '[]',
  `finished_cut_file_ids` text NOT NULL DEFAULT '[]',
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  `hlc` text NOT NULL,
  `provenance` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `media_productions_owner_idx` ON `media_productions` (`owner_person_id`);
