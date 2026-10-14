CREATE TABLE IF NOT EXISTS `setup_state` (
	`slot` integer PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	CONSTRAINT "setup_state_singleton" CHECK("setup_state"."slot" = 1)
);
