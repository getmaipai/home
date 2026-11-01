# Music: Listen and Create, bands, lyrics, playback (design draft, 2026-11-01)

Status (2026-11-01): proposed; architect ruling pending. No code. Item: MUSIC-STUDIO-01 (amended). This note amends
[music-studio-2026-10-31.md](music-studio-2026-10-31.md); where they differ, this note wins.

Owner answers that shaped this note (Jesse, 2026-11-01): one Music app split into Listen and Create (a separate app would not be found); stems accept anyone's own recordings; playback reliability first; "we should be able to create everything", including cover art, made bands with art and back story, albums with tracks, and our own lyrics; licences are accepted by the home owner through the existing install prompt (LICENCE-ACK-01) and no slice waits on one.

## 1. Supersedes

From [music-studio-2026-10-31.md](music-studio-2026-10-31.md):
- Section 3.1 placement (an own `music-studio` package): replaced by one Music package with Listen and Create modes. Q1 is answered. Q6 is answered by the media-editors ruling (kit `src/elements` parts such as `MusicTrack` may be used on non-chat pages under rules 9 and 9b).
- Section 4 "your own recordings" row and Q3: replaced by section 3.4 below. Voice, cover and edit sources stay closed; MUSIC-GEN-14 is still Jesse's decision.
- Q2 (sound effects licence): not a question; no slice waits on a licence. This replaces the "bench and licence gate first" wording of MUSIC-GEN-11: the bench stays, the licence gate goes.
- The slice list C1 to C10: replaced by P1 and C1 to C10 in section 7 (renamed so they do not clash with RULES.md C7).

From the backlog:
- MUSIC-STUDIO-01's "MUSIC-GEN-14 and TIER-STEMS-02 stay Jesse's decisions": TIER-STEMS-02 is built (owner ruling 2026-10-31); MUSIC-GEN-14 stays his.
- MEDIA-MUSIC-01's "no album or artist tables" stays: made bands and albums join the derived Artists and Albums views (section 3.2).
- The stem note ([stem-splitting-2026-10-30.md](stem-splitting-2026-10-30.md)) section 10.2 is not superseded; section 3.4 below keeps its points 1, 3 and 5.
- [media-editors-2026-10-31.md](media-editors-2026-10-31.md) is not superseded: the Photo editor and the Video editor stay their own pinnable apps (see RULES.md C7(b)).

## 2. Playback comes first (P1)

Audit 2026-11-01 (code read plus a real run on the dev hub): no gapless or crossfade code exists in the player; the Radio page
told people "This station is no longer available" because each shelf replaced the household's whole list of playable stations
(fixed and landed: `radioDirectory.ts`, commit 8e8d5f024; a station now stays playable for ten minutes after it was shown).
The audio element and mini player are kit parts, so shaping them is a commons change first (rule 9).

Reuse check (org principle 6): the player is the kit `Player` Element, so every P1 change is commons first (rule 9(c)). Prebuilt options considered: Media Chrome and the Web Audio API for crossfade and gapless seams (use the Web Audio API's own scheduling inside the Element; add a maintained gapless library only if it measures better on the seam fixture), and `hls.js`, already pinned for HLS stations. The reconnect "Try again" and the dead-station "Find it again" lines are the `Player`'s own states or the S6 row "A form or action failed": no new toast or banner. Not a duplicate of RADIO-02, RADIO-03 or RADIO-07, which built the station pages and the mini player this builds on.

P1 rows, each with a failing test or a measured number:
1. Stream reconnect: a live station that drops retries with backoff, then offers "Try again", never an empty page. Fixture: an ICY server that closes mid-stream.
2. Station page resolves a saved or just-shown station from the id alone (a stale link after a restart says "Find it again" with the Radio button, not a dead end).
3. Gapless between two songs of one album; crossfade as a person setting (off, 3 s, 6 s). Measured: no silence over 50 ms at the seam on a fixture pair.
4. Queue survives a reload (play next, add to queue, reorder).
5. Sleep timer, media keys and lock-screen controls checked against the shared shell audio session (media apps blend note, section 12).

## 3. Create: make everything

Create is simply absent for a person whose music lane is off (the studio note's rule stands, and rule 0 governs an adult's lane); the switch then shows only Listen.

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
- The as-sung check (MUSIC-GEN-15) applies to every song whoever wrote the words. For an adult it withholds only for CSAM (rule 10); minor lanes and the child rewrite are unchanged.

### 3.2 Made bands and albums

Reuse first. Music's Artists and Albums are derived views over `media-item` (MEDIA-MUSIC-01: no artist or album tables) with detail pages that use the collection `creation_header` ([media-detail-pages](media-detail-pages-2026-10-25.md)). So:
- A made song's `media-item` carries artist and album fields (additive, spec first in `commons`); made songs reach Artists and Albums through the same derived views as library songs, with a "Made here" badge.
- The Band page and the Album page are the existing Music artist and album pages, extended additively (backstory, members, liner notes). There is no second album page.
- Only what `media-item` and `media-collection` cannot hold gets a record, spec first, additive (org principles 4 and 6): `media-item` already has `artist` and `album`, so a band needs only `made-artist`; an album is a `media-collection` of kind `album`, because that record already is an ordered list of media references. A second album record would be a duplicate.

| Record | Fields |
|---|---|
| `made-artist` | id, name, backstory, genre words, members (name, role, portrait file id), portrait and logo file ids, `style` words (the prompt reused for every track), `origin: made`, `owner_person_id`, share pointer, provenance, clock stamp |
| album | not a new record: a new `album` kind of the existing spec `media-collection` (a person's ordered references to media items), plus additive `cover_file_id` and `liner_notes` fields; title, year and tracks come from the track items' album fields |

- A track is a normal made song file; an album only orders them.
- **Band creator**: one box, "Describe your band". The chat model writes the name, back story, members and three album ideas; the picture job makes portraits, a logo and a cover; the song engine makes tracks from the band's `style` words so an album sounds like one band. Every piece is editable and re-makeable, old versions kept (the picture editor's version model).
- Defaults and guards: the band creator's default prompt asks for a fictional band and fictional people. That is a default, not a block for an adult (the adult-content rule: no classifier or likeness gate on an adult's request). Family subjects follow rule 0's household option. A minor's lane keeps its floors (C8). Backstory text runs through the same output gate as chat (rule 10).

