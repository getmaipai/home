CREATE TABLE `loras` (
	`id` text PRIMARY KEY NOT NULL,
	`record` text NOT NULL,
	`media` text NOT NULL,
	`kind` text NOT NULL,
	`base_model` text NOT NULL,
	`audience` text NOT NULL,
	`availability_who` text NOT NULL,
	`sha256` text NOT NULL,
	`removed_at` text,
	`trash_until` text,
	`added_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`provenance` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `loras_media_removed_idx` ON `loras` (`media`,`removed_at`);--> statement-breakpoint
CREATE INDEX `loras_audience_idx` ON `loras` (`audience`,`availability_who`);--> statement-breakpoint
CREATE INDEX `loras_sha256_idx` ON `loras` (`sha256`);--> statement-breakpoint
CREATE INDEX `loras_trash_idx` ON `loras` (`trash_until`);
