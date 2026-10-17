# Media apps blend: what the two source projects actually have (2026-10-17)

Companion to [media-apps-blend-2026-10-17.md](media-apps-blend-2026-10-17.md). This file is the evidence: a read of both
codebases on 2026-10-17, facts only, so the verdicts in the main note can be checked against something. Paths are relative to each
repo's root. Both repos were read from fresh shallow clones of their GitHub `main`; nothing was changed in either.

Loki Doki (`JesseWebDotCom/loki-doki`, archived; its last commit says the project continues at `getmaipai/home`) is pre-rebuild
code: copy hard-won logic only, never feature scope (org rule 8). FileTube (`dtammam/filetube`, MIT, version 1.391.0, "a
self-hosted media server with switchable retro looks") is a coworker's live project that he will merge into Home himself, so its
inventory is the merge map, not a review queue.

## Supersedes

Nothing. Evidence only; the decisions are in the main note.

## 1. Loki Doki

Stack: Bun, Hono, Drizzle on SQLite (`backend/src/db/schema.ts`, 4,492 lines); React 18, Vite, Tailwind 4, Radix, react-router 6,
TanStack Query. Five media surfaces, four of them with a Netflix-shaped home (billboard hero, horizontal shelves, true-black
cinema shell, a left rail per app, a breadcrumb search box). Per-app accent: Videos cyan (emerald when offline), Music orange
(amber when offline), Movies violet, Shows sky.

### 1.1 Videos hub (YouTube, Reddit, TikTok, Vimeo, pasted links, "Mine")

- Routes `/videos/*`: index, search, subscriptions, history, playlists, watch-later, liked, offline, family-picks, recap, clip,
  mine, create, settings, per-source browse, `:source/watch/:id`, `youtube/*`, `youtube/shorts/:id`. Pages in
  `frontend/src/pages/videos/` (`WatchPage.tsx` is 1,964 lines) and `frontend/src/pages/youtube/`.
- Home screen: `VideoBillboard.tsx` (up to six slides, scroll-snap, auto-rotates, pauses on hover, hidden tab and reduced motion,
  accent colour pulled from the thumbnail), source pills, category chips, a Continue watching shelf, followed-creator uploads,
  popular and trending rows, a card / list / large toggle, silent hover previews. In a kid's approved-only mode the discovery chips
  and suggestion rows are hidden.
- Player (`components/youtube/VideoPlayer.tsx`, 1,279 lines): native `<video>` through the server's privacy proxy, YouTube IFrame as
  fallback. Quality auto/720/360 progressive, 1080 to 2160 by ffmpeg remux. Speed 0.25 to 2, sleep timer, subtitles with
  translation, PiP, volume boost to 4x, zoom to fill, storyboard scrubber previews, SponsorBlock chips, ambient glow. Touch:
  double-tap plus or minus 10 s, hold for 2x (`hooks/use-video-gestures.ts`). Autoplay countdown, Up next column, docked
  mini-player with queue, live DVR and recording. No keyboard shortcuts found in the player.
- Sources behind one provider interface (`backend/src/lib/videos/{provider,registry}.ts`, `providers/*`), each declaring
  capabilities (browse, search, creators, comments, live, playlists, related, transcript, downloadKinds). YouTube by InnerTube with
  no key (`youtube/innertube.ts`); popular and trending from Invidious or Piped; streams resolved by yt-dlp and proxied
  (`youtube/stream.ts`); yt-dlp binary managed and self-updating (`lib/ytdlp.ts`); SponsorBlock, DeArrow, Return YouTube Dislike;
  TV-client device-code sign-in to link a Google account (`tvClient.ts`, `accountSync.ts`).
- HLS for Apple TV: byte-range VOD HLS over the DASH files with no transcode (`youtube/hls.ts`); 1440p and 4K decoded from VP9 or
  AV1 and re-encoded to HEVC fMP4 (`hlsTranscode.ts`), the Apple TV 4K first generation (A10X, HEVC only) named as the target.
- Offline: durable `download_jobs` queue (yt-dlp or an ffmpeg HLS remux); bytes stored once in a content-addressed blob store
  (`blobs` keyed by hash, `media_assets` per source and kind) and referenced per person; the stored copy is the highest quality
  anyone asked for. Per subscription `autoSave`, `autoSaveKind`, `autoSaveKeep` (latest N), `removeWatched` (`offlineSweep.ts`).
  Admin quality ceiling combined with the person's preference (`quality.ts`). Optional background HEVC re-encode. An online or
  offline toggle in the app's layout. Export to per-person Plex libraries as NFO, poster and SRT with SponsorBlock segments cut.
- Trickplay sprite sheets by ffmpeg keyframes (`videos/trickplay.ts`).

### 1.2 Movies and Shows (discovery apps, playback through Plex)

- Routes `/movies/*` (in-theaters, new, top-rated, genres, family, watchlist, `:ref`) and `/shows/*` (on-tv, calendar, top-rated,
  genres, family, continue, watchlist, `:id`). Components in `frontend/src/components/media/` (MediaBillboard, MediaRail, TitleCard,
  DetailHero, Backdrop, EpisodeList, PlexPlayer, PlexNowPlaying, WatchlistButton, Showtimes).
- No local film or show scan and no TMDB client. Shows from TVMaze (no key), films from JustWatch keyed by title and year, showtimes
  from Fandango; trailers, Wikipedia overview, parents guide, backdrop by image search and LLM-written reviews in `lib/titles/`.
- `PlexPlayer.tsx`: full-screen `<video>` over a Range-aware `/api/plex/stream/:ratingKey` proxy (the token never reaches the
  browser), cross-device resume through `media_progress`, skip intro and credits from the file's chapters, trickplay, Esc closes,
  arrows seek 10 s. Requests through Overseerr or Radarr and Sonarr; watchlist and watched state sync both ways with Plex.

### 1.3 MaiPai TV (linear channels) and the TV mode

- `/channels` and `/channels/watch/:slug`: a seeded deterministic scheduler (`lib/tv/scheduler.ts`) over Plex, YouTube, podcasts,
  radio and Frigate cameras; channel up and down, number entry, a guide overlay; IPTV out as M3U plus XMLTV and chained-ffmpeg
  MPEG-TS at 720p30, three sessions at most. `plans/maipai-tv.md` lists kid gating of the channel list as still open.
- `/tv` (`TvPage.tsx`): a D-pad focus ring with resume, subscriptions and shuffle rows; `/tv/signin`: Quick Connect (a code on the
  screen approved from a phone); `/display`: an ambient kiosk screen.

### 1.4 Music

- Routes `/music/*`: stations, `station/:id`, `watch/:id`, browse, live, now-playing, artist and album by MusicBrainz id, library,
  replay, stats, import, playlists, generate, remix, studio, karaoke.
- One track reference format (`lib/music/trackRef.ts`): a YouTube id, `local:<id>`, `plex:<machine>:<ratingKey>`;
  `resolveSource.ts` prefers the person's own local or Plex copy and falls back to YouTube audio through the same stream proxy.
- Local library (`localLibrary.ts`): admin-chosen folders scanned with `music-metadata` (ID3, Vorbis, MP4 tags), incremental on
  size and mtime, MusicBrainz ids and `ITUNESADVISORY` read, embedded or folder art, ALAC/WMA/APE/DSD flagged as not browser
  playable, uploads supported. Plex music copied into a local index every six hours. Catalog browsing by MusicBrainz and the Cover
  Art Archive, candidates from Deezer charts, lyrics from LRCLIB, internet radio by radio-browser with timed recordings, scrobbling to
  ListenBrainz only. No Lidarr, Navidrome or Subsonic.
- Stations (`stationEngine.ts`): an LLM proposes a tracklist from a prompt, YouTube Music radio from a seed, an AI DJ speaks between
  tracks (Kokoro TTS).
- Player (`frontend/src/lib/music/radioEngine.ts`, 1,483 lines): two `<audio>` decks crossfaded by loudness, beat-matched AutoMix,
  prefetch for gapless play, shuffle (off, random, no-repeat), repeat one, sleep timer, editable Up next, a 10-band EQ per device,
  waveform seek bar and loudness from ffmpeg, lock-screen controls (`lib/mediaSession.ts`), `mediaCoordinator.ts` so one app plays at
  a time.
- Offline: saving a station freezes its queue and downloads each track plus the DJ segments (`music_offline_*`); single songs download;
  auto-cache keeps the top-N played and favourite tracks (`autocache.ts`).

### 1.5 Podcasts

- Routes `/podcasts/*`: Listen Now, browse, preview, library, filters, bookmarks, replay, snips, search, `episode/:id`, offline,
  `show/:id`, settings, admin.
- One feed row per show shared by the household, membership per person (`lib/podcast/feeds.ts`); the poller uses conditional GET;
  a dependency-free regex RSS parser (`rss.ts`) reads `itunes:*`, explicit, and Podcasting 2.0 person, funding, soundbite, chapters
  and transcript tags; directory search by iTunes Search with PodcastIndex optional.
- Episodes stored as shared files in the same blob store; per subscription `autoDownload` and `autoDownloadKeep` (default 3);
  auto-downloads pruned, manual ones never.
- Playback position in `podcast_watch_state` and `media_progress`; per-show speed, skip intro and outro seconds, trim silence, voice
  boost, skip ads; a server-held Up next; bookmarks, chapters, Whisper transcripts; ad detection and fingerprinting; clips ("snips");
  smart filters. OPML import and export, a gPodder-compatible sync API with a per-person app password, tokenized private RSS out.
  AI-generated shows in the same tables.

### 1.6 Data model (the parts worth carrying)

- `media_progress`: id, userId, assetType (video, youtube, podcast, music), assetId, positionSec, durationSec, completed,
  updatedAt; unique per person and asset. Per person, not per device.
- `blobs`: hash, relPath, sizeBytes, mime, status (staging, live), storageLocationId. `media_assets`: sourceType, sourceId, kind
  (audio, video, ebook, cover), format, height, blobHash, status. `download_jobs`: type, refId, domain, priority, status, attempts,
  progress JSON.
- Videos: `yt_subscriptions` (autoSave, autoSaveKind, autoSaveKeep, removeWatched, autoTranscribe, source local or google),
  `yt_videos`, `yt_downloads` (per person, maxHeight, assetId, auto, prefetch, origin), `yt_watch_state`, `yt_collections`
  (watch-later, liked), `yt_playlists`; the other sources mirror these as `video_follows`, `video_items`, `video_watch_state`,
  `video_saves`. `video_watch_time` (userId, day, seconds) and `video_allowlist` for kids. `video_moments`, `video_votes`,
  `video_embeddings`, `video_transcripts`, the Plex export tables.
- Music: `music_local_folders`, `music_local_tracks` (title, artist, albumArtist, album, trackNo, discNo, year, genre, codec, bitrate,
  sampleRate, bitDepth, browserPlayable, hasEmbeddedArt, folderArtPath, mbid, advisory, normTitle, normArtist), `music_playlists`
  (kind manual, magic, smart, blend; visibility; rulesJson), `music_favorites` (song, station, playlist, artist, album),
  `music_history`, `music_stations`, offline station tables, radio tables, `music_track_audio` (lufs, waveform), ratings, advisory.
- Podcasts: `podcast_shows` (feedUrl, artworkUrl, feedEtag, explicit, personsJson), `podcast_episodes` (guid, enclosureUrl,
  enclosureType, durationSec, chaptersJson, chaptersUrl, transcriptUrl, assetId, explicit), `podcast_subscriptions`,
  `podcast_downloads`, `podcast_watch_state`, `podcast_show_settings`, `podcast_queue`, `podcast_bookmarks`, filters, gPodder tables,
  transcripts and ad tables.
- Profiles and kids: `users` (birthdate, role), `profile_pins`; `content_profiles` with eight dials plus per-app JSON and a
  `kidSafeMedia` switch; tiers kid, teen, open (`lib/media/policyTier.ts`): a kid gets only what is verified clean and YouTube
  Restricted Mode; an LLM topic classifier cached in `media_classification`; videos filtered by platform adult flags plus the
  classifier, podcasts by `itunes:explicit` plus the classifier, music by advisory flags with optional title masking; a daily minutes
  cap and allowed-hours window metered from player position updates (`videos/watchTime.ts`); allowlist-only mode.

### 1.7 Other mechanisms

- Chromecast by mDNS with a short-lived token proxy (`lib/cast/*`); the Videos "cast" button hands the current position to another
  signed-in screen, not Chromecast. No AirPlay. Watch Together over SSE in memory; Listening Together remote commands; Family Jam
  shared queue. `useMediaProgress` writes about every 10 s with keepalive; no live push of position between devices.
- Transcoding: ffprobe compatibility checks, cached H.264 and AAC jobs, a live fMP4 pipe capped at two (`lib/mediacompat/*`); HEVC
  by VideoToolbox or NVENC with libx265 fallback (`media/encoder.ts`).
- Look: `frontend/src/index.css` (968 lines), OKLCH light and dark by `[data-theme]`, brand hue 288, radius 0.75 rem (card 1.5 rem,
  sheet 2 rem), Inter Variable, a design-contract lint (`scripts/check-design-contract.mjs`). Mobile breakpoint 768.
- Service worker (`public/sw.js`) caches pages as visited, no precache; handles Web Push.
- Libraries: hls.js, `@soundtouchjs/audio-worklet` (tempo), `idb-keyval`, `@dnd-kit`, `motion`; backend `music-metadata`,
  `metadata-filter`, `sharp`, `kokoro-js`, `drizzle-orm`, `ws`, `obscenity`; binaries ffmpeg, ffprobe, yt-dlp, Whisper.
- Docs the project itself flagged as stale or unproven: `docs/.../dev/subsystems/music.md` describes only the MIDI generator;
  `plex.md` says "not yet verified against a live Plex server". YouTube walled the hub's home IP on 2026-08-28 after the server's
  own background fan-out (the origin of `THIRD-PARTY-SERVICES.md`).

## 2. FileTube

Stack: Node 22 with Express, one process, one SQLite file (`node:sqlite`, `SCHEMA_VERSION = 37`, append-only migrations that are
also rollback floors). `server.js` (7,851 lines) is being split into `lib/` (about 140 modules, 68k lines). Frontend is vanilla
multi-page HTML with a SPA-lite router swapping `#view-root`; no framework; vendored epub.js, jszip and pdf.js; a push-only service
worker. About 7,000 `node:test` unit and integration tests, no end-to-end suite. Runtime dependencies: `express`, `dotenv`,
`mime-types` only. Binaries: ffmpeg and ffprobe; yt-dlp is installed from PyPI into a venv at runtime (`lib/ytdlp/engine.js`).

### 2.1 Media kinds and how each gets in

| Kind | Ingest | Metadata | Notes |
|---|---|---|---|
| Video (`media_items`, id = md5 of the path) | Folder roots (`library_folders`) scanned every 30 min by `lib/scan/orchestrator.js`; yt-dlp subscriptions and one-shot URL downloads into a synthetic root | ffprobe: duration, codecs, dimensions, tags, chapters, spherical projection, embedded date and source URL; ffmpeg thumbnails, storyboard sprites, hover preview clips; identity from the `[id]` filename bracket or embedded purl (`identity.js`) | On-demand transcode to H.264 and AAC `+faststart` when the container or codec is outside the allowlist; `.m4a` audio sidecar for background audio on iOS; VR 180 and 360 projection |
| TV (`tv_episodes`) | Folder roots laid out `Show/Season N/Show SxxEyy - Title.ext`, optional `poster.jpg` | Parsed from the file name (`lib/tv/parse.js`); seasons derived | Own scan runner, continue row, played latch |
| Music (`music_tracks`) | Folder roots; yt-dlp audio items projected as tracks; chapter rows `<id>::c<n>` | Tags: title, artist, album, albumArtist, trackNo, discNo, year, genre, codec, embedded art; albums and artists are derived, not tables | Radio seeded from a track, artist, album, genre or station with similarity tiers over the person's own tags; station kinds favorites, deep cuts, decade, recent, genre, style, custom; no playlist tables ("Playlists" are pins) |
| Podcasts (`podcasts_subscriptions`, `podcasts_episodes`) | RSS subscriptions polled on `pollMinutes` with 15 min to 6 h backoff; per-subscription backfill all, new or latest N; the full feed URL kept in a 0600 file outside the database and backups | Episode: guid, title, description, link, pubDateMs, durationSec, enclosureBytes, status (pending, downloaded, failed, skipped, deleted-on-disk, trashed, tombstone) | Every episode is downloaded to disk before it can play; trash then a tombstone after `trashRetentionDays` ("deleted stays gone") |
| Books (`books_items`) | Folder roots; `.epub` and `.pdf` only | OPF title and author, spine, cover; PDF page count backfilled by the client | epub.js paginated reader with CFI locators, pdf.js with page locators; paper, sepia and night themes; TTS "Listen from here" by espeak-ng (Piper opt-in) synthesized per chapter into an m4a cache (`books_audio`) |
| Audiobooks | **Not supported.** No m4b, no chapters-as-audio, no series. The one mention is a comment, "export as audiobook", in `lib/books/tts-engine.js:81` | | |

No media upload exists (uploads are avatars, stickers, logos, critters and a book cover). Video, music, books, TV and podcast roots
must not overlap. Folder settings per root: name, hidden, hiddenFromSidebar, glyph, order; a folder is a video "channel".

### 2.2 Per-person state (every table keyed by `user_id`, cascading on delete)

`user_progress` (media_id, timestamp, duration, updated_at), `user_watched` latch, `user_liked`, `user_watch_later` (ordered),
`user_queue` (entry_uid, media_id, entry_order, entry_kind media, podcast or track) with `user_queue_state` (pointer),
`user_music_liked`, `user_music_progress`, `user_music_state` (last track, queue context, position), `user_music_plays` (plays,
skips, finishes), `user_music_stations`, `user_podcast_progress`, `_played`, `_liked`, `_pins`, `user_tv_progress`, `_played`,
`_liked`, `user_book_progress` (locator `{kind, cfi or page, spineIndex, blockIndex}` plus percent), `user_book_liked`,
`_finished`, `_pins`, `user_channel_pins`, `user_restrictions` (kind path, folder, show, library or mode; value),
`user_search_history`, `user_feed_hidden`, `user_feed_sessions`, `user_prefs` (24-key allowlist, last-writer-wins by a client
stamp clamped to now plus five minutes), notification state, `device_tokens` (sha256 of an `ftd_` token, name, platform, epoch).

History has no table: `/api/history` is `user_progress` filtered to 0 to 98 percent. Progress latches: watched at `watchedPct`,
podcast played at 95 percent, TV played; music has no latch. Online progress pings are server-stamped and coalesced.

### 2.3 Offline

- The browser PWA caches nothing: `public/filetube-worker.js` is push-only by hard contract (a fetch handler breaks background media
  on WebKit). Offline copies exist only in the native iOS app, through four routes (`lib/offline/routes.js`, v1.387.0,
  `docs/references/offline-api.md`):
  - `GET /api/offline/manifest?kind=&id=`: kinds track, album, podcastEpisode, video, tvEpisode, tvSeason; items carry title,
    subtitle, durations, `file {url, bytes, mime, fingerprint, ready, playable, reason}`, artwork, chapters, subtitles and the
    person's progress; `fingerprint = size-mtime`.
  - `GET /api/offline/file/:kind/:id`: Range, ETag, Last-Modified, If-Range for background resume, `Cache-Control: private,
    no-store`; 409 when not playable, 503 with `Retry-After: 60` while a transcode queues; marks the file served so the cache sweep
    keeps it.
  - `POST /api/offline/status`: up to 500 `{kind, id, fingerprint}`, answers ok, changed or gone.
  - `POST /api/offline/progress`: up to 200 events `{kind, id, positionSec, durationSec, at, finished}` with `sentAt`; skew is
    corrected from `sentAt`, each stamp clamped to the server's now; **newer wins** (a rewind applies if it is newer); the online
    coalescer is flushed first and a newer buffered online ping refuses the offline event; latches mirrored; a batch more than five
    minutes in the future gets `400 restamp`.
- Playability (`lib/offline/playable.js`): original, transcode or none; mp4, m4v and mov with H.264, HEVC only when the tag is `hvc1`
  (probed lazily and cached by id and fingerprint); audio served as the original (flac, alac, ogg, opus included).
- Device tokens: paired from a signed-in session plus the password, bearer only, default-deny route allowlist
  (`lib/auth/device-scope.js`), revoked by delete, an epoch bump (password change, "Remove all devices"), disable, or 180 days unused;
  never in backups.
- The web half (`public/js/offline.js`) activates only when the native host announces a `downloads` capability; error codes
  storageFull, revoked, notOnServer, notReady, notPlayable, network; copy "Make available offline" and "Remove offline copy".
- `PRIVACY-IOS.md`: the app is a window onto the person's own server; no analytics, no third-party SDK, the pairing token in the
  Keychain, media and progress stay on the device and sync only to that server.

### 2.4 Player and mobile UI

- One persistent `#player-host` (`public/js/player.js`, 11k lines) reparented between full, docked and closed. Rates 0.25 to 2 in
  eight steps; hold 500 ms for 2x; double-tap left or right skips 15 s (chain window 800 ms); arrows 5 s; digits jump to tenths;
  pull the picture down to minimize; swipe back from the edge. Media Session API everywhere; PiP; loop; theatre; ambient glow;
  autoplay next; a handoff card. **No sleep timer, no video bookmarks.**
- Chapters resolved manual, then embedded, then description; Chapter Snap aligns chapter starts to silence with ffmpeg
  `silencedetect`. WebVTT captions; transcript export de-rolls YouTube auto-captions.
- Looks: four eras (2005, 2009, 2014, 2021) by light and dark; the Pocket music view has skins (Cider, Nordic, Original, Click
  colorways, Transparent) and decorative "critters".
- Music: Albums, Artists, Songs, Liked; shuffle and autoplay persisted; queue is the shared `user_queue`; resume; "Speakers" lets a
  phone drive a desktop (`lib/remote`, in-memory command queue over SSE).
- Books: reader themes, font size, TOC, TTS from the current block, finished as a manual latch.

### 2.5 Navigation and home

- Bottom nav: home, feed, playlists (a sheet of folder, channel, book and podcast pins), history, then podcasts, music, books and
  downloads when enabled, and theme; a desktop sidebar and header search.
- Home rows (`lib/home/feed.js`, `GET /api/home`): Continue watching (all kinds, by recency), New from subscriptions, Recently added,
  "More from X" per channel ranked by watched count, From your Liked, Watch again; optional continue-listening, continue-podcasts
  and TV rows. A Modern grid layout with chips (all, videos, audio, podcasts, continue, unwatched).
- Feed mode (`/feed`): reel-style one card at a time in 10, 20 or 30 minute sessions with extend and recap; mix weights book 30,
  video 30, podcast 20, Watch later 10, song 10 by smooth weighted round-robin, never the same kind twice; book cards are excerpts;
  intro and sponsor chapters skipped by title; progress forward-only after about a minute.
- Search (`lib/search/registry.js`, `rank.js`): one provider per library, each visibility-filtered; title and identity fields only;
  rank by tier (exact, prefix, contains, identity), then type priority, then recency.

### 2.6 Ingest from the web (yt-dlp, opt-in by `FILETUBE_YTDLP_ENABLED`)

- Subscriptions: poll every 60 min by default; per subscription maxVideos (default 2), max and min duration, skipShorts, cutoffDate,
  format audio or video, quality best to 360p, filetype, pushBell. Sleep intervals and five retries; a circuit breaker trips after
  four failures for 30 min; stall detection at 10 min; download timeout 180 min; every heavy job through one FIFO (`heavyGate.js`).
- Flags: `--embed-metadata --embed-thumbnail --embed-chapters`, `--write-subs --write-auto-subs --sub-langs en.* --convert-subs
  vtt`, `--download-archive` so a deleted item stays gone, `--cookies` only when configured and present. SponsorBlock is not used.
- One-shot: `POST /api/ytdlp/download` from a session or the `X-FileTube-Token` API token (the browser extension's path); pending
  jobs survive restarts; shortlink resolver is SSRF-guarded; playlist links wait for an in-app picker; per-video failure attribution
  and a fail log; metadata repull and relocation.

### 2.7 People and access

Roles admin and member, with per-member grants `canManageSubscriptions` and `canModifyLibrary`. Visibility
(`lib/auth/visibility.js`) is a per-person restriction list by path prefix, folder, podcast show or whole library; `mode:allowlist`
flips to default-deny, which is the "kid-safe account". There is no kid profile type, no age, no time budget, no classifier.
scrypt passwords, HMAC cookie sessions (30 days), a login rate limiter, a mutation audit log. Handoff: an in-memory presence map fed
by progress pings about every 4 s, surfaced as a "Continue here" card on another device.

### 2.8 Other pieces

- Self-implemented Web Push (VAPID, encryption, delivery) with per-device opt-in; a roadmap bug notes push is not filtered per
  person.
- Backup and restore of state only (never media, never device tokens, never the podcast feed URLs).
- Roku channel (BrightScript, sideloaded, username and password, poster grid, chapters, resume, `?compat=roku` renditions).
- Browser extension (Manifest V3): the popup posts the current tab's URL as audio or video to `POST /api/ytdlp/download` with the API
  token; a playlist picker on playlist tabs.
- Diagnostics pages, a performance run store, a cleanup-suggestions endpoint, a trash with restore and purge.
- `ROADMAP.md` (15.6k lines) lists 37 owed device checks for player gestures, YouTube comments, iOS auto-PiP, an offline UI "that looks
  like FileTube", Feed phases for news and subreddits, onboarding, streaming tiers.
