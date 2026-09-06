CREATE TABLE `routing_embeddings` (
	`package_id` text NOT NULL,
	`example_hash` text NOT NULL,
	`space` text NOT NULL,
	`example` text NOT NULL,
	`dims` integer NOT NULL,
	`vector` blob NOT NULL,
	`hlc` text NOT NULL,
	PRIMARY KEY(`package_id`, `example_hash`, `space`)
);
--> statement-breakpoint
ALTER TABLE `conversation_turns` ADD `routing_tier` text;--> statement-breakpoint
ALTER TABLE `conversation_turns` ADD `routing_score` real;