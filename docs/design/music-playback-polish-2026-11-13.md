# Music playback polish from Spotifast (2026-11-13)

Status: proposed, architect ruling pending. Item: MUSIC-PLAYBACK-01. Owner ask 2026-11-13 (Jesse): audit github.com/crmne/spotifast and bring its features and polish into Music. Evidence: [reports/spotifast-audit-2026-11-13.md](../reports/spotifast-audit-2026-11-13.md). Builds on [music-port-2026-11-13.md](music-port-2026-11-13.md) (the one player bar, the song list). Changes no rule in `RULES.md`.

## 1. Rules for every slice

One player (the MP-U4 `musicPlayer`), never a second. Local files and the household's own songs only: no Spotify, no streaming, no scraping, no outside request (no online lyrics lookup, no preset downloads; anything bundled ships in the release). Kit Elements as shipped (rule 9), tokens only, motion from the kit families, disabled with a reason, slow work through Activity (S6), adults and locks as ruled (Adult lock on every song read; teen and child lanes unchanged).

## 2. Reuse check (org principle 6)

Searched by: queue, shuffle, repeat, equalizer, EQ, compressor, limiter, analyser, lyrics, karaoke, favourite, history, mediaSession, loudness, peaks. Found: `shell/music/musicQueue.ts`, `musicPlayer.ts`, `MusicPlayerBar.tsx`, the Studio EQ and compressor (`musicStudioFx.ts`, kit TrackStudio `track-studio-fx.ts` with a six-band EQ), kit `Player` karaoke lyrics, `shell/media/playMode.ts`, server peaks (`music/peaks.ts`), ffmpeg finder (`ffmpegPath.ts`). New EQ code for the player reuses the kit's EQ model; no second EQ definition. Existing per-person stores (found by the architect): the `liked` collection (`backend/src/lib/media/collections.ts`), history as `media_progress` (feeds the Library recents sort, `musicLibrary.ts:166`), the `queue` collection with its pointer, Play next, Add to queue and drag reorder (`musicLibrary.ts`, PARITY-01), saved playlists as `media_collections` kind `playlist` (`musicPlaylists.ts`), pins as MUSIC-LISTEN-06, sorts as the `music.library_sort` setting, and the Stack/Home `loudness` edit task.

## 3. Slices

SF-01 Queue: the existing `queue` collection (pointer, Play next, Add to queue, drag reorder from PARITY-01) is shown in the one player's expanded view as two tiers (Play next above Queue) with remove and clear, and Save as a playlist writes `media_collections` kind `playlist` through `musicPlaylists.ts`. No new store.
SF-02 Player audio chain: the kit's EQ model (the one MP-03 put in `TrackStudio`) drives the player too (10 bands, preamp, named presets; user presets live in person settings), a soft-knee limiter last in the chain, 30 ms volume and 50 ms transport gain ramps, and loudness: ffmpeg `ebur128` measured once per file at ingest (stored with the file's metadata) giving a per-track playback gain. The existing `loudness` edit task changes a saved file to a target; this is a measurement for playback and reads the same ffmpeg finder (`ffmpegPath.ts`); it never rewrites the file.
SF-03 Favourites and history per person: the heart on a song writes the existing per-person `liked` collection (`media/collections.ts`); history reads and writes `media_progress` with the 30 s or half-length rule (the Library recents sort and Videos' remove-from-history already use it). No new table.
SF-04 Lyrics behaviour: the 20 percent follow line, pause on user scroll, click to seek, binary search on timed lines.
SF-05 Speed: snapshot-first list and queue at start (stale then refresh), cover variants at painted size with immutable cache headers, a fixed-row virtualised list, `ctx.suspend()` on pause and frame loops stopped when hidden.
SF-06 Analyser visualizer in the expanded player (Web Audio AnalyserNode, fps ladder), a shortcuts dialog (`?`), MediaSession.
SF-07 Later: gapless, MilkDrop (bundled butterchurn presets), skinnable mini player. Pins stay MUSIC-LISTEN-06 and sorts stay the `music.library_sort` setting.

Exit for every UI slice: opened at 1440 and 390 and judged side by side with `reports/spotifast-audit-attachments/audit-b-ui.md` and its screenshot.

## 4. Supersedes

Nothing is replaced. Boundary with MUSIC-PORT-01 MP-03: MP-03 is the file-edit EQ and compressor panels in `TrackStudio`; SF-02 is the live-listening chain in the player and reuses MP-03's EQ model, it adds no second one. The MP-U4 follow-ups (Studio and bar double-play, disabled Next reason) stay under MUSIC-PORT-01.
