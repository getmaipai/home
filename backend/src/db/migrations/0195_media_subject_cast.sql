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
-- Link existing synth subjects once: the subject learns its synth from the provenance ensureSubject wrote.
UPDATE `media_subjects` SET `synth_id` = substr(json_extract(substr(`provenance`, 15), '$.source'), 14)
WHERE `provenance` LIKE 'media-subject:%' AND json_extract(substr(`provenance`, 15), '$.source') LIKE 'talent:synth:%';
