# Audio and music parity with Higgsfield: gaps, changes, screens (2026-11-05)

Status: architect APPROVED 2026-11-05, including V4 for every member and V5 (Inspired voice). Item: AUDIO-PARITY-01. Owner ask 2026-11-05 (Jesse): review Higgsfield's audio and music feature list, find our gaps and the changes needed, and make the screens and flow match. Sources: our repo (origin/main, read 2026-11-05) and Higgsfield's own pages and third-party guides (URLs at the end). "Verified" means seen on a Higgsfield page; "secondhand" means a third-party guide only.

## 1. Corrections to the list we were given

- **Higgsfield has no dedicated music or sound-effects generator.** Its Audio tab (Voiceover, Change Voice, Translate) says so in its own launch post. Ambience appears only inside Seed Audio multi-speaker scenes. "Music, effects, ambience and dialogue in one track" is ByteDance's model description, not a verified Higgsfield screen.
- **Seed Audio 1.0** (verified): a free prompt where "@" references attachments, 50+ voice presets, sample rate, speed, volume, WAV, MP3 or OGG/Opus out; about 2 minutes (secondhand).
- **Urban Cuts and ClipCut are outfit reels** (selfie plus wardrobe photos plus music, cuts on the beat, 9:16 MP4). "Recreate the pacing of a reference edit" has no documented Higgsfield tool.
- **Music Video Director** is real (verified): drop an MP3, WAV or M4A, add 1 to 4 photos, press Make My Video. Stages: Song DNA (BPM, length, sections), Cast Lock (same face), Direction (a shot plan per section), Final Cut (hard cuts on the beat, audio from 0:00, lip-synced, one MP4). No timeline, prompts or editing; no model, price or limits named.
- Higgsfield has no song generation, covers, extend or stems. We are ahead there.

## 2. Coverage and changes

| # | Capability | Us today | Change (owner row) |
|---|---|---|---|
| 1 | Music beds for a scene | Songs and instrumentals with a length control; `edit_video mix` overlays audio | "Add music" on a clip calls `generate_music` instrumental fitted to the clip seconds (one definition); lands on the Studio Music lane (VIDEO-STUDIO, Videos) |
| 2 | Sound effects and ambience | Planned: music-listen-create slice C7 and MUSIC-GEN-11 (tool `make_sound`, Sound card) | Build C7 as written; this note adds nothing to its design except the Create tab placement below |
| 3 | One combined track | Studio export lays voice lines over music (VIDEO-STUDIO-07) | The lanes are video-studio 4.6's Video, Voice and Music ("Music and sounds" once C7 exists); no change here |
| 4 | Video with synced sound | Built: LTX-2.3 sound and speech; children and teens get no sound | A Sound switch and a "no music" chip in Create; the chat model writes the four audio layers (dialogue, effects, ambience, music) into the prompt (Videos) |
| 5 | Audio-driven video | Planned: VIDEO-INPUTS-04/05, VIDEO-UI-09, benches first | Keep; add "Use in a video" on audio results (a `MusicTrack` `actions` entry, kit first) |
| 6 | Automatic music video | Absent | MUSIC-VIDEO-01, section 4 |
| 7 | Beat-synced short edits | Absent | Beat detection and "Cut to the beat" (section 3). Outfit reels need a try-on model we do not have; deferred for that reason only |
| 8 | Voiceover, clone, replace, dub | Voiceover (`edit_video mix`, Studio lines); cloned voices admin-only | V1 to V3, section 5 |
| 9 | Full songs, covers, remix, stems | Built; MUSIC-REMIX-01 R2 to R6 in progress | Tempo, pitch and loop stay in music-listen-create 3.3 and 6; multitrack stays unproposed |

## 3. Screens and flow

Higgsfield's Audio tab: a tool switch at the bottom left (Voiceover, Change Voice, Translate), then model, voice preset, script, Generate; audio stays in the same project as the video.

