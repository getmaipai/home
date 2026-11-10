# Changelog

All notable changes to the Videos package, in [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [Unreleased]

- MEDIA-PARITY-02: Playlists. Save to playlist is on every video card and the watch page; a Playlists page and a Playlists row in the Library; drag videos into the order you want; share a playlist with people in your home (they can add videos; adult-only videos never go into a playlist a child or teen can read). A Channels row on Home and a page for each channel. The search box suggests titles and channels as you type. Remove from history on the History page. The Library remembers its sort. Cards use the soft corner radius and show the channel's picture.

- Home has a filter row (All, Made at home, Unwatched, Long, Short) and a Channel picker; Library sorts by Recents or A to Z; Search has Type and length or date chips; every card can be shared; the watch page can be shared and turns on picture in picture, double tap to seek and hold for 2x.

- VIDEOS-PARITY: a Liked videos page, a Watch later and Like menu on each video card, a "Channel, age" line under cards, chapters on clips you made by joining others, and a notice when a video you made finishes.

- SPATIAL-REACH: Spatial sound is on every clip in the Create feed and on the Studio's export card, not only on chat videos. It opens the same edit (adults only), and the new clip shows in the Create feed. A spatial clip's note reads in order: what moved (the headphones sentence once), the 5.1 line, then the quiet back speakers.

## [0.3.0] - 2026-11-02

- VIDEO-STUDIO-07: a Studio page between Create and My clips. Open a clip you made, cut it, put other clips of yours next to it with a cut or a crossfade, lay a voice line you type or a song of yours under it, set the levels and fades, then Export as a new clip. The old clip stays. Open in Studio is on every clip in the Create feed and on My clips tiles. Adults only.

## [0.2.0] - 2026-11-02

- VIDEO-UI-06: Create is one page with two sides. Describe the video on the left (a Start frame inside the box, one Style button for Look and Camera, the level, the shape and length, and a Generate button that says about how long it takes). Your clips are on the right, newest first, and a new clip turns from waiting to a percent to a video by itself. Each clip has Download, Another take, Remix, Make it Max (when it is ready for you) and a star. A new My clips page shows every clip by day, with All, Favorites and Uploaded, a size slider and a heart. The pages Make a video and My creations are gone.

## [0.1.5] - 2026-11-02

- VIDEO-CREATE-02 (U3): Make a video is rebuilt like a modern video studio. Look and Camera are grids of picture cards that play a short sample loop made by this home's own engine, a Picture slot starts the video from a picture in your Library (or a new upload), the stage shows your newest video with Another take, and a strip under it shows recent ones. Camera has eight cards (Still is new; it replaced Wide establishing shot). The loops ship inside the package as `assets/loops/` and are served only to adults.

## [0.1.4] - 2026-11-02

- VIDEO-CREATE-01 (V1b): Make a video shows what the video tests found. Length offers 5 and 10 seconds (a level that cannot make the length says so in one line), a Look chip (Natural, Classic cartoon, Anime, 3D animated, Film), a Voices chip (Keep it clean is the default), a one-line hint on writing speech, and an Another take button on the last video (same words, new seed).

## [0.1.3] - 2026-11-01

- VIDEO-CREATE-01 (V1a): Make a video and the Create home use the kit prompt bar (words, Shape, Length, Camera move and the Standard, Boost and Max segment for the levels you may use) instead of the placeholder form.

## [0.1.2] - 2026-11-01

- VIDEO-CREATE-01 (V1a): Create mode works for words-to-video. Create, Make a video (words, shape, length, level and a camera move from a list of eight) and My creations replace the placeholders; Make a video and a recent creations shelf show what is being made and what was made. The three Create pages are for adults only; Browse is unchanged for everyone.

- MEDIA-POLISH-01: the cinema page tone was removed 2026-10-19 (Jesse); media pages follow the user's selected theme. Rows without a frame and with See all, empty rows hidden, a shorter billboard, a two-column Watch with the title, Like and Watch later and Up next beside it, History, Watch later and Library as lists, and a mini bar that keeps a video playing after you leave Watch remain.

## [0.1.0] - 2026-10-17

- First version: Home (billboard, Continue watching, new, recently added, more from your most watched, Watch again), Library by channel, Watch with Up next, Watch later and History. Plays and resumes saved videos; a child sees only child-cleared videos and no discovery rows.
