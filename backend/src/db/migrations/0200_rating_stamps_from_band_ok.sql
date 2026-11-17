-- FILTER-MEDIA-01: the old library words (explicit flag, band_ok adult, the all-ages and adult-only marks) become the one stamp
-- (content_ratings), the same or stricter than today. Rows with band_ok child or teen get no stamp here: they stay Unrated (hidden
-- from a minor) until the ratings sweep rates them with the real rater. The spec's rating needs rater_version >= 1 (a version 0 stamp
-- does not parse and reads as Unrated), so these carry 1. A media stamp's fingerprint ends in "#migrated", which never equals the real
-- one, so the sweep re-rates it in the background and the stamp holds until then. A creation or attachment mark is already what the
-- rater gives, so those keep the real fingerprint.
INSERT INTO `content_ratings` (`subject_kind`, `subject_id`, `fingerprint`, `rater`, `rater_version`, `level`, `source`, `reasons`, `label`, `rated_at`)
SELECT 'media_item', m.`id`, coalesce(m.`fingerprint`, m.`external_id`, m.`id`) || '#migrated',
  CASE WHEN m.`advisory_explicit` = 1 THEN 'explicit-flag' ELSE 'band-ok-migration' END, 1,
  CASE WHEN m.`advisory_explicit` = 1 THEN 'R' ELSE 'X' END,
  CASE WHEN m.`advisory_explicit` = 1 THEN 'given' ELSE 'worked_out' END,
  NULL,
  CASE WHEN m.`advisory_explicit` = 1 THEN '{"system":"explicit","value":"true"}' ELSE NULL END,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `media_items` m
WHERE m.`deleted_at` IS NULL AND (m.`advisory_explicit` = 1 OR m.`band_ok` = 'adult')
  AND NOT EXISTS (SELECT 1 FROM `content_ratings` c WHERE c.`subject_kind` = 'media_item' AND c.`subject_id` = m.`id`);
--> statement-breakpoint
INSERT INTO `content_ratings` (`subject_kind`, `subject_id`, `fingerprint`, `rater`, `rater_version`, `level`, `source`, `reasons`, `label`, `rated_at`)
SELECT 'creation', t.`id`, t.`made_audience` || ':' || t.`updated_at`, 'audience-mark', 1,
  CASE t.`made_audience` WHEN 'adult-only' THEN 'X' ELSE 'G' END, 'given', NULL,
  '{"system":"audience","value":"' || t.`made_audience` || '"}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `creations` t
WHERE t.`made_audience` IN ('adult-only', 'all-ages')
  AND NOT EXISTS (SELECT 1 FROM `content_ratings` c WHERE c.`subject_kind` = 'creation' AND c.`subject_id` = t.`id`);
--> statement-breakpoint
INSERT INTO `content_ratings` (`subject_kind`, `subject_id`, `fingerprint`, `rater`, `rater_version`, `level`, `source`, `reasons`, `label`, `rated_at`)
SELECT 'attachment', a.`id`, a.`sha256`, 'audience-mark', 1,
  CASE a.`aud` WHEN 'adult-only' THEN 'X' ELSE 'G' END, 'given', NULL,
  '{"system":"audience","value":"' || a.`aud` || '"}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM (
  SELECT t.`id` AS `id`, t.`sha256` AS `sha256`,
    CASE WHEN instr(t.`provenance`, ':') > 0
      AND substr(t.`provenance`, 1, instr(t.`provenance`, ':') - 1) IN ('picture-gen', 'video-gen', 'video-edit', 'video-poster', 'image-edit')
      AND json_valid(substr(t.`provenance`, instr(t.`provenance`, ':') + 1))
      THEN json_extract(substr(t.`provenance`, instr(t.`provenance`, ':') + 1), '$.audience') END AS `aud`
  FROM `attachments` t WHERE t.`deleted_at` IS NULL
) a
WHERE a.`aud` IN ('adult-only', 'all-ages')
  AND NOT EXISTS (SELECT 1 FROM `content_ratings` c WHERE c.`subject_kind` = 'attachment' AND c.`subject_id` = a.`id`);
