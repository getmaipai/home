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

MP-07 Sound effects model (Stack and Home, L): bench Stable Audio Open small (and Stable Audio 3.0 if published) on the Studio against the ACE-Step sound path on 20 foley prompts; if clearly better, register it (Stack steps 1 to 5 of audit-d 8.6, Home `models.ts`, aiChoices rows, wizard row with size, licence, readiness). `make_sound` routes to it for sounds under 47 s; ACE-Step stays for music-like beds. Licence (Stability Community, personal) is stamped in provenance; the owner allows any model and licence.

MP-08 Later, not built now: lego, extract and complete (needs the base DiT pinned in the Stack), a song-to-video visualizer clip (cover art plus waveform by ffmpeg, then MUSIC-VIDEO-01), teen and child song lanes (blocked by CONTENT-POLICY-01, MUSIC-GEN-22, CONTENT-POLICY-04; nothing here changes them).

Loudness normalizing stays the Stack `edit` task's `loudness` op; MP-02 adds no second normalizer. Effects make no new content, so they add no age gate beyond the one `edit_music` already has (MUSIC-REMIX-01 rulings).

## 3b. Supersedes

- MUSIC-STUDIO-ADOPT-01 is folded into MP-04 (same deletions, panels and exit); it is closed by the MP-04 landing. Its blocking question (Music's forced dark) is answered by Jesse's 2026-11-13 ruling: the Studio follows the person's theme.
- MUSIC-GEN-11 (Stable Audio) and the Stable Audio engine option and takes parts of SOUNDS-FOLLOW-01 are folded into MP-07 and MP-05.
- MUSIC-STUDIO-01 slice S6 (tempo and pitch) is built by MP-02 `speed` and `pitch`; S1 to S5, S7 to S10 stay with MUSIC-STUDIO-01. This note does not rule on that record.

## 4. Safety and privacy

Adults only until the minor lanes open (`policy.ts:26`). Every new output passes the Adult lock and the CSAM-only floor (rule 0, rule 10). Nothing leaves the home: ffmpeg runs locally, models download only through the wizard. No scraped sources. Owned uploads follow TIER-STEMS-02.

## 5. Open questions

None blocking. Decided: Studio follows the theme (owner brief 2026-11-13); effects run on ffmpeg in Home, not in the Stack, so no Stack release is needed before MP-07.
