-- Rename the "skill" package kind to "plugin" (docs/dev.md's "Naming:
-- skill, plugin, command, connector" entry, 2026-09-05): what these
-- packages are (self-contained, permissioned, installable capabilities)
-- matches Claude's/ChatGPT's actual "Plugin" shape, not their narrower
-- "Skill" shape. Hand-written, not drizzle-kit generated: drizzle-kit's
-- rename-vs-drop-and-add prompt needs a TTY this environment doesn't
-- have, and a data migration (the UPDATE below) isn't something it
-- generates anyway.
--
-- conversation_turns.skill_id -> plugin_id, and its existing "skill"/
-- "skill_error" source values -> "plugin"/"plugin_error": this table has
-- real, already-written rows from tonight's live testing, not just
-- future ones, so the values themselves need migrating, not only the
-- column name.
ALTER TABLE `conversation_turns` RENAME COLUMN `skill_id` TO `plugin_id`;--> statement-breakpoint
UPDATE `conversation_turns` SET `source` = 'plugin' WHERE `source` = 'skill';--> statement-breakpoint
UPDATE `conversation_turns` SET `source` = 'plugin_error' WHERE `source` = 'skill_error';--> statement-breakpoint
-- scheduled_jobs.kind: no real row has ever had "skill" (no bundled
-- recipe uses the `schedule` step yet, confirmed by checking every
-- backend/packages/*/recipe.json before writing this), but normalized
-- anyway for correctness, not left to chance.
UPDATE `scheduled_jobs` SET `kind` = 'plugin' WHERE `kind` = 'skill';