- **Create tabs.** Music Create gets two tabs beside Song, Band, Album, Style: **Sounds** (the C7 design: prompt, length, variations, history) and **Voice** (a three-way switch: Voiceover, Change voice, Translate). Same two-pane layout as Video Create (prompt panel left, result feed right, VIDEO-UI-01). Parts: kit `Tabs`, the kit segmented control for the three-way switch, the kit file-upload part; no className and no `*Panel` wrapper (rules 9, 9b). "Use in a video" and "Add to Studio" are `MusicTrack` `actions` and a Sound card: a `commons` change first with a `UI-DECISIONS.md` row (owner: Music, tag ourselves).
- **Video Studio** keeps video-studio 4.6's lanes. A lane's "+" opens the same generator in the kit `Sheet`; any lane change is a `TrackStudio` prop in `commons` first, owned by Videos.
- **Beat detection** (Music owns): local, Beat This with librosa as the fallback; it returns BPM, beat times and sections for any audio. "Cut to the beat" in Studio calls it and cuts chosen clips through the one `media.edit` path (Videos).
- **Chat (owner rule 2026-11-01, music-listen-create 3.3, not yet in RULES.md).** Conditional tools, offered only when relevant, set stays at 16 or fewer (rule 1): `make_sound`, `voiceover`, `change_voice`, `translate_dub`, `add_music_to_clip`, `cut_to_beat`, `make_music_video`, `make_inspired_voice`. Each has CHAT-AB-01 rows (a positive, a negative, a minor refusal) and code never picks the task from words.

Music video, one screen like Higgsfield's plus the step they lack. Home: Videos Create hosts it (the render is a video job); Music's "Make a video for this song" opens it with the song filled in.
1. Drop a song (MP3, WAV or M4A, or pick one from Music) and add one to four photos (saved subjects).
2. Song DNA shows BPM, length and sections, found locally.
3. **Shot plan**: one row per section, written shot, still, Redo. It is the existing `media_production` shot list and `PRODUCTION-VIDEO-01` subjects, never a second store. A "Just make it" switch skips this step.
4. Render and cut on the beat; progress is the existing job Status row.
5. One MP4 in My clips, Open in Studio.

## 4. MUSIC-VIDEO-01 (L, after the benches)

Song DNA (beats, sections, timed words from `lyricsAlign`), Cast Lock (saved subjects), Direction (the household chat model writes one shot per section into `media_production`), shots (LTX clips from a still with audio-to-video lip sync, blocked until VIDEO-INPUTS-04 and -05 pass), Final Cut (ffmpeg cut on the beat and mux of the original audio through `media.edit`, EDITOR-11). The source is the person's own song through the `owned_file` path of song-remix section 3.1; nothing leaves the home.
- **Gate, adult:** request-aware CSAM screening on the lyrics and shot text; direct CSAM detection on the stills, the clips and the final MP4; an unrun check on an adult-only media job fails closed; no other content block (rules 0 and 10).
- **Minors:** a minor's music video, Change voice and Translate are refused until a named later row exists; its hard prerequisites are MUSIC-GEN-22, CONTENT-POLICY-01 and -04 and the video child rules (no sound, short clips). Song-remix R5 covers audio edits only and is not that row.

## 5. Voice slices

| Slice | What | Needs |
|---|---|---|
| V1 | Voice tab: Voiceover with a voice picker and script box. The box offers the tags of the engine that will speak: Chatterbox Turbo has only nonverbal tags (`[laugh]`, `[sigh]`, `[cough]`, `[chuckle]`); once V6 lands the recorded engine's own documented list replaces it for recorded work, and the box never offers a tag the engine cannot speak | none |
| V2 | Change voice on a video or audio: transcribe, speak in the picked voice with the same timing, remux | existing voices only, never V4 |
| V3 | Translate and dub: transcribe (mlx-whisper), translate (chat model), speak in the picked voice, lip sync when a face is visible | VIDEO-INPUTS-04 lip-sync bench; existing voices only, never V4 |
| V6 | **Recorded voice engine**: every non-realtime spoken output (Voiceover, Change voice, Translate, video voice lines, Studio lines, read-aloud files) uses Fish Audio Drama 3 where the tier can hold it; realtime chat voice stays Chatterbox Turbo. Chosen by Jesse 2026-11-05 after listening to the six-line bench; see "V6 design" below | the V6 bench checks below; V1 to V3 render with it once it lands |
| V5 | **Inspired voice**: a new voice based on an uploaded voice, not a copy. Named "Inspired voice" by Jesse 2026-11-05, so it is never confused with "Clone a voice" (V4, an exact copy). Flow: upload or pick a voice, choose how different it should be, hear three previews, keep one; saved as a clip plus settings like any voice | the V5 bench below; same voice rules as V4 |

