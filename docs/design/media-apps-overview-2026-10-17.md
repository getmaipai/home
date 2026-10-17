# Media apps in plain words (2026-10-17)

A short, plain-language companion to [media-apps-blend-2026-10-17.md](media-apps-blend-2026-10-17.md), the full design.
It says what the five media apps are, how they look and feel, and how they work. Nothing here changes that design.

Clickable mockup: [assets/media-apps-2026-10-17/index.html](assets/media-apps-2026-10-17/index.html). Open it in a browser.
"Try it" is the clickable app at phone, desktop and TV sizes, with Kid mode and Internet off switches. "How it works" is this
page. Screenshots of every screen are in [assets/media-apps-2026-10-17/shots/](assets/media-apps-2026-10-17/shots/).
Titles, channels and people in the mockup are made up.

## The short version

- Five apps: Videos, Shows and Films, Music, Podcasts and Books.
- Each one looks and works like the app people already know: YouTube, Netflix, Spotify, Apple Podcasts and Apple Books.
- Everything is saved on the hub. With the internet off, saved things still play.
- Stop on one screen and pick up on another, right where you left off.
- Kids see only what a grown-up allowed, with bigger buttons and a daily time limit.

## The five apps

| App | Feels like | What is in it |
|---|---|---|
| Videos | YouTube | Videos from channels you follow, links you save, and home videos from the hub's folders. A big picture on top, then rows you swipe. |
| Shows and Films | Netflix | The home's own show and movie files. Posters, seasons, episodes, and Skip intro when the file marks it. |
| Music | Spotify | Albums, artists, songs, playlists and liked songs. Radio is made from the home's own music only. |
| Podcasts | Apple Podcasts | Follow shows. New episodes play right away. Save the ones to keep, or let the app save the newest few. |
| Books | Apple Books | E-books and PDFs to read, audiobooks with chapters and a sleep timer. A book can read itself aloud in the home's own voice. |

## How browsing feels

- A dark, cinema look. Big pictures and rows you swipe sideways.
- Phone: one column. A small player stays docked at the bottom while you look around.
- Computer: the app icons on the left, 3 to 5 tiles across, the player on the left and Up next on the right.
- TV: move with the remote, one row in focus at a time, and everything plays full screen.
- The one Search box finds titles in all five apps.

## How playing feels

- It opens where you stopped, with a short line: "Resume from 12:40" or "Start over".
- Only one thing plays at a time in the whole app.
- Hold for 2x speed. Double-tap the left or right side to jump 15 seconds. Chapters, captions and speed are one tap away.
- Sleep timer: 15, 30, 45 or 60 minutes, or the end of the chapter or episode.
- Lock screen and headphone buttons work.
- Continue here: something playing on the TV can move to your phone. Play on another screen sends it the other way.

## Downloads and offline

There are three layers. Each one is a fallback for the one above it.

1. **The hub.** Everything saved on the hub plays with the internet off. Things that are not saved show "Not saved" and a
   Save button, never an error.
2. **A computer or Android phone.** In Chrome or Edge, "Keep on this device" puts a copy in the browser, for a plane or a
   long drive.
3. **iPhone, iPad and Apple TV.** The MaiPai Go app keeps the copies. Safari cannot do it reliably, so the button says so.

The Downloads page shows what is on this device, how much room is left, and the rules the hub follows by itself, like
"keep the 3 newest episodes of each show".

## Where things come from

- Folders on the hub for shows, films, music, books and audiobooks. The hub checks them every so often.
- A link you save, from the chat box or your phone's Share button, or a channel you follow. The hub fetches slowly, a little
  at a time, the way a person would.
- Podcast feeds the home follows.
- Nothing from the web streams through the hub. A saved copy is stored once and shared with the family.

## What comes from where

| From Loki Doki | From FileTube | New | Left behind |
|---|---|---|---|
| The look: big billboard, poster rows, cinema colors | Offline downloads that sync progress back | Audiobooks with chapters | Plex and the movie lookup sites |
| Podcast details: chapters, transcripts, per-show speed | Player gestures and the docked mini player | One sleep timer, speed and Continue row for the whole home | Streaming the web through the hub |
| Skipping sponsor parts of a saved video | The home rows: Continue, New, Recently added | A kid look for every media screen | Live TV channels and karaoke |
| Save once, share with the family | Careful folder scanning that never deletes by mistake | | |
| Kid rules: approved only, daily time, hidden explicit songs | Saving from channels, the book reader, read-aloud | | |

## What a kid sees

- Only things a grown-up allowed.
- Warmer colors, bigger text and buttons, and a rounder font.
- "Keep watching" instead of "Continue watching". The next video does not start by itself.
- A daily time limit. When time is up the video pauses, and a grown-up can add more from their own phone.
- Explicit songs show no title, and kid radio skips them.
- Tapping something not allowed says "Not for you yet. Tap to ask a grown-up."
- On a shared TV, a grown-up's rows never show on a kid's profile.

The words on kid screens come from [kid-mode-app-voice-2026-10-17.md](kid-mode-app-voice-2026-10-17.md). The time's-up
lines in the mockup ("Screen time is done for today." and "Ask a grown-up for more.") are placeholders until that catalog
has a row for them.

## How FileTube joins the home

FileTube's author moves his best logic into the hub's own code, one step at a time. Each step lands on its own and leaves the
app working.

1. Folder scanning. It is the most hard-won part, and it has no screens yet.
2. Progress and resume.
3. The Videos app.
4. Saving from channels and links.
5. Offline on devices.
6. Podcasts, Music, Books, and Shows and Films.
7. The iPhone and Apple TV app (MaiPai Go), with his offline code.

Same records, same tests, one hub. Nothing runs as a second app beside it. The full order with sizes is section 13 of the
design.

## Still to decide

- **A. His iPhone app:** becomes the iPhone half of MaiPai Go (the plan today), or stays his own app pointed at the hub for now.
- **B. Live web video:** browsing and playing web video the way YouTube works is its own proposal,
  [live-video-2026-10-17.md](live-video-2026-10-17.md), waiting for approval. Until it is approved, nothing contacts a video
  service (RULES.md V1), and this mockup shows saved copies only.
- **C. Video quality for saved copies:** 1080p by default (the plan today), with 4K only when a grown-up raises it.

## About the mockup

It is one self-contained HTML file. Colors are Home's dark tokens copied by hand from the kit's `tokens.css`, with the kid
values from the kid-mode record; gradients stand in for pictures. It is a look-and-feel reference, not a build: the real apps
are kit parts restyled by tokens (RULES.md rule 9). Opened and judged at 390 by 844 and 1440 by 900, plus the TV frame, on
2026-10-17. Faults found and fixed before commit: shelves snapped their first tile flush to the screen edge (scroll padding
added); the audiobook chapter bar ran past its end; the kid time's-up card overflowed the small player (it now covers the
screen); the phone player's control row clipped its last button (captions move to a menu under 480 px); the fit frame cut
off the mini player on desktop.
