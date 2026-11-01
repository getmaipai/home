# Music: made radio, stations that write their own songs (design draft, 2026-11-01)

Status (2026-11-01): proposed; architect ruling pending. No code. Item: MUSIC-STUDIO-01, new slice G1 (after P1 and C1 to C5).
Owner ask (Jesse, 2026-11-01): create a radio station by describing it, have AI songs generate and play, generate the next song while the
previous one plays; and settle what happens when you want to save a song, go back to a previous one, and that every song has a unique
title, band name and cover. Amends [music-listen-create-2026-11-01.md](music-listen-create-2026-11-01.md); that note wins elsewhere.

## Supersedes

Nothing. The legacy Loki Doki stations asked a model for a tracklist and resolved it through YouTube Music; this note ports none of that
(owner ruling 2026-11-01: no music scraping). It reuses the `song-style` record from [music-studio-2026-10-31.md](music-studio-2026-10-31.md)
section 3.3 and the song engine, covers, lyrics and provenance that already exist.

## 1. What a made station is

A station is a described sound that keeps making songs: "late-night synthwave for driving", "bedtime lullabies about animals".
- **The record, reused:** a station is a `song-style` (the person's style words, length, instrumental flag) plus a `media-collection` of kind
  `station` (the ordered history of the songs it made). No new store, no second station model. Radio Browser stations stay a different thing
  (a live stream somebody else broadcasts); the Radio page lists both with a clear "Made here" badge on ours.
- **House bands:** on its first run the station invents two to four fictional bands (the band creator of the main note, section 3.2) that
  fit the described sound, each with a name, a one-line back story and a portrait. Songs come from these bands, so the station has a
  recognisable roster, and a person can promote a favourite band to a full band in Create.
- **Every song is unique and complete:** a title, a band, cover art, lyrics (or instrumental) and credits ("Made here, by the Marsh Lights,
  for your Late Night station"). The chat model writes the title and picks the band; uniqueness is an index rule, not a word list (a title
  and band pair already in the household's made songs is rejected and the model is asked for another). The cover comes from the picture job.

## 2. Generating ahead while the current song plays

- A rolling buffer: the station keeps N songs ready ahead of the one playing (default 2) and starts the next job when a song starts.
  The buffer size is the resource tier's setting (Standard 1 to 2, Boost 2 to 3), never a person's setting.
- **Resource order (owner, 2026-10-21, chat before images before video before everything else):** station jobs queue behind chat and
  pictures. If the buffer runs dry, playback never errors: the station crossfades to a saved or liked song in the same style, or a short
  sting, and says "Making your next song" through the existing S6 status line, never a raw error.
- **Speed is the open number.** Measured: a new 30 s song takes 16 to 26 s, so Quick songs (about 45 s) can stay ahead of playback on
  Standard; Full songs (about 3 min) have no measured real-time factor yet. Bench before building: songs per hour sustained, with chat and
  one picture job running, on the Studio and on a p64 host. A station may default to Quick songs and offer Full on Boost.
- **Covers never block a song:** the song plays with a generated art-led color card; the real cover swaps in when its picture job finishes
  (MUSIC-GEN-19 already starts the cover when the song job is accepted).
- **Checks before play:** the same song gates as chat (policy, child rewrite, the as-sung check). A song that fails is withheld and replaced
  in the buffer; the person never hears it. The as-sung check adds a few seconds, which the buffer absorbs.

## 3. Save, previous, and what happens to songs nobody keeps

- **Previous:** the station's history is the collection of songs it made, newest last. Previous and Next move through it; a song replays
  from its stored file, not regenerated. The Now Playing screen shows the last songs as a short list.
- **Keep:** a heart (or "Keep this song") saves the song to the person's Library as a made song (a `media-item`, `origin: made`, the same
  as a song made in Create, with its band, cover, lyrics and provenance). Kept songs appear in Listen under Songs, Artists and Albums
  like any made song. One tap, no dialog.
- **Unkept songs expire:** the station keeps its last 50 songs or 7 days, whichever is fewer, then removes unkept ones and their covers.
  Storage counts the history like any Library file and the existing caps apply. The expiry is shown once in plain words
  ("Songs you don't keep are removed after a week").
- **Variations:** "More like this" starts a branch of the station from one song; "Remake this" uses the existing song tasks.
- **Share:** a station and its kept songs follow the normal household share pointer (private by default).

## 3a. After you keep it: edit the song, the band, the album (owner, 2026-11-01)

A kept song is an ordinary made song, so everything Create does works on it, with no separate "station song" path:
- **Edit the song:** the Song page and its Edit tools (rewrite a part, extend, restyle, instrumental, stems, new lyrics, new cover, rename) with versions; the original take is never lost. An edit can also start from the Now Playing screen ("Edit this song"). Editing a song that is not kept yet keeps it first, so no work is lost.
- **Edit the band:** keeping a song also adds its house band to the Library as a band (`made-artist`), so the Band page exists for it. Rename it, rewrite the back story, change members, remake the portrait or logo, change its style words. The band is one record that songs point to, so a rename shows everywhere at once; audio already made is not rewritten, and new style words apply to songs made after the change (the page says so in plain words).
- **Edit the album:** a person can gather kept songs by one band into an album (an `album` collection): order, cover, liner notes, matched loudness. Moving a song between bands or albums is an edit of its album and artist fields, never a new file.
- **From chat:** the existing `edit_music` for songs, and `make_band` with an edit mode for the band (no new tool per field), both inside the conditional music set and its cap of 5. The Station card carries "Edit this song" and "Edit this band" buttons that open the same pages.
- **Gates:** edits run the song gates again (policy, as-sung check for sung changes), exactly as an edit in Create.

## 4. Chat and Create (rule S7, proposed)

- Chat tool `make_station` (conditional music set, rule 1): describe a station, get a **Station card** (a kit Element in `commons`): the
  station name and described sound, now playing with its cover and band, what is being made next, Keep, Previous, Next and a Stop button.
  The tool starts the station and returns the card; playback uses the one mini player.
- Create gets a "Stations" section: the same card, an editor for the style words and the house bands, and the history.
- Failure shape: if the song engine is down, the station is not offered (the S6 `music` row disables the control with the reason); a
  running station that loses the engine finishes its buffer and then says so.

## 5. Gates and safety

Age bands, surface gates, the policy seam and the as-sung check are the song gates, unchanged; a child's station request is rewritten like
a child's song request (MUSIC-GEN-22). A station started in a conversation, a spoken turn or a shared screen follows the main note's
surface rules. No outbound connection: every model runs in the Stack.

## 6. Slice

| # | Size | Slice | Done when |
|---|---|---|---|
| G1a | M | Bench: sustained songs per hour with chat and a picture job running, Standard and p64; tier buffer defaults | the measured numbers are in this note |
| G1b | L | Station engine: record reuse, house bands, rolling buffer, title and band uniqueness index, keep (adds the song and its band to the Library), previous, expiry | a station plays three songs back to back with the next generated during the previous; Keep adds a Library song and its band; Previous replays the earlier file; the kept song and its band both open in Create and edit |
| G1c | M | Station card, `make_station`, Create Stations section | the same card draws in chat and Create; a station starts from a sentence |

Preview at 1440 and 390 wide against the leader benchmark (main note, section 6a) before handing over.
