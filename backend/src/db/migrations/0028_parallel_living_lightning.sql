CREATE TABLE `episode_embeddings` (
	`episode_id` text PRIMARY KEY NOT NULL,
	`space` text NOT NULL,
	`dims` integer NOT NULL,
	`vector` blob NOT NULL,
	`hlc` text NOT NULL,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `episodes` (
	`id` text PRIMARY KEY NOT NULL,
	`turn_id` text NOT NULL,
	`conversation_id` text,
	`person_id` text NOT NULL,
	`speaker` text NOT NULL,
	`text` text NOT NULL,
	`created_at` text NOT NULL,
	`hlc` text NOT NULL,
	FOREIGN KEY (`turn_id`) REFERENCES `conversation_turns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `episodes_person_id_created_at_idx` ON `episodes` (`person_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `episodes_turn_id_idx` ON `episodes` (`turn_id`);--> statement-breakpoint
CREATE TABLE `pending_episode_embeddings` (
	`episode_id` text PRIMARY KEY NOT NULL,
	`queued_at` text NOT NULL,
	FOREIGN KEY (`episode_id`) REFERENCES `episodes`(`id`) ON UPDATE no action ON DELETE no action
);--> statement-breakpoint
CREATE VIRTUAL TABLE `episodes_fts` USING fts5(text, content='episodes', content_rowid='rowid');--> statement-breakpoint
CREATE TRIGGER `episodes_ai` AFTER INSERT ON `episodes` BEGIN
  INSERT INTO `episodes_fts` (rowid, text) VALUES (new.rowid, new.text);
END;--> statement-breakpoint
CREATE TRIGGER `episodes_ad` AFTER DELETE ON `episodes` BEGIN
  INSERT INTO `episodes_fts` (episodes_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;--> statement-breakpoint
CREATE TRIGGER `episodes_au` AFTER UPDATE ON `episodes` BEGIN
  INSERT INTO `episodes_fts` (episodes_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
  INSERT INTO `episodes_fts` (rowid, text) VALUES (new.rowid, new.text);
END;
