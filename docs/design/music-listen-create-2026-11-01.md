# Music: Listen and Create, bands, lyrics, playback (design draft, 2026-11-01)

Status (2026-11-01): proposed; architect ruling pending. No code. Item: MUSIC-STUDIO-01 (amended). This note amends
[music-studio-2026-10-31.md](music-studio-2026-10-31.md); where they differ, this note wins.

Owner answers that shaped it (Jesse, 2026-11-01): one Music app split into Listen and Create (no separate Studio package, because
people would not find it); stems accept anyone's own recordings; playback reliability comes first; "we should be able to create
everything", including cover art, made bands with art and back story, albums with tracks, and our own lyrics; licences are accepted
by the home owner through the existing install prompt (LICENCE-ACK-01) and no slice waits on one.

## 1. What changes in the Studio note

| Studio note | Now |
|---|---|
| Q1: own `music-studio` package | **No.** One Music package, two sections: **Listen** (today's pages: Listen now, Albums, Artists, Songs, Playlists, Liked, Radio) and **Create** (Songs I made, Create, Song page, Edit, Stems, Sounds, Bands, Albums). A section switch sits at the top of Music so Create is always visible. |
| Q2: sound effects licence | Not a question. The sound-effects slot takes ACE-Step trims first (MIT), and Stable Audio 3 Small SFX as an optional catalog download; the owner accepts its licence in the install prompt and its outputs stay `personal_only`. No slice waits on it. |
| Q3: own recordings | **Yes, for everyone.** A person splits a file they own into stems. The stem note's floor stays: a stem or an upload never becomes a voice or cover source for a minor, and a recording of a household adult's voice follows likeness consent. |
| S1 to S10 | Re-ordered in section 7. |

## 2. Playback comes first (P1)

Audit 2026-11-01 (code read plus a real run on the dev hub): no gapless or crossfade code exists in the player; the Radio page
told people "This station is no longer available" because each shelf replaced the household's whole list of playable stations
(fixed and landed: `radioDirectory.ts`, commit 8e8d5f024; a station now stays playable for ten minutes after it was shown).
The audio element and mini player are kit parts, so shaping them is a commons change first (rule 9).

P1 rows, each with a failing test or a measured number:
1. Stream reconnect: a live station that drops retries with backoff, then offers "Try again", never an empty page. Fixture: an ICY server that closes mid-stream.
2. Station page resolves a saved or just-shown station from the id alone (a stale link after a restart says "Find it again" with the Radio button, not a dead end).
3. Gapless between two songs of one album; crossfade as a person setting (off, 3 s, 6 s). Measured: no silence over 50 ms at the seam on a fixture pair.
4. Queue survives a reload (play next, add to queue, reorder).
5. Sleep timer, media keys and lock-screen controls checked against the shared shell audio session (media apps blend note, section 12).

## 3. Create: make everything

Create is one place for each thing a person can make. Every made thing is a record with provenance (rule: no data debt), always
labelled "Made here", and appears in Listen beside what the library holds.

| Make | Starts from | Uses |
|---|---|---|
| Song | a sentence, a recipe, or **your own lyrics** | built song engine (ACE-Step) |
| Cover art | the song or album words, or "make another" | the picture job (MUSIC-GEN-19) |
| Stems | a made song or an uploaded file | TIER-STEMS-01 (`htdemucs`) |
| Sound effect or loop | a described sound, a length, a Loop toggle | section 5 |
| Band | a description ("a lo-fi duo from a lighthouse") | chat model for the text, picture job for art |
| Album | a band or a theme and a track count | song engine, cover through the picture job |

### 3.1 Own lyrics

- The Lyrics box takes pasted or typed words; the engine sings them as written, section markers (verse, chorus) honoured. The engine already sings a person's kept words (MUSIC-GEN-17).
- **Help me write**: the household chat model drafts or tidies lyrics from a topic, a mood or a family story. It is a draft in the box; the person edits it before anything is made. No outbound call.
- Edit a line on an existing song, then remake only that section (the existing rewrite-section task).
- Timed lyrics highlight as sung (MUSIC-GEN-20, karaoke).
- The as-sung check (MUSIC-GEN-15) applies to every song whoever wrote the words; minor lanes and the child rewrite are unchanged.

### 3.2 Made bands and albums

New records, spec first in `commons/spec`, additive only:

| Record | Fields |
|---|---|
| `made-artist` | id, name, backstory, genre words, members (name, role, portrait file id), portrait and logo file ids, `style` words (reused as the prompt for every track), `origin: made`, `owner_person_id`, share pointer, provenance, clock stamp |
| `made-album` | id, title, `made_artist_id?`, year, cover file id, ordered `track_file_ids`, liner-notes text, `origin: made`, owner, share pointer, provenance, clock stamp |

- A track is a normal made song file; an album only orders them. Listen's Artists and Albums list made records next to library ones with a "Made here" badge; nothing else about the player changes.
- **Band creator**: one box, "Describe your band". The chat model writes the name, backstory, members and three album ideas; the picture job makes portraits, a logo and a cover; the song engine makes tracks from the band's `style` words so an album sounds like one band. Every piece is editable and re-makeable, old versions kept (the picture editor's version model).
- Guards: a made band is never named or drawn as a real artist or a real person; portraits are fictional people; family-likeness rules (likeness consent) apply unchanged; child and teen lanes open only with the safety slice (section 7, S8). Backstory text runs through the same text checks as chat.

