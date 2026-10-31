# Music Studio: design draft (2026-10-31)

Status (2026-10-31): proposed; architect re-ruling pending; Q1 and Q6 wait on Jesse before S1. No code. Item: MUSIC-STUDIO-01.
Research date 2026-10-31. Web facts come from search snippets and a few fetched pages; anything marked (unverified) was not read
at its primary source and must be checked before a row is built on it.

## Supersedes

- music-generation-2026-10-17.md section 10 (the "studio later, not designed here" stub).
- music-generation-2026-10-17.md section 9 absolute line (2) `imitates_real_voice` and its mention near line 574 (stale; the code dropped it; rule 0 overrides it).
- stem-splitting-2026-10-30.md section 4 title "no new surface" (this note adds the stem mixer).
- stem-splitting-2026-10-30.md section 5.4 (a stem becomes a mix source, not only a trim and fade source).
- The old one-line MUSIC-STUDIO-01 row.
- Rows folded into slices: MUSIC-CARD-EDIT-01, MUSIC-GEN-08, -09, -11, -15, -17, -18, -19, -20, -21, -22, CONTENT-POLICY-04.
- Not absorbed: TIER-STEMS-01 (slice S4 builds it as its approved note says); MUSIC-GEN-14 and TIER-STEMS-02 stay Jesse's decisions (Q3).

## 0. Answer in five lines

1. Higgsfield has no music or song product. It is an image and video studio; its audio is voices (Speak, Change Voice, Translate), lip sync, and
   sound that rides inside video models. The thing worth copying is its shape (presets, one create surface, remix a reference), not a music feature.
   The real models to copy for music are Suno (Studio, stems, Reuse prompt), Udio (section edit), ElevenLabs (sound effects) and Moises (practice tools).
2. Home already has most of the engine: song generation, nine edit tasks, versions, covers, timed lyrics, a stems path designed and approved. What is
   missing is a place to do it that is not a chat bubble.
3. Proposal: **Music Studio**, an app package launched from the Music app ("Make music") and from the chat song card ("Open in Studio").
   Songs, Create, Song page, Edit, Sounds, Export. Same jobs, same records, same gates as chat.
4. One new kit Element (`AudioEditor`, waveform with region select, wrapping an existing library) plus a stem mixer row. Everything else reuses.
5. Ten slices, S1 to S10, adults first; teens and children open only when the shared text check (CONTENT-POLICY-01) and MUSIC-GEN-15/22 land.

## 1. What exists today

### 1.1 Built (read from code and BACKLOG, 2026-10-31)

| Piece | Where | State |
|---|---|---|
| Song engine: ACE-Step 1.5 turbo 2B, 5 Hz planning LM 1.7B/0.6B, MIT | Stack `backend/src/music/*` (`music_worker.py`, `jobs.ts`, `provenance.ts` made-here ledger) | built (MUSIC-GEN-01, -02) |
| Home jobs, gates, tools `generate_music`, `edit_music` | `backend/src/lib/music/{jobs,tool,store,policy,sections,cover,commercial,ready}.ts` | built (MUSIC-GEN-03) |
| Edit tasks in `tool.ts` | remake, restyle (cover), instrumental, rewrite_section (repaint), extend, variation, trim, fade, loudness, make_full, make_quick, stems | built; `stems` is wired in the tool and in `musicApi.stems`, the Stack worker is TIER-STEMS-01a (not built) |
| Versions, "Use this version", Make it full/quick, Boost, revise, new cover | `frontend/src/lib/musicApi.ts` -> `/api/music/jobs/:id/*` | built |
| Card in chat | kit `MusicTrack` (commons `elements/music-track.tsx`), Player audio layout, version stepper | built (MUSIC-GEN-04); card is `max-w-xl` fixed |
| Commercial-use flag per track, export refusal | `commercial.ts`, spec `GenerationProvenance` | built |
| Cover art through the picture job | MUSIC-GEN-19 | partly built |
| Music app (Albums, Artists, Songs, Liked, playlists, radio) and the Created by you shelf | catalog package `backend/packages/music`, `media-item` records | built (MEDIA-MUSIC-01); Save to Music still open |
| Picture editor pattern | kit `image-editor.tsx` + `image-editor-state.ts` (versions cursor, Original, Undo, preview then apply as a new version) | built; the copy-this-shape source |

