CREATE TABLE `coding_token_usage` (
  `person_id` text NOT NULL,
  `day` text NOT NULL,
  `tokens` integer NOT NULL,
  `updated_at` text NOT NULL,
  PRIMARY KEY (`person_id`, `day`),
  FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
