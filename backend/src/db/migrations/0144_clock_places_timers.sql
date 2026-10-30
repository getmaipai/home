CREATE TABLE `world_places` (`id` text PRIMARY KEY NOT NULL, `person` text NOT NULL REFERENCES `people`(`id`), `name` text NOT NULL, `country` text NOT NULL, `zone` text NOT NULL, `position` integer NOT NULL, `source` text NOT NULL, `created_at` text NOT NULL, `updated_at` text NOT NULL, `deleted_at` text, `hlc` text NOT NULL);
--> statement-breakpoint
CREATE INDEX `world_places_person_idx` ON `world_places` (`person`);
--> statement-breakpoint
CREATE TABLE `quick_timers` (`id` text PRIMARY KEY NOT NULL, `person` text NOT NULL REFERENCES `people`(`id`), `name` text NOT NULL, `minutes` integer NOT NULL, `position` integer NOT NULL, `source` text NOT NULL, `created_at` text NOT NULL, `updated_at` text NOT NULL, `deleted_at` text, `hlc` text NOT NULL, `defaults_initialized` integer NOT NULL DEFAULT 0);
--> statement-breakpoint
CREATE INDEX `quick_timers_person_idx` ON `quick_timers` (`person`);