Measured speeds (music note section 4): a new 30 s song 16 to 26 s, an edit 3.5 to 7 s, stems on a 40 s song 1.8 to 4.5 s at 1.2 GB (TIER-EVAL-07).

### 1.2 Planned in the backlog (the design must absorb, not duplicate)

MUSIC-GEN-08 privacy check; -09 Save to Music + shelf; -10 ACE-Step XL turbo as the detailed profile; -11 Stable Audio for beds and effects (licence gate);
-12 stems (absorbed by TIER-STEMS-01); -14 uploaded audio (decision for Jesse); -15 check the sung words (Whisper in the worker); -17 sung words fit lyrics;
-18 card shows while made; -19 cover art; -20 karaoke; -21 length follows words; -22 teens and children make songs (child request rewritten, not refused);
MUSIC-CARD-EDIT-01 full-width card + Library item endpoint; CONTENT-POLICY-04 songs consume policy; TIER-STEMS-01 (approved note
`stem-splitting-2026-10-30.md`), TIER-STEMS-02 (uploads, Jesse); MUSIC-STUDIO-01 (the stub this draft replaces).
Done already: -01 to -07, -13 (superseded by -22), -16, MUSIC-SPEC-01/02.

## 2. What the products do (and what to model after)

### 2.1 Higgsfield, honestly

Checked: the homepage (fetched), its help centre and blog results. Findings:
- No song, music or sound-effect generator is listed. Products named: Cinema Studio, Genjutsu (recast the motion of a reference with your own
  characters; "View all presets"), Content Factory (trending styles into ready-to-post series), AI Influencer Studio, Playable, an MCP for Claude.
- Audio is three things: **Audio** tool (voiceover, Change Voice, Translate), **Lipsync Studio** (add a talking mouth to a picture or clip, pick a model),
  and sound inside video models (Kling 3.0, Seedance 2.0, Wan 2.5 are described as making effects, speech and music synced to the picture).
- Third-party guides pair Higgsfield (video) with Suno (music) for music videos: you bring a song, it makes the visuals.
- Much Higgsfield-hosted text is SEO marketing; weight it low. A 2026 "Higgsfield Music" launch was searched for and not found.

What to take from it: presets as the front door, one create surface where the model is chosen for you, "take this reference and recast it", series
(make many of the same kind), and the music-video pairing (Home makes video: "Make a video for this song" is a natural later slice).

### 2.2 The music products (what a family would use)

| Product | Does | Note |
|---|---|---|
| Suno (v5.5, Studio 2.0) | Simple and Custom create; Extend, Cover, Remix, Reuse prompt in a three-dot menu; Personas; Voices (record once, verified); Stem separation with Auto Split (12 categories) and Advanced Split (Premier); Sounds (one-shots and loops, Jan 2026); MIDI edit; clip stretch and fade curves (Oct 2026) | Cloud, paid tiers. Release notes fetched. |
| Udio (v3, 2026) | "Magic Edit": regenerate a selected section only; 48 kHz stems (sources conflict) | Downloads reported locked since Oct 2025 after a label settlement (blogs, unverified). A local app can promise "always yours". |
| ElevenLabs Music + Sound Effects | Composition plan with sections; inpainting by section (enterprise API); Sound Effects v2: duration, prompt influence 0 to 1, Loop toggle | Cloud. Docs partly third-party. |
| Moises | Stems, speed change without pitch change, pitch shift, live chord display, loop a section, practice mode | Best fit for family practice and karaoke. |
| BandLab | Free 2 and 4 stem splitter, browser multitrack DAW | Multitrack is too big for v1. |
| Stable Audio / AudioLDM2 | Text to sound effect and short loops | Local candidates, section 3.4. |
| Splice, LANDR, Adobe Podcast Enhance | Sample library, mastering, speech cleanup | Not searched successfully (results did not cover them). Splice is a store: no local analogue. LANDR = our loudness task. Enhance = needs uploads (MUSIC-GEN-14). |

