ALTER TABLE `notification_deliveries` ADD `repeat_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `notification_deliveries_repeat_key_idx` ON `notification_deliveries` (`type_id`,`recipient_id`,`repeat_key`);
