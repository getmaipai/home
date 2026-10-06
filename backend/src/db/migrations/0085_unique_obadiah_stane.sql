CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`started_by` text NOT NULL,
	`for_person` text NOT NULL,
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
