# Transcripts and captions: timed text with speakers, subtitle files, edit by transcript (2026-11-06)

Status: architect APPROVED 2026-11-06 (first pass REJECTED, edits applied: Supersedes, conditional tool, band floor, reuse spike). Condition: "names a Library file" in 2.3(b) means a structured reference (an attachment or a `maipai://` item reference matched like `itemReferenceAllowed`), never a file name read from free text. Item: CAPTION-01. Owner ask 2026-11-06 (Jesse): build the missing "transcribe audio and
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

One definition: a `Transcript` is a spec record (commons `spec`, additive, spec first): `id`, `source` (media file id), `language`,
`segments[]` of `{start, end, text, speaker?}`, optional `words[]` of `{start, end, text}`, provenance (engine, model id, run date),
clock stamp, and the source's visibility (a transcript is never more public than its source).

**2.1 Engine (Stack).** A long-file transcription job: decode with ffmpeg, cut at silence into chunks of at most 30 seconds, run the
existing speech role on each chunk with word timestamps, stitch with overlap removal. Speaker labels from a local diarizer. Candidates
to measure in the spike, in this order: the sherpa-onnx speaker diarization pipeline (the Stack already ships sherpa-onnx for Parakeet),
then pyannote segmentation. Take the first that fits the license rule and the tier memory ladder; record the verdict. No cloud call.
Chunking is not hand-built unless the spike shows it must be: the spike compares (1) sherpa-onnx VAD plus the offline recognizer with
token timestamps (already shipped in the Stack), (2) mlx-whisper (already in MUSIC-REMIX-01's R0 bench), (3) WhisperX, and records why the
winner wins. Only if none returns word times is the silence-cut stitch above written.

**2.2 Outputs.** SRT and WebVTT written from the record by one pure function (`lib/transcripts/subtitles.ts`), plus plain text and
a speaker-labelled text. Burned-in captions use ffmpeg `subtitles` through the existing `media.edit` job (`EDITOR-11`), not a new
renderer.

**2.3 Where it shows.**
(a) Library: a Transcript action on any audio or video file the person owns, a transcript view with click-to-seek.
(b) Chat: a `transcribe` tool, offered only on a turn that carries an audio or video attachment or names a Library file by structured reference (a conditional
set, rule 1; never in the base ten), with its own bench row in slice 01d. The model chooses to call it; the answer is a card with the
text, Download SRT, Download VTT, Burn into video.
(c) Players: `Player` already takes WebVTT `captions`; `VideoPlayer` gets an additive `tracks` prop (not `caption`, which is the prompt
line) of the same `PlayerTextTrack` shape. Rule 9, so it lands in `commons` first. Home serves the VTT from the Transcript record.
(d) Translate captions through the household chat model into a second Transcript record; same shape, `language` differs. Translated
text is model output, so it passes the reader's band floor before it is stored or shown (rule 10), as PODCAST-PORT-05 does for summaries.

**2.4 Edit by transcript (slice 2).** Delete or replace a sentence in the transcript view; Home builds a cut list from segment times and
runs `media.edit` trim and join. Filler-word removal is a button that lists the words it would cut for the person to confirm.

**2.5 Fit with other work.** FILM-05 and PODCAST-PORT-05 consume `Transcript`; dubbing (LOCAL-BENCH-02) reads it; MUSIC-GEN-15 (check the
sung words) can use the same job. None of them get their own transcription path. Podcast storage is handled in section 4.

## 3. Rules and gates

- Transcribing makes no new content, so the feature adds no age gate (owner ruling 2026-11-01, minors: safety filtering only);
  the source's own access check decides who can open the transcript. Podcast transcripts keep their existing teen-and-adult limit until
  Jesse rules otherwise; this note does not change it. Burning captions into a video makes a new file and follows the
  video lane's existing rules.
- Nothing leaves the home (zero phone-home). Transcript text never reaches a log line; logs carry counts and durations only.
- A failed transcription or speaker pass degrades: text without speakers is still delivered, a failed chunk is marked and retried once.
- Resource priority: runs below chat, images and video (queue, never a raw error). A long file shows its progress on that job's own card (S6, "One job's progress").
- Speaker names are labels (Speaker 1, 2); naming a speaker is the person's edit, never a voiceprint match (no biometric ID).

## 4. Supersedes

- `podcast_transcripts` (PODCAST-PORT-04, migration 0137) and its `{start_s, text}` segment shape. Principles 1 and 4: one transcript
  definition. Slice **CAPTION-01g** migrates it to the `Transcript` record (additive migration, existing rows converted, publisher-first
  then Stack fetch order kept, `parseTranscriptDocument` reused as the shared WebVTT/SRT parser). The child refusal in `podcasts.ts` is
  carried over unchanged; changing it is a safety-gate change and Jesse's call, not part of this item. Until 01g lands the two coexist
  and nothing new reads `podcast_transcripts`.

## 5. Slices

1. **CAPTION-01a** spec `Transcript` in commons, pin bump (S).
2. **CAPTION-01b** Stack long-file job with word timestamps, spike on diarization with a measured verdict and a real two-speaker clip (M, Stack).
3. **CAPTION-01c** Home route, storage, SRT/WebVTT writer, Library action and transcript view (M).
4. **CAPTION-01d** `transcribe` chat tool and card (S).
5. **CAPTION-01e** kit `tracks` prop on `VideoPlayer`, then wiring (M, commons first).
6. **CAPTION-01f** burn-in via `media.edit`, caption translation (S).
7. **CAPTION-01g** migrate podcast transcripts to `Transcript` (S, after 01c).
8. **CAPTION-02** edit by transcript (M, after 01c).

Acceptance (whole item): a 10 minute two-speaker recording on the Studio gives a speaker-labelled transcript whose SRT opens in a
standard player in sync, the same file burned into a video shows correct captions, the chat tool does the same from a prompt, and the
displayed result was opened and judged. Reuse check: `lib/stt.ts` and the Stack transcription route are extended, not duplicated;
`align_worker.py` stays for known lyrics only; `media.edit` renders; no new subtitle library unless the spike shows the writer is not
trivial.
