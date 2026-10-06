CREATE TABLE `notification_holds` (
	`id` text PRIMARY KEY NOT NULL,
	`type_id` text NOT NULL,
	`recipient_id` text NOT NULL,
	`text` text NOT NULL,
	`options` text NOT NULL,
	`deliver_after` text NOT NULL,
	FOREIGN KEY (`recipient_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE cascade
);
