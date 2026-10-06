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
