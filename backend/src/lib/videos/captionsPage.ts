// The Captions page of the Video app: add and fix captions and titles on a finished clip. Nothing new in the engine: the lines are the clip's own
// transcript and caption track (lib/transcripts), and burning them in, a title card and rolling credits are the `edit_video` captions, title_card and credits
// edits (clipEditStart.startClipEdit), so the edit gate (adults only), the lock check, the audience mark of the new clip and the Activity row are the ones every
// edit already has. The page offers the lines as editable text, one per row: `m:ss-m:ss words`.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { captionTracks } from "@/db/schema";
import { nextHlc } from "@/lib/hlc";
import type { PersonRow } from "@/types";
import { makeAudienceOf } from "./make";
import { editRefusal } from "./editGate";
import { LOCKED_START_LINE } from "./lock";
import { studioClip } from "./studio";
import { startClipEdit, type ClipEditStart } from "./clipEditStart";
import { CAPTION_POSITIONS, type CaptionPosition } from "./editPlan";
import { transcribeJob } from "@/lib/transcripts/stack";
import { createTranscript, transcriptRowForItem, TranscriptError } from "@/lib/transcripts/store";
import { captionTrackCues, createCaptionTrack, listCaptionTracks } from "@/lib/transcripts/captions";
import type { Cue } from "@/lib/transcripts/cues";

/** The most caption lines one burn-in takes (the `edit_video` captions argument). */
export const MAX_CAPTION_LINES = 40;
const MAX_LINE_CHARS = 160;
export const MAX_CREDIT_LINES = 60;

export type CaptionsFail = { ok: false; status: 400 | 403 | 404 | 413 | 422 | 423 | 502 | 503; error: string; code: string };
type Clip = { ok: true; fileId: string; id: string } | CaptionsFail;
export const NO_CLIP_LINE = "That video isn't available any more. Pick a clip again.";
export const NO_SPEECH_LINE = "I couldn't hear any speech in that clip, so there is nothing to caption. Pick a clip with talking in it.";
const STACK_LINE = "I couldn't listen to that clip. Check that the local Stack is ready, then try again.";

/** The gate every Captions action starts with: the edit gate (adults only), then the person's own finished clip, open (not behind the Adult lock). */
export function captionClip(actor: PersonRow, id: unknown): Clip {
  const gate = editRefusal(makeAudienceOf(actor), "");
  if (gate) return { ok: false, status: gate.kind === "denied" ? 403 : 422, error: gate.line, code: gate.kind === "denied" ? gate.why : "minor" };
  const found = studioClip(actor, typeof id === "string" ? id : undefined);
  if (!found) return { ok: false, status: 404, error: NO_CLIP_LINE, code: "not_found" };
  if ("locked" in found) return { ok: false, status: 423, error: LOCKED_START_LINE, code: "locked" };
  const file = found.job.files[0];
  return file ? { ok: true, fileId: file.id, id: found.job.id } : { ok: false, status: 404, error: NO_CLIP_LINE, code: "not_found" };
}

type Track = { transcriptId: string; trackId: string; cues: Cue[]; language: string };

/** The clip's own caption track (the first one that is not a translation), when it has one. */
function trackOf(actor: PersonRow, fileId: string): Track | null {
  let transcript;
  try { transcript = transcriptRowForItem(actor, fileId); } catch { return null; }
  if (!transcript) return null;
  const summary = listCaptionTracks(actor, transcript.id).find((track) => !track.translated);
  if (!summary) return null;
  return { transcriptId: transcript.id, trackId: summary.id, cues: captionTrackCues(actor, transcript.id, summary.id), language: transcript.language };
}

const clock = (seconds: number): string => {
  const whole = Math.max(0, Math.round(seconds * 10) / 10);
  const minutes = Math.floor(whole / 60);
  const rest = whole - minutes * 60;
  return `${minutes}:${(rest < 10 ? "0" : "") + (Number.isInteger(rest) ? String(rest) : rest.toFixed(1))}`;
};
const lineOf = (cue: Cue): string => `${clock(cue.start)}-${clock(cue.end)} ${cue.text.replace(/\s+/g, " ").trim()}`;

/** `scope: "caption-lines"`: one row per caption line, with its times. Nothing for a clip the person may not edit. */
export function captionLineRows(actor: PersonRow, id: string | undefined): Array<Record<string, unknown>> {
  const clip = captionClip(actor, id);
  if (!clip.ok) return [];
  const track = trackOf(actor, clip.fileId);
  return (track?.cues ?? []).map((cue) => ({ id: cue.id, text: cue.text, times: `${clock(cue.start)} to ${clock(cue.end)}`, clip: clip.fileId }));
}

/** `scope: "caption-edit"`: one row that opens the lines as editable text (the row's `text` is the whole list, one line per caption). */
export function captionEditRows(actor: PersonRow, id: string | undefined): Array<Record<string, unknown>> {
  const clip = captionClip(actor, id);
  if (!clip.ok) return [];
  const track = trackOf(actor, clip.fileId);
  if (!track || track.cues.length === 0) return [];
  return [{ id: "edit", title: "Fix the words", subtitle: `${track.cues.length} ${track.cues.length === 1 ? "line" : "lines"}, shown with their times`, text: track.cues.map(lineOf).join("\n"), clip: clip.fileId }];
}

