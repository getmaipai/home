# Transcripts and captions: timed text with speakers, subtitle files, edit by transcript (2026-11-06)

Status: revision 2, architect APPROVED 2026-11-06 (revision 1 APPROVED the same day after a first-pass REJECTED, edits applied: Supersedes, conditional tool, band floor, reuse spike). Condition: "names a Library file" in 2.3(b) means a structured reference (an attachment or a `maipai://` item reference matched like `itemReferenceAllowed`), never a file name read from free text. Item: CAPTION-01. Owner ask 2026-11-06 (Jesse), widened the same day by two feature lists (section 2.0): build the missing "transcribe audio and
video with timestamps and speaker labels" and "generate captions as a subtitle file or embedded in the video" from the combined
AI feature list (ElevenLabs Scribe, Adobe, Runway, Kling, NotebookLM). First of the gaps found by comparing that list to the backlog.

## 1. What exists (read from origin/main, 2026-11-06)

- Speech to text is one call: `lib/stt.ts` sends one short WAV to the Stack `POST /v1/audio/transcriptions` and gets plain text back.
  No timestamps, no speaker labels, no long files, no subtitle output. Models: Parakeet TDT 0.6B v2 int8 (optional) or the default
  speech role (`modelCatalog.ts`).
- Stack forced alignment exists for songs: `backend/src/align/align_worker.py` (MMS_FA, known lyrics in, one `{t, end, text}` per word
  out); Home side `lib/music/lyricsAlign.ts`, `libraryAlign.ts`. It needs the words in advance.
- Podcast transcripts exist (PODCAST-PORT-04, done): table `podcast_transcripts` with segments `{start_s, text}`, publisher transcript first,
  then a Stack `media.fetch` job (`backend/src/lib/media/podcasts.ts`; `parseTranscriptDocument` already parses WebVTT). Children are refused
  there ("Transcripts are available to teens and adults").
- The kit `Player` primitive already takes `captions?: readonly PlayerTextTrack[]` (WebVTT tracks, MEDIA-PLAYER-01). The `VideoPlayer`
  Element has no tracks, and its boolean `caption` prop means the prompt line.
- `FILM-05` (faceless films) wants burned-in captions for narrated scenes; `PODCAST-PORT-05` wants a transcript for Ask this episode;
  `VIDEO-INPUTS-04/06` and `LOCAL-BENCH-02` bench dubbing and lip sync. All of them need timed text first.
- `STACK-STT-STREAM-01` (streaming sessions for live voice) is separate and stays separate.

## 2. Design

**2.0 Owner direction (2026-11-06).** One workspace, "Captions & Transcripts", opened from a video or audio recording. The transcript is
the editable text; captions are timed cues made from it. Player on one side, transcript on the other; three obvious actions: Search, Edit,
Export. Build first: import audio or video, transcribe locally, click text to seek, correct the text, preview captions, export SRT or
VTT. Build next: word-level timing, speaker labels, selected-range regeneration. Everything else on the owner's list is phase 3 and
becomes its own backlog item when picked up. Dubbing, edit by transcript, NotebookLM-style podcasts and highlights/chapters consume the
record and are separate items (section 6).

**2.1 Records (commons `spec`, additive, spec first).**
- `Transcript`: `id`, `source` (media file id), `language`, `current_revision`, `segments[]`, `speakers[]` (`{id, label}`), `vocabulary[]`,
  provenance (engine, model id, run date), clock stamp. Visibility follows the source and is never wider.
- Segment: stable `id`, `start`, `end`, `text`, optional `speaker`, optional `words[]` of `{start, end, text, confidence?}` when the speech model
  returns them. Text edits and timing edits are two separate operations (`edit_text`, `retime`): fixing a name never moves a cue.
- `TranscriptRevision`: append-only, `{id, transcript_id, n, author, clock, provenance, reason, ops[]}`. Autosave writes one per edit burst; undo and
  restore replay or invert them.
- `CaptionTrack`: `id`, `transcript_id`, `language`, `based_on_revision`, provenance (generated, imported or translated, with engine), clock stamp, `cues[]` of `{id, segment_id?, start, end, text, text_overridden}`,
  optional `style`. A cue with `text_overridden` keeps its own wording when the transcript line is too long for the screen.
- Every output made from a transcript (caption track, burned-in video, translation, later a dub) stores the `transcript_revision` it used.
  Home shows "needs refreshing" when `current_revision` is newer, and regenerating is one tap.

