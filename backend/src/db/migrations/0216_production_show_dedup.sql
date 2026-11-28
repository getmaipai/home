-- Keep the earliest household production show for duplicate source identities.
-- This intentionally never selects feeds or any other source kind.
CREATE TEMP TABLE `_duplicate_production_sources` (`id` TEXT PRIMARY KEY);
--> statement-breakpoint
INSERT INTO `_duplicate_production_sources` (`id`)
SELECT duplicate.`id`
FROM `media_sources` AS duplicate
WHERE duplicate.`kind` = 'production'
  AND EXISTS (
    SELECT 1 FROM `media_sources` AS keeper
    WHERE keeper.`kind` = 'production'
      AND keeper.`scope` = duplicate.`scope`
      AND keeper.`owner_person_id` IS duplicate.`owner_person_id`
      AND keeper.`label` = duplicate.`label`
      AND (keeper.`created_at` < duplicate.`created_at`
        OR (keeper.`created_at` = duplicate.`created_at` AND keeper.`id` < duplicate.`id`))
  );
--> statement-breakpoint
CREATE TEMP TABLE `_duplicate_production_items` (`id` TEXT PRIMARY KEY);
--> statement-breakpoint
INSERT INTO `_duplicate_production_items` (`id`)
SELECT `id` FROM `media_items` WHERE `source_id` IN (SELECT `id` FROM `_duplicate_production_sources`);
--> statement-breakpoint
DELETE FROM `media_progress` WHERE `media_id` IN (SELECT `id` FROM `_duplicate_production_items`);
--> statement-breakpoint
DELETE FROM `podcast_segment_links` WHERE `media_item_id` IN (SELECT `id` FROM `_duplicate_production_items`);
--> statement-breakpoint
DELETE FROM `podcast_transcripts` WHERE `item_id` IN (SELECT `id` FROM `_duplicate_production_items`);
--> statement-breakpoint
DELETE FROM `transcripts` WHERE `library_item_id` IN (SELECT `id` FROM `_duplicate_production_items`);
--> statement-breakpoint
UPDATE `media_collections`
SET `items` = (
  SELECT json_group_array(json(j.value)) FROM json_each(`media_collections`.`items`) AS j
  WHERE json_extract(j.value, '$.media_id') NOT IN (SELECT `id` FROM `_duplicate_production_items`)
)
WHERE EXISTS (SELECT 1 FROM json_each(`media_collections`.`items`) AS j
  WHERE json_extract(j.value, '$.media_id') IN (SELECT `id` FROM `_duplicate_production_items`));
--> statement-breakpoint
DELETE FROM `media_items` WHERE `id` IN (SELECT `id` FROM `_duplicate_production_items`);
--> statement-breakpoint
DELETE FROM `attachments` WHERE `media_source_id` IN (SELECT `id` FROM `_duplicate_production_sources`);
--> statement-breakpoint
DELETE FROM `media_sources` WHERE `id` IN (SELECT `id` FROM `_duplicate_production_sources`);
--> statement-breakpoint
DROP TABLE `_duplicate_production_items`;
--> statement-breakpoint
DROP TABLE `_duplicate_production_sources`;
