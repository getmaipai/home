CREATE TABLE `device_states` (
	`device_id` text PRIMARY KEY NOT NULL,
	`activity` text NOT NULL,
	`muted` integer NOT NULL,
	`tracking` integer NOT NULL,
	`on_battery` integer,
	`battery_level` real,
	`daemon_version` text,
	`reported_at` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE cascade
);