**2.2 Engine (Stack).** A long-file transcription job: ffmpeg extracts audio (selected track and time range supported), the existing
speech role transcribes with word timestamps when the model gives them, plain segment times when it does not. The spike compares, in
order: (1) sherpa-onnx VAD plus the offline recognizer with token timestamps (already shipped in the Stack, Parakeet TDT), (2) mlx-whisper
(already in MUSIC-REMIX-01's R0 bench), (3) WhisperX, and records why the winner wins. A hand-built 30 second silence-cut stitch is
written only if none of them returns usable times. Language: auto-detect or chosen; a vocabulary list is passed as a hint where the
model supports one and applied as a post-pass suggestion where it does not. Progress, cancel and retry are the Stack job's own;
batch is a list of jobs. No cloud call. Speaker labels: phase 1 manual (rename, assign), phase 2 automatic diarization from a local
model (sherpa-onnx speaker diarization first, pyannote segmentation second, measured in its own spike). Range regeneration reruns the job
on `[start, end]` and replaces only the segments inside it, leaving corrections elsewhere alone.

**2.3 Home.**
- Import: upload, a file already in the Library, or an existing project clip. Import of SRT, VTT or plain text creates a `Transcript`
  directly (provenance `import`); untimed text is aligned to the recording with the Stack's forced aligner (`align_worker.py` already
  takes known text), and left untimed with a clear note when alignment fails. One shared parser: `parseTranscriptDocument` in
  `podcasts.ts` moves to `lib/transcripts/parse.ts` and is reused by podcasts.
- Writers (pure functions, `lib/transcripts/`): SRT, WebVTT, plain text, Markdown (optional speaker names and timestamps), and the
  structured JSON of the record for other MaiPai tools. Cue builder: line breaks, characters per line, lines per cue, reading speed and
  duration limits as settings with defaults; overlaps and flash cues are flagged, not silently fixed.
- Workspace (Library, "Transcript" on any audio or video the person can open): `Player` on one side (`captions` already takes WebVTT tracks), the transcript
  on the other, built on the kit `LyricsList` (section 2.4), and for audio-only files the kit `TrackStudio` waveform lane. Search with next/previous match; click a line or word to seek; the current line (or word,
  when word times exist) highlights during playback; edit in place; autosave, undo, revision history with restore; Export menu.
  Phone width stacks player above transcript. Speaker filter and timestamp toggle sit in the same toolbar.
- Chat: `transcribe` tool, offered only on a turn carrying an audio or video attachment or a structured Library reference (an
  attachment or a `maipai://` item reference matched like `itemReferenceAllowed`; never a file name read from free text; a conditional
  set under rule 1, not in the base ten), with its own bench row. The model chooses to call it; the answer is a card opening the workspace.
- Translated captions are model output and pass the reader's band floor before they are stored or shown (rule 10), as PODCAST-PORT-05 does
  for summaries. Each language is its own `CaptionTrack`.
- `VideoPlayer` gets an additive `tracks` prop of the same `PlayerTextTrack` shape as `Player.captions` (not `caption`, which is the prompt
  line). Rule 9: kit change first in `commons`.
- Burn-in: ffmpeg `subtitles` through the existing `media.edit` job (EDITOR-11), with the chosen style; no new renderer.

**2.4 Reuse check for the transcript pane (principle 6, rule 9b).** No new Element.
- `LyricsList` (commons `ui/src/elements/lyrics-list.tsx`, Home `docs/design/UI-DECISIONS.md` row 35) already renders timed lines (`TimedLyricLine {t, line, words?}`),
  the current-line highlight, the word-by-word fill and `onSeek` click-to-seek. A transcript segment maps onto a `TimedLyricLine`. The gaps are
  additive props (rule 9c): editable lines (`onEditLine`), a speaker label per line, search-match marks with next/previous, a timestamp toggle,
  and a plain (non-lead, non-blurred) look. These land in `commons` first and MUSIC-GEN-20b and MUSIC-KIT-01 keep using the same Element.
- Waveform for audio-only: the kit `TrackStudio` waveform lane (UI-DECISIONS `track-studio`, wavesurfer). No second waveform library.
- AI Elements' transcription component: not confirmed to exist; slice 01d checks the registry first and records the finding. It is taken
  only if it covers editing and search better than extending `LyricsList`; otherwise `LyricsList` stays the base and the reason goes in a
  UI-DECISIONS row.
- If `LyricsList` cannot carry editing without breaking its lyrics look, a new Element needs its own UI-DECISIONS row stating why before
  a line is written.

