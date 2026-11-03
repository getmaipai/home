# Song and band facts, and the AI DJ (MUSIC-FACTS-01, MUSIC-DJ-01)

Owner ask 2026-11-03: the pre-migration hub showed Wikipedia facts about the playing song and band and fed them to its AI DJ; "don't forget the AI DJ". Status: proposed, architect ruling pending.

## 1. Review of the old code (platform principle 8)

The old hub had no stored "fun facts" table. It had (a) an on-demand info panel (Wikipedia summary for the artist and song, shown in Now Playing) and (b) a
one-aside fact lookup used only by the DJ (one live Wikipedia search per transition, first snippet capped at 700 characters), plus the DJ itself: a local-model
line generator with three positions (intro, transition, outro), word caps, five random "angles" for variety, a `full | minimal | silent` mode, speech through
its text-to-speech with the DJ over the song at a low bed level, and a 24 hour cache of pre-rendered lines so playback never waited.

| Old behaviour | Verdict |
|---|---|
| Artist and song Wikipedia summary panel | Rebuild small on the existing MUSIC-WIKI-01 source (section 2) |
| Live Wikipedia search per track for the DJ | Drop: sends the listening history out. The DJ reads stored facts only |
| Deezer, iTunes, YouTube source chains | Drop (no music scraping, zero phone-home) |
| DJ line generator, positions, word caps, five angles | Rebuild (section 3) |
| `full / minimal / silent` | Rebuild as one per-person setting (section 4) |
| Pre-rendered line cache (2 variants per track, 24 h) | Rebuild small (section 3) |
| Weather and news headline in the intro | Drop in v1 (each needs its own declared permission; the listen-create row can add them later) |
| DJ speaking over the song at bed level 0.22 | Rebuild with a kit prop first (section 5) |
| Station editor, per-station DJ mode | Drop: one per-person setting, no new editor |

## 2. Facts (MUSIC-FACTS-01)

- **Source.** The same declared Wikimedia source and the same household switch as MUSIC-WIKI-01 (`music.artist_wikimedia`): no new host, no new setting. Because
  songs are now looked up too, the key's spec copy (label, help, `copy.does`, today "Show artist photos and short bios from Wikimedia") is rewritten in commons
  first (slice 0, spec tag), then Home pins it and `musicKeys.ts` matches it; the privacy row and `what-home-looks-up.md` say songs are looked up too. A song's page is found only through the MusicBrainz-linked Wikipedia URL of its matched
  recording or work (MUSIC-MB-01 ids); a track with no match shows no fact. No name-guessing, no search (the old `looksLikeSong` heuristic is not carried).
- **Store.** One local row per matched song: a two-sentence summary, the page URL and the fetch date, filled by the existing background matcher at its existing
  rate, never at play time. The under-18 subject protection of `lib/answerImages/wikimedia.ts` applies unchanged: a withheld subject stores nothing.
- **Show.** A "Did you know" row on the Song page only (not in Now Playing: the kit `Player` has no slot for it, and adding one is not worth a tag): a kit
  `Card` rendered inline where it is used, with the summary and a link, built from shipped primitives (rule 9b), no Home wrapper component and no new Element. Child and teen profiles follow the same band check as lyrics (the stored text is checked through the reader's band before it is shown). A
  failed or missing fact shows nothing, never an error (rule 6).

## 3. The AI DJ lines (MUSIC-DJ-01)

- **Inputs, all local.** The playing and next track's tags, the stored artist bio (MUSIC-WIKI-01) and song fact (section 2), the station or playlist name, and the
  person's name. No live lookup, no weather, no news.
- **Writer.** The household chat model through the turn engine's completion seam (not a second model path), as the companion the person has chosen
  (`companion` voice and personality; one DJ per person). Positions: **intro** one line of 14 words or fewer; **transition** names the song that ended, adds
  one true aside only if a stored fact exists, and teases the next song, 28 words or fewer; **outro** 18 words or fewer; **minimal** only announces songs.
  Five fixed "angles" chosen at random keep it from repeating. The prompt says: use only the supplied facts, never invent a fact, no profanity. Every line
  passes the person's band checks (rule 0) before it is stored or spoken, and a line that fails is dropped (the song just plays).
- **Voice.** `synthesizeSpeech` with the companion's resolved voice (`voiceResolve`, `voiceForSpeech`); when the Stack offers no voice the DJ is text only.
- **Cache.** Lines are made ahead for the next one or two tracks as a background job of the lowest priority class (never ahead of chat, pictures, video or
  songs; resource order), stored as audio files under the person's own made-media rules with a 24 hour life and a cap of 200, and consumed when played.
  Playback never waits for a model: no ready line means no DJ for that gap.
- **No transcript store.** The spoken text is kept only with its audio file and dropped with it; logs carry counts and milliseconds, never the words (rule 6a).

Build notes (architect): the DJ personality comes from the companion personality path chat already uses (`lib/companionPersonality.ts`), never new prompt prose
(rule 14); ducking lowers the media element Home's audio session owns (`Player` `media`, MEDIA-POLISH-01), so it works with only the mini bar showing.

## 4. Setting and gates

One per-person key in commons spec first (`music.dj`: `off | minimal | full`, default `off` for children and teens until a parent turns it on through the existing
family settings, `full` for adults), plus the household's existing voice keys. Nothing else is configurable. The age and surface gates outrank it (RULES.md rule 0):
child and teen DJ lines use the child and teen filters, and the DJ is off wherever the surface is.

## 5. Playing it (kit first, rule 9c)

The kit `Player` gains an optional `voiceover` input: a second audio source that plays at its own level, lowers the music to a bed while it speaks, ends on
the track's first lyric time if the speech would run into it (the old hub's rule), and has its own volume trim. Without it the Player is unchanged. One
commons tag, then a Home pin. Home passes the cached line; there is no Home audio element and no wrapper.

## 6. Reuse check

Considered and rejected: a hosted DJ or voice service (phone-home); the old hub's Kokoro-only path (Home speaks through the Stack); `react-lrc`-style
players (draw their own UI, rule 9); a second model path for the DJ (the turn engine seam exists); a new facts table per source (one local row on the existing
MUSIC-MB and MUSIC-WIKI rows). Reused: MUSIC-MB-01 ids, MUSIC-WIKI-01 source, switch and protections, `synthesizeSpeech`, voice resolution, the companion record,
the resource queue, the kit `Player`, `Card`.

## 7. Slices

(0) commons spec copy for `music.artist_wikimedia`, tag; (a) facts matcher, store, privacy line, tests (Home backend); (b) the Did you know row on the Song page (Home frontend); (c) `music.dj` in commons spec, then a tag; (d) kit `Player` `voiceover`
and tag; (e) DJ writer, band checks, cache job, route (Home backend); (f) DJ playback wiring and the setting row (Home frontend); (g) a real run: play three tracks, hear
the DJ, see a fact, check a child profile gets none until a parent allows it.

## Supersedes

- `music-listen-create-2026-11-01.md` row C9 ("Playlist and DJ"): the DJ half moves here (MUSIC-DJ-01); C9 keeps playlists and `make_playlist`.
- Nothing in `RULES.md` changes.
