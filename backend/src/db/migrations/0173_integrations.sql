CREATE TABLE `integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`instance` text NOT NULL,
	`label` text NOT NULL,
	`address` text NOT NULL,
	`credential_ref` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`deleted_at` text,
	`provenance` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integrations_type_instance_idx` ON `integrations` (`type`,`instance`);
