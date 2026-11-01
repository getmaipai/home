# Music app: handoff and discoveries (2026-11-01)

A session record, not a design. The design is [music-listen-create-2026-11-01.md](music-listen-create-2026-11-01.md); this note says
what was found, decided, landed and left open so the next session starts where this one stopped. Item: MUSIC-STUDIO-01.

## 1. Where everything is (checked 2026-11-01)

| Thing | State |
|---|---|
| Radio fix (a station from any shelf plays) | On GitHub `main`, commit 8e8d5f024. Not in a release tag. Not on the live hub (the hub lacks it). Needs Jesse's word to ship. |
| Music design note (Listen and Create, bands and albums, own lyrics, chat tools and cards, leader benchmark, slices P1 and C1 to C10) | On GitHub `main` (latest d7de9ead5). Docs only, so nothing changed on the hub. |
| Stem note section 10.7 (no age gate on stems) | On GitHub `main`, same landing. |
| Proposed platform rule S7 (what an app can make, chat can ask for; creative apps split into Listen/Watch/View and Create) | NOT on `main`. On branch `wt/fair-heron-music-chat-cards-note` (commits c485fa2d1, e1bc56b28 and later), owner-approved 2026-11-01 in his words. It edits `RULES.md`, a safety surface, so the lander runs the sharded backend tests, and `main` has a failing test (`STT-SMARTTURN-01B`, `backend/tests/sttReopenNoSideEffects.test.ts`, "a cancelled first turn leaves no judge-eligible row", fails on a docs-only branch). Land S7 when `main` is green again. `chatTurn.test.ts` and `wyoming.test.ts` also failed in the lander but pass alone (load). |
| Architect verdict | REJECTED twice on text; all listed fixes are applied on `main`. A third ruling is pending. Records: `data-scratch/architect/MUSIC-STUDIO-01.verdict`. Nothing music is built before APPROVED. |
| Code | Only the radio fix. No Studio, stems, sound, band or lyrics code exists. |

## 2. Owner decisions (Jesse, 2026-11-01)

- One Music app with **Listen** and **Create** sections. No separate Studio app (people would not find it).
- Create everything: songs, cover art, stems, sound effects, made bands (art, back story, members) and albums with tracks, and **own lyrics** (paste, "Help me write", edit a line, remake a section).
- Every Create function also has a chat tool and a chat card, the same kit Element in both places. Same pattern for Videos (Watch and Create) and Pictures later. This is the proposed rule S7.
- Stems accept anyone's own recording. **No age gate on stems:** the only filtering for children and teens is around safety content (sex and the like); splitting makes no content.
- Playback and radio reliability first, then the Studio shell.
- **No music scraping** (no YouTube, no YouTube Music radio, no acquisition tools). Music sourcing from outside services is designed later.
- **Licences are never a question and never a wait:** the home owner accepts licences through the existing install prompt (LICENCE-ACK-01).
- Benchmark the leaders (features and UI) before designing any app, replicate the best, make the UI easy and beautiful.
- Sound-effect engine per tier: asked to be researched (done, section 4), no choice needed from him.

Standing rules saved as Claude memory (shared by sessions in this project): `feedback_dont-ask-about-licenses`,
`feedback_minors-only-safety-filtering`, `feedback_benchmark-leaders-then-replicate`, `feedback_no-music-scraping`.

## 3. The radio bug (fixed): cause and test

