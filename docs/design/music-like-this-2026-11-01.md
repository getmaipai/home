# Music: "Create a band like this" and MusicBrainz matching (design draft, 2026-11-01)

Status (2026-11-01): proposed; architect ruling pending. No code. Items: MUSIC-MB-01, MUSIC-WIKI-01, MUSIC-LIKE-01.
Owner request (Jesse, 2026-11-01): while a song plays, a button "Create a band like this" and "Create a song like this". On a
Metallica song the first makes a whole band profile (look, history, full sound and style, and a first single to judge); "that
probably means MusicBrainz matching of bands and songs". Extends slice C5 of [music-listen-create-2026-11-01.md](music-listen-create-2026-11-01.md)
(made bands); where they differ, this note wins for these two buttons.

## Supersedes

- Owner ruling, Jesse, 2026-11-01 (asked in the question box): Home may send a library item's title, artist, album and later its
  MusicBrainz id to MusicBrainz in the background, **on by default**. That ruling replaces the three records below, as far as
  MusicBrainz goes.
- Owner ruling, Jesse, 2026-11-01 (question box, "Yes, add it"): the Artist page may show a Wikimedia photo and short bio
  (MUSIC-WIKI-01). That replaces the two records below for that path too. Permissions become `net:musicbrainz.org` plus the
  Wikimedia hosts `backend/src/lib/answerImages/wikimedia.ts` already uses.
- `media-apps-blend-2026-10-17.md` line 133: "Catalog browsing (MusicBrainz, Cover Art Archive), Deezer, lyrics from LRCLIB,
  ListenBrainz scrobbling ... nothing in the app by default | drop from the app". Replaced for MusicBrainz, and for Cover Art Archive (on by
  default under the 2026-11-01 ruling in [music-listen-build](music-listen-build-2026-11-01.md), MUSIC-DATA-01); Deezer, iTunes and
  scrobbling stay dropped.
- `media-detail-pages-2026-10-25.md` line 40: "This note reverses the LRCLIB part only ... MusicBrainz, Deezer and scrobbling stay
  dropped." Replaced for MusicBrainz only; Deezer and scrobbling stay dropped.
- The 2026-10-06 owner decision (`docs/dev.md`, DOCS-01): "AcoustID and MusicBrainz are request-only, with only fingerprint and
  duration sent and a household privacy switch." The owner ruling above replaces "request-only" for text and id matching. The
  household privacy switch stays as an owner off switch (default on). Fingerprint matching is not part of this note.
- The music package manifest's `musicbrainz` data source entry (`when` "the household asks about a music artist", `what` "the
  artist's name as typed") changes with MUSIC-MB-01 to name the background match and the text and ids sent, and its `opt_in` flag changes from true to
  false (the owner ruled on by default). `backend/src/lib/privacy.ts` builds the Settings > Privacy page from it. In the same
  commit `docs/user/what-home-looks-up.md` (lines 179 to 189, "when someone asks about an artist ... The artist's name") and,
  for MUSIC-WIKI-01, the manifest `permissions` change too. The org `PRIVACY.md` (in `.github`) has no per-source rows and needs
  no change.
- [music-listen-create-2026-11-01.md](music-listen-create-2026-11-01.md) slice C5 and section 3.2: C5's band creator starts from
  "Describe your band". This note adds a second start, a seed from the playing track; the rest of C5 stands. For songs, the
  `song-style` record of [music-studio-2026-10-31.md](music-studio-2026-10-31.md) stays the one "like this" shape (section 2).

## 1. MusicBrainz matching (MUSIC-MB-01)

Home's Music app today only looks an artist up by name on request (`backend/packages/music/handler.ts`, one search, nothing
stored). Library items carry free-text `artist` and `album` and no identity. Matching adds one:

- `media-item` gets optional MusicBrainz ids (recording, artist, release group), spec first, additive (principle 3). There is no
  artist or album table (MEDIA-MUSIC-01), so the Artist and Album views read the ids from their items. The match runs in the background, one request per second with an identifying User-Agent as
  MusicBrainz asks, from the title, artist, album and track number the file already has; embedded tags with an id win. A wrong
  or missing match is never shown as fact: a low-confidence match stays empty.
