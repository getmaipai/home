# Music app: handoff and discoveries (2026-11-01)

A session record, not a design. The design is [music-listen-create-2026-11-01.md](music-listen-create-2026-11-01.md); this note says
what was found, decided, landed and left open so the next session starts where this one stopped. Item: MUSIC-STUDIO-01.

## 1. Where everything is (checked 2026-11-01)

| Thing | State |
|---|---|
| Radio and player fixes (2026-11-01, all on GitHub `main` and **live on the hub as sha-bf5027f**, no release tag) | (1) a station from any shelf plays (preview list merged, 8e8d5f024); (2) a station that cannot be found shows an Open Radio button; (3) a dropped live stream retries at 1, 2, 4 and 8 seconds and tells the person only after the fourth failure (`frontend/src/lib/media/liveReconnect.ts`); (4) stations from the Radio page (preview route) now count as live, so they get the retry, the error line, the song title and the live-edge rejoin (`radioLive.ts`); (5) pressing Play on the open station resumes it instead of navigating again (`playIsAlreadyOpen` in `mediaApps.ts`); (6) the per-host request pace was 6 then one per 5 s, which refused the hub's own HLS player after about ten seconds and caused minute-long starts and stalls; it is now about 2 a second for HLS and 1 connect a second for plain streams (`radioHls.ts`, `radioStream.ts`). Not measured on the live hub: ask Jesse how long a slow station takes now. |
| Music design note (Listen and Create, bands and albums, own lyrics, chat tools and cards, leader benchmark, slices P1 and C1 to C10) | On GitHub `main` (latest d7de9ead5). Docs only, so nothing changed on the hub. |
| Stem note section 10.7 (no age gate on stems) | On GitHub `main`, same landing. |
| Proposed platform rule S7 (what an app can make, chat can ask for; creative apps split into Listen/Watch/View and Create) | NOT on `main`. On branch `wt/fair-heron-music-chat-cards-note` (commits c485fa2d1, e1bc56b28 and later), owner-approved 2026-11-01 in his words. It edits `RULES.md`, a safety surface, so the lander runs the sharded backend tests, and `main` has a failing test (`STT-SMARTTURN-01B`, `backend/tests/sttReopenNoSideEffects.test.ts`, "a cancelled first turn leaves no judge-eligible row", fails on a docs-only branch). Land S7 when `main` is green again. `chatTurn.test.ts` and `wyoming.test.ts` also failed in the lander but pass alone (load). |
| Architect verdict | **APPROVED on the third pass** (2026-11-01; two earlier REJECTED on text, all fixed). Two optional wording edits after it (stem 10.2 point 1 "minus the age refusal", C4 "when their music lane is open") are applied. Record: `data-scratch/architect/MUSIC-STUDIO-01.verdict`. Rule S7 is still proposed, not in `RULES.md`. |
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
Not in the first cut, on merit: MMAudio is built for video-to-audio and is weak on unfamiliar sounds, and TangoFlux has no verified Mac path. Both ship non-commercial weights; that is only a line in the catalog entry for the owner's acceptance (LICENCE-ACK-01) and never a reason to drop a model. Bench before shipping the optional engine: offline load of a Mac conversion
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

1. (Done) Architect ruling APPROVED. Build may start with P1.
2. Land rule S7 once `main` is green (fix or wait for `STT-SMARTTURN-01B`; do not skip the safety tests).
3. P1 playback and radio reliability, commons first (rule 9(c)): reconnect with backoff, dead-station state, gapless and crossfade, a saved queue, sleep timer and media keys. Reuse check before building (Media Chrome, Web Audio, `hls.js` already pinned).
4. C1 Listen/Create switch and Songs I made; C2 Create with recipes and own lyrics; then C3 to C10 as in section 7 of the design note. Each slice ships its chat tool and card.
5. Preview every UI slice at 1440 and 390 wide and judge it against the leader benchmark before handing it over.

## 5a. Idea queued: R1 "Describe what you want" station search (owner, 2026-11-01)

Jesse: station filters by country and genre are not enough (a German station can play US rock), and nothing may be hard coded for the US or any genre; "just need some smart AI interpreting the description and allowing filtering". Shape agreed in chat, not yet in the design note and not yet architect-ruled (add it as a Radio slice after P1, with a short note amendment and a re-ruling):
- A description box on Radio. The household chat model turns the words into a structured query (genre tags, language, era, mood, where the music comes from versus where the station sits). Rule 1: the model decides, no word list or regex.
- Home fetches a broad candidate set from the directory (tag and language), and the model ranks it against the description from each station's name, tags, language, country, homepage and its own knowledge. Optional second step: peek at the now-playing text of the top candidates for a few seconds to confirm the music (on the person's request only, behind the household radio switch, the same switch as the directory).
- Each result shows a one-line reason; the interpreted filters show as editable chips; the person's wording is never stored (rule 6a). Results cache for a few minutes. Engine not ready: the usual S6 status line, and the plain country and genre filter bar still works.
- Also planned in the same slice: a plain genre, country and language filter bar (Home already passes country and tag to the directory and the records carry language).
- Not hard coded: no country list, genre map or "US" special case beyond the directory's own tag and country fields.

