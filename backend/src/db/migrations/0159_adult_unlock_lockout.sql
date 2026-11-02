ALTER TABLE `person_credentials` ADD `adult_failed_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `person_credentials` ADD `adult_locked_until` text;