Voice rules for V1 to V3: until V4 lands, a minor gets preset voices only (household-voices-2026-10-20.md, SAFETY.md); after V4 a minor may use clip voices like anyone else; the typed script and the translated text pass the same text floors through the shared gate function the Studio uses (`videoRefusalFor`; for an adult this is the CSAM check only, rule 0); transcripts and translations are dropped after use, never stored or logged (rule 6a); an uploaded video or audio source follows the song-remix `owned_file` path. Results of Voiceover, Change voice, Translate and Sounds are records with provenance (engine, voice id and kind; principle 3, VOICES-06); a sound is `media-item` `kind: "sound"`, spec first.

**V4, clone a voice from a clip: ruled by Jesse 2026-11-05 ("Voice cloning for everyone is fine", then "everyone means everyone not just adult").** Every member, adult, teen and child, may make a voice from a clip (6 to 30 s), and may list and pick any clip voice in the household, as an adult does. For a minor these stay exactly as today: (1) the content floors on everything the voice says (a child's per sentence, a teen's at the configured grain), on the typed script and on any translation, as in every band; (2) rule 8, so no model or tier choice, no temperature controls and no pitch controls beyond V5's own limited ones (owner and admin only); (3) the band gates on shared surfaces and for an unknown speaker (rule 0); (4) no clip voice is created or used in a temporary or guest session. Ruled by Jesse 2026-11-05 for the SAFETY.md wording: (a) the line "a robot that belongs to a child speaks a preset only" is removed, so a child's robot may speak any voice the child can pick, under the same content floors; (b) a parent or admin sees, can listen to and can delete a minor's voices in the Voices manager (the voice only; other private teen settings stay private). Still to be settled by the architect on the exact wording before the commit: (c) the creation log line follows the typed activity-log event and carries no voice or clip name and no person id (rule 6a); (d) the responsibility line is rewritten for a child at grade 6. Today only owners and admins add cloned voices (VOICES-02) and SAFETY.md says a member, teen or child cannot make one; household-voices-2026-10-20.md says a child or teen never lists, picks or hears a clip voice. The slice that builds V4 changes SAFETY.md line 126, household-voices decision 7 and its minor rule, and the org standard in `.github` in one commit that carries `Owner-approved: 2026-11-05`, with the architect ruling on the exact wording first. Clone clips are 6 to 30 seconds (VOICES-04, Chatterbox); "up to 2 minutes" is Higgsfield's figure. V2 and V3 do not depend on V4.

