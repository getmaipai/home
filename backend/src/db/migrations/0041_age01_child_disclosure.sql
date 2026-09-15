ALTER TABLE `memory_records` ADD `child_disclosure` text DEFAULT 'child_ok' NOT NULL;--> statement-breakpoint
ALTER TABLE `memory_records` ADD `child_disclosure_set_by` text;--> statement-breakpoint
ALTER TABLE `memory_records` ADD `child_disclosure_set_at` text;