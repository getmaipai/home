CREATE TABLE `robot_credentials` (
	`device_id` text PRIMARY KEY NOT NULL,
	`ssh_username` text NOT NULL,
	`password_encrypted` text NOT NULL,
	`rotated_at` text NOT NULL,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