## 5b. Review of a ChatGPT suggestion list (owner pasted it, 2026-11-01)

Verdict: mostly the same plan, plus three useful additions. Details:
- **Already in our plan:** library and player, persistent bands and albums, stems and a stem mixer, waveform editor (wavesurfer.js behind a kit `AudioEditor`), sound effects, practice mode, export, ACE-Step as the song engine, Stable Audio Open as an optional sound engine, covers as both artwork and musical covers (separate flows already), immutable takes and versions, the "Play this versus Edit this" boundary (we use no streaming provider and no scraping).
- **Adopt (new):** (1) the band flow "create a band, make two song previews, approve its sound, then build the first album" becomes the band creator's order in slice C5; (2) store a band's approved reference tracks and generation settings, and bench whether the same band keeps one singer identity (ACE-Step reference audio or a small LoRA; a prompt or seed alone does not guarantee it) before promising it; (3) album-wide finishing: matched loudness (the existing loudness task), credits ("Made here" provenance) and sequencing on the album page.
- **Do not adopt:** a separate Music service or a parallel `MusicEngine` interface (the Stack engine catalog and roles already carry capabilities and the S6 health row gates controls; a second interface breaks org principle 1); a project file format in v1 (the main note stores mix levels and trim points in the job request); Navidrome (GPLv3 server, Home scans folders itself; an optional "connect your server" slice stays later); Music Assistant and room playback (later, with the robot and Apple TV clients); Tone.js (only if the stem mixer needs sample-accurate scheduling; start with the kit Player and the Web Audio API); streaming-provider SDKs (MusicKit, Spotify) are out of scope and the "never extract audio from a provider" line is already our rule.
- **Check before relying on:** `mlx-audio-separator` as another stem option beside the measured Demucs path (TIER-STEMS-03 already plans model options); Rubber Band is GPL or commercial (ffmpeg `atempo` first; our product is AGPL-3.0, so GPL code is compatible, but verify the build). Its own claims about ACE-Step's REST server and MLX scripts match what the Stack already uses.
- **Uploaded demos and "generate accompaniment" from a person's recording:** still closed (MUSIC-GEN-14 is Jesse's decision; stems of an owned file are never a creative source).

## 5c. Made radio (owner, 2026-11-01)

Stations that write their own songs while the previous one plays, with save, previous, and a unique title, band and cover for every song:
designed in [music-made-radio-2026-11-01.md](music-made-radio-2026-11-01.md) (architect APPROVED 2026-11-01, slice G1 after P1 and C1 to C5; verdict record `data-scratch/architect/MUSIC-STUDIO-01-G1.verdict`).

## 5d. Standing rules from this session (memory files shared by sessions in this project)

Ship every landed change to the live hub yourself (ship-home steps, `--before-green` when the watcher has no run) and never ask Jesse to approve a ship; no licence questions, waits or rejections; no age gates on features that make no content; no music scraping; benchmark the leaders before designing an app; chat can ask for anything Create makes (proposed rule S7, still on branch `wt/fair-heron-music-chat-cards-note`, waiting for a green `main`). A repeat `Play` or reconnect must never open extra streams.

## 5e. Open items at the end of the session

- Rule S7 not on `main` yet (see section 1).
- Station start can still wait on a slow station server; the planned fix is a "Connecting..." state in the kit `Player` (commons first), and spending no hub pace budget when the same person re-requests the same station.
- Player work left in P1: the Player's own "Reconnecting..." line, crossfade and gapless (spec key `audio.crossfade` first, then the shell), and a queue saved per person on the device.
- R1 describe-what-you-want station search and G1 made radio (approved) come after P1 and C1 to C5.
- `STT-SMARTTURN-01B` (`backend/tests/sttReopenNoSideEffects.test.ts`) was failing on `main`; not fixed here.

## 6. Practical notes for the next session

- `wt.sh start` needs `bun` on the PATH: `export PATH="$HOME/.bun/bin:$PATH"`. Source `data-scratch/bin/https-git.env` before any git, `wt.sh` or push.
- `bun run dev` in a worktree gives a seeded hot-reload Home (`scripts/dev.sh url` prints it); sign in as Sage with the secret `dev.sh start` prints. Never preview on the live hub.
- A landing that bounces with "safety-surface tests failed" lists its failing files in `data-scratch/land/notes/<branch>.json` (`check_tail`). Run those files alone with ports allowed (not `MAIPAI_TEST_NO_PORTS=1`) to tell load failures from real ones.
- `pipeline.sh wait <sha>` can return the status of an earlier landing; confirm with `git branch -r --contains <sha>` and by reading `origin/main`.
- The git stash list is shared across worktrees; never pop a stash you did not make.
