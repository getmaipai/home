CREATE TABLE `scheduled_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`person` text NOT NULL,
	`kind` text NOT NULL,
	`executor` text NOT NULL,
	`once_at` text,
	`time` text,
	`days` text,
	`zone` text,
	`what` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`state` text NOT NULL,
	`paused_reason` text,
	`external_ref` text,
	`grant_snapshot` text NOT NULL,
	`deliver_on` text,
	`provenance` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `scheduled_tasks_person_idx` ON `scheduled_tasks` (`person`);--> statement-breakpoint
CREATE INDEX `scheduled_tasks_external_ref_idx` ON `scheduled_tasks` (`external_ref`);
