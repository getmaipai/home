-- STACK-LORAS-01 slice 6. The snapshot for this step no longer lists `loras`, `video_adapter_prefs` and `picture_adapter_prefs`, but this file drops nothing.
-- A drop here would run before Home can ask the Stack whether it holds every style, and it would keep no copy. The drop is the hub-start step
-- lib/loras/legacyDrop.ts: it refuses (and keeps the tables) unless the Stack lists every id in `loras`, archives the rows, then drops the three tables.
-- Rollback and the archive's names: docs/dev/loras-legacy-drop.md.
SELECT 1;
