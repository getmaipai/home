CREATE TABLE `podcast_transcripts` (
  `item_id` text PRIMARY KEY NOT NULL,
  `transcript_url` text,
  `source` text,
  `text` text,
  `segments` text DEFAULT '[]' NOT NULL,
  `job_id` text,
  `updated_at` text NOT NULL,
  `hlc` text NOT NULL
);
