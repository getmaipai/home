CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_key` text NOT NULL,
	`conversation_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`version` integer NOT NULL,
	`parent_version` text,
	`created_by` text NOT NULL,
	`provenance` text NOT NULL,
	`created_at` text NOT NULL,
	`hlc` text NOT NULL,
	`is_current` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`turn_id`) REFERENCES `conversation_turns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `artifacts_artifact_key_idx` ON `artifacts` (`artifact_key`);--> statement-breakpoint
CREATE INDEX `artifacts_conversation_id_idx` ON `artifacts` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `artifacts_turn_id_idx` ON `artifacts` (`turn_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `artifacts_artifact_key_current_idx` ON `artifacts` (`artifact_key`,`is_current`) WHERE is_current = 1;