# Media apps: Loki Doki's look and offline behaviour blended with FileTube (2026-10-17)

Status: design note, no code. Written overnight on Jesse's ask: Loki Doki's Netflix-like look and feel plus its online and
offline behaviour, blended with FileTube's code, features and mobile-first, offline-first design, so that FileTube's author can
join, co-code, and merge FileTube into MaiPai Home cleanly. Covers video, TV shows, music, podcasts, books and audiobooks.
Evidence (what each project really has, read from both codebases today) is in
[media-apps-blend-2026-10-17-sources.md](media-apps-blend-2026-10-17-sources.md); the verdicts here cite it.

Companion records this note builds on and does not redesign: the package `app` kind
([app-kind-2026-10-16.md](../plans/app-kind-2026-10-16.md), landed as APP-KIND-01 to 04 on spec-v0.1.153; the Weather app and
its `weather_card` Element are the pattern for every app package), household storage
([household-storage-2026-09-23.md](../plans/household-storage-2026-09-23.md): the one `file` record, shares, caps), the news shelf
poller (KS-05), image and video generation and the canvas editor ([image-generation-2026-10-17.md](image-generation-2026-10-17.md),
[video-generation-2026-10-17.md](video-generation-2026-10-17.md), [image-tools-2026-10-17.md](image-tools-2026-10-17.md): a
generated clip or track is a `file` record with `origin: made` and shows up in these apps' library shelves, nothing more), and
the kid-mode voice ([kid-mode-app-voice-2026-10-17.md](kid-mode-app-voice-2026-10-17.md): every child-facing string in these
apps follows it).

## 1. The decision in one paragraph

Media is one platform layer plus five app packages, not five apps with five stores. The layer is: four spec records
(`media-item`, `media-source`, `media-progress`, `media-collection`) plus one new `file.origin` value; one Home service
(`backend/src/lib/media/`) that owns ingest, the saved-copy store, progress and the offline protocol; one kit `Player` primitive
(a maintained web player restyled by tokens) and one shell-owned docked mini bar; and one Stack `media` service that pins and runs
ffmpeg, ffprobe and yt-dlp behind one heavy-job FIFO. The apps (Videos, Shows and Films, Music, Podcasts, Books) are catalog
`app` packages of schema pages, each emulating its native app (rule S2) in the cinema tone Loki Doki proved. Online sources are
opt-in, go through the one limiter at a person's pace, and every fetched copy lands in the household's `file` store once, owned by
the person who asked and shared by pointer. Offline is three layers: the hub's own saved copies (the household works with the
internet down), Chromium browsers' on-device copies through a scoped service-worker cache, and Go on iPhone and Apple TV carrying
FileTube's device-token offline protocol as its native half. FileTube's author lands his work as the ingest, offline and reader
slices of this layer, in Home's stack, with the same record shapes.

## 2. Why these two, and what each contributes

| | Loki Doki (archived, Jesse's) | FileTube (live, the coworker's) |
|---|---|---|
| Strength | The look: billboard hero, shelves, cinema shell, hover previews, ambient art; the online side (YouTube by yt-dlp through a privacy proxy, SponsorBlock, DeArrow, stations, podcasts with chapters and transcripts); saved copies stored once per hash and referenced per person; a kid tier with a classifier, time budgets and an allowlist | The offline side: a device-token offline protocol with fingerprints and newer-wins progress sync, playability rules, a persistent mobile player with gestures and Media Session, the home rows, Feed mode, a disciplined folder scan with prune guards, a one-FIFO heavy gate, yt-dlp subscriptions with a circuit breaker, books (EPUB, PDF, read-aloud), 7,000 tests |
| Weakness | Same stack as Home but pre-rebuild scope: five surfaces, Plex, Overseerr, IPTV, karaoke, a 4,492-line schema; the background fan-out that got the home IP walled on 2026-08-28 | A different stack (Express, vanilla pages, no framework), a monolith mid-split, no browser offline cache (push-only worker), no audiobooks, no kid profile beyond an allowlist account, Roku instead of a TV client |
| Carried into Home | Logic only (rule 8): track reference resolution "prefer my library", the blob-once rule, the quality ceiling, SponsorBlock chip handling, the kid policy tiers, the podcast RSS tag coverage, trickplay | Logic and, where the coworker ports it himself, code: the offline protocol, device scope, progress merge, playability, scan orchestration and prune guards, identity resolution, chapter snap, yt-dlp args and failure attribution, the home-row assembler, the search ranker, the reader locators and the TTS chunker |

## 3. Target architecture (how it maps onto Home)

| FileTube or Loki Doki piece | MaiPai Home home | Rule or record |
|---|---|---|
| `media_items`, `tv_episodes`, `music_tracks`, `books_items`, `podcasts_episodes`, `yt_videos` | one `media-item` record (section 7) in `hub.db`, Drizzle table `media_items` | principles 1, 3, 4 |
| `library_folders` and the per-kind roots, `yt_subscriptions`, `podcasts_subscriptions`, `video_follows` | one `media-source` record: a root folder, a feed, a channel, a pasted link | `nas_mounts` already holds roots; it becomes a `media-source` of kind `root` |
| `user_progress`, `user_*_progress`, `media_progress`, `yt_watch_state`, `podcast_watch_state` | one `media-progress` record per person and item | section 10 |
| liked, watch later, queue, pins, playlists, `music_favorites`, `podcast_queue` | one `media-collection` record with a `kind` | section 7 |
| `blobs`, `media_assets`, downloaded podcast files, yt-dlp output | the household `file` record (`attachments` table today), content-addressed by sha256, with the new origin `fetched` | household storage record; PACKAGES.md "a person's output is a household record" |
| `download_jobs`, heavyGate, transcode and faststart workers | the Stack `media` service: pinned ffmpeg, ffprobe and yt-dlp, one FIFO, jobs through the Stack job API (`stack-job` record, the PROJECT-MEDIA-01 step) | RULES 11 precedent KS-STACK-REF-01 (kiwix moved to the Stack as the `reference` service) |
| `device_tokens`, `device-scope.js`, the four `/api/offline/*` routes | Home's `devices` and `device_tokens` tables plus a default-deny scope; routes under `/api/media/offline/*` | section 9 |
| Podcast poller, `lib/podcast/feeds.ts` | the KS-05 shelf poller (feedsmith, conditional GET, per-host concurrency 1, backoff, SSRF guard); `feed` gains `kind: podcast` | principle 1 |
| `lib/auth/visibility.js` restrictions | the person's band (child, teen, adult), share pointers, and `media.allowlist_only` for a child | RULES 0 |
| `player.js`, `VideoPlayer.tsx`, `radioEngine.ts`, `PodcastPlayerBar` | one kit `Player` primitive (video, audio and reader-audio layouts) placed by each app's page; the shell owns the docked mini bar and the audio session | rule 9b, UI.md "the player bar, player hooks" |
| Home rows, Feed mode, search registry | Home page "Pick up where you left off" (media rows join it), the global Search (one provider per media kind), Feed mode as a Videos app page later | home-page-2026-10-17.md, section 12 |
| Web Push, backup and restore, diag, config CAS | NOTIFICATIONS.md, BACKUPS.md, the status app, settings `hlc` | dropped as duplicates |
| Roku channel, iOS app | Go (Apple TV and iPhone) renders the same schema pages natively and carries the native offline half; Roku is a later community package at most | principle 7 |
| Eras and skins | catalog `theme` packages, tokens only | principle 6 |