- Privacy: every request, to `musicbrainz.org` only (permission `net:musicbrainz.org`): (a) match: title, artist, album and track
  number text from the file; (b) facts: a lookup by the matched MusicBrainz id (members, years, genres, tags, related acts) when an
  Artist page opens or Band like this is pressed. Matched ids are stored on the `media-item`; the facts are fetched when needed
  and cached for a day like the current lookup, not stored as records. Nothing about the household is sent beyond that text and
  those ids. The owner can turn the matcher off. The manifest and privacy rows change as listed under Supersedes. Matcher logs carry counts and timings only,
  never a title, artist or id (rule 6a). A missing, failed or opted-out match never fails an answer or the Band like this
  action (rule 6): the brief falls back to the file's own tags.
- Prebuilt options considered: a maintained MusicBrainz client library (`musicbrainz-api`) for the request and rate handling,
  checked at build time before any hand-written client; beets and Picard matching logic is Python and heavier than the one
  search this needs; AcoustID fingerprinting is allowed by the 2026-10-06 decision but is a separate item.
- Reference, not a port: the pre-migration hub's `catalog.ts` (`pickArtistMbid`, one-per-1.1 s queue, name-equality across
  spelling quirks, artist photo through the MusicBrainz Wikimedia relation) holds the hard-won matching logic. Rule 8: review,
  rebuild small, record the verdict first. Deezer and iTunes are out. Cover Art Archive is on by default under the 2026-11-01 ruling (MUSIC-DATA-01). MusicBrainz is `net:musicbrainz.org`; the Wikimedia photo and bio path is section 1b.

## 1b. Artist photo and bio from Wikimedia (MUSIC-WIKI-01; after MUSIC-MB-01)

A matched artist's page shows a photo and a two-sentence bio. The Wikimedia page comes from the MusicBrainz artist's Wikimedia
link, and the fetch reuses `backend/src/lib/answerImages/wikimedia.ts` (no new client), keeping its under-18 subject protection.
Only the Wikipedia or Commons title is sent, never anything about the household. A failed fetch leaves the page as it was (rule 6).
Logs carry counts only (rule 6a). Cover Art Archive is allowed by the 2026-11-01 ruling in [music-listen-build](music-listen-build-2026-11-01.md) (MUSIC-DATA-01); album art otherwise comes from the files and made-here art.

## 2. "Create a band like this" and "Create a song like this" (MUSIC-LIKE-01; after MUSIC-MB-01 and C5)

A button pair in the kit `Player`'s existing `actionsSlot` (no Home wrapper, no className, rule 9). Pressing opens Create with the playing track as the seed.

- **Band like this.** Facts come from MusicBrainz (members, years, genres, tags, related acts) so the brief starts from real data,
  not model memory. The chat model writes the new band's name, history, sound words and style as a **new fictional band inspired
  by the seed**, never a copy: its own name, members, backstory and lyrics. The picture job makes the look (portraits, logo,
  cover). The song engine makes a first single from the band's style words, and the band card shows it for approval; keep, remake
  or discard (the picture editor's version model). Same `make_band` tool and Band card as C5, so chat can ask for it too.
- **Song like this.** Creates a `song-style` (the record from music-studio S2, proposed and not yet ruled; style words, never lyrics) from the seed's tags, then the existing "Make one like
  this" path runs it; new lyrics, engine job through `generate_music`. No second brief shape. Never the seed's lyrics, melody or the artist's voice.
- Seeds are an input description only: the original audio is never sent to the engine (voice, cover and edit sources stay closed,
  MUSIC-GEN-14 is Jesse's decision). The adult-content rule applies as in C5: no classifier gate on an adult's request; a minor's
  lane keeps its floors.

### Follow-up (2026-11-02): card, artist, layout, bench

- `make_band` returns a `band` answer block (spec 0.1.297+, kit Band). The card actions are keep, remake, remake_portrait and
  discard (the kit allows four). Make-album and remake-logo stay off the card for that cap; the route
  `POST /api/music/bands/{id}/action` and the Music band page still do them. The card polls the band every 3 s for the picture job.
- The first single gets `artist` and `made_artist_id` (migration 0156), so the band appears under Music artists.
- The player action row wraps (`actions_wrap`, additive kit prop, ui 0.5.461) instead of clipping beside the left nav.
- Bench: `datasets/band-tool.json`, run with `MAIPAI_BENCH_OFFER=make_band`.

## 3. Open questions for Jesse

None block MUSIC-MB-01 (the background-send ruling is answered above). For MUSIC-LIKE-01: how close a "like this" may be named (the new band may say "inspired by Metallica" on
its card, or never name the seed). Default proposed: the card says it was inspired by the seed, the band's own name never copies it.
