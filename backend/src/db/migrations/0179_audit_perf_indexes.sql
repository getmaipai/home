CREATE INDEX `conversation_turns_created_idx` ON `conversation_turns` (`created_at`);--> statement-breakpoint
CREATE INDEX `device_commands_device_delivered_idx` ON `device_commands` (`device_id`,`delivered_at`);--> statement-breakpoint
CREATE INDEX `jobs_state_kind_idx` ON `jobs` (`state`,`kind`);--> statement-breakpoint
CREATE INDEX `scheduled_jobs_status_next_run_idx` ON `scheduled_jobs` (`status`,`next_run_at`);