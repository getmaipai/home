ALTER TABLE `memory_records` ADD `fact_confidence` real;--> statement-breakpoint
ALTER TABLE `memory_records` ADD `confidence_evidence` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `memory_records` ADD `conflicts_with` text DEFAULT '[]' NOT NULL;