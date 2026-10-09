CREATE TABLE `safety_alarms` (
	`id` text PRIMARY KEY NOT NULL,
	`sensor_id` text NOT NULL,
	`area` text,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`started_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`ended_at` text,
	`ended_by_person_id` text,
	`quieted_devices` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`ended_by_person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE set null
);
