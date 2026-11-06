-- A transcript belongs to a Library item, which is a media item or an uploaded or generated file. The first version
-- pointed library_item_id at media_items, so a file could not have one. These three tables hold no shipped data
-- (CAPTION-01c landed the same day), so they are recreated without that foreign key.
DROP TABLE `caption_tracks`;
--> statement-breakpoint
DROP TABLE `transcript_revisions`;
--> statement-breakpoint
DROP TABLE `transcripts`;
--> statement-breakpoint
CREATE TABLE `transcripts` (
  `id` text PRIMARY KEY NOT NULL,
  `library_item_id` text NOT NULL,
  `owner_id` text NOT NULL REFERENCES `people`(`id`),
  `language` text NOT NULL,
  `current_revision` integer NOT NULL,
  `segments` text NOT NULL,
  `speakers` text NOT NULL,
  `vocabulary` text NOT NULL,
  `provenance` text NOT NULL,
  `hlc` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `transcripts_item_idx` ON `transcripts` (`library_item_id`);
--> statement-breakpoint
CREATE TABLE `transcript_revisions` (
  `id` text PRIMARY KEY NOT NULL,
  `transcript_id` text NOT NULL REFERENCES `transcripts`(`id`) ON DELETE CASCADE,
  `n` integer NOT NULL,
  `author` text NOT NULL,
  `reason` text NOT NULL,
  `ops` text NOT NULL,
  `provenance` text NOT NULL,
  `hlc` text NOT NULL,
  UNIQUE (`transcript_id`, `n`)
);
--> statement-breakpoint
CREATE INDEX `transcript_revisions_transcript_idx` ON `transcript_revisions` (`transcript_id`, `n`);
--> statement-breakpoint
CREATE TABLE `caption_tracks` (
  `id` text PRIMARY KEY NOT NULL,
  `transcript_id` text NOT NULL REFERENCES `transcripts`(`id`) ON DELETE CASCADE,
  `language` text NOT NULL,
  `based_on_revision` integer NOT NULL,
  `cues` text NOT NULL,
  `style` text NOT NULL,
  `provenance` text NOT NULL,
  `hlc` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `caption_tracks_transcript_idx` ON `caption_tracks` (`transcript_id`);
