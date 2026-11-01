# Music Listen: a modern Apple Music / Spotify look, the data behind it, and the build order (design, 2026-11-01)

Status (2026-11-01): proposed; architect ruling pending. Items: MUSIC-DATA-01, MUSIC-DATA-02, MUSIC-DEMO-01, MUSIC-KIT-01, MUSIC-LISTEN-03 to MUSIC-LISTEN-06. Builds Listen mode of [music-listen-create-2026-11-01.md](music-listen-create-2026-11-01.md) (section 6a is the
leader benchmark; this note adds the screen spec, the data, and the order) with the ids and artist pages of
[music-like-this-2026-11-01.md](music-like-this-2026-11-01.md).

Owner request (Jesse, 2026-11-01): the music app "should look and feel like a super modern Apple Music and Spotify"; research it,
"figure out the design and required data, and then get all data and build that out".

Owner ruling (Jesse, 2026-11-01): "change whatever rules ... we need outside data which means sending data to different services.
that will be on by default because it's the best for results. in parallel we should always look for alternate local sources to give
people options for more privacy and to work offline." Recorded in the org `docs/PRIVACY.md` (commit 67e510b).

## Supersedes

- [music-like-this-2026-11-01.md](music-like-this-2026-11-01.md) sections 1 and 1b and `media-apps-blend-2026-10-17.md` line 133, where Cover Art
  Archive was dropped: replaced for **Cover Art Archive** only (album art; the ruling above). Deezer and iTunes stay out.
- `media-detail-pages-2026-10-25.md` is not changed: LRCLIB stays as MEDIA-DETAIL-03 built it (`music.lyrics_online`, default on,
  never for a child, no background reads). This note adds no lyrics source.
- Permissions widen by `net:coverartarchive.org` and its archive.org redirect host, with one `data_sources` row (on by default, off
  switch) and the `docs/user/what-home-looks-up.md` line in the same commit. MusicBrainz and Wikimedia rows belong to MUSIC-MB-01 and
  MUSIC-WIKI-01; the LRCLIB row exists (`backend/src/lib/privacy.ts`, `platform:music-lyrics-lookup`).
- Listen slices P1 and C1 to C10 of the listen-create note stand; queue reorder and crossfade stay P1 rows 3 and 4.

## Rules these obey

Outside reads send only what a catalog needs (a title, an artist, a MusicBrainz or Wikidata id), never a name, address or account of
the household and never a minor's free text (rule 0, 10); a failed lookup never fails playback (rule 6); logs carry counts only
(rule 6a). Every outside source has a local twin that an owner can pick, and the off switch falls back to it, never to a broken page.

## Screens (what to build, what to avoid)

Kit parts are used as shipped (rule 9); a look the kit cannot reach is a prop or token added in `commons` first.

1. **Listen now.** Six quick tiles ("Pick up where you left off"), then scroll-snap shelves: Recently played, Made here, For each
   person, Radio. Card: square art, 8 px radius, title and one quiet line; hover lightens and a round Play slides up; press scales
   to 0.98. No ads, no reshuffle mid-song.
2. **Search.** Empty: recents and colour tiles (genre, mood, decade, Made here). Results: a Top result card, then Songs (4 rows),
   Artists (round), Albums, Playlists, Stations; chips All, Songs, Artists, Albums, Playlists; search as you type.
3. **Artist.** Full-bleed portrait with a bottom gradient, large name, Play, Shuffle, Pin. Popular (5 rows, play counts), Latest
   release, discography tabs (Albums, Singles and EPs, Appears on), Similar artists (round), About. The page tint comes from the
   portrait. No portrait: a coloured monogram, or a generated portrait for a made band.
4. **Album and Playlist.** Large art, title, artist, year, track count and runtime, Play and Shuffle, numbered rows (hover turns the
   number into a play icon), disc headers, a Details expander, More by this artist. A playlist gets a 2x2 mosaic cover and a filter box.
5. **Library.** Chips (Playlists, Artists, Albums, Songs, Made here), sort, list or grid, up to 6 pins.
6. **Now Playing.** Full-bleed blurred backdrop tinted from the art, big art that springs on play and pause, scrubber, Lyrics,
   Queue and Output always visible. Lyrics: the active line large and bright, others dimmed and blurred by distance, tap a line to
   seek; plain lyrics when no timing exists. Queue: Playing next, Up next with drag handles, Clear, and a "Mixing" label in a crossfade.
7. **Mini player.** Bar tinted from the art, thumb, title, play and skip, a thin progress line, swipe up opens Now Playing.
8. **Radio.** Station tiles with logo, a pulsing LIVE pill, now-playing text, and loading, playing and retry states.

Child profiles show no play counts or "popular" ranks. Verified sources for these: Apple Music (iOS 26 release coverage, Apple's
artist-page partner document), Spotify (newsroom, Engadget); the Spotify pixel numbers come from a third-party guide, so they are a
starting point to judge on screen, not a spec.

## Data, with the outside source and its local twin