/** `scope: "caption-make"`: one row when the clip has no captions yet; its action listens to the clip. */
export function captionMakeRows(actor: PersonRow, id: string | undefined): Array<Record<string, unknown>> {
  const clip = captionClip(actor, id);
  if (!clip.ok) return [];
  const track = trackOf(actor, clip.fileId);
  if (track && track.cues.length > 0) return [];
  return [{ id: "make", title: "No captions yet", subtitle: "Listen to the clip and write down what is said", clip: clip.fileId }];
}

/** Make the clip's captions from its speech (Stack transcription), unless it already has them. */
export async function makeCaptions(actor: PersonRow, id: unknown): Promise<{ ok: true; lines: number } | CaptionsFail> {
  const clip = captionClip(actor, id);
  if (!clip.ok) return clip;
  const have = trackOf(actor, clip.fileId);
  if (have && have.cues.length > 0) return { ok: true, lines: have.cues.length };
  try {
    let transcript = transcriptRowForItem(actor, clip.fileId);
    if (!transcript) {
      const heard = await transcribeJob(actor, { item_id: clip.fileId });
      if (!heard.segments.some((segment) => segment.text.trim())) return { ok: false, status: 422, error: NO_SPEECH_LINE, code: "no_speech" };
      transcript = createTranscript(actor, { itemId: clip.fileId, language: heard.language || "en", segments: heard.segments, speakers: heard.speakers, vocabulary: heard.vocabulary, provenance: { engine: heard.engine ?? "stack", model_id: heard.model_id ?? "unknown", source_kind: "generated" } });
    }
    createCaptionTrack(actor, transcript.id);
    const made = trackOf(actor, clip.fileId);
    if (!made || made.cues.length === 0) return { ok: false, status: 422, error: NO_SPEECH_LINE, code: "no_speech" };
    return { ok: true, lines: made.cues.length };
  } catch (error) {
    if (error instanceof TranscriptError) return { ok: false, status: error.status as 403 | 404, error: error.message, code: "transcript" };
    return { ok: false, status: 502, error: STACK_LINE, code: "stack" };
  }
}

const SECONDS = "(\\d{1,3}):(\\d{2}(?:\\.\\d)?)";
const LINE_PATTERN = new RegExp(`^\\s*${SECONDS}\\s*(?:-|to)\\s*${SECONDS}\\s+(\\S.*)$`);
const secondsOf = (minutes: string, rest: string): number => Number(minutes) * 60 + Number(rest);

/** The lines the person typed, `m:ss-m:ss words` each. The first problem is named with its line number and what to type. */
export function parseCaptionText(text: string): { ok: true; lines: Array<{ from_s: number; to_s: number; text: string }> } | CaptionsFail {
  const rows = text.split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
  if (rows.length === 0) return { ok: false, status: 400, error: "There are no caption lines. Type each line like 0:03-0:06 and then the words.", code: "no_lines" };
  if (rows.length > MAX_CAPTION_LINES) return { ok: false, status: 413, error: `That is ${rows.length} caption lines and a video takes up to ${MAX_CAPTION_LINES}. Join some lines and try again.`, code: "too_many_lines" };
  const lines: Array<{ from_s: number; to_s: number; text: string }> = [];
  for (const [index, row] of rows.entries()) {
    const match = LINE_PATTERN.exec(row);
    if (!match) return { ok: false, status: 400, error: `Line ${index + 1} needs its times first, like 0:03-0:06, and then the words.`, code: "bad_line" };
    const from = secondsOf(match[1]!, match[2]!);
    const to = secondsOf(match[3]!, match[4]!);
    if (to <= from) return { ok: false, status: 400, error: `Line ${index + 1} ends before it starts. Make the second time later than the first.`, code: "bad_times" };
    if (to > 600) return { ok: false, status: 400, error: `Line ${index + 1} is past ten minutes, which is the longest a caption can sit. Use an earlier time.`, code: "bad_times" };
    const words = match[5]!.replace(/\s+/g, " ").trim();
    if (words.length > MAX_LINE_CHARS) return { ok: false, status: 400, error: `Line ${index + 1} has ${words.length} letters and a caption holds up to ${MAX_LINE_CHARS}. Split it in two lines.`, code: "line_too_long" };
    lines.push({ from_s: from, to_s: to, text: words });
  }
  return { ok: true, lines };
}