### 3.4 Stems from a person's own file

Jesse answered "everyone" (2026-11-01). The approved stem note keeps these, unchanged: any child or teen cannot split a file (10.2 point 1); the stems of an owned file are not recorded in the made-here ledger, so they can never be a trim, edit or cover source for anyone (10.2 point 3); there is no consent step (10.2 point 5). So every person the music gates allow (the stem note refuses minors) splits a file they own, mixes it and downloads the result; a mix of an uploaded file's stems exports as a download and is not saved as a made song. "Make a song from this mix" applies to the stems of songs made here. Open for Jesse, one question: does "everyone" also mean teens and children (which would change 10.2 point 1)? Until he says so, the stem note stands.

## 3.3 Chat: every thing Create makes also has a chat tool and a card (owner, 2026-11-01)

Rule for this whole note, now a platform rule ([RULES.md](RULES.md) S7, owner-approved 2026-11-01, which also covers Videos' Watch and Create and Pictures): no slice is done until its chat half exists. Anything a person can make or change in Create can be asked for
in chat, and the result is the same Element in both places (rule 9: the kit Element as it ships, never a chat-only copy). This follows the
[chat cards standard](chat-cards-2026-10-18.md): a job that takes time uses a named tool-call card that polls the job (as the song card does
today); everything else is an answer block, a new `kind` added once in `commons` and drawn by `AnswerBlockView`. The new cards (Lyrics, Sound, Stems, Band, Album) are kit Elements in `commons`, never Home `*Card` components (rule 9(b)). Reuse check before each: `MusicTrack`, `Player`, `MediaShelf`, `CreationHeader` and the shadcn `Textarea` (the Lyrics editor is a `Textarea` with section markers, not a new editor), and against the existing `spec_sheet` and playlist answer-block kinds. The commons slice for each new Element adds its row to `UI-DECISIONS.md` (rule 9b ledger) before the Element is written.

| Make | Chat tool (conditional music set, rule 1) | Chat card | Same Element in Create |
|---|---|---|---|
| Song | `generate_music`, `edit_music` (built) | `MusicTrack` song card (built) | Song page |
| **Lyrics** | `write_lyrics` (draft, tidy, rhyme a line, fit to a length; returns text only, no job) and `edit_lyrics` (change a line, then offer "Remake this part") | **Lyrics card** (answer block `lyrics`): sections, editable lines, "Use in a song", "Make it a song", copy; the same Element is the Lyrics box's editor in Create | Create's Lyrics box and the Song page lyrics tab |
| **Sound effect** | `make_sound` (description, length, loop; returns three takes) | **Sound card**: three takes with play, Loop toggle, "Stick to my words or Surprise me", Save to Sounds, "Add to a song" | Sounds maker |
| **Stems** | `split_stems` (a song made here, or a file the person attached in this conversation; never a browse of the Library, which stem note 10.1 point 2 keeps closed) | **Stems card**: four rows with mute, solo, level, download, "Make a song from this mix" | Stems mixer |
| **Cover art** | existing picture tool with a song or album as the subject | picture card (built) | Song and Album pages |
| **Band** | `make_band` (description; the model writes name, back story and members, the picture job makes portraits and logo) | **Band card** (answer block `band`): portrait, name, back story, members, "Make an album", "Remake the logo" | Band page |
| **Album** | `make_album` (a band or a theme and a track count; queues the song jobs) | **Album card** (answer block `album`): cover, ordered tracks that play in place, progress while tracks are made, "Reorder", "Remake a track" | Album page |
| Practice | `change_song` for tempo and pitch (an `edit_music` task) | song card gains Slower, Key shift | Edit |
| Playlist and DJ (C9) | `make_playlist`, `play_queue` | playlist card (exists in the media shelf kinds) | Playlists |

Rules that apply to every row:
- **One definition each:** a card kind and a tool are defined once in `commons` spec (`answer-block` kinds, tool result schema) and bound once in `elementBindings.ts`; the Create pages bind the same kinds. Adding a kind is a commons change first, tagged, then the Home pin.
- **What earns the music tools on a turn (rule 1, no word rule):** the music lane is open for the person (`generation.music.enabled` and the person's band) and one of: the turn is in the Music app or pane, a song, a lyrics card or an audio file is in the conversation, or the person pressed a Create action. Then one set is offered, never all: Song (`generate_music`, `edit_music`, `change_song`, `write_lyrics`, `edit_lyrics`), Sound (`make_sound`, `split_stems`), Band (`make_band`, `make_album`), Playlist (`make_playlist`, `play_queue`). The set follows the surface or the object in the conversation. At most 5 music tools on any turn, so with the base ten the total is 15, under rule 1's cap of 16. The model still decides which offered tool to call. Each tool gets a bench row ("help me with the chorus", "make a door slam", "split this song", "invent a band") before it is allowed in the conditional music set.
- **A failed tool never fails the answer** (rule 6): the model is told only the kind of failure and answers in its own fresh words (no stored wording); the card shows the job's state through the existing S6 one-job-progress row, never an error bubble.
- **Gates apply at the tool, not the card:** age band, surface and the as-sung check (CSAM only, for an adult) run in the tool exactly as for `generate_music`; family subjects follow rule 0's household option; the card only draws what the tool returned.
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

The Boost and Max engine choice never reaches a minor (rule 8: a minor never gets model choice). Rejected: MMAudio and TangoFlux (non-commercial weights). Benches before the optional engine ships: offline load from a pinned
Mac conversion, memory and seconds per 10 s clip on the Studio and a p32 host, loop seam clicks on ten prompts, and a foley set
scored against ACE-Step trims. The bench decides whether the optional engine is worth shipping; it does not wait on any licence.

## 6. Practice, playlists, later

Practice mode (slower without pitch change, key shift, loop a part, tempo and key readout), prompt-to-playlist and an AI DJ over the
household library through the local chat model, similar-track radio, export and share, music video for a song, notes to MIDI.

## 7. Slices, in order

| # | Size | Slice | Done when |
|---|---|---|---|
| P1 | M | Playback and radio reliability (section 2), commons first | each P1 row's test or number passes; Jesse plays three stations from three shelves and all play |
| C1 | M | Listen/Create switch, Songs I made, Song page, versions, Download, Share | Sage switches to Create, opens a made song, steps versions |
| C2 | M | Create with recipes and **own lyrics** plus Help me write, cover art on every song | a recipe tap and a pasted lyric each make a song with a cover |
| C3 | S | Song actions on existing tasks (Extend, Style, Instrumental, Variation, Rewrite the chorus) | each adds one version, old stays |
| C4 | L | Stems for made songs and adults' own files (section 3.4), mixer, Make a song from this mix (made songs only) | a 3 min song splits in under 30 s; mute vocals, save as a new file |
| C5 | L | Made bands and albums (spec first, then Home, then Create pages) | "Describe your band" yields a band with art and back story, then a four-track album that plays in Listen |
| C6 | L | `AudioEditor` Element and peaks; Trim, Fade, Loop, Rewrite a region | drag a region, type the change, get a version |
| C7 | M | Sounds maker (ACE-Step first, optional engine after its bench) | three sounds from one prompt in under 20 s; a loop has no seam click |
| C8 | M | Child and teen lanes (rewrite, floors, as-sung check, cartoon art) | each safety row passes its own test; a hit withholds and deletes |
| C9 | M | Practice mode, then prompt playlists and the AI DJ | 0.8x keeps pitch within a measured tolerance; a spoken request builds a queue |
| C10 | S | Export and share, privacy check on every new worker (MUSIC-GEN-08) | zero outbound connections asserted |

Each slice ships its chat tool and card with it (section 3.3): a slice is not done until the same thing can be asked for in chat and draws the same Element. Each slice goes to Codex or the local lane as one-to-three-file briefs with a failing test; commons work is its own worktree.