**V5 design (research 2026-11-05).** Primary: blend the speaker embedding of the reference clip with one household preset voice in Chatterbox Turbo (MIT, MPS with CPU fallback; the blend is `normalize(a*ref + (1-a)*preset)`, also on the second conditioning path if the bench says so), then a small pitch and formant nudge on the output (the existing pitch offset plus a WORLD or ffmpeg formant shift); three previews at different seeds, the person keeps one; stored as clip plus settings, a derived voice never stores more than a clone does. Fallback: an ffmpeg-only pitch and tempo shift with light EQ (LGPL-safe, narrower range before it sounds processed). A text-described voice (Qwen3-TTS VoiceDesign, Apache 2.0 to confirm on the model card) is a later option, not this slice. XTTS (CPML) and F5-TTS (CC-BY-NC weights) are ruled out by licence. Labels, plain words: "How different from the original" (Slightly, Different, Very different, 0 to 100), "Base voice to mix in", "Higher or lower", "Brighter or deeper", "Try another", "Keep this one". For every member, minors included, V5 offers exactly: Base voice to mix in (a preset), How different from the original (0 to 100), Higher or lower (limited to plus or minus 2 semitones), Brighter or deeper (formant, limited to plus or minus 2 semitones), Try another and Keep this one. These are V5's own controls and are not model or tier choices. Temperature, cfg and the wide pitch range of -12 to 12 stay owner and admin only (rule 8), and there is no "Expressiveness" control (it is temperature). **Bench to decide:** five reference clips (adult male, adult female, teen), each blended with two presets at 30, 50 and 70 percent with and without a 2 semitone shift, scored on speaker similarity to the reference (a clone scores above about 0.85; target 0.5 to 0.7), word error rate and a blind listen for "different but natural". It also confirms the output carries the PerTh watermark and that nothing phones home. Voice rules are V4's: every member may make one, content floors apply, rule 8 for minors. **Spec:** V5 adds `HouseholdVoice` fields (kind `inspired`, base preset id, blend amount, formant shift), additive, spec first in `commons/spec`; the Stack gets additive speech-request fields for the blend and keeps no voice store. **Chat:** the conditional tool `make_inspired_voice`, with CHAT-AB-01 rows (a positive, a negative, and a minor's chat gets the same text floors); the offered set stays at 16 or fewer. **Surface:** the Voice tab of Create and the Voices manager, drawn with the kit `Tabs`, `Slider`, `Select` and the existing Voices list; no className and no `*Panel` wrapper (rules 9, 9b); absent until the V5 bench passes.

## 5b. Who builds what (agreed with the VIDEOS session, 2026-11-05; Videos records it in its VIDEO-STUDIO rows)

- **Videos owns** the Studio lanes and "Add music to a clip", audio-driven video and lip sync, and the clip and render side of the music video. There is one `media.edit` path for audio on clips, owned by Videos; Music calls it and never adds a second.
- **Music owns** beat and section detection, the Sounds maker (C7) and the Create tabs.
- Traps from Videos: a2v and lipdub are not measured on the Stack yet (check `/stack/v1/roles` before any claim); Stack job replies are wrapped as `{ job: {...} }`; video qualities are quick = Wan, detailed = LTX 2.3, ltx25, ltx25max; `VideoPlayer` has a `notice` prop and `poll_while` is required for refresh (VIDEO-UI-01 rev 7).

**V6 design (bench 2026-11-05, Mac Studio M5 Max).** Question from Jesse: do recorded voices use plain Chatterbox or something better, since expression matters more than speed when nothing is live. Six candidates, six lines (a long story, two short, a laugh, a whisper, a date and time line), 36 clips, Whisper large-v3-turbo for word error, results in the bench folder's `RESULTS.md`. Jesse listened and chose **Fish Audio Drama 3** (`mlx-community/fish-audio-drama-3-4bit`). Measured: word error 0.0 on five of six lines (the date line 0.235, mostly Whisper's own number formatting), render speed 0.37 to 0.72 of real time (1.4 to 2.7 times faster than real time, so fine for recorded work, not for live talk), peak memory 28.7 GB (the largest of the six; Chatterbox peaks at 5 GB). The decisions:
- **Scope:** recorded work only. The realtime voice, the robot's live speech and the DJ stay on Chatterbox Turbo; one definition of "which voice engine" per mode, chosen by the Stack role, never by a client or a setting a person sees.
- **Where:** a Stack speech role `speech_recorded` beside the existing speech role, with the engine behind it as an installable model package (download, never vendored, `RELEASES-AND-DEPENDENCIES.md`). Home asks for a recorded line the way it asks today; the Stack picks the engine and returns audio. Additive request field only.
- **Resource priority (owner order, 2026-10-21):** chat first, then images, then video, then everything else. A Fish render queues behind them and shows the existing Status row, never a raw error (S6). At 28.7 GB it loads on demand and unloads after idle; a tier too small to hold it (Reduced, and Standard when chat plus images are resident) falls back to Chatterbox Turbo with the same line, and the card says nothing about memory (owner rule 2026-11-01). The fallback is a per-render decision, not a setting.
- **Licence:** the Fish Audio Community License is free for use under USD 500,000 annual revenue, and requires a separate agreement for a hosted service. MaiPai Home is self-hosted and the household downloads the model itself, so the household is the licensee; the existing licence prompt (LICENCE-ACK-01) shows the terms at download, and nothing is bundled. Jesse chose the engine knowing the cap (2026-11-05); no further question is raised. Recheck the licence text at the pinned model revision when the package is cut.
- **Expression:** the Voice tab's script box offers the tags this engine documents on its model card (read at build time and kept in one list in the voice spec, like the Chatterbox list now), so V1's "nonverbal tags only" line becomes per-engine. The typed script and any translation still pass the same text floors (rule 0 for adults).
- **Bench items before the engine is the default:** (a) does it accept a reference clip, and how close does a V4 clone come; if it cannot, a clone voice renders with Chatterbox Turbo and the card says which engine spoke (honest provenance, VOICES-06); (b) PerTh or equivalent watermark and nothing phoning home (`PRIVACY.md`); (c) a 60-second read-aloud and a three-voice dialogue for drift and seams; (d) the cold-load time on Standard; (e) a child's line goes through the same floors with no extra control (rule 8); (f) the closeness measurement `tier-families-and-options-2026-10-30.md` F5 requires before a family swap between tiers: the same line and reference rendered by Fish and by the Chatterbox fallback, scored on speaker similarity and a blind listen, so the fallback is shown close enough or the card names which engine spoke.
- **Chat:** no new tool. A chat ask for a voiceover or a read-aloud file uses the existing speech tool; the engine is the Stack's choice. CHAT-AB-01 gets no new row.
- **Records:** every recorded line carries provenance with engine id and model revision (principle 3, VOICES-06), spec first only if the engine id field is not already in `@maipai/spec`.

