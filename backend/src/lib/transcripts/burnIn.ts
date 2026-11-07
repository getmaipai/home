// Burn a caption track into a copy of its video (CAPTION-03). The Stack's `media.edit` job draws the text; Home stages the
// video, runs the job in the background, and saves the result as a new file. The original is never changed.
import { randomUUID } from "node:crypto";
import { readAttachment, storeFile } from "@/lib/attachments";
import { readableItem } from "@/lib/media/access";
import { mediaBandOf } from "@/lib/media/band";
import { serveItemBytes } from "@/lib/media/serve";
import { runStackEdit, type StackEditRequest, type StackEditResult } from "@/lib/videos/stackEdit";
import type { PersonRow } from "@/types";
import { captionTrackCues } from "./captions";
import { getTranscriptDatabaseRow, TranscriptError } from "./store";

export const BURN_MAX_CUES = 2000;
export type BurnPosition = "bottom" | "middle" | "top";
export type BurnJob = { id: string; person: string; state: "running" | "done" | "failed"; progress: number; file_id?: string; error?: string };

type Runner = (request: StackEditRequest) => Promise<StackEditResult>;
let runner: Runner = runStackEdit;
export function __setBurnRunnerForTests(fn: Runner | null): void { runner = fn ?? runStackEdit; }

const jobs = new Map<string, BurnJob>();
export function __resetBurnJobsForTests(): void { jobs.clear(); }

const fail = (message: string, status: number): never => { throw new TranscriptError(message, status); };

async function sourceVideo(actor: PersonRow, itemId: string): Promise<{ bytes: Uint8Array; mediaType: string; name: string }> {
  const item = readableItem(actor, itemId);
  if (item) {
    const served = await serveItemBytes(actor, item, undefined);
    if (served instanceof Response && served.ok) {
      return { bytes: new Uint8Array(await served.arrayBuffer()), mediaType: (served.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase(), name: item.title };
    }
    return fail("The video file could not be read. Check that it is still in your Library, then try again.", 404);
  }
  const file = readAttachment(actor, itemId);
  if (!file.ok) return fail("That video was not found. Reload the Library and try again.", 404);
  return { bytes: file.value.bytes, mediaType: file.value.record.media_type.toLowerCase(), name: file.value.record.name ?? "Video" };
}

/** Starts the burn-in and returns at once; `burnJob` reports progress and the new file. */
export async function startBurnIn(actor: PersonRow, transcriptId: string, trackId: string, position: BurnPosition): Promise<BurnJob> {
  if (mediaBandOf(actor) === "child") return fail("Transcripts are available to teens and adults.", 403);
  const transcript = getTranscriptDatabaseRow(actor, transcriptId);
  const cues = captionTrackCues(actor, transcriptId, trackId);
  if (cues.length === 0) return fail("That caption track has no captions to burn in.", 400);
  if (cues.length > BURN_MAX_CUES) return fail(`This track has ${cues.length} captions and burn-in handles up to ${BURN_MAX_CUES}. Use a shorter video.`, 413);
  const source = await sourceVideo(actor, transcript.libraryItemId);
  if (!source.mediaType.startsWith("video/")) return fail("Burn-in needs a video. This item is audio only, so download the captions instead.", 400);

  const job: BurnJob = { id: randomUUID(), person: actor.id, state: "running", progress: 0 };
  jobs.set(job.id, job);
  const lines = cues.map((cue) => ({ from_s: cue.start, to_s: Math.max(cue.end, cue.start + 0.1), text: cue.text.replace(/\s+/g, " ").trim().slice(0, 120) })).filter((line) => line.text);
  void (async () => {
    try {
      const result = await runner({
        inputs: [{ bytes: source.bytes, ext: "mp4" }],
        ops: [{ op: "captions", lines, position }],
        name: "caption-burn-in",
        onProgress: (value) => { job.progress = value; },
      });
      if (!result.ok) { job.state = "failed"; job.error = result.line; return; }
      const saved = storeFile(actor, {
        conversationId: null, turnId: null, mediaType: "video/mp4", bytes: result.bytes, deduplicate: false, retention: "kept",
        provenance: `caption-burn-in:${JSON.stringify({ v: 1, transcript: transcriptId, track: trackId })}`,
        name: `${source.name} with captions.mp4`,
      });
      if (!saved.ok) { job.state = "failed"; job.error = "The captioned video could not be saved. Check that your storage has room, then try again."; return; }
      job.file_id = saved.value.id; job.progress = 1; job.state = "done";
      console.info(JSON.stringify({ event: "transcript.burn_in_done", cues: lines.length }));
    } catch {
      job.state = "failed"; job.error = "The captions could not be burned in. Check that the video editor is ready, then try again.";
    }
  })();
  return { ...job };
}

export function burnJob(actor: PersonRow, id: string): BurnJob {
  const job = jobs.get(id);
  if (!job || job.person !== actor.id) return fail("That burn-in was not found. Start it again.", 404);
  return { ...job };
}
