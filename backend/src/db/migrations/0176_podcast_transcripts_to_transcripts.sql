-- CAPTION-01h: a podcast episode's transcript now lives in the shared Transcript record (transcripts and transcript_revisions),
-- keyed by the episode's media item id. This copies every stored podcast transcript across. podcast_transcripts rows stay in
-- place and keep the summary, takeaways, publisher address and Stack job; its text and segments columns are no longer read.
-- Idempotent: an episode that already has a transcript is skipped, and a transcript that already has a revision gets no second one.
-- A segment's end is the next segment's start, or its own start plus 5 seconds for the last one. A row with text but no timed
-- segments becomes one segment at 0 seconds.
INSERT INTO `transcripts` (`id`, `library_item_id`, `owner_id`, `language`, `current_revision`, `segments`, `speakers`, `vocabulary`, `provenance`, `hlc`)
SELECT
  'transcript-' || lower(hex(randomblob(5))),
  pt.`item_id`,
  src.`owner_person_id`,
  'und',
  1,
  CASE
    WHEN json_valid(pt.`segments`) AND json_type(pt.`segments`) = 'array' AND json_array_length(pt.`segments`) > 0 THEN (
      SELECT json_group_array(json_object('id', 'seg-' || (t.`n` + 1), 'start', t.`s`, 'end', t.`e`, 'text', t.`x`))
      FROM (
        SELECT
          row_number() OVER (ORDER BY CAST(j.`key` AS INTEGER)) - 1 AS `n`,
          CAST(coalesce(json_extract(j.`value`, '$.start_s'), 0) AS REAL) AS `s`,
          CASE
            WHEN lead(CAST(coalesce(json_extract(j.`value`, '$.start_s'), 0) AS REAL)) OVER (ORDER BY CAST(j.`key` AS INTEGER)) >
                 CAST(coalesce(json_extract(j.`value`, '$.start_s'), 0) AS REAL)
            THEN lead(CAST(coalesce(json_extract(j.`value`, '$.start_s'), 0) AS REAL)) OVER (ORDER BY CAST(j.`key` AS INTEGER))
            ELSE CAST(coalesce(json_extract(j.`value`, '$.start_s'), 0) AS REAL) + 5
          END AS `e`,
          coalesce(json_extract(j.`value`, '$.text'), '') AS `x`
        FROM json_each(pt.`segments`) AS j
        ORDER BY CAST(j.`key` AS INTEGER)
      ) AS t
    )
    ELSE json_array(json_object('id', 'seg-1', 'start', 0, 'end', 5, 'text', pt.`text`))
  END,
  '[]',
  '[]',
  json_object('engine', 'podcast-import', 'model_id', CASE WHEN pt.`source` = 'stack' THEN 'stack' ELSE 'publisher' END,
              'source_kind', CASE WHEN pt.`source` = 'stack' THEN 'generated' ELSE 'imported' END),
  pt.`hlc`
FROM `podcast_transcripts` AS pt
JOIN `media_items` AS mi ON mi.`id` = pt.`item_id`
JOIN `media_sources` AS src ON src.`id` = mi.`source_id`
WHERE pt.`text` IS NOT NULL
  AND src.`owner_person_id` IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM `transcripts` AS existing WHERE existing.`library_item_id` = pt.`item_id`);
--> statement-breakpoint
INSERT INTO `transcript_revisions` (`id`, `transcript_id`, `n`, `author`, `reason`, `ops`, `provenance`, `hlc`)
SELECT
  'trev-' || lower(hex(randomblob(5))),
  tr.`id`,
  1,
  tr.`owner_id`,
  CASE WHEN json_extract(tr.`provenance`, '$.source_kind') = 'generated' THEN 'transcription' ELSE 'import' END,
  json_array(json_object('kind', 'replace_range', 'start', 0, 'end', 9007199254740991, 'segments', json(tr.`segments`), 'speakers', json('[]'))),
  tr.`provenance`,
  tr.`hlc`
FROM `transcripts` AS tr
WHERE json_extract(tr.`provenance`, '$.engine') = 'podcast-import'
  AND NOT EXISTS (SELECT 1 FROM `transcript_revisions` AS rev WHERE rev.`transcript_id` = tr.`id`);
