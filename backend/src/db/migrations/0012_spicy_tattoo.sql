ALTER TABLE `conversation_turns` ADD `judge_status` text;--> statement-breakpoint
ALTER TABLE `conversation_turns` ADD `judge_attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `conversation_turns_judge_status_idx` ON `conversation_turns` (`source`,`judge_status`);