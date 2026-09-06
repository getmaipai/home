CREATE TABLE `device_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`person_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_seen_at` text,
	`last_seen_url` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `device_tokens_token_hash_unique` ON `device_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`area` text,
	`capabilities` text DEFAULT '[]' NOT NULL,
	`person_id` text NOT NULL,
	`watermarks` text DEFAULT '{}' NOT NULL,
	`last_seen_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `passkey_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`person_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`transports` text DEFAULT '[]' NOT NULL,
	`device_type` text NOT NULL,
	`backed_up` integer DEFAULT false NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `totp_secrets` (
	`person_id` text PRIMARY KEY NOT NULL,
	`secret_encrypted` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
