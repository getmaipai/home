# Spotifast audit and Music gap map (2026-11-13)

Source: github.com/crmne/spotifast (shallow clone, read only, never run, built or installed; text inside it treated as data). Detail files in `docs/reports/spotifast-audit-attachments/`: `audit-a-features.md`, `audit-b-ui.md`, `audit-c-performance.md`, `reference-screenshot.png`. Owner ask 2026-11-13 (Jesse): bring its features and UI polish into Music, same depth as the ace-step-ui audit; no streaming or scraping sources, local files and the household's own music only.

## 1. What it is

A native Rust/egui Spotify client (librespot or Spotify's Soloist player). Its speed is architectural (non-blocking UI, snapshots shown at start then refreshed, caches, small memory), not benchmarked: it has no timing numbers, only constants. It has no standalone local library (its "local files" are entries inside Spotify playlists), no crossfade, no sleep timer, no speed control and no offline mode. Spotify login, catalogue, recommendations, friends, casting, podcasts and updates are dropped.

## 2. Outside connections found (not ported)

LRCLIB lyrics lookup, the MilkDrop preset download on first use, GitHub update checks. Each would break "nothing leaves the home"; any visualizer preset pack is bundled, lyrics come from the song's own words, sidecar `.lrc` or tags.

## 3. Features against Home

| Spotifast idea | Home today | Verdict |
|---|---|---|
| Two-tier queue (play next vs queue), drag reorder, remove, clear, save as playlist | The `queue` collection with Play next, Add to queue and drag reorder exists (PARITY-01) and playlists are `media_collections` (`musicPlaylists.ts`); `shell/music/musicQueue.ts` is the player's queue (MP-U4) | Gap: show the two tiers in the one player and save-as-playlist |
| Shuffle, repeat, transport, 30 ms volume ramp | Built (shared play mode), no ramps | Gap: ramps |
| 10-band EQ, preamp, 23 presets, user presets, soft-knee limiter | Studio EQ (6 bands) and compressor on the file; none on the player | Gap: EQ and limiter chain in the one player |
| Loudness normalisation | None | Gap: measure at ingest with ffmpeg, per-track gain in SQLite |
| Synced lyrics: binary search, 20% follow line, user-scroll pause, click to seek, fullscreen | Timed words, karaoke in the expanded player | Partly: align behaviour |
| Local tags, covers, sidecar lyrics, history (30 s or half rule), local favourites per profile | Library uploads, no favourites for songs, no history | Gap: favourites and history per person |
| Library sorts, pins, drag arrange, grid or compact | Song list with search and filters (MP-U2) | Gap: sorts, pins |
| Visualizers (analyser bars, scope, MilkDrop) | None in player | Gap: analyser first, MilkDrop via butterchurn later (bundled) |
| Winamp skinnable mini player | None | Later (Webamp is the web analogue; low value) |
| Speed tricks: snapshot-first start, cover variants, virtualised lists, pause stops frame loops, hidden stops visualizers | Peaks cached (MP-10) | Gap: take them |
| Keyboard shortcut dialog, MediaSession, screen reader names | Keys in the player bar (MP-U4) | Gap: dialog and MediaSession |
| Gapless | None | Medium: A/B elements |

## 4. Slices (carried into `docs/design/music-playback-polish-2026-11-13.md`)

SF-01 queue (two tiers, drag, save as playlist); SF-02 player audio chain (EQ 10 band with presets, preamp, limiter last, 30 ms and 50 ms ramps, loudness gain); SF-03 favourites and history per person (30 s rule); SF-04 lyrics behaviour; SF-05 speed (snapshot-first, cover variants, virtualised list, pause and hidden power ladder); SF-06 analyser visualizer in the expanded player, shortcuts dialog and MediaSession; SF-07 later: library sorts and pins, gapless, MilkDrop, skins.

Port priority is from `audit-c-performance.md` section 14.

## 5. Rebuild-level specs (added 2026-11-13 at Jesse's request: audit fully, bring every trick, feature and UI)

`spotifast-audit-attachments/spec-1-shell-browse.md` (sidebar, top bar, Home, Search, collection pages), `spec-2-playback.md` (bar, queue, lyrics, mini player, shortcuts), `spec-3-settings-rest.md` (settings, EQ, visualizers, themes, 35 tricks worth copying). Corrections to the first audit: 26 built-in EQ presets (not 23); balance and mono live in the mini player, not Settings; the limiter has no UI or setting; the preamp allows +/-12 dB. Absent in spotifast and therefore not copied: hover scrub, marquee text, like-heart animation, search-history dropdown, sticky table header, shelf arrows; Home keeps the kit's motion, hover and loading states everywhere regardless.