### 2.3 Ideas ranked (use for families, then cost)

1. **Recipes: tap a style, get a song.** A shelf of cards (Bedtime lullaby, Birthday song, Road-trip rock, Chore-time beat, Family theme) and "Make one like
   this" on every song the household made (Suno Reuse prompt, Higgsfield presets). Cheapest, biggest effect for a non-musician. Words: "Start from a recipe".
2. **Two-level Create.** One box ("Describe your song"), toggles for Lyrics and Instrumental; "More options" opens style, length, tempo, key (Suno Simple vs
   Custom). Home's Quick/Full already maps to length.
3. **Song page with three-dot actions.** Extend, Change the style, Instrumental, Make a variation, Rewrite the chorus, Split into stems, Make a video (later).
   Versions as a stepper; old versions never lost.
4. **Stem mixer.** Vocals, drums, bass, other as four rows with Mute and Solo; "Just the music" (karaoke) and "Just the singing"; Download each. Moises/Suno.
5. **Region edit.** Drag over the waveform, say "make this part quieter and calmer", get a new version (Udio Magic Edit, repaint task exists).
6. **Practice tools.** Slower without changing pitch, shift the key, loop a part, show tempo and key (Moises). Fits karaoke (MUSIC-GEN-20) and kids learning an instrument.
7. **Sound effects maker.** "Describe a sound", a length, "Loop it", "Stick to my words / Surprise me" (ElevenLabs prompt influence in plain words). Use in videos, games, storytime.
8. **Make a video for this song / cover art / lyric video.** Higgsfield-style pairing, reuses the video engine and MUSIC-GEN-19. Later slice.
9. **Series.** "Make three more bedtime songs like this one" (Content Factory idea). Later.
10. **Own voice.** Suno Voices and personas. Not a v1 slice: it needs recorded uploads (closed until MUSIC-GEN-14, Q3). Not a content block for adults.

## 3. The proposed app

### 3.1 Placement

