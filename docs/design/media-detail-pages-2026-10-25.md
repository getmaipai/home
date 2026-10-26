# Media detail pages: watch, now playing, lyrics, edit (2026-10-25)

Owner request (2026-10-25, from his iPhone): the watch and now-playing pages leave the top row unused, a video page shows no title or
description (phone or desktop), a song or video has no Edit, and Music is thinner than Apple Music (no lyrics, nothing around the song).
Make a more complete page for desktop and phone, taking Apple Music and YouTube as the references.

Owner rulings in the same turn, answered in the question wizard:

1. Lyrics come from the person's own files (tags inside the song, a matching `.lrc` file, the words typed to make a song at home) and,
   as the owner's written exception to the zero-lookup default, an online lookup on LRCLIB for songs that have none.
2. Edit changes title, description, artist and cover only. No trim, no delete in this pass.

## What each page shows

**Video watch page (Videos, Shows).** Phone: the picture runs edge to edge at the top under the status bar, 16:9, and the shell's menu
button floats over its top-left corner on a soft scrim drawn by the kit Player's full-bleed phone mode (the YouTube phone look); no band, no rule, no gear. Under the picture, in this order:

| Row | Content |
|---|---|
| Title | the video's title, up to two lines, tap to open the description |
| Facts | channel or maker, running time, "made at home" or source, date; counts only when the source gave them |
| Actions | one scroll-free pill row: Like, Watch later, Share (copy link), Edit (owner and adults), More |
| Description | collapsed to two lines with "more"; opens in place; chapters list inside it when the file has them |
| Up next | wide shelf below on phone; a right column on desktop (already there) |

Desktop: same order in the main column under a 16:9 player; Up next stays the right column.

**Now playing (Music, Podcasts).** Apple Music's order. Phone: the artwork is large and square, title and artist under it with Like and
a More menu (Add to playlist, Go to artist, Go to album, Edit), the scrubber, the transport row, and a bottom toolbar of three icons:
Lyrics, Output (cast), Up next. Lyrics replaces the artwork with the song's words, the current line large and bright, the rest dimmed,
scrolling with the song; tapping a line seeks to it when the lyrics are timed. Up next opens as a sheet. Desktop: artwork left, the lyrics
or the queue as the right pane, the toolbar's Lyrics and Up next switch it.

