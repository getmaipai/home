ALTER TABLE `conversation_turns` ADD `parent_turn_id` text;--> statement-breakpoint
ALTER TABLE `conversation_turns` ADD `branch_chosen` integer DEFAULT true NOT NULL;--> statement-breakpoint
UPDATE `conversation_turns`
SET `parent_turn_id` = (
  SELECT prior.`id`
  FROM `conversation_turns` AS prior
  WHERE prior.`conversation_id` = `conversation_turns`.`conversation_id`
    AND (prior.`created_at` < `conversation_turns`.`created_at`
      OR (prior.`created_at` = `conversation_turns`.`created_at` AND prior.`rowid` < `conversation_turns`.`rowid`))
  ORDER BY prior.`created_at` DESC, prior.`rowid` DESC
  LIMIT 1
)
WHERE `supersedes` IS NULL;--> statement-breakpoint
UPDATE `conversation_turns`
SET `parent_turn_id` = (
  SELECT replaced.`parent_turn_id`
  FROM `conversation_turns` AS replaced
  WHERE replaced.`id` = `conversation_turns`.`supersedes`
)
WHERE `supersedes` IS NOT NULL;--> statement-breakpoint
UPDATE `conversation_turns`
SET `branch_chosen` = 0
WHERE `id` IN (SELECT `supersedes` FROM `conversation_turns` WHERE `supersedes` IS NOT NULL);
