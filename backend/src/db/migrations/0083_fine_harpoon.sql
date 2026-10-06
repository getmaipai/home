CREATE TABLE `device_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`issued_at` text NOT NULL,
	`delivered_at` text,
	`acked_at` text,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `notification_holds` (
	`id` text PRIMARY KEY NOT NULL,
	`type_id` text NOT NULL,
	`recipient_id` text NOT NULL,
	`text` text NOT NULL,
	`options` text NOT NULL,
	`deliver_after` text NOT NULL,
	FOREIGN KEY (`recipient_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