An app package `music-studio` in `getmaipai/catalog`, shipped in the default set, built like the Music package (JSON pages in
`backend/packages/music/pages` plus bound Elements). It is not a second Music app: Music is for listening (Albums, Artists, radio); Studio is for making.
Entry points: a "Make music" button on Music's Listen now page, "Open in Studio" on the chat song card, and the Library's song viewer. No new nav for a
child whose lane is off (the app is simply absent, as Videos' generation is).

### 3.2 Screens

1. **Songs** (Library of what I made). Square cards (kit `MediaShelf` square, `MediaGrid`), filters Mine / Shared with me / Stems / Sounds. Card shows
   cover, title, length, a "Remix" chip. Empty state with the recipes shelf. Reuses the Created by you listing (no second list).
2. **Create.** Left: the form (Describe, Lyrics, Instrumental, Quick or Full, More options: tempo, key, language, Standard or Boost where offered).
   Right: recipes shelf, then the stage card while it makes (kit `GenerationStage`, `job-progress`, the S6 busy line). Output opens the Song page.
3. **Song page.** The `MusicTrack` Element at full width (`width="full"`, MUSIC-CARD-EDIT-01), version stepper, lyrics with timed highlight, cover with
   New cover, details (title, who made it, Private/Shared chip via `CreationHeader`, licence line from `commercial.ts`), and an **Edit** button group.
4. **Edit** (a mode of the Song page, split view like `image-editor.tsx`: tool strip left, canvas center, versions bottom).
   Tools, in order of build: Trim, Fade, Loop a part, Rewrite part (region + words), Extend, Style (restyle), Singer swap (see below), Tempo, Pitch,
   Stems, Add a sound, Lyrics (edit words, then remake the sung part). Every tool previews, then **Apply as a new version** (picture editor model:
   Original, Undo, nothing destructive).
   - **Singer swap** v1 means a different described voice ("a choir", "a deep storyteller voice", instrumental), through the existing cover task. It needs no
     recording; a real voice would need an upload, which is closed until MUSIC-GEN-14 (Q3).
   - **Add a sound** mixes a sound effect from the Sounds maker at a time on the waveform (offset and level); render is a `mix` job (ffmpeg, no model).
5. **Stems** view (opened by Split into stems): four rows, each a small waveform with Mute, Solo, level, Download; "Make a new song from this mix"
   renders a `mix` job to a normal song file. Silent stems are left out (stem note section 1).
6. **Sounds maker.** One box, length (1 to 11 s), Loop toggle, "Stick to my words / Surprise me", three results at a time, Save to Sounds shelf, "Use in a song".
   Teen and child get the same screen with the safe rewrite (section 4).
7. **Export and share.** Download (AAC now; WAV and MP3 as added encodes), stems as one zip, Share by the household share pointer (any file),
   cover and lyrics file. The licence line says in plain words if a track is personal use only (blocks only an export for money, `?purpose=commercial`).

Copy follows the dad test (grade 6): "Make a song", "Change this part", "Split into singing, drums, bass and the rest". No model names in the UI.

### 3.3 Records (spec first in `commons/spec`, additive only)

No new store for songs: a song is a `file` (`origin: made`, `kind: audio`) plus Home's `music_jobs` row, as today.

| Record | Change | Why |
|---|---|---|
| `GenerationProvenance` | add enum values `task`: `stems` (already used), `mix`, `tempo`, `pitch`, `loop`, `sfx`; `kind`: `sound`; optional `stems_of` (job id) and `stem_role` (vocals, drums, bass, other, guitar, piano) | one definition for every derived track; `commercialUseOf` already walks parents |
| `song-style` (new) | `id`, `title`, `description` (the style words, never lyrics), `instrumental`, `length`, `bpm?`, `key?`, `language?`, `origin` (`starter` or `household`), `owner_person_id?`, `source_file_id?`, `clock stamp` | "Make one like this" and the starter shelf; a recipe is the person's own words, so it follows the job record's rule 6a (not logged) |
| `media-item` | sound effects are `media-item` records with `kind: "sound"` (not a tag); additive enum value in spec first | Sounds shelf without a second library |
| `HouseholdSetting` | none. `generation.music.enabled` and the picture lane switches already cover Studio | principle 1, no new setting |

Mix levels, trim points and loop regions live in `music_jobs.request` (as `edit` does today) and the output is a normal file; no `project` file format in v1.
A multitrack project record is explicitly not proposed (BandLab-scale work; revisit after S7).

### 3.4 Stack engines per feature, with licence and local feasibility (Mac Studio 128 GB)

| Feature | Model / tool | Licence | Feasibility | Status |
|---|---|---|---|---|
| Song, extend, cover, repaint, remake | ACE-Step 1.5 turbo 2B + LM | MIT | measured on the Studio | built |
| Better quality | ACE-Step 1.5 XL (4B, April 2026; xl-turbo) | MIT per a conversion's card (unverified at ACE-Step's own repo) | 20 GB weights, official guidance 20 GB+ without offload; fits | MUSIC-GEN-10, bench first |
| Stems | Demucs `htdemucs` (4), `htdemucs_6s` (adds guitar, piano) | code MIT; repo archived Jan 2025 (fork under adefossez); a Hugging Face thread questions the weights' MIT tag because of MUSDB terms (user claim) | measured 1.8 to 4.5 s, 1.2 GB (TIER-EVAL-07) | approved note; **re-read the weights licence before the pin lands** |
| Stems, stronger | BS-RoFormer / Mel-Band RoFormer | no clearly permissive weights with a Mac path (TIER-EVAL-07) | not used | rejected for now |
| Sung-word check, lyric timing | Whisper large-v3-turbo | MIT | 4.9 s per 60 s, 2 GB (measured in note 18.1) | MUSIC-GEN-15 |
| Timed lyrics for karaoke | ACE-Step `lrc` output (squeezed lines fixed by MUSIC-GEN-17/21); Whisper alignment as fallback | MIT | built | MUSIC-GEN-20 |
| Tempo (no pitch change), pitch, loop, fade, trim, mix, loudness | ffmpeg filters (`atempo`/`asetrate`) first; Rubber Band or SoundTouch only if quality demands | ffmpeg LGPL/GPL by build; Rubber Band is GPL or paid; SoundTouch LGPL (from memory, verify the build) | no model, instant | S6 |
| Key and tempo readout | librosa (ISC, from memory) | verify | CPU, instant | S6 |
| Notes to MIDI | Spotify basic-pitch | Apache-2.0 (from memory, verify) | tiny, CPU | later (S10) |
| Sound effects | Stable Audio Open Small (about 11 s, runs on a phone) or Stable Audio 3.0 | Stability Community Licence: free under $1M yearly revenue, so tracks are `personal_only` | local, fast | MUSIC-GEN-11, Jesse's licence call (Q2) |
| Sound effects, no-licence fallback | ACE-Step instrumentals trimmed (a sting is a trim of 10 s+) | MIT | works for stings and beds, weak for foley (bench) | S7 first cut |
| Sound effects, rejected | AudioLDM2 (weights believed non-commercial, unverified), MusicGen/AudioCraft (CC BY-NC, music note), MiniMax Music 3 (revenue + branding clause) | | | no |
| Second song engine to bench | HeartMuLa 3B (Apache-2.0 since Jan 2026, official repo; Mac path unknown); DiffRhythm 2 (Apache per search result, not read); YuE2 (non-commercial per earlier note) | | HeartMuLa only if it has a Mac path | optional, Q4 |