Each media app is a catalog `app` package exactly as Weather is: `contributes.pages[]` of schema pages, `contributes.data[]`
bound to the package's own routes under `/api/plugins/<id>/`, `contributes.settings_area`, keywords, `min_role`, `offline`
declared honestly, privacy rows from `data_sources`. The five packages share the platform layer through the host's record API;
none keeps a store of its own (PACKAGES.md shape check).

## 4. Feature matrix (one line each; rule 8 verdicts)

Verdicts: **keep** (build as designed in the target), **port** (carry the logic, rebuild the surface), **drop** (with the reason),
**later** (kept out of the first slices, named so it is not lost). "LD" is Loki Doki, "FT" is FileTube.

### Videos

| Feature | LD | FT | Target | Verdict |
|---|---|---|---|---|
| Billboard hero with auto-rotate, reduced-motion pause, art accent | yes | no | kit `Billboard` primitive on the app index | keep (kit gap, section 6) |
| Horizontal shelves with hover chevrons, card / list / large toggle | yes | grid chips | kit `MediaShelf` and `MediaGrid`, `CardSizeSlider` | keep |
| Continue watching, new from subscriptions, recently added, more from X, liked, watch again rows | partly | yes | the app index rows, assembled by one home-row function | port FT's assembler |
| Silent hover preview clips, storyboard scrub previews | yes | yes | `media-item.previews` built by the Stack media service | port (trickplay from LD, preview clip from FT) |
| Local folder roots scanned on an interval, prune guards, identity from `[id]` or embedded purl | music only | yes | `media-source` kind `root`, the one scan orchestrator | port FT |
| yt-dlp subscriptions (max per check, durations, shorts, cutoff, format, quality), circuit breaker, stall detection | yes | yes | `media-source` kind `channel`, polled by the Stack media service at a person's pace | port FT's runner and args, LD's quality ceiling |
| One-shot "save this link" from the composer, share sheet or extension | yes | yes | `POST /api/media/fetch` (section 8); the PWA share target; the extension later | keep |
| Browse and search YouTube live (InnerTube, Invidious, Piped), trending, related | yes | no | off by default; adults may turn on "Search the web for videos" (MEDIA-SEARCH-01 already owns the chat card) | later, opt-in only; never for a child |
| SponsorBlock, DeArrow, Return YouTube Dislike | yes | no | SponsorBlock chip skipping only, per person, off for a child's saved copies | port LD's chip logic; drop DeArrow and dislikes (two more outbound hosts for cosmetics) |
| Linked Google account by TV device code | yes | no | YOUTUBE-API-01 (owner's key, opt-in) | later |
| Reddit, TikTok, Vimeo, pasted-link providers | yes | no | one provider interface; only `link` (yt-dlp generic) ships first | later |
| Privacy proxy for live streams (bytes relayed through the hub) | yes | n/a | none: the hub plays saved copies only; an unsaved web result plays on the person's own device through the site's embed, exactly as MEDIA-SEARCH-01 rules for the chat card | drop (the live relay is what walled the home IP) |
| Player: speed 0.25 to 2, hold for 2x, double-tap skip, PiP, captions, chapters, loop, theatre, ambient glow | yes | yes | kit `Player` on Media Chrome | keep (gestures from FT: 15 s double-tap, 500 ms hold) |
| Volume boost 4x, zoom to fill, VR 180 and 360 | LD, FT | | | later (VR), drop boost and zoom (no family ask) |
| Sleep timer | yes | no | the shell audio session (section 12) | keep, universal |
| Autoplay next with a cancellable countdown, Up next | yes | yes | kit `Player` queue slot; `media-collection` kind `queue` | keep |
| Background audio on iOS by an `.m4a` sidecar | no | yes | Go owns it natively; the PWA keeps Media Session only | port to Go |
| Chapter Snap (snap chapter starts to silence) | no | yes | Stack media service job | port FT |
| Transcripts (Whisper), AI prompts on a transcript | yes | yes | the Stack `stt` role on the saved copy; the transcript is a `file` | later |
| On-demand transcode to H.264 and AAC, faststart, HEVC `hvc1` rule | yes | yes | Stack media service, FT's playability decision | port FT |
| Apple TV HLS and HEVC re-encode of 4K | yes | no | Go plays saved copies directly; HLS only if a measurement says a file cannot play | later |
| Quality ceiling (admin) combined with the person's preference | yes | no | settings `media.max_height` (household) and `media.preferred_height` (person) | keep |
| Auto-save per subscription, keep latest N, remove watched, auto-cache top played | yes | FT keeps latest N by sub | `media-source.auto` (section 8) | keep |
| Plex export as NFO, poster, SRT | yes | no | | drop (Plex is not in the target) |
| Watch Together over SSE, Family Jam, Listening Together | yes | Speakers | handoff only (section 10) | later |
| Family picks, moments, votes, recap | yes | no | | drop (no family use recorded) |
| Linear channels (MaiPai TV), IPTV out, kiosk display | yes | no | | drop; the kid bedtime "channel" is a collection on shuffle |
| Trash with restore and purge, tombstones ("deleted stays gone") | no | yes | household trash (section 12) | keep, universal |
| Duplicates report, cleanup suggestions, stats page | no | yes | Settings, Storage usage (STORE-CAP-01's page) | port the duplicate finder; drop the pages |
| Roku channel | no | yes | Go | drop |
| Eras and skins | no | yes | theme packages | later, catalog only |

> **Superseded in part 2026-10-17** by [live-video-2026-10-17.md](live-video-2026-10-17.md) (Jesse's decision: everyone browses live web video): the rows "Browse and search YouTube live" and "Linked Google account by TV device code" now follow that note (the official API with the household key, the official player on the person's device, a child within an approved list, an optional family account); InnerTube, Invidious and Piped are dropped. Any request to a live video service waits on RULES.md V1.

### Shows and Films

| Feature | LD | FT | Target | Verdict |
|---|---|---|---|---|
| Local TV layout `Show/Season N/Show SxxEyy - Title.ext`, poster.jpg | no | yes | `media-item` kind `episode` with `series`, `season`, `episode` from one parser | port FT |
| Local films as files with year in the name | no | no | `media-item` kind `film`; NFO read if present, never written | keep (new) |
| Netflix-shaped index: billboard, poster shelves, detail hero, episode list, continue row | yes (over Plex and TVMaze) | grid | the Shows and Films app, posters from embedded art or the folder; no online metadata by default | keep the layout, drop Plex, TVMaze, JustWatch, Fandango, Overseerr, Radarr, Sonarr, SABnzbd |
| Skip intro and credits from the file's chapters | yes | no | kit `Player` chapter skip | keep |
| Watchlist with status want, watching, completed | yes | no | `media-collection` kind `watchlist` | keep |
| Parents guide, reviews, trivia, showtimes | yes | no | | drop (web lookups belong to chat) |

### Music

| Feature | LD | FT | Target | Verdict |
|---|---|---|---|---|
| Folder scan with tags (ID3, Vorbis, MP4), embedded and folder art, incremental by size and mtime, MusicBrainz ids, advisory flag | yes (`music-metadata`) | yes | the one scan orchestrator with `music-metadata` | keep (LD's library) |
| Albums, Artists, Songs, Liked views; album key artist plus album | yes | yes (derived, no tables) | derived views over `media-item`; no album or artist tables | keep FT's rule |
| Playlists (manual), smart and magic playlists, blends | yes | no | `media-collection` kind `playlist`; smart rules later | keep manual; later smart |
| Radio from a seed over the person's own tags (similarity tiers) | stations by LLM and YouTube Music | yes, local only | FT's local radio first; an LLM-built playlist from the household's own library as a Music app action later | port FT; later LD's prompt stations over local tracks only |
| AI DJ between tracks | yes | no | | later (the Stack tts role, a companion voice); not in the first slices |
| Crossfade, AutoMix, 10-band EQ, waveform seek | yes | no | | later; the kit Player ships with none of these |
| Prefetch for gapless, two-deck engine | yes | no | the kit Player's preload | drop the two-deck engine |
| Internet radio (radio-browser), recordings | yes | no | | later, opt-in source |
| Catalog browsing (MusicBrainz, Cover Art Archive), Deezer, lyrics from LRCLIB, ListenBrainz scrobbling | yes | no | the existing `music` lookup package in chat; nothing in the app by default | drop from the app |
| Plex music index | yes | no | | drop |
| Pocket skins, click wheel, critters | no | yes | theme packages | later, catalog only |
| Speakers: phone drives a desktop | Listening Together | yes | handoff and `device_commands` (section 10) | keep, universal |
| Karaoke, remix, studio, generate | yes | no | generation is the generation records' concern | drop here |

### Podcasts

| Feature | LD | FT | Target | Verdict |
|---|---|---|---|---|
| RSS subscriptions, one feed row shared by the household, membership per person | yes | per server | `media-source` kind `feed` with `feed.kind: podcast`; the KS-05 poller | keep |
| Conditional GET, backoff, feed URL kept out of backups | yes | yes | the shelf poller already does conditional GET; the URL is a `media-source` field, excluded from the export like other secrets if it carries a token | keep |
| Podcasting 2.0 tags: chapters, transcript, persons, funding, soundbite; `itunes:explicit` | yes | basic | feedsmith reads them; `media-item.advisory` from explicit | keep LD's coverage |
| Directory search (iTunes Search, PodcastIndex) | yes | no | opt-in, adults; a child subscribes through a parent | later |
| Stream without downloading | yes | no (download first) | stream by default, save on request or by `auto` | keep LD |
| Auto-download latest N, prune auto, never prune manual | yes | backfill all, new or N | `media-source.auto` | keep |
| Per-show speed, skip intro and outro seconds, trim silence, voice boost, skip ads | yes | no | speed and skip seconds per source; trim silence and voice boost are Media Chrome gaps | keep speed and skips; later the rest |
| Ad detection and fingerprinting | yes | no | | drop (model-run audio classification on every episode is a budget with no ask) |
| Bookmarks, clips ("snips"), smart filters | yes | no | bookmarks as `media-progress.marks` | keep bookmarks; drop clips and filters |
| OPML import and export, gPodder sync, private RSS out | yes | no | OPML both ways through the feed-list import; gPodder and RSS out later | keep OPML; later the rest |
| AI-generated shows | yes | no | generation records | drop here |

### Books and audiobooks

| Feature | LD | FT | Target | Verdict |
|---|---|---|---|---|
| EPUB and PDF scan, OPF title and author, cover | no | yes | `media-item` kind `book` | port FT |
| Reader: epub.js with CFI, pdf.js with pages, themes, font size, TOC | no | yes | a kit `Reader` primitive wrapping epub.js and pdf.js (both MIT), tokens for themes | port FT |
| Reading position as a locator plus percent, finished as a manual latch | no | yes | `media-progress.position.locator` | port FT |
| Read aloud from the current block, per-chapter audio cache | no | yes (espeak, Piper) | the Stack `tts` role, FT's block chunker | port the chunker, drop espeak and Piper |
| Audiobooks: m4b and m4a with chapters, a folder of mp3s as one book, series | no | no | new: `media-item` kind `audiobook`, chapters from ffprobe, series from the folder or tags | keep (new work) |
| Book excerpts in Feed mode | no | yes | | later with Feed mode |

## 5. Information architecture

One rail entry per installed app (pins, never automatic); each app's own sections are its `nav: true` pages, drawn as in-app tabs on
wide screens and in the phone drawer (rules S1, S2).

- **Videos** (`/apps/videos`): Home (billboard, rows), Library (saved copies and folder roots by channel), Subscriptions, Watch later,
  History, Settings gear (sources, quality, SponsorBlock, auto-save). Watch page at `/apps/videos/watch?item=`.
- **Shows and Films** (`/apps/shows`): Home (billboard, Continue, Recently added, by genre when tags exist), Shows, Films, Watchlist.
  Detail page: hero, seasons, episode list with progress. Netflix's layout is this app's native app (rule S2 "and so on").
- **Music** (`/apps/music`): Listen now (recently played, radio seeds, liked), Albums, Artists, Songs, Playlists; Now playing is the
  shell's audio session surface, full screen on a phone. Spotify's layout is the native app.
- **Podcasts** (`/apps/podcasts`): Listen now (continue, newest from subscriptions), Shows, Episodes, Queue, Saved. Apple Podcasts'
  layout is the native app.
- **Books** (`/apps/books`): Reading now (continue reading, continue listening), Books, Audiobooks, Series. Apple Books' layout is the
  native app. The reader and the audiobook player are full-screen immersive pages with their own Close (rule S1).
- **Home page**: "Pick up where you left off" gains media rows (section 12); **Search**: one provider per kind, title and identity
  fields only, FT's rank tiers; **Settings**: each app's gear, plus Home settings, Storage (saved copies, trash, caps) and
  Devices (offline devices and their copies).

## 6. Layouts

All from kit primitives, tokens only (rule 9b). The cinema tone is a page-tone token the kit already owns (UI.md, CALM-TOKENS-00):
these apps select the dark page tone and their accent; no app CSS.

- **Phone (under 640)**: one column. Videos Home: the billboard as a full-width card, then shelves scrolling horizontally. Watch:
  player on top, title, actions row, Up next below; the player docks to a mini bar (kit `Player` layout `mini`) when the person
  navigates, and pulling the picture down docks it (FT). Music and Podcasts: lists with a persistent bottom mini bar; Now playing
  slides up full screen. Books: the reader is full screen with a top bar that hides on tap. Targets 48 px; body 16 px.
- **Tablet and desktop (640 and up)**: Videos is YouTube's layout: rail, then the app's content with its own top search and
  chips, three to five tiles per shelf by `CardSizeSlider`, Watch with the player left and Up next right (`SplitView`). Shows and
  Films is Netflix's: billboard full width, poster shelves, a detail page with the hero over the backdrop. Music is Spotify's:
  left sections, content, bottom player bar. Podcasts and Books follow Apple's.
- **TV (Go, input mode)**: a single focused row, the kit's TV density, no hover (hover previews become focus previews after a
  dwell), no toasts or sheets (UI.md TV rule). Billboard large at the top; D-pad moves between shelves (LD's `/tv` focus ring is the
  reference). Playback is full screen; captions and chapters through the Player's TV layout. Go renders the same page documents.

Kit gaps named here (rule 9b, a kit change first, each with a row in `docs/design/UI-DECISIONS.md` before a line is written):

- `Billboard`: a kit block composed from the kit's own shadcn `carousel` (Embla with `embla-carousel-autoplay`, UI-DECISIONS row
  `carousel`, 2026-10-13) plus the `Card` and `MediaShelf` aspect boxes: slides, autoplay that pauses on hover, on a hidden tab
  and under reduced motion (the Embla autoplay plugin's own options), a dwell preview slot. Reuse check: the carousel already
  ships; nothing new is drawn by hand. If Embla cannot pause under reduced motion by option, that is an additive kit prop, not
  Home code.
- `Player`: video, audio and mini layouts, chapters, preview thumbnails on the time range, playback rate, captions, PiP, Media
  Session, a cast slot. Reuse check, in rule 9b's order: Kibo UI's video player (named by rule 9b for a gap; it is built on Media
  Chrome) first, then Media Chrome (Mux, MIT, web components with React bindings) directly, then Vidstack (MIT); the slice takes
  the first with a release within the last 90 days at adoption and records the pick. Hand-built players (LD's 1,279-line
  `VideoPlayer.tsx`, FT's 11k-line `player.js`) are not carried.
- `Reader`: epub.js (CFI locators, pagination) and pdf.js (page locators), both MIT and already the parts FileTube vendors; themes
  are tokens. Reuse check: no shadcn or Kibo part reads EPUB or PDF, so the kit wraps these two libraries once.
- `Billboard`, `Player` and `Reader` as schema nodes, and the `play` action implemented by the interpreter (today it throws,
  `commons/ui/src/schema/actions.ts:24`).

The docked mini bar draws only inside a media app's area, under rule S2 ("only the rail is ours"): when the person switches to
Chat or any non-media app, audio keeps playing through the audio session and the Media Session controls, and no bar is drawn
over that app's layout; returning to a media app shows the bar again. UI.md's "player bar" in the shell contract is read as this
session-owned bar placed by media apps, not chrome over every app.

## 7. Records (spec first, `commons/spec`, then Home, then the robot and Go)

All four carry `id`, `created_at`, `hlc` and `provenance` like every spec record. Field lists are the whole record; a field not
listed does not exist.

**`media-item`** (`spec/schemas/media-item.schema.json`, id `media-…`): `kind` (video, episode, film, track, podcast_episode,
book, audiobook, chapter), `title`, `subtitle`, `source_id`, `location` (one of `{file_id}` for a saved copy in the household
store, `{root_id, path}` for a file on a library root, `{url}` for a stream-only item such as a podcast episode not yet saved),
`media_type`, `duration_s`, `size`, `width`, `height`, `video_codec`, `audio_codec`, `playable` (original, transcode, none; FT's
rule), `artwork` (a `file_id` or a path under the item's root), `previews` (`{storyboard_file_id, clip_file_id}`), `chapters[]`
(`{start_s, title, source: manual | embedded | description}`), `subtitles[]` (`{lang, label, file_id}`), `series`, `season`,
`episode`, `artist`, `album`, `album_artist`, `track_no`, `disc_no`, `year`, `genre`, `author`, `locator_kind` (cfi, page, none),
`external` (`{extractor, id, url, channel_id, channel_name, published_at}` for anything fetched from the web), `advisory`
(`{explicit: bool, source: tag | feed | platform | classifier | adult}`), `band_ok` (child, teen, adult: the lowest band that may
see the title, description and artwork; computed at ingest like KS-05's `band_ok`), `added_at`, `fingerprint` (`size-mtime` for a
root file; the sha256 for a saved copy), `hidden`. Identity: one item per `(source_id, external.id)` or per
`(root_id, path)`; a re-scan updates, never duplicates (FT's merge rule keeps the newer `last_served_at`). Deletion is not a
field here: it is the record envelope's `deleted_at` and `trash_until` (section 12, TRASH-01), one definition for every record.

**`media-source`** (`media-source.schema.json`, id `msrc-…`): `kind` (root, feed, channel, link), `scope` (household or person)
with `owner_person_id` when person, `label`, `root` (`{mount_id, path, kinds[]}` for a root; `nas_mounts` rows become these),
`feed_id` (for a podcast, the `feed` record; `feed.kind` gains `podcast`), `url` (channel or link), `extractor`, `auto`
(`{save: none | audio | video, keep_latest: n, remove_watched: bool, max_per_check: n, max_duration_s, min_duration_s,
skip_shorts, cutoff_date, quality_max_height}`), `poll_minutes`, `paused`, `last_checked_at`, `last_status`, `failures`,
`backoff_until`, `visible_to` (household or a person list), `archive` (the "deleted stays gone" ids). Roots of different kinds may
not overlap (FT's rule, enforced at save).

**`media-progress`** (`media-progress.schema.json`, id `mprg-…`): `person_id`, `media_id`, `position` (one of
`{seconds}` or `{locator: {kind, cfi | page, spine_index, block_index}, percent}`), `duration_s`, `completed` (a latch: video and
episode at 90 percent, podcast and audiobook at 95 percent, book by the person or at the end; a track never latches, it counts),
`plays`, `skips`, `finishes`, `marks[]` (`{at_s, label}` bookmarks), `device_id` (the device that wrote it, for the handoff card),
`updated_at` (server clock), `hlc`. One row per person and item. Merge rule in section 10.

**`media-collection`** (`media-collection.schema.json`, id `mcol-…`): `person_id`, `kind` (liked, watch_later, queue, playlist,
watchlist, pins), `title`, `items[]` (`{media_id, added_at, position, status}`; `status` want, watching, completed for a watchlist),
`pointer` (the queue's current entry), `shared_to` (household or persons; a child's collections are never shared outside the
household), `rules` (reserved for smart playlists, null today), `hlc`. One liked, one watch later and one queue per person exist
by construction. Why not the `list` record: its items are text with a checked state for shopping and chores; media items are
references with order, status and a pointer, and one shape for both would carry two schemas.

**`file.origin`** gains `fetched`: a copy the hub fetched for a person from a source they chose (a video download, a podcast
episode, a subtitle, a storyboard). Owner: the person who asked, or the adult who created a household subscription; shared to the
household by a pointer when the source is household-scoped. Bytes stored once per sha256 (the existing rule), so Loki Doki's
"highest quality anyone asked for" becomes: a second request at a higher ceiling replaces the blob and keeps the record. Saved
copies count against the owner's cap (STORE-CAP-01); a full cap stops auto-save for that person with a plain line, never a purge.

**`feed.kind`** gains `podcast`; **`device`** gains `offline_scope` (the default-deny route allowlist for a paired offline device);
**`stack-job.kind`** gains `media.fetch`, `media.probe`, `media.transcode`, `media.preview`, `media.chapter_snap`, `media.tts`.

Fixtures: one of each record, the Python package regenerated, tag cut, Home pin bumped (`docs/PINNING.md`). Robot: the records
are shared shapes so a paired robot with a speaker can hold a child's audiobook progress and play the saved copy from the hub.

## 8. Library ingest

One orchestrator (`backend/src/lib/media/scan.ts`, FT's `scan/orchestrator.js` ported: async walker, one interval per root, overlap
coalescing, the unchanged path-and-size fast path, prune guards: survives, deferred, root missing, unattributable root, unreadable
subtree, prune off). Per kind, one parser: FT's TV name parser, `music-metadata` for tags, FT's OPF reader for EPUB, pdf.js for PDF,
ffprobe through the Stack media service for anything with a stream (duration, codecs, dimensions, chapters, projection, embedded
date and source URL). Thumbnails, storyboards, preview clips and transcodes are Stack jobs, bounded by one FIFO, at idle priority
(the `jobs` table already carries `kind`, `state`, `progress`, `forPerson`).

Audiobooks: an `.m4b` or `.m4a` with chapters is one item with `chapters[]`; a folder of numbered mp3s is one item whose chapters are
the files (each file a `chapter` item under the book); series from the folder above or the `series` tag. Books and audiobooks of the
same title in the same folder are linked by `subtitle` match and offered as "listen" and "read" on one detail page.

From the web: `POST /api/media/fetch {url, kind: audio | video, quality}` runs a Stack `media.fetch` job (yt-dlp with FT's args:
embed metadata, thumbnail and chapters, subtitles as VTT, `--download-archive` per source, cookies only when the owner configured
them), writes the result as a `file` with `origin: fetched`, then a `media-item`. Subscriptions are `media-source` kind `channel`,
polled at `poll_minutes` (default 60) with `max_per_check` (default 2) through the Stack's limiter at a person's pace
(THIRD-PARTY-SERVICES.md): no discovery fan-out, no related-of-related, no warm-ahead; a 429 or a login wall puts that host in
quiet mode (FT's circuit breaker: four failures, 30 minutes) and only person-initiated requests continue. The request budget per
check is stated in the slice's commit. Where it comes in: the composer's attach menu ("Save a link"), the PWA share target
(section 12), the Videos app's Add page, and later the browser extension posting to the same route with a person API token
(`person_api_tokens` exists).

## 9. Offline: the three layers

1. **The hub is the household's offline.** Every saved copy, every scanned root and every progress record is on the hub, so with
   the internet down every app works on what is saved: Videos shows Library, not Home's web rows; Podcasts plays saved episodes;
   Music, Shows and Books are unaffected. A stream-only item is shown with "Not saved" and a Save action, never an error (rule 6's
   spirit: a failed source never fails the app). Each app's manifest declares `offline: "partial"` with the sentence the offline
   page shows.
2. **Chromium browsers keep copies on the device.** Home's service worker (`frontend/src/sw.ts`, `injectManifest`) gains one
   route: `GET /api/media/offline/file/*` is cache-first from a named Cache Storage bucket the person fills by "Keep on this
   device" (the KEEP-OFFLINE-01 mechanism in section 12). FT's hard finding stands: a fetch handler breaks background media on
   WebKit, so on Safari and iOS the worker stays push-only and the button says "Use the MaiPai Go app to keep this on your phone".
   Firefox stays passed through as today. Quota: `navigator.storage.estimate()` before a save, the error codes FT named (storageFull,
   revoked, notOnServer, notReady, notPlayable, network) as plain lines. The on-device bucket is listed under Settings, Devices,
   this device, with Remove all.
3. **Go carries the native half.** FileTube's iOS offline protocol is ported to Home as the device-scoped routes
   `GET /api/media/offline/manifest`, `GET /api/media/offline/file/:kind/:id`, `POST /api/media/offline/status`,
   `POST /api/media/offline/progress`, with the same semantics (fingerprint, ok | changed | gone, Range and If-Range, 503 with
   `Retry-After` while a transcode queues, 409 when not playable, a 200-event progress batch with skew correction and restamp).
   A paired device (Home's `devices` and `device_tokens`, the robot pairing flow) holds a token whose scope is default-deny to
   those routes plus the artwork and subtitle byte routes. Revocation: delete, a person's epoch bump on password change or "Remove
   all devices", disable, 180 days unused. Tokens never enter a backup. Go's iPhone app is where the coworker's iOS offline code
   lands (Swift, the same protocol); Apple TV uses the same client without the download UI.

Playability (FT's `decidePlayability`, ported): original for mp4, m4v and mov with H.264, HEVC only when tagged `hvc1`, audio
always original; otherwise a transcode job is queued and the copy is served when ready. The hub never transcodes on the fly for a
browser; it transcodes once into the store.

## 10. Playback and resume across devices

- Progress writes: the kit `Player` posts `media-progress` every 10 s while playing, on pause, on seek and on unload with
  `keepalive` (LD's cadence), carrying the device id. Online writes are server-stamped and coalesced (FT), so a flood from one tab
  is one row.
- Merge: newest wins by the server stamp after skew correction; a rewind applies when newer; `completed` is a latch that only
  the person clears; `marks` union by `at_s`; a child's progress is never written by another person's device. The same rule
  serves the offline batch, the robot and Go, so one function (`mergeProgress`) is the definition, with FT's test cases ported.
- Resume: opening an item seeks to `position` unless `completed`, with a two-second "Resume from 12:40, Start over" line (kit
  Player slot). Continue rows read the newest progress per item across the person's devices.
- Handoff: `device_states` already carries presence; a playing device publishes `{media_id, position}` there every 4 s, and
  another signed-in device of the same person shows "Continue here" (FT's card) in the app's index. "Play on another screen"
  sends a `device_command` (`play {media_id, position}`) to a chosen device of the household, the kit cast slot's first target;
  Chromecast and AirPlay are the Player's own buttons when the browser offers them (nothing of ours in the path).
- One audio session per client: the shell's audio session (section 12) ensures one thing plays at a time across apps, chat voice
  included, and owns speed, sleep timer and Media Session metadata. It draws nothing outside a media app's area (section 6).

## 11. Kid mode hooks

Rule 0 governs; nothing here loosens a child's or teen's protection, and the words come from the kid-mode voice record.

- **What a child can see**: `media-item.band_ok` computed at ingest from `advisory`, the title and description through the
  deterministic floor (KS-05's `band_ok` path), and an adult's verification; an unverified web item is adult-only until an adult
  marks it. The Videos, Shows, Music and Podcasts indexes for a child show only items whose `band_ok` includes child. A child's
  searches run against the household library only; web video search for a child needs an adult to allow it for that person
  (MEDIA-SEARCH-01's rule, unchanged).
- **Allowlist mode is the child default** (FT's `mode:allowlist` as the person's `media.allowlist_only`, a user default an admin
  may override, the child never): a child's Videos app shows the household's saved library plus channels an adult followed for
  them; no discovery rows, no chips (LD's approved-only mode behaviour).
- **Time budget**: `media.daily_minutes` and `media.allowed_hours` per person (admin-set, child-locked), metered from progress
  writes across all media kinds and devices (LD's `watchTime` logic ported); the player pauses at the budget with the kid-mode
  line and a parent can extend from their own device. Audiobooks and bedtime music are exempt by an admin switch, off by default.
- **Explicit music** masks the title for a child (LD's advisory masking) and is skipped by a child's radio.
- **Reader read-aloud** for a child uses the household's child-safe voice and the output floor on the text it speaks (rule 10).
- **Sharing**: a child's collections and saved copies share only within the household; a parent sees a child's usage and can
  remove a copy with the child told (household storage rules).
- **Screen surfaces**: a shared TV counts as a shared screen (SAFETY.md), so a signed-in adult's Continue row never appears on a
  child's profile on the TV and vice versa.

## 12. Cross-app platform features from FileTube

Jesse's ask: which FileTube features are universal across Home, which stay media-only, which are dropped. Each universal feature
has one definition in one place, spec first, and names the other apps that adopt it.

| Feature | Verdict | One definition, one place | Who adopts it |
|---|---|---|---|
| Keep on this device (offline copies, device tokens, status, manifest) | universal | spec `device.offline_scope` plus one `offline-manifest` shape; Home `backend/src/lib/offline/` serves manifests for any record kind that registers a provider (media first, then the reference library's ZIM pages, a conversation export, a news story's cached body); the shell's one "Keep on this device" action and the Settings, Devices page | Videos, Music, Podcasts, Books, News shelf (read a saved story offline), Reference, Chat (a pinned conversation), Go |
| Resume and continue | universal | `media-progress` for media; the Home page's existing "Pick up where you left off" shelf reads chat, projects and media progress through one `continue` provider registry; FT's home-row assembler is that registry's media provider | Home page, every media app, Chat, Projects, Reader, kid mode (own items only) |
| Playback speed | universal | one person setting family `audio.speed.<kind>` (podcast, audiobook, video, spoken reply) in the spec settings registry; the shell audio session applies it; the kit Player's rate menu writes it | Podcasts, Books, Videos, Chat voice replies and read-aloud, Companions |
| Sleep timer | universal | the shell audio session: one timer (15, 30, 45, 60 min, end of chapter or episode) that fades and pauses whatever plays; a spec setting for the default | Music, Podcasts, Books, Videos, bedtime story and companion voice, kid mode (a parent-set bedtime stop) |
| Media Session (lock screen, headset keys) | universal | the shell audio session publishes metadata and handlers once; apps hand it an item | every audio and video surface, chat voice |
| Queue and Up next | media-only | `media-collection` kind `queue`, one per person, shared across the media apps (a podcast after a song, as FT's `entry_kind` allows) | Videos, Music, Podcasts, Books (audiobooks) |
| Collections: liked, watch later, pins, playlists, watchlist | media-only record, universal pattern | `media-collection`; the `list` record stays for text lists; the kit's pin and favorite controls are the same primitives both use | the five media apps; the Library and Home page shelves read them |
| Search providers and rank | universal | the existing global Search with one provider per record kind; FT's ranker (tier, type priority, recency) becomes the one ranking function for every provider | Search everywhere, the command palette, each app's own search box |
| Home rows (continue, new from sources, recently added, more from X, liked, again) | universal pattern, media rows | one row assembler per app index built from the `continue`, `media-collection` and `media-source` providers; the Home page uses the same functions for its shelves | Home page, media apps, News shelf (new from feeds), Projects (recently made) |
| Feed mode (timed reel sessions, mixed kinds, forward-only progress) | media-only, later | a Videos app page over the queue and collections; kid mode gets it only with a time budget | Videos (later); kid mode as a bedtime reel (later) |
| Mobile gestures: edge swipe back, pull down to dock, hold for 2x, double-tap skip | split | edge swipe and pull-to-dismiss are shell behaviours in the kit (the drawer already uses the edge swipe); hold and double-tap live in the kit Player | shell (universal); Player (media-only) |
| Import and ingest: folder roots, scan on an interval, prune guards, OPML and feed-list import, "save this link" | universal | `media-source` for media roots and feeds; the one scan orchestrator takes a provider per record kind (media now; documents and photos for the Library later); OPML through the existing feed-list import; one `POST /api/media/fetch` for a pasted link | Media apps, News shelf (OPML), Reference (its library manager stays its own: ZIM is not a scan), Library |
| Save to Home: PWA share target and the browser extension | universal | one `share_target` in the manifest and one route that accepts a URL, text or file and routes by kind (a video link to media fetch, an article to read later, a picture to chat); the extension is the same route with a person API token | Chat, Videos, Podcasts, Reading list (news), Library |
| Settings and per-person preferences with last-writer-wins | universal, already exists | the spec settings registry and `SettingsShell` (rule S4); FT's 24-key prefs allowlist maps onto person-scope keys; no second prefs store | everything |
| Trash with restore, purge and "deleted stays gone" | universal | one household trash: a `deleted_at` plus `trash_until` on the record envelope (spec first), one Settings, Storage, Trash page, one tombstone list per `media-source` for sources that would re-fetch | Media, Library files, Lists, Memories (already soft-delete), Projects |
| Handoff and remote (Continue here, play on another screen) | universal | `device_states` for presence and `device_commands` for commands (both exist); the kit cast slot and the shell's Devices page | Media apps, Chat (continue this chat on the TV), the robot |
| Device tokens and default-deny scope | universal, already exists | Home's `device_tokens` with the new `offline_scope`; one middleware | Go, the robot, the extension |
| Web Push, notifications bell | drop FT's, universal already exists | NOTIFICATIONS.md's declared events and channels; media packages declare `new_from_source` as passive, `download_failed` as time-sensitive | all |
| Backup and restore of state | drop FT's, exists | BACKUPS.md; media records are in the backup, saved copies follow the household storage rules, device tokens never | all |
| Heavy-job FIFO (one never-wedging queue) | universal, in the Stack | the Stack job API's one idle lane; FT's `heavyGate` rules (cap the one-shot queue, never wedge) become that lane's tests | media jobs, model downloads, reference downloads, generation |
| Config compare-and-set (409 on a stale version) | drop | the spec record envelope's `hlc` already gives last-writer-wins with a stamp; a settings save that conflicts shows the other person's value | n/a |
| Multi-user RBAC by folder and library | replaced | bands, share pointers and `media-source.visible_to`; no per-path rules | n/a |
| Eras, skins, critters | later, catalog | `theme` packages, tokens only | n/a |
| Diagnostics pages, performance runs, stats | drop | the status app and the bench lane | n/a |
| Roku channel | drop | Go | n/a |

## 13. Merge plan for the coworker: ordered slices

Ground rules for the merge: FileTube's logic arrives as TypeScript in Home's stack (Bun, Hono, Zod, Drizzle), with its tests ported
to `bun test` beside the file; no Express, no vanilla pages, no second SQLite file, no second settings store. Every surface is kit
primitives and tokens (rule 9b, `bun run lint:ui-rules`). Every record is the spec shape (section 7), landed in `commons` first.
He works like any session: his own worktree through `scripts/wt.sh`, lands fast-forward on `main`, no pull requests, the CLA for
any catalog package (PACKAGES.md). Jesse owns deploys, releases and any rule change. Slices are sized S (a session), M (days);
each lands alone and leaves Home green; the exit is `bash scripts/check.sh --pre` plus the tests beside the change (ordinary
code), full `check.sh` and a medium review for the device-token and offline routes (auth surface).

| # | Slice | Size | Repo | Owner | What lands | Acceptance |
|---|---|---|---|---|---|---|
| 1 | MEDIA-SPEC-01 records | S | commons | Claude | the four records, `file.origin: fetched`, `feed.kind: podcast`, `device.offline_scope`, the Stack job kinds, fixtures, Python regen, tag, Home pin | ajv fixtures pass; round-trip tests; pin bumped |
| 2 | MEDIA-STACK-01 media service | M | stack | Claude | pinned ffmpeg, ffprobe and yt-dlp (sha256, the reference service's download job), `media.probe`, `media.fetch`, `media.transcode`, `media.preview` jobs on the one idle lane, the limiter and quiet mode per host, privacy rows on `/stack/v1/privacy` | a fetch of one public test video at a stated budget; a 429 fixture trips quiet mode; FIFO never wedges (FT's heavyGate tests ported) |
| 3 | MEDIA-LIB-01 roots and scan | M | home | coworker | `media-source` kind `root` over `nas_mounts`, the scan orchestrator (FT port), the TV, music, book and audiobook parsers, `media-item` writes, prune guards, duplicate finder | a fixture tree of every kind scans to the expected items twice with no duplicates; a removed root defers prune; tests beside each parser |
| 4 | MEDIA-PROGRESS-01 | S | home | coworker | `media-progress` and `media-collection` tables and routes, `mergeProgress` with FT's cases, latches, the Continue provider for the Home page | the merge table passes; a child's row is never written by another person; Pick up shows a media row |
| 5 | MEDIA-PLAYER-01 kit | M | commons | Claude | kit `Player` (Media Chrome) with video, audio and mini layouts, chapters, thumbnails, rate, captions, PiP, cast slot, resume slot; the `play` action implemented; `Billboard` primitive; schema nodes | kit tests; a schema page with a `media_shelf` whose `on_select` plays; rule 9 lints clean |
| 6 | AUDIO-SESSION-01 shell | S | home | Claude | the shell audio session: one playing thing, speed keys, sleep timer, Media Session, the docked mini bar | two apps cannot play at once; a sleep timer pauses chat voice too |
| 7 | MEDIA-VIDEOS-01 app | M | catalog, then Home's bundled set | coworker | the Videos package: index with FT's home rows and the billboard, Library, Watch page, Watch later, History, settings area, `min_role: child` with allowlist default, offline sentence | opens from the library at `/apps/videos`; a saved copy plays and resumes; captures at 1440 and 390 in both themes opened and judged; a child sees only `band_ok` items |
| 8 | MEDIA-ONLINE-01 sources | M | home | coworker | `media-source` kinds `channel` and `link`, `POST /api/media/fetch`, subscriptions polling through the Stack job at a person's pace, `auto` rules, SponsorBlock chips per person, the quality ceiling, privacy page rows, the user doc | one subscription with `max_per_check: 2` fetches two items and stops; the budget is in the commit; a child cannot add a source |
| 9 | MEDIA-OFFLINE-01 device offline | M | home | coworker | the four device-scoped offline routes, `offline_scope` middleware, playability, transcode-on-save, the Chromium service-worker bucket, Settings, Devices; the hub-only mode copy | FT's offline integration tests ported; WebKit gets no fetch handler (test on the user agent); full gate, review medium |
| 10 | MEDIA-PODCASTS-01 app | M | catalog | coworker | the Podcasts package over `feed.kind: podcast` and the shelf poller, stream and save, auto-save, per-source speed and skips, bookmarks, OPML in and out | a real feed's newest episode streams, saves, resumes; conditional GET proven; a child's explicit episode hidden |
| 11 | MEDIA-MUSIC-01 app | M | catalog | coworker | the Music package: Albums, Artists, Songs, Liked, playlists, FT's local radio, the queue | a scanned album plays through in order; radio from a seed stays inside the person's library; explicit masked for a child |
| 12 | MEDIA-BOOKS-01 app | M | catalog, commons (`Reader`) | coworker | the Books package: EPUB and PDF reader (kit `Reader`), locators, read-aloud through the Stack `tts` role with FT's chunker, audiobooks with chapters, series, listen-and-read linking | a book resumes at its CFI; an m4b lists chapters and resumes mid-chapter; read-aloud passes the child floor |
| 13 | MEDIA-SHOWS-01 app | M | catalog | coworker | the Shows and Films package: Netflix layout, seasons, episode list, skip intro from chapters, watchlist | a fixture show of two seasons; the next episode offer; captures judged |
| 14 | MEDIA-KID-01 | S | home | Claude | `media.allowlist_only`, time budget settings and metering, the parent extend action, explicit masking, kid-mode copy | a child hits the budget and the player pauses with the kid line; an admin override works; the child cannot change either |
| 15 | KEEP-OFFLINE-01, SAVE-TO-HOME-01, TRASH-01, HANDOFF-01 | S each | home | either | the universal pieces of section 12 after the media ones prove them | each row's own acceptance |
| 16 | MEDIA-GO-01 | M | go | coworker (Swift), with the Go client's owner | Go renders the five packages' pages; the offline half from FileTube's iOS app on the device-scoped routes | an iPhone keeps an album offline, plays it in airplane mode, syncs progress on return |

Order: 1, 2, 3 and 5 can run in parallel; 4 after 1; 6 after 5; 7 after 3, 4, 5 and 6; 8 after 2 and 7; 9 after 7; 10 to 13
after 7 in any order; 14 after 7; 15 and 16 last. The coworker's first slice is 3: the scan orchestrator is the part of FileTube
with the most hard-won logic and no UI, so it proves the stack move before any page is drawn.

## 14. Privacy rows (added in the same commit as each slice)

| Surface | Outbound | What leaves | Setting |
|---|---|---|---|
| Media fetch and subscriptions | the host the person named (a YouTube URL, a feed host) through the Stack media service | the URL the person pasted or the channel they followed, one real client identity, nothing of the household | per source; an admin adds or removes sources; a child cannot |
| SponsorBlock | `sponsor.ajay.app` | the video id of a copy about to play | `media.sponsorblock` per person, off for a child |
| Pinned binaries | the Stack's pinned download hosts for ffmpeg and yt-dlp | nothing; a version check at the update cadence | the Stack's update setting |
| Podcast feeds | each feed host | a conditional GET, no identity | per source |
| Offline devices | none; the device talks to the hub only | | Settings, Devices |

No MaiPai-operated service is in any path; no analytics; the privacy page gains these rows.

## 15. Questions resolved here, and what Jesse decides

Resolved by this note (with the reasoning):

1. **YouTube layout or Netflix layout?** Rule S2 names video as YouTube's layout. Loki Doki's Netflix look is the billboard,
   shelves and cinema tone, which YouTube's TV layout also has, so the Videos app keeps YouTube's structure in the cinema tone, and
   the Netflix layout proper is the Shows and Films app (S2's "and so on" lets each app name its native app). No rule change needed.
2. **Stream through the hub or play saved copies?** Saved copies. A live privacy proxy is what walled the home IP; a copy fetched
   once at a person's pace is one request, works offline, and is the household's record. An unsaved web result plays on the
   person's own device through the site's embed, never through the hub (MEDIA-SEARCH-01's rule, unchanged).
3. **Where do ffmpeg and yt-dlp live?** The Stack, as the `media` service, by the KS-STACK-REF-01 precedent: it already pins
   binaries, runs jobs on an idle lane, publishes privacy rows and updates them.
4. **One progress record or one per kind?** One, with a position that is seconds or a locator. FileTube's eight per-kind tables
   were the cost of growing kind by kind; Loki Doki's `media_progress` already proved the single shape.
5. **Reuse the `list` record for playlists?** No; different item semantics (section 7).
6. **Podcasts through their own poller?** No; the shelf poller is the one feed mechanism (principle 1); it already has conditional
   GET, backoff and the SSRF guard FileTube built by hand.
7. **Browser offline on iOS?** No; FileTube's finding (a fetch handler breaks WebKit background media) stands; Go is the iOS offline
   client, Chromium browsers get the scoped cache.
8. **Audiobooks?** New work (neither project has them); the shape is a `media-item` with chapters, the same progress record, the
   Books app's second half.
9. **Kid mode default?** Allowlist-only, as both projects converged on (FileTube's allowlist account, Loki Doki's approved-only
   mode), with Loki Doki's time budget and advisory masking ported.
10. **FileTube's code or its logic?** Logic, rebuilt in Home's stack by its author, tests first; none of its Express routes, vanilla
    pages or hand-built player are carried (rules 8 and 9b).

For Jesse (each goes through the question wizard when he is back; nothing above waits on them):

- **A.** Whether the coworker's iOS app becomes the iPhone half of Go (one native client, principle 7) or stays his own app pointed at
  Home's offline routes for now. This note assumes Go.
- **B.** Whether live web video browsing (trending, related, open search) is wanted for adults at all, or only "save this link"
  and subscriptions. This note ships the latter and holds browsing as opt-in later.
  > **Superseded in part 2026-10-17** by [live-video-2026-10-17.md](live-video-2026-10-17.md): answered, live browsing is wanted, for everyone.
- **C.** Default quality ceiling for saved video (this note: 1080p household default, 4K only when an admin raises it, since the
  Studio's disk and the Apple TV's decoder both argue for it).

## Supersedes

- [home-page-2026-10-17.md](home-page-2026-10-17.md), the Pick up shelf ("Your last three chats, title and relative time, 'All
  chats'. Own chats only."): replaced by one `continue` provider registry (section 12) that the shelf reads, with chats first and
  media rows (a video, an episode, a book) beside them once MEDIA-PROGRESS-01 lands; "own only" holds for every provider, and the
  three-row budget is unchanged.
- [shell-search-2026-09-23.md](../plans/shell-search-2026-09-23.md), the line that keeps "ranking beyond cmdk's ordering" out of
  scope: replaced by one ranking function for every search provider (FileTube's tier, type priority, recency) in section 12; the
  command palette's quick-result limit and app-match behaviour are unchanged.
- The soft deletes that exist per record (`lists.deletedAt`, memories): replaced by the record envelope's `deleted_at` and
  `trash_until` and one household trash (section 12, TRASH-01), spec first; the existing columns migrate to the envelope fields
  with no change in what a person sees until the Trash page lands.
- The "Videos/Weather/Podcasts-style" wording in the `app` kind backlog row is confirmed, not changed; the app kind is the
  vehicle. MEDIA-SEARCH-01's playback rule (never routed through the hub, the hub never downloads a video for a chat card) is
  unchanged: this note's saved copies are a person's explicit "Save", not the chat card.
- Nothing in RULES.md. The five media apps are new; no earlier design record in `docs/design/` or `docs/plans/` designed a Videos,
  Music, Podcasts, Shows or Books app (MEDIA-SEARCH-01 covers the chat video card and stays; MEDIA-HOST-01 to 03 and CHAT-MEDIA-01
  cover generation and are referenced, not changed; `docs/app-library.md`'s "To add Music, Videos" steps are replaced by the app
  kind's own registration, which that doc already notes).
- The Loki Doki media features not carried (section 4 "drop") are retired by this note's verdicts, per rule 8; the legacy code
  stays a reference for the logic named in section 2.
