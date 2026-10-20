ALTER TABLE `conversations` ADD `device_id` text REFERENCES devices(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `conversations_device_id_idx` ON `conversations` (`device_id`);--> statement-breakpoint
ALTER TABLE `memory_records` ADD `device_id` text REFERENCES devices(id) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `memory_records_device_id_idx` ON `memory_records` (`device_id`);