All engines run as Stack uv environments with pinned hashes, offline at run time, one JSON-lines worker, queue class "tool job" (stems, mix, sfx)
or `generator` (songs), per the tiers memory note. `mix`, `tempo`, `pitch`, `loop` need no model, so they ride the music worker's `edit` task.
New Stack endpoints, all additive: `POST /v1/audio/stems` (designed), `POST /v1/audio/sound`, `edit` ops `tempo|pitch|loop|mix`, `GET .../peaks`
(waveform peaks as a small JSON array so the browser never decodes a song).

### 3.5 Kit Elements and parts

Reused as shipped (rule 9, no `className` shaping, no wrapper):
`MusicTrack`, `Player` (audio layout), `GenerationStage`, `job-progress`, `Progress`, `MediaShelf`/`MediaGrid`, `SplitView`, `Select`, `Chip`, `EmptyState`,
`DestructiveConfirm`, `CreationHeader`, `ShareDialog`, `image-editor-state.ts` (`stepVersion`, Original/Undo model), `Wizard` for first-run only,
the Library listing, the Music package pages and `media-item` records, Save to Music (MUSIC-GEN-09), cover art through the picture job (MUSIC-GEN-19),
karaoke `timedLyrics` (MUSIC-GEN-20), `commercial.ts`, `musicProtections` seam.

New in `commons` (own worktree, Elements decision row first; Jesse says yes to any new tag):
1. `AudioEditor` Element: waveform from supplied peaks, playhead, region select and loop brackets, zoom, emits `onRegion`, `onSeek`. Prebuilt over hand-built
   (principle 6): wrap wavesurfer.js with its Regions plugin (BSD-3, from memory, verify) behind the Element's props; no network access in the Element.
   Rule 9b reuse check, in the order the rule requires, each step a row in `docs/design/UI-DECISIONS.md` (the 9b ledger, not ELEMENTS-DECISIONS.md):
   (a) the shadcn registry first: it has nothing for audio or waveform; (b) Kibo UI for the named gap (waveform and region select): it lists no
   waveform or audio editor component that I found (unverified, re-check its registry before the row); (c) only then wavesurfer.js. The Song page
   is a non-chat surface, so it falls under 9b too, and it shows `MusicTrack` (Q6).
