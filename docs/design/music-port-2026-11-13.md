# Music port from ace-step-ui: file edits, Studio on the kit, takes, beds, sound effects (2026-11-13)

Status: proposed, architect ruling pending. Item: MUSIC-PORT-01. Owner ask 2026-11-13 (Jesse): audit github.com/fspecii/ace-step-ui and build what Home's Music lacks. Evidence: [reports/ace-step-ui-audit-2026-11-13.md](../reports/ace-step-ui-audit-2026-11-13.md) and its attachments. Builds on [music-studio-2026-10-31.md](music-studio-2026-10-31.md), [audio-parity-2026-11-05.md](audio-parity-2026-11-05.md), [video-studio-2026-11-02.md](video-studio-2026-11-02.md). Changes no rule in `RULES.md`.

## 1. Owner requirements (2026-11-13)

1. Every new feature gets a chat tool and chat card where chat could ask for it.
2. Every slow job shows through the existing Activity status (`createJob`/`updateJob` into `activity.ts`, RULES S6). No new status design.
3. The Studio moves onto kit `TrackStudio kind="audio"`, EQ and compressor as panels (MUSIC-STUDIO-ADOPT-01), follows the person's theme (no forced dark), and behaves like the picture and video editors: tool bar with More overflow, overlay menus, disabled with a reason, preview then Apply and Undo, Compare, versions, Fit zoom.
4. Sound effects in scope; any new model is listed in the setup wizard and Settings, AI and models with size, licence, readiness.
5. A song made here is usable as a film's music bed. No music scraping. Teen and child song lanes and the Adult lock are respected as ruled.

## 2. Reuse check (org principle 6)

Searched by: music, song, track, audio, ace, acestep, sound, sfx, stems, mixParts, soundAudio, lyrics, TrackStudio, musicBed, film score, effect, eq, compressor, repaint.
- File edit plumbing exists: Stack `edit` task (trim, fade, loudness), `music/mixParts.ts` (ffmpeg or afconvert; it is the ONE Home host for ffmpeg effects, new effects live beside it), `soundAudio.ts` (pure WAV math, crossfade loop, `mixSoundAtWav`), `songEdit.ts`, `studioTools.ts`. New effects extend this path; no second audio engine.
- Edits are `edit_music` changes (`tool.ts:37`); new effects add change names to the same tool and card (`MusicCardView`, kit `music-edit.tsx`).
- Jobs: Music already registers with the household queue and `activity.ts` (`songItems`). Fix it for sounds and edits instead of adding a status surface.
- Studio: kit `TrackStudio kind="audio"`, `track-studio-media.ts` peaks code (replaces `MusicWaveform.tsx`), panels union extended in commons.
- Bed: `edit_video` `sound:"music"` + `track`, `videos/musicBed.ts`, `films/engines.ts` `makeMusic`. A song card action calls these; no new mix path.
- Models: Stack registration steps (audit-d section 8.6), Home `music/models.ts`, `shared/aiChoices.ts`.
- Rejected from ace-step-ui: AudioMass (a separate app in a new tab, vendored minified, GPL-style stack we would not fork), its server, auth, news, Gemini, public sharing, LoRA training.

## 3. Slices

MP-01 Readiness and housekeeping (Home, S): the Stack says music `needs-setup` because Whisper large-v3-turbo is missing; add it to the setup wizard path and verify songs run end to end. `models.ts` rows for XL turbo and XL SFT. `activity.ts` lists sounds as sounds and every edit job (cover, extend, stems, effects) as its own row. Exit: a sound, a trim and a stem split each appear in Activity with the right words.

MP-02 File edits (Home, M): new `edit_music` changes on a saved song or sound, run by ffmpeg in Home (CPU, no model, no memory admission): `gain`, `reverse`, `speed` (tempo, pitch kept), `pitch` (key shift, tempo kept), `remove_silence`, `limit`, `echo`, `reverb`, `eq` (named presets and six-band), `denoise` (ffmpeg `afftdn`). Optional `from_s`,`to_s` selects a region. Each makes a new version of the song (old stays, Compare and Undo work on versions), keeps provenance and the Adult lock (`musicJobLockState`), logs no titles (rule 6a). Chat: the existing `edit_music` card shows the result with Use this version. Activity: a job row while it runs.

MP-03 Kit (commons ui, M): `TrackStudio` `StudioPanel` gains `eq` and `compressor` (the shipped six-band and compressor controls, token styled), lanes gain `stem` (label and hue per stem), a selection range tool for audio, and `kind="audio"` shows Compare of two versions. Tagged by this session; shared editor frame and motion tokens are the parent session's: any overlay or motion change is asked of it first.

MP-04 Studio on the kit (Home, M): `MusicStudioView` becomes `TrackStudio kind="audio"`; delete `music-surface`, `MusicWaveform.tsx`, the forced dark class; it follows the person's theme. Region select, preview then Apply and Undo through MP-02, versions list, Compare, Fit, export format (m4a, wav, flac, mp3 via ffmpeg). Studio EQ and compressor become real: Apply writes a new version through the MP-02 path. Opened at 1440 and 390 before and after.

MP-05 Takes and seed (Home, M): `generate_music` accepts `takes` 1 to 3 (like `make_sound`) shown as one card with a take picker; the seed is shown in song details and a "Make another like this" reuses it with the lyrics changed; repaint takes a free time range picked on the Studio waveform. Each take is one queue job; the household queue ranks them as today.

MP-06 Music bed (Home, S): a "Use in a video or film" action on the song card and the Studio opens the Videos Studio or the film with that song as the track (hooks in section 2); chat: `edit_video` and the film tool already take `track`; add a plain way to name a song ("use the song I just made") through `make_music`/`track` resolution and card text. A locked song is refused as today.

