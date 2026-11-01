CREATE TABLE `music_album_covers` (
	`musicbrainz_release_group_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`file` text,
	`mime` text,
	`checked_at` text NOT NULL,
	`hlc` text NOT NULL,
	`provenance` text NOT NULL
);
