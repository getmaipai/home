CREATE TABLE `music_lyric_translations` (
  `id` text PRIMARY KEY NOT NULL,
  `media_id` text NOT NULL,
  `language` text NOT NULL,
  `source_hash` text NOT NULL,
  `lines_json` text NOT NULL,
  `created_at` text NOT NULL,
  `hlc` text NOT NULL
);
CREATE UNIQUE INDEX `music_lyric_translations_key` ON `music_lyric_translations` (`media_id`, `language`);
