PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_robot_credentials` (
	`device_id` text PRIMARY KEY NOT NULL,
	`host` text NOT NULL,
	`ssh_username` text NOT NULL,
	`password_encrypted` text NOT NULL,
	`rotated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_robot_credentials`("device_id", "host", "ssh_username", "password_encrypted", "rotated_at") SELECT "device_id", "host", "ssh_username", "password_encrypted", "rotated_at" FROM `robot_credentials`;--> statement-breakpoint
DROP TABLE `robot_credentials`;--> statement-breakpoint
ALTER TABLE `__new_robot_credentials` RENAME TO `robot_credentials`;--> statement-breakpoint
PRAGMA foreign_keys=ON;