ALTER TABLE `conversation_turns` ADD `rung` text;--> statement-breakpoint
ALTER TABLE `conversation_turns` ADD `corrected_next_turn` integer;--> statement-breakpoint
ALTER TABLE `conversation_turns` ADD `rules` text;