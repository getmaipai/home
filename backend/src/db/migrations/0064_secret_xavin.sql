CREATE TABLE `memory_consolidation_cursor` (
	`id` integer PRIMARY KEY NOT NULL,
	`group_key` text NOT NULL,
	`after_a_id` text NOT NULL,
	`after_b_id` text NOT NULL
);