2. `StemRow` (or an `AudioEditor` `lanes` prop): label, mini waveform, Mute, Solo, level. Prefer a prop on `AudioEditor` over a second Element.
3. `MusicTrack` `width="full"` and an `actions` prop for the Edit and Split buttons (already half-asked in MUSIC-CARD-EDIT-01).
4. Check whether the kit has a slider and a toggle in its shadcn base; if not, they join the commons row, not a Home copy.

## 4. Who may do what (rules, no setting lifts them)

Rule 0 age and surface gates run first. The lane is the picture lane (`laneOf`), as in note 18.7. Written screens only; never a guest, a spoken turn,
a glance, a TV, a robot or a pod. All text (description, lyrics, title, recipe words, sound words, and the sung words) passes `musicProtections`.

| | Adult | Teen | Child |
|---|---|---|---|
| Create song | yes, own filters apply | yes when pictures allowed (lane switch), floors on lyrics and as-sung words | yes, **Quick only**; request rewritten kid-friendly (note 18.7), fixed gentle fallback, cartoon covers |
| Edits on a song they made (trim, fade, loop, tempo, pitch, stems, mix, extend) | yes | yes | yes for trim, fade, loop, tempo, pitch, stems, mix (no new words enter); extend, rewrite and restyle re-run the rewrite and the as-sung check |
| Lyrics edit | yes | yes, floors | words go through the rewriter first |
| Sound effects | yes | yes, text floors | yes, rewritten request; no violence or horror sounds (the child list, in the shared check, never in `lib/music`) |
| Singer swap | described voices; no voice block | described voices | described voices |
| Upload audio to split or edit (a feature-and-source gate, not a content block) | closed until MUSIC-GEN-14 / TIER-STEMS-02 | closed | closed |

- Adults: the only content check is the direct CSAM check (`backend/src/lib/music/policy.ts` `refuseMusicPrompt` refuses only `minor_sexual`). Rule 0
  (adult content paragraph, owner-approved 2026-10-26; `adult-content-model-decides-2026-10-26.md` line 9 lists "real-voice restriction" as not allowed
  for music) means no block on cloned, imitated, household-member or named-singer voices. Children and teens keep their band filters, with no real-voice category.
- The minor line on every text and rule 6a (nothing logged) hold in every row.
- Teen and child lanes stay closed until CONTENT-POLICY-01 supplies the shared text check and MUSIC-GEN-15/22 add the as-sung transcript. The Studio
  ships to adults first; the app package checks the same `musicViewDenial` the chat card does.
- Stems, mixes and sounds are made songs with provenance, so a child cannot use a stem as a voice or cover source (stem note section 5.4).
- Failures use the `failureCopy.ts` plain lines and Status rows (rule S6); engine down disables the button with the reason, never a raw error after a click.
  The source is a `music` row in `backend/src/lib/roleHealth.ts` through `healthSnapshot`, read the way frontend `useMakingAvailability` reads it; no polling loop of its own.
- Nothing leaves the home: no cloud model, no sample store, no outbound call (privacy test MUSIC-GEN-08 extends to every new worker).

## 5. Slices, in order

