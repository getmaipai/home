CREATE TABLE `music_artist_profiles` (
	`musicbrainz_artist_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`wikidata_id` text,
	`bio` text,
	`bio_url` text,
	`photo_file` text,
	`photo_mime` text,
	`photo_credit` text,
	`checked_at` text NOT NULL,
	`hlc` text NOT NULL,
	`provenance` text NOT NULL
);
