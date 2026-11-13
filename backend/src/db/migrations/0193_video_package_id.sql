-- VIDEO-RENAME-01: move persisted package references to the renamed package.
-- For package_status, keep an already-installed video row if both ids exist.
DELETE FROM package_status WHERE package_id = 'videos' AND EXISTS (
  SELECT 1 FROM package_status AS video WHERE video.package_id = 'video'
);
--> statement-breakpoint
UPDATE package_status SET package_id = 'video' WHERE package_id = 'videos';
--> statement-breakpoint
UPDATE package_installs SET package_id = 'video' WHERE package_id = 'videos';
--> statement-breakpoint
UPDATE feeds SET package_id = 'video' WHERE package_id = 'videos';
--> statement-breakpoint
UPDATE scheduled_jobs SET package_id = 'video' WHERE package_id = 'videos';
--> statement-breakpoint
UPDATE routing_embeddings SET package_id = 'video' WHERE package_id = 'videos';
--> statement-breakpoint
UPDATE conversation_turns SET plugin_id = 'video' WHERE plugin_id = 'videos';
--> statement-breakpoint
UPDATE notification_deliveries SET type_id = 'video.clip_ready' WHERE type_id = 'videos.clip_ready';
--> statement-breakpoint
UPDATE notification_holds SET type_id = 'video.clip_ready' WHERE type_id = 'videos.clip_ready';
--> statement-breakpoint
UPDATE settings_values
SET value = replace(value, '"/apps/videos"', '"/apps/video"')
WHERE key = 'ui.pinned_apps' AND value LIKE '%"/apps/videos"%';
