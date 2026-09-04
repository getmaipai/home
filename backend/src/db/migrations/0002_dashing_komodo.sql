CREATE TABLE `settings_values` (
	`scope` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`hlc` text NOT NULL,
	`source` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`scope`, `key`)
);