**Edit.** One sheet (a dialog on desktop, a bottom sheet on phone, the kit `Dialog` and `Drawer`): title, description, artist (songs), cover (a picture picker from the
hub's pictures or an upload). Owner and adult members only, and only for an item that person can read (the playback gate: age band, `visible_to`, Library grant); a teen or child never sees it, and an adult never edits another person's private creation. The cover picker lists only pictures the editor can see. The save writes the record with a new clock
stamp and provenance `hub:edit`, and marks the edited fields locked so a rescan never overwrites them.

## Supersedes

- `media-apps-blend-2026-10-17.md` line 133: "Catalog browsing (MusicBrainz, Cover Art Archive), Deezer, lyrics from LRCLIB, ListenBrainz scrobbling ... nothing in the app by default | drop from the app". This note reverses the LRCLIB part only, by the owner's ruling of 2026-10-25; MusicBrainz, Deezer and scrobbling stay dropped.
- `"details": false` in `backend/packages/videos/pages/watch.json` (set in 55e42d1fb) is turned on.
- Backlog: MEDIA-DETAIL-01 replaces MEDIA-DETAIL-KIT-01. MEDIA-DETAIL-05 takes over MEDIA-VIDEOS-DETAIL-01, MEDIA-MUSIC-DETAIL-01, MEDIA-PODCASTS-DETAIL-01 and MEDIA-SHOWS-DETAIL-01 and keeps their per-item visibility part (title, creator and visibility rows are built, not dropped). MEDIA-BOOKS-DETAIL-01 stays open. MEDIA-DETAIL-02 and 03 finish MUSIC-GEN-20 (karaoke through `timedLyrics`) and the lyrics part of MUSIC-CARD-EDIT-01; the rest of MUSIC-CARD-EDIT-01 stays open.

## Reuse check (org principle 6, rule 9)

| Prebuilt part | Use |
|---|---|
| `CreationHeader` and the `creation_header` schema node (title, creator, date, collapsible description) | The watch and play pages declare it. MEDIA-DETAIL-01 adds props only: a facts line, an actions row, chapters. No second details block. |
| `PlayerDetails` (the `details` flag on the player node) | Turned on in the Videos and Shows pages; gains the same additive props. |
| Chapters in the Player (`NodeRenderer.tsx`) | Shown inside the collapsed description; no new list. |
| `MusicTrack` `timedLyrics` (current line highlighted, tap to seek) | MEDIA-DETAIL-02 moves that list into one shared kit part that `MusicTrack` itself then uses, so only one copy exists; recorded in `UI-DECISIONS.md` and `ELEMENTS-DECISIONS.md`. The Lyrics pane uses it. The `{t, line, section}` shape is reused. |
| `music-metadata` and `backend/src/lib/media/parsers/audioTags.ts` | Lyrics inside a song file are read with `common.lyrics` there. |
| Legacy LRCLIB client in `legacy-backups` | Hard-won logic to copy, not scope. |
| Kit `Dialog`, `Drawer` | The Edit sheet. |
| Cover picker | "From the hub's pictures" reuses the kit's existing picture grid; "upload" uses Kibo UI's Dropzone, the named gap, added to the kit first. MEDIA-DETAIL-02 writes its `docs/design/UI-DECISIONS.md` row before any code, and the schema Edit node's `cover` field is the only place it appears. |

Home writes no wrapper and no CSS for any of these. The Edit sheet is a kit schema action and node that opens the `Dialog` (desktop) or `Drawer` (phone) with its fields; the pages JSON declares it and Home supplies the route and copy. The scrim belongs to the Player's phone mode in commons.

## Where the lyrics come from

Order, first hit wins, stored on the song record so a lookup happens once:

1. Lyrics inside the song file (ID3 USLT/SYLT, Vorbis LYRICS, MP4 lyrics), read at scan.
2. A sidecar `<song>.lrc` or `<song>.txt` next to the file, read at scan.
3. For a song made at home, the lyrics text that was sent to the music model.
4. Online, LRCLIB, only when the household switch `music.lyrics_online` is on (declared in the Music package manifest and the spec registry, not a Home-local key file).

**Owner exception and budget (the written exception THIRD-PARTY-SERVICES.md requires).** The switch is on by default because the owner chose it.
The lookup runs only when a person opens Lyrics on a scanned song that has none and carries artist and title tags. Never on a scan, never in
the background, never for a song made at home or a Library creation (a home-made title is household data), never while a child is
viewing. One request per song ever, success or miss, receipt cached in the music package's store; through the shared fetch path
(`guardedGet`) and one limiter, at most one request per second across the household; sends only title, artist, album and duration; no account,
cookie, name or listening history; a first refusal pauses the class for an hour, doubling to 24 hours (as NEWS-07). Lyrics shown to a
child or teen pass the same band check a media item's description passes. A miss or a paused lookup shows the kit empty state in the Lyrics
pane: no toast, no new status surface. MEDIA-DETAIL-03 adds the budget row to `docs/THIRD-PARTY-SERVICES.md` and the privacy page row
(`music:lyrics-lookup`) in the same commit; the setting's help text says the above in plain words.

## Spec first

`media-item.schema.json` has `additionalProperties: false` and no lyrics field, and says a rescan updates and never duplicates, which would
overwrite an edit. MEDIA-DETAIL-00 (commons `spec`) adds: stored lyrics (text, source `file|sidecar|made|lrclib`, optional timed form
`{t, line, section}`), and a locked-fields marker for edited fields. Provenance on an edit is `hub:edit`.

## Slices (each one item, one worktree, one Codex run, one landing)

| Id | Where | What |
|---|---|---|
| MEDIA-DETAIL-00 | commons `spec` | The lyrics and locked-fields shapes above. Tag. |
| MEDIA-DETAIL-01 | commons `ui` and `spec/ui/schema.json` | Additive props on `PlayerDetails` and `CreationHeader`; Player full-bleed phone mode with the scrim. Tag. |
| MEDIA-DETAIL-02 | commons `ui` | Shared timed-lyrics part (used by `MusicTrack` too), audio layout bottom toolbar, Up next as sheet on phone and pane on desktop, the Edit schema action and node with the cover picker above. Slices 01 and 02 cut a spec tag alongside the ui tag. Tag. |
| MEDIA-DETAIL-03 | home backend | Lyrics reading at scan, the LRCLIB lookup behind the switch with the budget, the setting, privacy and budget doc rows. |
| MEDIA-DETAIL-04 | home backend | `edit` plugin call for the five media apps: fields, role and item-read gate, clock stamp, `hub:edit`, locked fields, a test that a teen and an unseen item are refused. |
| MEDIA-DETAIL-05 | home pages and frontend glue | Pages JSON for Videos, Music, Podcasts and Shows (`creation_header`, `details`, Edit, Lyrics and Up next), per-item visibility rows, phone top row on play pages, desktop and phone screenshots. |

Order: 00, then 01 and 02 (kit), then 03 and 04 (independent), then 05. Codex builds every slice; the dispatcher reads each diff, runs the checks and lands.

## What is not in this pass

Trim and delete, karaoke word-by-word highlighting, lyrics translation, comments, subscriptions, a share sheet beyond copy link, Books.
