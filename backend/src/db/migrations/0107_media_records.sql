CREATE TABLE `media_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`items` text DEFAULT '[]' NOT NULL,
	`pointer` integer,
	`shared_to` text,
	`rules` text,
	`deleted_at` text,
	`trash_until` text,
	`created_at` text NOT NULL,
	`hlc` text NOT NULL,
	`provenance` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `media_collections_person_kind_idx` ON `media_collections` (`person_id`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `media_collections_singleton_idx` ON `media_collections` (`person_id`,`kind`) WHERE "media_collections"."kind" IN ('liked', 'watch_later', 'queue');--> statement-breakpoint
CREATE TABLE `media_items` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`subtitle` text,
	`description` text,
	`source_id` text NOT NULL,
	`parent_id` text,
	`loc_file_id` text,
	`loc_root_id` text,
	`loc_path` text,
	`loc_url` text,
	`media_type` text NOT NULL,
	`duration_s` real,
	`size` integer,
	`width` integer,
	`height` integer,
	`video_codec` text,
	`audio_codec` text,
	`playable` text NOT NULL,
	`artwork` text,
	`previews` text,
	`chapters` text DEFAULT '[]' NOT NULL,
	`subtitles` text DEFAULT '[]' NOT NULL,
	`series` text,
	`season` integer,
	`episode` integer,
	`artist` text,
	`album` text,
	`album_artist` text,
	`track_no` integer,
	`disc_no` integer,
	`year` integer,
	`genre` text,
	`author` text,
	`narrator` text,
	`series_index` real,
	`locator_kind` text DEFAULT 'none' NOT NULL,
	`external` text,
	`external_id` text,
	`advisory_explicit` integer DEFAULT false NOT NULL,
	`advisory_source` text DEFAULT 'tag' NOT NULL,
	`band_ok` text NOT NULL,
	`verified_by_person_id` text,
	`added_at` text NOT NULL,
	`fingerprint` text,
	`hidden` integer DEFAULT false NOT NULL,
	`last_seen_scan` text,
	`missing_since` text,
	`pages` integer,
	`probe_failed_fp` text,
	`deleted_at` text,
	`trash_until` text,
	`created_at` text NOT NULL,
	`hlc` text NOT NULL,
	`provenance` text NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `media_sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_items_external_idx` ON `media_items` (`source_id`,`external_id`) WHERE "media_items"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `media_items_root_path_idx` ON `media_items` (`loc_root_id`,`loc_path`) WHERE "media_items"."loc_root_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `media_items_source_kind_idx` ON `media_items` (`source_id`,`kind`);--> statement-breakpoint
CREATE INDEX `media_items_kind_band_idx` ON `media_items` (`kind`,`band_ok`);--> statement-breakpoint
CREATE INDEX `media_items_parent_idx` ON `media_items` (`parent_id`);--> statement-breakpoint
CREATE INDEX `media_items_file_idx` ON `media_items` (`loc_file_id`);--> statement-breakpoint
CREATE INDEX `media_items_dupes_idx` ON `media_items` (`size`,`title`);--> statement-breakpoint
CREATE TABLE `media_progress` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`media_id` text NOT NULL,
	`position` text NOT NULL,
	`duration_s` real,
	`completed` integer DEFAULT false NOT NULL,
	`plays` integer DEFAULT 0 NOT NULL,
	`skips` integer DEFAULT 0 NOT NULL,
	`finishes` integer DEFAULT 0 NOT NULL,
	`marks` text DEFAULT '[]' NOT NULL,
	`device_id` text,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`provenance` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_progress_person_media_idx` ON `media_progress` (`person_id`,`media_id`);--> statement-breakpoint
CREATE INDEX `media_progress_person_updated_idx` ON `media_progress` (`person_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `media_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`scope` text NOT NULL,
	`owner_person_id` text,
	`label` text NOT NULL,
	`root_mount_id` text,
	`root_path` text,
	`root_kinds` text,
	`feed_id` text,
	`url` text,
	`extractor` text,
	`auto` text DEFAULT '{}' NOT NULL,
	`speed` real,
	`skip_intro_s` integer DEFAULT 0 NOT NULL,
	`skip_outro_s` integer DEFAULT 0 NOT NULL,
	`poll_minutes` integer DEFAULT 60 NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`last_checked_at` text,
	`last_status` text,
	`failures` integer DEFAULT 0 NOT NULL,
	`backoff_until` text,
	`visible_to` text DEFAULT '"household"' NOT NULL,
	`archive` text DEFAULT '[]' NOT NULL,
	`last_scan_summary` text,
	`prune` integer DEFAULT true NOT NULL,
	`deleted_at` text,
	`trash_until` text,
	`created_at` text NOT NULL,
	`hlc` text NOT NULL,
	`provenance` text NOT NULL,
	FOREIGN KEY (`owner_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `media_sources_kind_idx` ON `media_sources` (`kind`);--> statement-breakpoint
CREATE INDEX `media_sources_root_path_idx` ON `media_sources` (`root_path`);