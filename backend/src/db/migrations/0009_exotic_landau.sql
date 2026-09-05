CREATE TABLE `notification_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`type_id` text NOT NULL,
	`recipient_id` text NOT NULL,
	`text` text NOT NULL,
	`channels` text NOT NULL,
	`created_at` text NOT NULL,
	`read_at` text,
	`dismissed_at` text,
	FOREIGN KEY (`recipient_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
