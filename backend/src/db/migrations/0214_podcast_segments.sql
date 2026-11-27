CREATE TABLE `podcast_segment_links` (
  `media_item_id` text PRIMARY KEY NOT NULL REFERENCES `media_items`(`id`) ON DELETE cascade,
  `sha256` text NOT NULL,
  `pipeline_version` text NOT NULL DEFAULT '1',
  `state` text NOT NULL,
  `record_id` text,
  `job_id` text,
  `record` text,
  `reason` text,
  `updated_at` text NOT NULL
);