| Need | Outside source (default on) | Local twin (picked in Settings, or the fallback) |
|---|---|---|
| Artist and album ids, type, area, dates, members, genres, release groups | MusicBrainz (MUSIC-MB-01) | embedded tags; the library's own grouping |
| Artist photo, two-sentence bio | Wikipedia/Wikimedia via `wikimedia.ts` (MUSIC-WIKI-01) | a person's own folder image; a coloured monogram; a generated portrait for made bands |
| Album and single art | Cover Art Archive by MusicBrainz release id | embedded art, folder art, then a generated cover |
| Synced lyrics | LRCLIB by title, artist, album, length | a `.lrc` sidecar or embedded lyrics; plain lyrics; made songs already carry timed lyrics |
| Similar artists | shared MusicBrainz genres and tags | the library's own listening and tags |
| Popular, play counts | none | local play history only |
| Colours | none | dominant colour from the art, cached per track in Home's database |
| Genre and mood tiles | MusicBrainz genres | file tags |

A bundled, offline copy of MusicBrainz (the public database dump on the household's own computer) is the long-term local twin for the
first row; MUSIC-DATA-02 below researches size and refresh before anyone builds it.

## Already built (do not rebuild)

- Now Playing with the Lyrics, Output and Up next toolbar and the phone Up next sheet: MEDIA-DETAIL-05. Art colours (`frontend/src/lib/media/artPalette.ts`:
  dominant, vibrant, blur backdrop), the tinted mini bar and the Music page tint: MEDIA-VIZ-01 to -03.
- Synced lyrics: kit `LyricsList` (timed lines, large current line, tap to seek, plain fallback), LRCLIB lookup
  `backend/src/lib/media/lyricsLookup.ts`, local twins (tags, `.lrc`, made-song words): MEDIA-DETAIL-02, -03, -03a.
- Pages: `backend/packages/music/pages/` `index.json` (billboard and seven `media_shelf`s), `artist.json`, `album.json`,
  `playlist.json`, `search.json`, `songs.json`, `albums.json`, `artists.json`, `playlists.json`, `liked.json` (MEDIA-MUSIC-DETAIL-01).
  There is no second album or artist page; the work below extends these files.

- Pins: `MediaCollection` kind `pins` (MEDIA-SPEC-01; `commons/spec/gen/ts/media-collection.ts`, `backend/src/lib/media/collections.ts`
  `MADE_KINDS`, `backend/src/routes/media.ts`). A pin entry holds only a `media_id` today.

## Backlog

| Item | Size | What | Done when |
|---|---|---|---|
| MUSIC-DATA-01 | S | Cover Art Archive art by MusicBrainz release id (after MUSIC-MB-01). Local twin: embedded art, folder art, then a generated cover. One `data_sources` row, off switch, user doc | a fake-server test returns art for a known release id; off and offline fall back with no error; one new privacy row |
| MUSIC-DATA-02 | S | Research note for an offline MusicBrainz mirror (size, refresh, licence) | a note with measured sizes; no build |
| MUSIC-DEMO-01 | S | Demo music in `scripts/seed.ts`: songs, art, lyrics. Audio is licence-clean, downloaded or generated, never vendored; seeding makes no outside lookup; the made-band part waits on the `made-artist` record of MUSIC-STUDIO-01 slice C5 | `bun run dev` shows a populated Listen now |
| MUSIC-KIT-01 | M | In `commons` ui, additive and tokens first (check the kit drawer for the swipe-up and a token for the 8 px radius before adding a prop); also the page blocks the Listen pages lack (quick tiles, Top result card, category tiles, hover-number track rows): `Player` swipe-up to open and art spring; `LyricsList` blur by distance; `MediaShelf` hover Play, 8 px card, press scale (rules 9(a), 9(c); Jesse says yes to any tag) | kit tests per prop; Home pins the new tag |
| MUSIC-LISTEN-03 | M | Listen now: extend `pages/index.json` with six quick tiles ("Pick up where you left off") and per-person shelves using `MediaShelf` (after MUSIC-KIT-01). "For each person" shows only the viewer's own listening | 1440 and 390 screenshots judged; a second person's history never appears |
| MUSIC-LISTEN-04 | L | Extend `artist.json`, `album.json`, `playlist.json`: tinted hero, hover-number track rows, discography tabs, Popular (hidden for child profiles), Similar, About (after MUSIC-MB-01 and MUSIC-WIKI-01) | each page renders with data and with none; screenshots judged |
| MUSIC-LISTEN-05 | M | Extend `pages/search.json`: Top result, grouped results, category tiles. Local library plus stations already saved or shown; no radio-browser request per keystroke (RADIO-08 budget and its child rule) | typing returns grouped results from the local library in under 300 ms |
| MUSIC-LISTEN-06 | M | Library pins: one `pins` collection per person (existing kind), capped at 6; one additive optional field on the entry, `ref: {kind: artist, album or collection; key}`, spec first in commons, then Home, then the library pages | pins persist per person; a second person sees none of them; no second record type |

Order: MUSIC-MB-01, MUSIC-DATA-01, MUSIC-DEMO-01, MUSIC-KIT-01, then LISTEN-03 to -06. Each UI slice is previewed in the dev hub at
1440 and 390 and the screenshot judged before landing.

## Reuse check

Pages and parts: the existing music pages above, kit `MediaShelf`, `Player`, `LyricsList`, and `artPalette.ts`; no Home
wrapper, no `className` on a kit Element. Data: MusicBrainz and Cover Art Archive through one maintained client
(`musicbrainz-api`) at 1 request a second, as MUSIC-MB-01 states.
