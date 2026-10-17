CREATE TABLE `likeness_adapters` (
	`id` text PRIMARY KEY NOT NULL,
	`adapter_id` text NOT NULL,
	`medium` text NOT NULL,
	`subject_person_id` text,
	`classification` text NOT NULL,
	`state` text NOT NULL,
	`declared_by` text NOT NULL,
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	FOREIGN KEY (`subject_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`declared_by`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `likeness_adapters_subject_idx` ON `likeness_adapters` (`subject_person_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `likeness_adapters_medium_adapter_idx` ON `likeness_adapters` (`medium`,`adapter_id`);--> statement-breakpoint
CREATE TABLE `likeness_consent_events` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`option` text NOT NULL,
	`state` text NOT NULL,
	`source` text NOT NULL,
	`changed_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `likeness_consent_events_person_idx` ON `likeness_consent_events` (`person_id`);--> statement-breakpoint
CREATE TABLE `likeness_uses` (
	`id` text PRIMARY KEY NOT NULL,
	`subject_person_id` text NOT NULL,
	`requester_person_id` text NOT NULL,
	`medium` text NOT NULL,
	`way` text NOT NULL,
	`adult_content` integer DEFAULT false NOT NULL,
	`source` text NOT NULL,
	`used_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	FOREIGN KEY (`subject_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requester_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `likeness_uses_subject_idx` ON `likeness_uses` (`subject_person_id`);