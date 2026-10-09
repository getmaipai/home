ALTER TABLE `entities` ADD `geo` text;
--> statement-breakpoint
-- Preserve the existing free-text home as a household Entity and point the
-- new core key at it. The legacy setting row stays as an alias for the
-- existing editor until the location selector ships.
CREATE TEMP TABLE `_home_place_migration` (`id` text NOT NULL, `name` text NOT NULL, `hlc` text NOT NULL, `updated_at` text NOT NULL);
--> statement-breakpoint
INSERT INTO `_home_place_migration` (`id`, `name`, `hlc`, `updated_at`)
SELECT 'ent-' || lower(hex(randomblob(10))), json_extract(`value`, '$'), `hlc`, `updated_at`
FROM `settings_values`
WHERE `scope` = 'household' AND `key` = 'household.home_place'
  AND json_type(`value`, '$') = 'text' AND length(trim(json_extract(`value`, '$'))) > 0
  AND NOT EXISTS (SELECT 1 FROM `settings_values` WHERE `scope` = 'household' AND `key` = 'household.home');
--> statement-breakpoint
INSERT INTO `entities` (`id`, `kind`, `name`, `aliases`, `description`, `place_kind`, `geo`, `parent_id`, `account_person_id`, `source`, `confirmed_by_person_id`, `confirmed_at`, `scope`, `person`, `sensitive`, `pronouns`, `created_at`, `updated_at`, `deleted_at`, `hlc`)
SELECT `id`, 'place', `name`, '[]', NULL, 'map', NULL, NULL, NULL, 'hub', NULL, NULL, 'household', NULL, 0, NULL, `updated_at`, `updated_at`, NULL, `hlc`
FROM `_home_place_migration`;
--> statement-breakpoint
INSERT INTO `settings_values` (`scope`, `key`, `value`, `hlc`, `source`, `updated_at`)
SELECT 'household', 'household.home', json_quote(`id`), `hlc`, 'user', `updated_at`
FROM `_home_place_migration`;
--> statement-breakpoint
DROP TABLE `_home_place_migration`;
