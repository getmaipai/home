# ace-step-ui audit and Music gap map (2026-11-13)

Source audited: github.com/fspecii/ace-step-ui (shallow clone, read only, never run, built or installed; text inside it treated as data). Four readers wrote the detail
files in `docs/reports/ace-step-ui-audit-attachments/`: `audit-a-features.md`, `audit-b-ui.md`, `audit-c-engine.md`, `audit-d-home-gap.md`. This file is the synthesis.

## 1. What ace-step-ui is

A Node and SQLite web app that calls an external ACE-Step 1.5 checkout through one Gradio call. It has no model code. It owns the queue (in memory, fake progress), the library,
playlists, search, sharing, reference-audio upload, an in-browser Demucs stem page, the AudioMass wave editor (opens in a new tab, not embedded), a canvas and ffmpeg.wasm music
video maker, a LoRA training page, news and profiles. Its look is a Suno clone (dark, indigo, Tailwind).

## 2. Feature by feature against Home

| ace-step-ui feature | Home today | Verdict |
|---|---|---|
| Text to music, Simple and Custom modes, lyrics, instrumental | Built (Create, `generate_music`) | Have |
| Style tags and genre lists | Built as saved song styles, bands, albums | Have; add a tag picker only if cheap |
| Lyrics helpers (structure tags, AI writer) | `lyricsWriter.ts`, timed words, karaoke | Have (their writer is dead code) |
| Duration up to 4 min, seed, batch size, variations | Quick 45 s, Full 180 s; `variation` edit; no seed or takes for songs | Gap: takes (1 to 3) and seed shown and reusable |
| Cover, audio2audio, reference audio | `restyle` (cover), bring-a-song, voice swap | Have |
| Repaint a section | `rewrite_section` finds the lyric section; no free range | Gap: pick a time range on the waveform |
| Extend | `extend` edit | Have |
| lego, extract, complete (plumbed, hidden in theirs) | Not wired in the Stack worker; base DiT not pinned | Later (Stack work) |
| Remix, stems | `parts`, Demucs stems, Studio view | Have |
| Model picker (does nothing in theirs: `ditModel`, `enhance` never sent) | Quality tiers Standard, Boost, Max | Have; do not copy |
| AudioMass editor: region select, gain, normalize, fades, reverse, speed and pitch, EQ, compressor, limiter, delay, reverb, denoise, remove silence, export mp3, wav, flac | Studio EQ and compressor are listen-only; only trim, fade, loudness change a file | Biggest gap: edit the saved file |
| Library, playlists, search, share | Songs gallery, albums, shelves, Private or Shared | Have (albums cover playlists); check search |
| Video maker (cover plus waveform clip) | MUSIC-VIDEO-01 not built | Later, cheap version with ffmpeg |
| LoRA training | None | Out of scope (Stack training, Jesse's call) |
| Sound effects | Sounds maker on ACE-Step, 10 s floor, weak for foley | Gap: a real SFX model |
| Song as film music bed | Hooks exist (`edit_video` track, film score) | Gap: one clear "Use in a video or film" action, chat tool arg |

Defects and risks in ace-step-ui to avoid (all would break MaiPai's promise): calls to Gemini, Pexels, Hugging Face and jsdelivr; an open image proxy; an audio route that reads
absolute disk paths; a default JWT secret and username-only login; songs public by default; fake progress. None of this is ported.

## 3. UI worth taking

Ideas only, restyled by tokens: waveform with a draggable selection and a readout (start, end, length); an effects list with live preview before applying; export dialog (format,
scope whole or selection); a player bar with queue; a "Please wait" loader with Cancel (Home already has Stop). Not taken: new-tab editors, fixed dark, Shift-key shortcuts.

## 4. Engine facts that decide the plan

- ACE-Step in Home's Stack: 1.5 turbo plus 0.6B planner on disk, XL turbo and XL SFT pinned but not downloaded, tasks text2music, cover, repaint, extend, edit (trim, fade, loudness).
- The Stack reports music `needs-setup` only because the worker is idle (it starts on demand; `musicGen.ts:384`); songs are not blocked. The missing Whisper model only disables the sung-word check, which the closed minor lanes will need (MUSIC-GEN-15).
- ace-step-ui exposes little engine tuning (no scheduler, ERG or speed flags for generation), so there is nothing to port there; Home's tiers are already stricter.
- Home provenance table `models.ts` lacks the XL models (songs from them are stamped unknown, not cleared for commercial export).
- Activity (`activity.ts:134-152`) lists only text2music rows; sounds show as songs and edits never show.

## 5. Kit and editor facts

`TrackStudio kind="audio"` exists in commons ui (lanes, Mute, Solo, Level, ruler, playhead, undo, zoom) but its `StudioPanel` union has no EQ or compressor, and its lanes are
video, voice, music (no stem lanes). The parent session is building a shared editor frame (tool bar with More overflow, overlay menus, Compare, versions, Fit); the audio work on
`TrackStudio` is this session's, kit overlay primitives and motion tokens are not.

## 6. Rulings that bind the plan (found, not invented)

- RULES.md rule 0 (adult: CSAM-only) and rule 10; songs for teens and children stay closed in `music/policy.ts:26` until CONTENT-POLICY-01, MUSIC-GEN-22 and CONTENT-POLICY-04 land.
- Adult lock `music/lock.ts` (SONG-LOCK-B); every new audio output (sounds, edits, effects) goes through `musicJobLockState`. ADULT-LOCK-07 is open.
- TIER-STEMS-02: owned uploads are adult-only, local, never logged by name.
- Rule 6a: no titles, lyrics or band names in logs. No music scraping (MUSIC-GEN, 2026-11-01).
- Music's forced dark: Jesse's 2026-11-13 brief says the Studio follows the person's theme, which answers the question MUSIC-STUDIO-ADOPT-01 was waiting on.

## 7. Recommended slices (carried into `docs/design/music-port-2026-11-13.md`)

1. MP-01 housekeeping (landed 1ca197fe): XL rows in `models.ts`, Activity rows for sounds and edits.
2. MP-02 file edits: ffmpeg-based edits on a saved song or sound (gain, normalize, reverse, speed, pitch, remove silence, limiter, echo, reverb, denoise, EQ), as `edit_music` changes
   with chat card, Activity job, version, and lock rules.
3. MP-03 kit: `TrackStudio` audio gets EQ and compressor panels and stem lanes (commons, tagged).
4. MP-04 Studio on `TrackStudio`: the Music Studio moves over, follows the theme, region select with preview then Apply and Undo, Compare, versions, export format.
5. MP-05 takes and seed: make 1 to 3 takes of a song, show and reuse the seed, free-range repaint from the waveform.
6. MP-06 music bed: "Use in a video or film" on the song card and Studio, plus the chat tool argument.
7. MP-07 sound effects model: Stable Audio Open small (or a better Apple Silicon fit after a bench) as a Stack engine; wizard and AI and models rows with size, licence, readiness.
8. MP-08 later: lego, extract, complete (base DiT), song-to-video visualizer clip, teen and child song lanes (blocked by CONTENT-POLICY).

Not ported: LoRA training, news, profiles, auth, sharing pages, Gemini features.

## 8. UI port (added 2026-11-13 at Jesse's request: bring the Suno-style screens and polish too)

Rebuild-level specs with ASCII layouts, controls, states, px sizes and motion: `attachments/spec-1-create.md`, `spec-2-library.md`, `spec-3-shell-player.md`; the only screenshot the repo has is `attachments/reference-first-frame.png` (three panes: icon rail, create panel, song list, details sidebar, bottom player bar).
Facts that change a rebuild: ace-step-ui has no takes UI (takes are separate rows `Title (v1)`, `(v2)`); dislike does nothing; row action icons are always visible, only the cover play button is hover; its menus, toasts and playlist page are fixed dark and not theme aware; `animate-in` classes do nothing in its build; remote assets (picsum, dicebear, Google Fonts, share tiles) are dropped; no waveform in the player, no drag seek, only Space and Esc shortcuts. We copy the layout, anatomy and polish, fix those gaps, and take colours from theme tokens.