/** Save the person's fixed lines on the clip's caption track. Each saved line is marked as hand-fixed, so a refresh keeps it. */
export function saveCaptionText(actor: PersonRow, id: unknown, text: unknown): { ok: true; lines: number } | CaptionsFail {
  const clip = captionClip(actor, id);
  if (!clip.ok) return clip;
  const track = trackOf(actor, clip.fileId);
  if (!track) return { ok: false, status: 404, error: "This clip has no captions yet. Make captions first, then fix the words.", code: "no_captions" };
  const parsed = parseCaptionText(typeof text === "string" ? text : "");
  if (!parsed.ok) return parsed;
  const fallbackSegment = track.cues[0]?.segment_id ?? "";
  const cues: Cue[] = parsed.lines.map((line, index) => {
    const old = track.cues[index];
    return { id: old?.id ?? `cue-hand-${index + 1}`, segment_id: old?.segment_id ?? fallbackSegment, start: line.from_s, end: line.to_s, text: line.text, text_overridden: true };
  });
  db.update(captionTracks).set({ cues: JSON.stringify(cues), hlc: nextHlc() }).where(eq(captionTracks.id, track.trackId)).run();
  return { ok: true, lines: cues.length };
}

export const isCaptionPosition = (value: unknown): value is CaptionPosition => typeof value === "string" && (CAPTION_POSITIONS as readonly string[]).includes(value);

/** Burn the clip's caption lines into a new copy (the original stays). Words typed in the box are saved first. */
export async function burnCaptions(actor: PersonRow, id: unknown, position: unknown, text: unknown): Promise<ClipEditStart | CaptionsFail> {
  const clip = captionClip(actor, id);
  if (!clip.ok) return clip;
  if (position !== undefined && position !== "" && !isCaptionPosition(position)) return { ok: false, status: 400, error: "Choose top, middle or bottom for where the captions sit.", code: "bad_position" };
  if (typeof text === "string" && text.trim()) {
    const saved = saveCaptionText(actor, id, text);
    if (!saved.ok) return saved;
  }
  const track = trackOf(actor, clip.fileId);
  if (!track || track.cues.length === 0) return { ok: false, status: 404, error: "This clip has no captions yet. Make captions first, then add them to the video.", code: "no_captions" };
  if (track.cues.length > MAX_CAPTION_LINES) return { ok: false, status: 413, error: `This clip has ${track.cues.length} caption lines and a video takes up to ${MAX_CAPTION_LINES}. Join some lines in Fix the words, then try again.`, code: "too_many_lines" };
  const captions = track.cues.map((cue) => ({ from_s: Math.min(Math.max(cue.start, 0), 599.9), to_s: Math.min(Math.max(cue.end, cue.start + 0.1), 600), text: cue.text.replace(/\s+/g, " ").trim().slice(0, MAX_LINE_CHARS) })).filter((line) => line.text);
  return startClipEdit(actor, clip.id, { change: "captions", captions, position: isCaptionPosition(position) ? position : "bottom" }, "I couldn't add the captions to that video. Try again.", "captions_failed");
}

/** A title card at the start of a copy of the clip. The first line of the box is the title, an optional second line the subtitle. */
export async function addTitle(actor: PersonRow, id: unknown, text: unknown): Promise<ClipEditStart | CaptionsFail> {
  const clip = captionClip(actor, id);
  if (!clip.ok) return clip;
  const [title, subtitle] = (typeof text === "string" ? text : "").split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
  if (!title) return { ok: false, status: 400, error: "Type the title to put on the video. A second line is the smaller line under it.", code: "missing_title" };
  if (title.length > 120 || (subtitle?.length ?? 0) > 120) return { ok: false, status: 400, error: "A title and its second line each hold up to 120 letters. Shorten them and try again.", code: "title_too_long" };
  return startClipEdit(actor, clip.id, { change: "title_card", title, ...(subtitle ? { subtitle } : {}) }, "I couldn't add the title to that video. Try again.", "title_failed");
}

/** Rolling credits at the end of a copy of the clip: one name per line, or `Role: Name`. */
export async function addCredits(actor: PersonRow, id: unknown, text: unknown): Promise<ClipEditStart | CaptionsFail> {
  const clip = captionClip(actor, id);
  if (!clip.ok) return clip;
  const rows = (typeof text === "string" ? text : "").split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
  if (rows.length === 0) return { ok: false, status: 400, error: "Type the names for the credits, one on each line. Use Role: Name to add a job.", code: "missing_credits" };
  if (rows.length > MAX_CREDIT_LINES) return { ok: false, status: 413, error: `Credits can have up to ${MAX_CREDIT_LINES} names and this has ${rows.length}. Shorten the list and try again.`, code: "too_many_credits" };
  const credits = rows.map((row) => {
    const split = row.indexOf(":");
    const role = split > 0 ? row.slice(0, split).trim().slice(0, 40) : "";
    const name = (split > 0 ? row.slice(split + 1) : row).trim().slice(0, 60);
    return { ...(role ? { role } : {}), name };
  }).filter((line) => line.name);
  if (credits.length === 0) return { ok: false, status: 400, error: "Each credit needs a name. Type Role: Name or just the name.", code: "missing_credits" };
  return startClipEdit(actor, clip.id, { change: "credits", credits }, "I couldn't add the credits to that video. Try again.", "credits_failed");
}