## 3.3 Chat: every thing Create makes also has a chat tool and a card (owner, 2026-11-01)

Rule for this whole note, now a platform rule ([RULES.md](RULES.md) S7, owner-approved 2026-11-01, which also covers Videos' Watch and Create and Pictures): no slice is done until its chat half exists. Anything a person can make or change in Create can be asked for
in chat, and the result is the same Element in both places (rule 9: the kit Element as it ships, never a chat-only copy). This follows the
[chat cards standard](chat-cards-2026-10-18.md): a job that takes time uses a named tool-call card that polls the job (as the song card does
today); everything else is an answer block, a new `kind` added once in `commons` and drawn by `AnswerBlockView`.

| Make | Chat tool (conditional, rule 1: appears only when the turn needs it, with a bench row) | Chat card | Same Element in Create |
|---|---|---|---|
| Song | `generate_music`, `edit_music` (built) | `MusicTrack` song card (built) | Song page |
| **Lyrics** | `write_lyrics` (draft, tidy, rhyme a line, fit to a length; returns text only, no job) and `edit_lyrics` (change a line, then offer "Remake this part") | **Lyrics card** (answer block `lyrics`): sections, editable lines, "Use in a song", "Make it a song", copy; the same Element is the Lyrics box's editor in Create | Create's Lyrics box and the Song page lyrics tab |
| **Sound effect** | `make_sound` (description, length, loop; returns three takes) | **Sound card**: three takes with play, Loop toggle, "Stick to my words or Surprise me", Save to Sounds, "Add to a song" | Sounds maker |
| **Stems** | `split_stems` (a made song or an uploaded file the person owns) | **Stems card**: four rows with mute, solo, level, download, "Make a song from this mix" | Stems mixer |
| **Cover art** | existing picture tool with a song or album as the subject | picture card (built) | Song and Album pages |
| **Band** | `make_band` (description; the model writes name, back story and members, the picture job makes portraits and logo) | **Band card** (answer block `band`): portrait, name, back story, members, "Make an album", "Remake the logo" | Band page |
| **Album** | `make_album` (a band or a theme and a track count; queues the song jobs) | **Album card** (answer block `album`): cover, ordered tracks that play in place, progress while tracks are made, "Reorder", "Remake a track" | Album page |
| Practice | `change_song` for tempo and pitch (an `edit_music` task) | song card gains Slower, Key shift | Edit |
| Playlist and DJ (S9) | `make_playlist`, `play_queue` | playlist card (exists in the media shelf kinds) | Playlists |

Rules that apply to every row:
- **One definition each:** a card kind and a tool are defined once in `commons` spec (`answer-block` kinds, tool result schema) and bound once in `elementBindings.ts`; the Create pages bind the same kinds. Adding a kind is a commons change first, tagged, then the Home pin.
- **The model decides when to call a tool** (rule 1): no word list picks `write_lyrics` over `generate_music`. Each tool gets a bench row (right tool for "help me with the chorus", "make a door slam", "split this song", "invent a band") before it is allowed in the default tool set.
- **A failed tool never fails the answer** (rule): a failed `make_sound` returns a plain card line and the Status row, not an error bubble.
- **Gates apply at the tool, not the card:** age band, surface, as-sung check and likeness rules run in the tool exactly as for `generate_music`; the card only draws what the tool returned.
- **Resume in chat:** "Work on lyrics" opens the Lyrics card seeded from the current song; "Use in a song" hands the text to `generate_music` in the same turn, so a conversation can go lyrics, song, cover, album with no page change.
- **Voice and spoken surface:** spoken turns read a short summary and show the card on the shared screen only (as the song card does).

## 4. Edit

As the Studio note section 3.2 item 4: Trim, Fade, Loop a part, Rewrite a part, Extend, Style, Singer swap by description, Tempo, Pitch, Stems, Add a sound, Lyrics. Each tool previews, then applies as a new version.

## 5. Sound effects by resource tier

Evidence: research pass 2026-11-01 (model cards read; any figure not read from a card is marked unverified there).

| Tier | Engine |
|---|---|
| Reduced | not a pick; a sound job queues. Off on the smallest host (p16). |
| Standard | ACE-Step stings and loops (trim, ffmpeg crossfade at the seam). Default everywhere music exists. |
| Boost | Stable Audio 3 Small SFX (optional download) for foley: door, footstep, glass, whoosh, UI beep; more steps or a longer clip. |
| Max | same engines as Boost; long beds use the ACE-Step XL profile. No separate sound engine is invented for Max. |

Rejected: MMAudio and TangoFlux (non-commercial weights). Benches before the optional engine ships: offline load from a pinned
Mac conversion, memory and seconds per 10 s clip on the Studio and a p32 host, loop seam clicks on ten prompts, and a foley set
scored against ACE-Step trims. The bench decides whether the optional engine is worth shipping; it does not wait on any licence.

## 6. Practice, playlists, later

Practice mode (slower without pitch change, key shift, loop a part, tempo and key readout), prompt-to-playlist and an AI DJ over the
household library through the local chat model, similar-track radio, export and share, music video for a song, notes to MIDI.

## 7. Slices, in order

| # | Size | Slice | Done when |
|---|---|---|---|
| P1 | M | Playback and radio reliability (section 2), commons first | each P1 row's test or number passes; Jesse plays three stations from three shelves and all play |
| S1 | M | Listen/Create switch, Songs I made, Song page, versions, Download, Share | Sage switches to Create, opens a made song, steps versions |
| S2 | M | Create with recipes and **own lyrics** plus Help me write, cover art on every song | a recipe tap and a pasted lyric each make a song with a cover |
| S3 | S | Song actions on existing tasks (Extend, Style, Instrumental, Variation, Rewrite the chorus) | each adds one version, old stays |
| S4 | L | Stems for made songs and uploads, mixer, Make a song from this mix | a 3 min song splits in under 30 s; mute vocals, save as a new file |
| S5 | L | Made bands and albums (spec first, then Home, then Create pages) | "Describe your band" yields a band with art and back story, then a four-track album that plays in Listen |
| S6 | L | `AudioEditor` Element and peaks; Trim, Fade, Loop, Rewrite a region | drag a region, type the change, get a version |
| S7 | M | Sounds maker (ACE-Step first, optional engine after its bench) | three sounds from one prompt in under 20 s; a loop has no seam click |
| S8 | M | Child and teen lanes (rewrite, floors, as-sung check, cartoon art) | each safety row passes its own test; a hit withholds and deletes |
| S9 | M | Practice mode, then prompt playlists and the AI DJ | 0.8x keeps pitch within a measured tolerance; a spoken request builds a queue |
| S10 | S | Export and share, privacy check on every new worker (MUSIC-GEN-08) | zero outbound connections asserted |

Each slice ships its chat tool and card with it (section 3.3): a slice is not done until the same thing can be asked for in chat and draws the same Element. Each slice goes to Codex or the local lane as one-to-three-file briefs with a failing test; commons work is its own worktree.
