DROP INDEX `conversation_turns_conversation_id_idx`;--> statement-breakpoint
CREATE INDEX `conversation_turns_conversation_created_idx` ON `conversation_turns` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `conversation_turns_conversation_status_created_idx` ON `conversation_turns` (`conversation_id`,`status`,`created_at`);