Clicking a station from the Radio page showed "This station is no longer available. Go back to Radio and find it again." Cause:
`rememberPreviewStations` in `backend/src/lib/media/radioDirectory.ts` replaced the household's whole list of playable directory
stations on every call, and the Radio page asks for several shelves at once, so the last shelf to finish erased the others. The station
page and the player's item lookup both resolve an unsaved station only from that list. Fix: merge, and expire each station ten minutes
after it was shown. Tests: `radioDirectory.test.ts` "preview stations". Verified in the dev hub: Classic Vinyl HD opened and played (audio
clock advancing). `stationOf > cleans the row` in the same file was already failing and is unrelated.
Still open under P1: a stale link after a hub restart still lands on an empty page; it needs a "Find it again" state with a button
(the kit `Player`'s own state, commons first).

## 4. Research findings

**What AI music apps ship** (agent research; sources were thin and mostly secondary, so details are unconfirmed): text to song with
lyrics; stem split with a mixer; practice tools (tempo without pitch change, key shift, loop a section); repaint, extend and cover;
prompt playlists and an AI DJ (Spotify); similar-track radio (Navidrome Instant Mix); synced lyrics; sound effects from a prompt with a
waveform editor; stem to MIDI. Table stakes: gapless, crossfade, a reliable queue, lyrics, sleep timer, offline, radio streams that
reconnect. Users complain most about basic playback bugs. Cloud services are locking down exports (Udio disabled downloads after a label
settlement, per blogs), so "your files are always yours" is a real selling point. ACE-Step added an XL 4B model (2026-04-02); ComfyUI's
ACE-Step does not support repaint or cover yet, so use the native API.

**Leader UI benchmark:** the screen-by-screen table and the ten details to copy first are in section 6a of the design note. Not
reached: YouTube Music, Tidal, Udio, Stable Audio, Splice, Soundtrap. No product found that makes a fictional band with portrait, back
story and members, so made bands are a differentiator. Items marked (unv) there are from general knowledge and need checking.

**Sound effects by tier** (agent research, model cards read): Standard uses ACE-Step trims (MIT, already running); Boost and Max add
Stable Audio 3 Small SFX as an optional download (Community Licence, outputs `personal_only`), after a bench; no separate Max engine.
Rejected: MMAudio and TangoFlux (non-commercial weights). Bench before shipping the optional engine: offline load of a Mac conversion
(official code is CUDA or CPU; MLX conversions are community and unchecked), memory and seconds per 10 s clip, loop seam clicks on ten
prompts, a foley set against ACE-Step trims.

**Self-hosted helpers** (the SearXNG pattern): rule 11 keeps every model in the Stack. A service that holds no model and speaks a
standard interface may be an owner-run instance chosen by one setting. Options, none adopted now: an optional "connect your music
server" source (Navidrome, Jellyfin, Plex; Home already scans folders itself), self-hosted copies of the radio directory and LRCLIB
(privacy hardening), a sonic-similarity radio (holds models, so it would be a Stack engine). Rejected: Lidarr, Soulseek and similar.

**Legacy Loki Doki player logic to port for P1** (per `media-apps-blend-2026-10-17-sources.md`; mirror in
`legacy-backups/home-legacy.git`, read for hard-won logic only): two `<audio>` decks crossfaded by loudness, beat-matched AutoMix,
prefetch for gapless play, shuffle and repeat, sleep timer, editable Up next, a 10-band EQ per device. Never port its YouTube resolver or
YouTube Music stations.

**What already exists** (from the design record, code and backlog): song engine (ACE-Step 1.5 turbo), nine edit tasks, versions, covers,
timed lyrics, the `MusicTrack` card, the Music package with Albums, Artists, Songs, Liked, Playlists and Radio, radio HLS and recordings,
LRCLIB lyrics, MusicBrainz and Cover Art Archive. Not built: stems worker (TIER-STEMS-01), Studio screens, sound maker, waveform editor,
made bands and albums, own-lyrics tools.

## 5. Next steps, in order

1. Get the third architect ruling on the music note (read origin/main; fixes are listed in the verdict record).
2. Land rule S7 once `main` is green (fix or wait for `STT-SMARTTURN-01B`; do not skip the safety tests).
3. P1 playback and radio reliability, commons first (rule 9(c)): reconnect with backoff, dead-station state, gapless and crossfade, a saved queue, sleep timer and media keys. Reuse check before building (Media Chrome, Web Audio, `hls.js` already pinned).
4. C1 Listen/Create switch and Songs I made; C2 Create with recipes and own lyrics; then C3 to C10 as in section 7 of the design note. Each slice ships its chat tool and card.
5. Preview every UI slice at 1440 and 390 wide and judge it against the leader benchmark before handing it over.

## 6. Practical notes for the next session

- `wt.sh start` needs `bun` on the PATH: `export PATH="$HOME/.bun/bin:$PATH"`. Source `data-scratch/bin/https-git.env` before any git, `wt.sh` or push.
- `bun run dev` in a worktree gives a seeded hot-reload Home (`scripts/dev.sh url` prints it); sign in as Sage with the secret `dev.sh start` prints. Never preview on the live hub.
- A landing that bounces with "safety-surface tests failed" lists its failing files in `data-scratch/land/notes/<branch>.json` (`check_tail`). Run those files alone with ports allowed (not `MAIPAI_TEST_NO_PORTS=1`) to tell load failures from real ones.
- `pipeline.sh wait <sha>` can return the status of an earlier landing; confirm with `git branch -r --contains <sha>` and by reading `origin/main`.
- The git stash list is shared across worktrees; never pop a stash you did not make.
