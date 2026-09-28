CREATE TABLE `biometric_prints` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`modality` text NOT NULL,
	`model_id` text NOT NULL,
	`model_sha256` text NOT NULL,
	`dim` integer NOT NULL,
	`embedding_encrypted` text,
	`captured_by` text,
	`consent_at` text NOT NULL,
	`consented_by_person_id` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`hlc` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`consented_by_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `biometric_prints_person_id_idx` ON `biometric_prints` (`person_id`);