PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`started_by` text NOT NULL,
	`for_person` text,
	`title` text NOT NULL,
	`state` text NOT NULL,
	`progress` text,
	`waiting_reason` text,
	`result_ref` text,
	`conversation_id` text,
	`error_kind` text,
	`raw` text,
	`provenance` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`for_person`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_jobs`("id", "kind", "started_by", "for_person", "title", "state", "progress", "waiting_reason", "result_ref", "conversation_id", "error_kind", "raw", "provenance", "created_at", "updated_at") SELECT "id", "kind", "started_by", "for_person", "title", "state", "progress", "waiting_reason", "result_ref", "conversation_id", "error_kind", "raw", "provenance", "created_at", "updated_at" FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;