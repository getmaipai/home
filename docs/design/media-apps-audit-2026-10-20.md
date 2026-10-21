# Media apps: look-and-feel audit against the mockup (2026-10-20)

Owner ruling: the five media apps are standalone, each looks and feels like its counterpart, and across all of them the look is one
universal look, the mockup's ([media-apps-overview-2026-10-17.md](media-apps-overview-2026-10-17.md), screens in
[assets/media-apps-2026-10-17/shots/](assets/media-apps-2026-10-17/shots/)). Media is only the wrapper that moves between them.

**What this audit covers.** The structure of each app's home page document (`backend/packages/<app>/pages/index.json`) and its manifest
tabs, compared with the matching desktop mockup screen. It does not compare pixels: that pass needs a seeded media library and the
screenshot tool, and is the second step below. Findings marked "check live" need a real screen to confirm.

## The shared look in the mockup

1. A large app title at the start, search and download icons at the end (Videos adds a link icon), then pill tabs.
2. A home page of shelves under the tabs: a hero (Videos, Shows), then rows of tiles with progress bars, badges (Saved, On this phone)
   and running times.
3. A player bar at the bottom that keeps playing while you browse.
4. Tiles in three shapes only: wide, square (round for radio and artists) and poster.
5. Empty states that say what to do next, centered in the page.

## Across all five apps

| Area | Mockup | Today | Gap |
|---|---|---|---|
| Header icons | search, download (link in Videos) | the shell's Settings gear and star | different controls, no search or download icon |
| Pill tabs | present | present (kit `Tabs` pill) | matches |
| Bottom player bar | always shown while playing | docked mini bar exists, draws inside a media app | check live; matches in design |
| Empty states | centered, one next step | Podcasts "No shows yet" draws at the far right | kit layout bug (fix in flight in commons) |
| Shelf errors | none | "Could not load this shelf" seen during hub restarts | check live after v0.2.55; not a design gap |
| Tile badges and times | Saved, On this phone, running time | shelves name `item_badge_field` and `item_meta_field` | check live |
| Theme | dark cinema in the first proposal | follows the person's theme since 2026-10-19 | intended |

## App by app

| App | Mockup home | Today | Differences to fix |
|---|---|---|---|
| Videos | tabs Home, Library, Subscriptions, Watch later, History; billboard; Continue watching | tabs Videos, Library, Watch later, History; billboard; seven wide shelves | no Subscriptions tab; first tab says "Videos" not "Home"; seven shelves is more than the mockup's one or two to start; "Made at home" leads, so the household's own videos come first (good) |
| Shows and Films | tabs Home, Shows, Films, My list; full-bleed hero with the title large, Resume and More info; Continue watching | tabs Shows and Films, Shows, Films, Watchlist; billboard; "Continue watching" and "Keep watching" both wide | "My list" is named Watchlist; two near-duplicate continue shelves; hero check live |
| Music | tabs Listen now, Albums, Artists, Songs, Playlists; Recently played; Radio from your music in round art | tabs Listen now, Albums, Artists, Songs, Playlists, Liked; Created by you first; Recently played; Recently added; Radio; Liked songs | an extra Liked tab (fine, Spotify has it); "Created by you" leads as a list, the mockup leads with Recently played; radio is `square`, the mockup is round (check live) |
| Podcasts | tabs Listen now, Shows, Episodes, Queue, Saved; two columns: Up next with badges, Your shows with a settings icon | same tabs; split view with four shelves | closest to the mockup; badges and the per-show settings icon check live |
| Books | tabs Reading now, Books, Audiobooks, Series; Continue as two cards (Reading, Listening) with a read-along button; Books posters | same tabs; Continue reading (poster) and Continue listening (square) as separate shelves; Books and Audiobooks shelves | Continue should be two cards like the mockup, with the read-along button; titles on the cover tile |

## The Media home against the media hub design

[media-hub-2026-10-19.md](media-hub-2026-10-19.md) records the owner's decisions for the combined view: one more rail entry, placed
directly under Chat and never hidden; the four apps keep their own icons; the hub is a feed and never a manager; and its page has
these rows. The first Media build (a page of five links) ignored it; the rebuilt hub (MEDIA-HOME-01) follows its placement and gates
and adds the Media column and the embedded apps the owner asked for on 2026-10-20.

| Design row or rule | Today |
|---|---|
| Permanent rail entry under Chat, never unpinnable | done (`cast` icon, a core destination) |
| Continue across kinds | done (`GET /api/media/home`, `continue`) |
| New across the apps | done (`new`) |
| Recently played songs | done (`recent_music`); the design leaves tracks out of Continue |
| Up next (the person's one queue) | missing |
| Made at home (Library-made songs and clips, with "Manage in Library") | missing on the Media home; the Music "Created by you" shelf exists and its queue bug is fixed |
| Liked | missing |
| Recently added | partly: `new` is the newest few of each app |
| A chip row (All, Videos, Shows and Films, Music, Podcasts, Books) that narrows every row | missing; the Media column lists the apps instead |
| The media Search provider (titles in all five apps in the one Search box) | missing (MEDIA-HUB-03) |
| The mini player stays inside the Media area | check live (MEDIA-HUB-05) |
| Kid, teen and allowlist gates | done (same read helpers as the apps) |

These rows come after the shared look fixes in the order of work below.

## Order of work

1. **Fix the shared pieces first** (kit and shell, one change serves five apps): the header controls (search and download, with the
   gear and star kept as secondary), the centered empty state, and the one tile set (wide, square, round, poster).
2. **Seed a media library and capture real screens** with the screenshot tool, one desktop and one phone screen per app and tab, then
   put each next to its mockup screen and close this table's "check live" cells.
3. **Per-app page edits**, one small item each: Videos tabs and shelf count, Shows names and duplicate shelf, Music lead shelf and round
   radio, Podcasts badges and show settings icon, Books Continue cards.
4. **Own content first**: every app's first page shows what the person made at home (the Library's generated music and videos) before the
   rest, with the centered empty state when there is none.

Each item is one to three files with a test that can fail, so the local coding model can take it (owner rule, 2026-10-20).