## 6. Reuse check (org principle 6)

| Piece | Prebuilt used | Hand-built only where |
|---|---|---|
| Beat and section detection | Beat This (MIT) with librosa (ISC) as fallback; licences read before use | the section merge with lyric sections |
| Transcription for dub and change voice | mlx-whisper (MIT), already planned in song-remix | none |
| Recorded speech | Fish Audio Drama 3 as an installable model package behind a Stack role (V6); the existing Stack speech path, model-package install and LICENCE-ACK-01 | the role and its tier fallback |
| Speech and voice | the existing Chatterbox Turbo TTS and voice manager (V5 blends its own speaker embedding, no new model); Seed-VC or SoulX-Singer only if R0's bench of song-remix wants voice conversion | the speaker-embedding blend and the formant nudge in the Stack's Chatterbox worker |
| Cutting and muxing | ffmpeg through the one `media.edit` path | none |
| Shot plan | `media_production` and the Storyboard stitch (PRODUCTION-01) | the lyric-to-shot writer prompt |
| Sounds engine | ACE-Step stings first at Standard; Stable Audio 3 Small SFX optional at Boost and Max, never for a minor (rule 8), no licence gate (music-listen-create section 5) | none |
| Tabs, switch, side sheet, upload | kit `Tabs`, segmented control, `Sheet`, file-upload part | none |

## 7. Supersedes

- music-listen-create-2026-11-01.md section 7 slice C7 and music-studio S7 for the Create-tab placement of Sounds only (the engine and tool stay as written there); section 6 "music video for a song, later" is replaced by MUSIC-VIDEO-01; MUSIC-GEN-11 is built under C7.
- Nothing in video-studio-2026-11-02.md section 4.6 (lanes are not changed).
- SAFETY.md voice-from-a-clip bullet, household-voices decision 7 and its minor rule: replaced by the V4 slice commit (`Owner-approved: 2026-11-05`).
- The rows of section 2 of this note replace no existing row; they point at owners.
- V6 supersedes, for recorded (non-realtime) speech only: `studio-voice-2026-10-17.md` lines 73-74 and 87-88, which rejected Fish drama-3 because its licence blocks selling the product (stale: Jesse chose it on 2026-11-05 knowing the Fish Community License, free under USD 500,000 annual revenue, separate agreement for a hosted service; the old note's "non-commercial" reading is replaced by the terms quoted in V6); `resource-tiers-2026-10-27.md` section 5.6, "voice has no Boost or Max", which stays true for realtime voice and no longer holds for recorded voice, where the Fish slot loads on demand with a tier fallback; `tier-families-and-options-2026-10-30.md` principle 2 and F5, one family per category and a swap only between measured-close tiers, which V6 keeps by adding the F5 closeness measurement as bench item (f) and by choosing the family per mode (realtime Chatterbox, recorded Fish) rather than per tier.

## 8. Status (rule S6)

Long jobs (sounds, voice, dub, music video, beat cut) report through the existing job Status row and Repairs; controls are absent or disabled through the existing music and video health rows; a feature whose bench has not passed is absent (video-create-one-page rule 5). No new banner, toast or poll.

## 9. Order

1. Finish MUSIC-REMIX-01 R2 to R6 (in progress).
2. Sounds (C7) and "Add music to a clip".
3. Beat detection and Cut to the beat.
4. Voice V1, then V2; V6 (Fish recorded voice) after its bench items and before V1 ships, so V1 never needs the nonverbal-only wording.
5. MUSIC-VIDEO-01 and V3 after the VIDEO-INPUTS benches pass.

Each slice ships with its chat half, goes to Codex as one-to-three-file briefs, and is opened in the preview at 1440 and 390 before landing.

## 10. Unknowns

Higgsfield's live Audio tab layout, Seed Audio price, whether Music Video Director exposes the shot plan, Urban Cuts' official page, the voice preset count (21 or 40 plus) and translate language count (10 or 18). We could not log in.

Sources: higgsfield.ai/blog/higgsfield-audio, higgsfield.ai/blog/higgsfield-audio-ai-voice-tools, higgsfield.ai help-center pages for lipsync and Seedance, the Kling 3.0 guide, mv-director.higgsfield.app, higgsfield.ai/es/apps/clipcut, fal.ai/seed-audio-1.0, wavespeed.ai Urban Cuts, gregpreece.com and frankx.ai workflow guides.