## 3. Rules and gates

- Transcribing a person's own file makes no new content, so the feature adds no age gate (owner ruling 2026-11-01, minors: safety filtering
  only); the source's own access check decides who can open, edit or export a transcript. Podcast transcripts keep their existing
  teen-and-adult limit until Jesse rules otherwise; this note does not change it.
- Nothing leaves the home (zero phone-home). Transcript text never reaches a log line; logs carry counts and durations only.
- A failed transcription degrades to what was produced: text without word times, or without speakers, is still delivered; a failed chunk
  is marked and retried once. Errors say what went wrong and what to do.
- Resource priority: below chat, images and video (queue, never a raw error). A long file shows progress on that job's own card (S6,
  "One job's progress").
- Speaker names are labels the person sets; no voiceprint matching, ever.
- "Verbatim" is the stored transcript. A clean reading view is derived (filler words hidden, listed for the person to confirm), never a
  second stored copy.

## 4. Supersedes

- `podcast_transcripts` (PODCAST-PORT-04, migration 0137) and its `{start_s, text}` segment shape. Principles 1 and 4: one transcript
  definition. Slice **CAPTION-01h** migrates it to the `Transcript` record (additive migration, existing rows converted, publisher-first then
  Stack fetch order kept, the shared parser reused). The child refusal in `podcasts.ts` is carried over unchanged; changing it is a
  safety-gate change and Jesse's call. Until 01h lands the two coexist and nothing new reads `podcast_transcripts`.

## 5. Slices

**Phase 1, build first** (import, transcribe, click to seek, correct, preview captions, export SRT/VTT):
1. **CAPTION-01a** spec records `Transcript`, `TranscriptRevision`, `CaptionTrack`; pin bump (S, commons).
2. **CAPTION-01b** Stack long-file job: audio extraction, track and range, language, vocabulary hint, word times when present, cancel/retry; engine spike verdict (M, Stack).
3. **CAPTION-01c** Home store, routes, revisions with autosave/undo/restore, SRT/VTT/text/Markdown/JSON writers, SRT/VTT/text import, cue builder (M).
4. **CAPTION-01d** commons kit: `VideoPlayer` `tracks`; additive `LyricsList` props for editing, speakers, search marks and a timestamp toggle (section 2.4), registry check recorded (M, commons first).
5. **CAPTION-01e** the workspace in Library: player plus transcript, Search/Edit/Export, caption preview, phone layout, preview-checked at both widths (M).

**Phase 2, build next:**
6. **CAPTION-01f** word-level highlight and word-precise seek, manual speaker labels, speaker filter (M).
7. **CAPTION-01g** automatic speaker detection (diarization spike and job) and selected-range regeneration (M, Stack).
8. **CAPTION-01h** migrate podcast transcripts to `Transcript` (S, after 01c).
9. **CAPTION-01i** "needs refreshing" on outputs from revision numbers; find and replace with preview (S).

**Phase 3, each filed as its own backlog item when picked up:** `transcribe` chat tool (needs its bench row); burn-in; caption translation
and per-language tracks; caption styles and safe-area preview for vertical, square, widescreen; cue timeline editor and readability
flags; sound-description cues; word-highlight animation for social clips; bookmarks and chapters; voice memo record; batch queue;
share-at-timestamp link; search across all transcribed media; verbatim/clean views; uncertain-word flags.

## 6. What it feeds (separate items, not built here)

Dubbing (corrected dialogue, speakers, time ranges; LOCAL-BENCH-02 reads it), edit by transcript (word times cut through `media.edit`
trim and join; a typo fix and a speech cut are different actions), NotebookLM-style podcasts (source timestamps for citations; document-only
podcasts stay independent under PODCAST-PORT-08), highlights and chapters. FILM-05, PODCAST-PORT-05 and MUSIC-GEN-15 consume `Transcript`
and get no transcription path of their own.

Acceptance (phase 1): on the Studio, a 10 minute two-voice recording is imported, transcribed locally, a name is corrected and the
correction survives a reload, clicking a line seeks the player, the captions preview over a video, and the exported SRT plays in sync in a
standard player; screenshots at desktop and phone width opened and judged. Reuse check: `lib/stt.ts` and the Stack transcription route are
extended, not duplicated; `align_worker.py` aligns known text; the podcast parser is moved, not copied; `media.edit` renders; no new
subtitle library unless the spike shows the writer is not trivial.
