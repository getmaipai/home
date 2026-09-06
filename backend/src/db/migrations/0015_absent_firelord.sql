PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_person_credentials` (
	`person_id` text PRIMARY KEY NOT NULL,
	`secret_hash` text,
	`failed_attempts` integer DEFAULT 0 NOT NULL,
	`locked_until` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_person_credentials`("person_id", "secret_hash", "failed_attempts", "locked_until", "created_at", "updated_at") SELECT "person_id", "secret_hash", "failed_attempts", "locked_until", "created_at", "updated_at" FROM `person_credentials`;--> statement-breakpoint
DROP TABLE `person_credentials`;--> statement-breakpoint
ALTER TABLE `__new_person_credentials` RENAME TO `person_credentials`;--> statement-breakpoint
PRAGMA foreign_keys=ON;