MP-07 Sound effects model (Stack and Home, L): bench Stable Audio Open small (and Stable Audio 3.0 if published) on the Studio against the ACE-Step sound path on 20 foley prompts; if clearly better, register it (Stack steps 1 to 5 of audit-d 8.6, Home `models.ts`, aiChoices rows, wizard row with size, licence, readiness). `make_sound` routes to it for sounds under 47 s; ACE-Step stays for music-like beds. Licence (Stability Community, personal) is stamped in provenance; the owner allows any model and licence. Built (Home half): `make_sound` and `POST /api/music/sounds` use the Stack sound role when `GET /stack/v1/sound` says the model is installed and the length is 1 to 47 s (otherwise ACE-Step), provenance row `stable-audio-3-small-sfx` is `personal_only`, the wizard row `sound-effects` carries the licence accept, and the sound card and Sounds maker say "Powered by Stability AI".

MP-08 Later, not built now: lego, extract and complete (needs the base DiT pinned in the Stack), a song-to-video visualizer clip (cover art plus waveform by ffmpeg, then MUSIC-VIDEO-01), teen and child song lanes (blocked by CONTENT-POLICY-01, MUSIC-GEN-22, CONTENT-POLICY-04; nothing here changes them).

Loudness normalizing stays the Stack `edit` task's `loudness` op; MP-02 adds no second normalizer. Effects make no new content, so they add no age gate beyond the one `edit_music` already has (MUSIC-REMIX-01 rulings).

## 3a. UI slices (Jesse 2026-11-13: carry over ace-step-ui's Suno-style UI and polish, not only its features)

Source of truth for each screen: `docs/reports/ace-step-ui-audit-attachments/spec-1-create.md`, `spec-2-library.md`, `spec-3-shell-player.md`, plus `reference-first-frame.png`. Every slice: colours from the person's theme tokens, kit Elements as they ship (rule 9; a look that is not reachable gets a prop or variant in commons first), motion from the app-wide commons motion system (no song-specific animation), disabled with a reason, Activity for slow work. Exit for every slice: "match ace-step-ui" checked side by side against its spec and frame at 1440 and 390 on a dev hub with the built-in browser, screenshots opened and judged, and the differences listed (deliberate: tokens, no remote assets, no dead controls).

- MP-U1 Create panel: Simple and Custom modes, lyrics box with structure-tag chips, style chips and tag field, title, instrumental, vocal language, advanced drawer (seed, takes, length, bpm, key), reference audio, Create button with takes count ("Create 2 songs"). Chat parity: same fields in `generate_music`.
- MP-U2 Song list and cards: row anatomy (cover, title, tags, length, hover play, like, share, more menu), takes grouped into one row with a take strip (a group id on the record), selected and playing states, filters, search, empty and loading states.
- MP-U3 Song details panel: large cover, title, creator, style and tags, lyrics (timed karaoke where present), versions and takes, actions (Studio, remix, stems, bed, download, share).
- MP-U4 Player bar: cover, title, like, shuffle, prev, play, next, repeat, seek with a waveform, time, volume, expanded player; phone mini player with expand. Space and arrow keys.
- MP-U5 Music shell: wide three panes (rail or Home's nav, create panel, list, details) and the phone layout (one pane at a time, bottom player above the nav, create as a sheet).
- MP-U6 Studio: MP-04, matched to the picture and video editors rather than ace-step-ui (the AudioMass editor is not copied).

## 3c. MP-09 ffmpeg is a listed tool (Jesse 2026-11-13)

ffmpeg already runs on the hub as a Stack-managed engine (`stack/data/engines/ffmpeg/<version>/ffmpeg`, about 109 MB), but it is not named in the setup wizard or in Settings, AI and models: the Stack's component list has the groups chat, voice, pictures, video, music, stems, tools and loras, and no ffmpeg row. Home code that needs it must find that one binary (MP-02 added `findFfmpeg` in `music/mixParts.ts`; `voiceShift.ts` and `pictures/keyframes.ts` still look only on the PATH). MP-09: (a) the Stack lists "Audio and video tools (ffmpeg)" as a `tools` component with size, licence and readiness, a required part in the plan, installed by the wizard; (b) Home shows it in the wizard and in Settings, AI and models (`stackComponents.ts` group `tools`, `aiChoices.ts`); (c) one shared finder in Home used by music, voice shift and keyframes. Exit: the wizard and the settings page show it installed with size and licence; a hub with no ffmpeg on the PATH still makes effects.

## 3b. Supersedes

- MUSIC-STUDIO-ADOPT-01 is folded into MP-04 (same deletions, panels and exit); it is closed by the MP-04 landing. Its blocking question (Music's forced dark) is answered by Jesse's 2026-11-13 ruling: the Studio follows the person's theme.
- MUSIC-GEN-11 (Stable Audio) and the Stable Audio engine option and takes parts of SOUNDS-FOLLOW-01 are folded into MP-07 and MP-05.
- MUSIC-STUDIO-01 slice S6 (tempo and pitch) is built by MP-02 `speed` and `pitch`; S1 to S5, S7 to S10 stay with MUSIC-STUDIO-01. This note does not rule on that record.

## 4. Safety and privacy

Adults only until the minor lanes open (`policy.ts:26`). Every new output passes the Adult lock and the CSAM-only floor (rule 0, rule 10). Nothing leaves the home: ffmpeg runs locally, models download only through the wizard. No scraped sources. Owned uploads follow TIER-STEMS-02.

## 5. Open questions

None blocking. Decided: Studio follows the theme (owner brief 2026-11-13); effects run on ffmpeg in Home, not in the Stack, so no Stack release is needed before MP-07.
