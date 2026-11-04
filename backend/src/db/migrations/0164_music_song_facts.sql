CREATE TABLE `music_song_facts` (
	`musicbrainz_recording_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`summary` text,
	`page_url` text,
	`fetched_at` text NOT NULL,
	`hlc` text NOT NULL
);
