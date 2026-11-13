-- CREATOR-04 (CREATOR-PORT-2026-11-13): the one cast record. A saved subject gains the spec's synth link, voice and trained style,
-- the person link of a household member, and the locked sentence.
ALTER TABLE `media_subjects` ADD `synth_id` text;
--> statement-breakpoint
ALTER TABLE `media_subjects` ADD `person_id` text;
--> statement-breakpoint
ALTER TABLE `media_subjects` ADD `voice` text;
--> statement-breakpoint
ALTER TABLE `media_subjects` ADD `trained_style_id` text;
--> statement-breakpoint
ALTER TABLE `media_subjects` ADD `locked_description` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `media_subjects_person_idx` ON `media_subjects` (`person_id`) WHERE `person_id` IS NOT NULL;
--> statement-breakpoint
-- Link the subjects ensureSubject made before this release: the provenance names the synth. Bad json is skipped (json_valid inside CASE, since
-- SQLite does not short-circuit AND), and only the oldest subject of each synth is linked. A deleted synth cannot be told from SQL (synths are
-- files); its link is harmless and fails safe in the reader.
UPDATE `media_subjects` SET `synth_id` = substr(CASE WHEN json_valid(substr(`provenance`, 15)) THEN json_extract(substr(`provenance`, 15), '$.source') END, 14)
WHERE `provenance` LIKE 'media-subject:%'
  AND CASE WHEN json_valid(substr(`provenance`, 15)) THEN json_extract(substr(`provenance`, 15), '$.source') END LIKE 'talent:synth:%'
  AND `id` = (
    SELECT m2.`id` FROM `media_subjects` AS m2
    WHERE m2.`provenance` LIKE 'media-subject:%'
      AND CASE WHEN json_valid(substr(m2.`provenance`, 15)) THEN json_extract(substr(m2.`provenance`, 15), '$.source') END
        = CASE WHEN json_valid(substr(`media_subjects`.`provenance`, 15)) THEN json_extract(substr(`media_subjects`.`provenance`, 15), '$.source') END
    ORDER BY m2.`created_at`, m2.`id` LIMIT 1
  );
--> statement-breakpoint
CREATE UNIQUE INDEX `media_subjects_synth_idx` ON `media_subjects` (`synth_id`) WHERE `synth_id` IS NOT NULL;