| # | Size | Slice | Done when | Absorbs |
|---|---|---|---|---|
| S1 | M | Studio shell: package, Songs screen, Song page (full-width `MusicTrack`, versions, Download, Share, licence line), Library item endpoint | Sage opens Studio, sees her made songs, opens one, steps versions, downloads | MUSIC-CARD-EDIT-01, MUSIC-GEN-09 (Save to Music), MUSIC-GEN-18 |
| S2 | M | Create screen and starter recipes; `song-style` spec + "Make one like this" | A recipe tap produces a song with no chat; a saved recipe reuses the style words only | MUSIC-GEN-19 cover, MUSIC-GEN-20 karaoke, MUSIC-GEN-21 |
| S3 | S | Song actions on existing tasks: Extend, Change the style, Instrumental, Variation, Rewrite the chorus (lyric sections, no waveform yet) | each action adds one version and the old one stays | edits of MUSIC-GEN-03 (UI only) |
| S4 | L | Stems: Stack `stems` env + endpoint + ledger, Home task, Split action, stem mixer, `mix` render | a 3 min song splits in under 30 s; mute vocals, play, and "Make a song from this mix" saves a new file | builds TIER-STEMS-01 as its note says (MUSIC-GEN-12 is already absorbed there; TIER-EVAL-07 is done) |
| S5 | L | `AudioEditor` Element + peaks endpoint: waveform, Trim, Fade, Loop a part, Rewrite a region by drag | drag a region, type the change, get a new version; previewed at 1440 and 390 | MUSIC-STUDIO-01 core |
| S6 | M | Tempo and pitch (no model), key and tempo readout, Practice mode (slower, loop, karaoke) | 0.8x keeps pitch within a measured tolerance; key shift plays in tune on a listen | new |
| S7 | M | Sounds maker (records are `media-item` with `kind: "sound"`): ACE-Step stings first, Stable Audio behind the licence gate; Loop toggle; Add a sound to a song | 3 sounds from one prompt in under 20 s; a loop has no click at the seam (measured) | MUSIC-GEN-11 |
| S8 | M | Child and teen lanes in Studio: rewrite, floors, as-sung check, Quick-only, cartoon covers, independent safety review | each row of section 4 passes its own test; a hit withholds and deletes the song | MUSIC-GEN-15, -17, -22, CONTENT-POLICY-04 |
| S9 | S | Export and share: WAV and MP3 encodes, stems zip, cover and lyrics file, privacy check on all new workers | file opens in a stock player; zero outbound connections asserted | MUSIC-GEN-08 |
| S10 | M | Later: XL quality profile, notes to MIDI, Whisper alignment fallback, Make a video, series, second engine bench | each is its own bench then row | TIER-EVAL-06 (which absorbed MUSIC-GEN-10), video pairing |

S3 can start with S1. S8 gates opening the Studio to any minor, not the build of S2 to S7. Each slice goes to Codex or the local lane as 1 to 3
file briefs with a failing test; commons work (S5) is its own worktree.

## 6. Open questions for Jesse

1. **Name and home (design-blocking).** Own `music-studio` catalog package, or a Make tab inside the Music package? Recommended: own package launched from Music and from the chat song card, because making and listening have different pages and gates and Music stays a pure player.
2. **Sound effects licence (engine choice behind a slot).** Allow Stable Audio (free under $1M revenue, results marked personal use only) as an optional install, or keep to the MIT
   ACE-Step stings and accept weaker foley?
3. **Your own recordings (additive later).** Should a person be able to drop in a recording to split into stems or fix (MUSIC-GEN-14 and TIER-STEMS-02)? It puts voices through
   a model; a household adult's own voice is the sensitive case.
4. **Second engine (engine choice behind a slot).** Spend a bench on HeartMuLa (Apache-2.0, Mac path unknown) to compare with ACE-Step, or stay on ACE-Step plus the XL profile?
5. **Music video (order choice).** Is "Make a video for this song" (the Higgsfield pairing) worth a slice right after stems, or after the Sounds maker?
6. **Chat Element on a non-chat surface (design-blocking).** May the shared chat Element `MusicTrack` be used on the Song page, a non-chat surface, under rule 9b? `frontend/src/shell/library/LibraryViewer.tsx` already renders `MusicTrack` outside chat (via `useMusicTrackProps`). Recommended: yes, as shipped, with the same props.
