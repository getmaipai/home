CREATE TABLE `shares` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`from_person_id` text NOT NULL,
	`to` text NOT NULL,
	`provenance` text NOT NULL,
	`created_at` text NOT NULL,
	`hlc` text NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `attachments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `shares_file_id_idx` ON `shares` (`file_id`);--> statement-breakpoint
CREATE INDEX `shares_to_idx` ON `shares` (`to`);--> statement-breakpoint
CREATE INDEX `shares_from_person_id_idx` ON `shares` (`from_person_id`);--> statement-breakpoint
CREATE INDEX `attachments_sha256_idx` ON `attachments` (`sha256`);