-- MUSIC-ID-01: library song fingerprints for the local side of song identification.
CREATE TABLE `music_fingerprints` (
	`item_id` text PRIMARY KEY NOT NULL,
	`fingerprint` text NOT NULL,
	`file_key` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
