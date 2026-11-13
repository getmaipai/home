-- AUDIO-RENAME-01: move persisted package references to the renamed package.
-- For package_status, keep an already-installed audio row if both ids exist.
DELETE FROM package_status WHERE package_id = 'music' AND EXISTS (
  SELECT 1 FROM package_status AS audio WHERE audio.package_id = 'audio'
);
--> statement-breakpoint
UPDATE package_status SET package_id = 'audio' WHERE package_id = 'music';
--> statement-breakpoint
UPDATE package_installs SET package_id = 'audio' WHERE package_id = 'music';
--> statement-breakpoint
UPDATE feeds SET package_id = 'audio' WHERE package_id = 'music';
--> statement-breakpoint
UPDATE scheduled_jobs SET package_id = 'audio' WHERE package_id = 'music';
--> statement-breakpoint
UPDATE routing_embeddings SET package_id = 'audio' WHERE package_id = 'music';
--> statement-breakpoint
UPDATE conversation_turns SET plugin_id = 'audio' WHERE plugin_id = 'music';
