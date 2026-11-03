// VIDEO-STUDIO-07: what the Studio page reads and the `add` action. The page is a kit `studio` node (commons TrackStudio) fed by the Videos package's
// `recipes` data id (scopes `studio`, `studio-header`, `studio-picker`) and two package actions (`add`, `export`, see studioExport.ts). One definition of
// who may open a clip: the person's own finished clip (as chat's `ownClip` says), never a locked one without the proof, never for a minor (the page is
// adult-only: appRouteAllowed answers a child or teen 404 before any of this runs).
import { eq } from "drizzle-orm";
import { db, sqlite } from "@/db";
import { attachments } from "@/db/schema";
import { libraryProvenanceSql } from "@/lib/libraryProvenance";
import { lockItemOfProvenance, lockState } from "@/lib/adultLock";
import { makeAudienceOf } from "./make";
import { clipUrl, getVideoJobByFileFor, getVideoJobFor, posterUrl, type VideoJob } from "./jobs";
import { editableClip, editRefusal, ownTrackFile, speakLine, voiceChoice } from "./editGate";
import { lockedJobView, videoJobLockItem, videoJobLockState } from "./lock";
import { audioSeconds } from "./audioLength";
import { putStudioVoice, studioVoiceRef, studioVoiceUrl, VOICE_REF_PREFIX } from "./studioVoices";
import { STUDIO_AUDIO_PIECES, STUDIO_FILM_S, STUDIO_VIDEO_PIECES } from "./studioPlan";
import { MIX_LEVELS } from "./editPlan";
import type { PersonRow } from "@/types";

type Row = Record<string, unknown>;

export const STUDIO_TITLE = "Make it yours";
export const STUDIO_NO_CLIP_LINE = "That clip isn't available any more. Pick another one from My clips.";
export const STUDIO_LOCKED_LINE = "That is locked. Unlock it with your passcode first, then try again.";
export const STUDIO_NO_SONG_LINE = "I can't find that song. Pick one of your own songs.";
export const STUDIO_SPEECH_LINE = "Home can't speak right now, so the line was not added. Try again in a minute.";
export const STUDIO_SAY_LINE = "Type the line to say, up to 600 characters.";
export const STUDIO_WRONG_KIND_LINE = "That pick does not fit here. Use Add a voice for a typed line and Add music for a song.";

const words = (job: VideoJob, max: number): string => {
  const clean = job.prompt.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean || "Your clip";
};

/** The finished clip a Library file id or a job id names, when this person may edit it. `locked` is a clip that needs the Adult lock proof first. */
export function studioClip(person: PersonRow, id: string | undefined): { job: VideoJob } | { locked: true; job: VideoJob } | null {
  const wanted = (id ?? "").trim();
  if (!wanted || wanted.startsWith("$") || !/^[A-Za-z0-9_-]{1,160}$/.test(wanted)) return null;
  const job = getVideoJobByFileFor(person, wanted) ?? getVideoJobFor(person, wanted);
  if (!job || job.personId !== person.id || job.state !== "done" || job.files.length === 0) return null;
  const state = videoJobLockState(person, job);
  if (state === "hidden") return null;
  if (state === "locked") return { locked: true, job };
  return editableClip(person, job) ? { job } : null;
}

const secondsOf = (job: VideoJob): number => {
  const file = job.files[0]!;
  const length = file.seconds ?? job.request.seconds;
  return Math.max(0.5, Math.round(length * 100) / 100);
};

/** `scope: "studio"`: the clip as the TrackStudio's one row. A locked clip is the one lock row and nothing of it (no title, poster or file address). */
export function studioRows(person: PersonRow, id: string | undefined): Row[] {
  const found = studioClip(person, id);
  if (!found) return [];
  if ("locked" in found) return [{ ...lockedJobView(found.job), id: "locked" }];
  const { job } = found;
  const file = job.files[0]!;
  const length = secondsOf(job);
  const adult = videoJobLockItem(job)?.madeAudience === "adult-only";
  const mark = adult ? { adult_only: true } : {};
  return [{
    id: file.id,
    title: words(job, 80),
    poster: posterUrl(job, file),
    locked: false,
    ...mark,
    lanes: [
      { id: "video", pieces: [{ id: "clip-1", ref: file.id, src: clipUrl(job, file), label: words(job, 40), poster: posterUrl(job, file), in_s: 0, out_s: length, source_s: length, ...mark }] },
      { id: "voice", pieces: [] },
      { id: "music", pieces: [] },
    ],
  }];
}

/** `scope: "studio-header"`: the one row of the header (the clip's words and picture), or the plain title with no clip; a locked clip shows nothing of it. */
export function studioHeaderRows(person: PersonRow, id: string | undefined): Row[] {
  const found = studioClip(person, id);
  if (!found) return [{ title: STUDIO_TITLE, locked: false }];
  if ("locked" in found) return [{ title: STUDIO_TITLE, locked: true }];
  const adult = videoJobLockItem(found.job)?.madeAudience === "adult-only";
  return [{ title: words(found.job, 60), thumbnail: posterUrl(found.job, found.job.files[0]!), locked: false, ...(adult ? { adult_only: true } : {}) }];
}

/** The numbers the page draws (its `limits`), from the constants the export enforces. */
export const studioLimits = { video_pieces: STUDIO_VIDEO_PIECES, audio_pieces: STUDIO_AUDIO_PIECES, film_s: STUDIO_FILM_S };
export const studioLevelSteps = MIX_LEVELS.map((step) => ({ id: step.id, label: step.id === "very_loud" ? "Very loud" : step.id[0]!.toUpperCase() + step.id.slice(1), gain_db: step.gain_db, clip_gain_db: step.clip_gain_db }));

/** The length of a Library audio file (a made song's job, else its note), or null. */
export function songSeconds(person: PersonRow, fileId: string, bytes?: Uint8Array): number | null {
  const read = bytes ? audioSeconds(bytes) : null;
  if (read !== null) return read;
  const meta = libraryProvenanceSql("a.provenance");
  const row = sqlite.query<{ d: number | null }, [string, string]>(`SELECT coalesce(mj.duration_s, json_extract(${meta},'$.duration_seconds'), json_extract(${meta},'$.seconds')) AS d FROM attachments a LEFT JOIN music_jobs mj ON mj.id = coalesce(json_extract(${meta},'$.job_id'),json_extract(${meta},'$.job')) AND mj.person_id = a.owner_person_id WHERE a.id = ? AND a.owner_person_id = ?`).get(fileId, person.id);
  return typeof row?.d === "number" && Number.isFinite(row.d) && row.d > 0 ? row.d : null;
}

export type StudioAddResult = { ok: true; piece: Row } | { ok: false; status: 403 | 404 | 422 | 503; line: string; code: string };

/**
 * `actions/add`: what a person picked becomes a piece for the page. A clip is one of their own finished clips, a voice line is typed words (screened like a
 * prompt, then spoken once and kept for the session), a song is one of their own audio files. The reply is `{ ref, src, label, duration_s }`; an adult-only
 * source also says so, so the page fetches it with the Adult lock proof and plays it only inside the Studio.
 */
export async function studioAdd(person: PersonRow, body: Record<string, unknown>): Promise<StudioAddResult> {
  const kind = body.kind;
  const ref = typeof body.ref === "string" ? body.ref.trim() : "";
  if (kind !== "clip" && kind !== "voice" && kind !== "music") return { ok: false, status: 422, code: "bad_arguments", line: STUDIO_WRONG_KIND_LINE };
  // The page is the person's own screen; the gate is the one every edit uses (surface and age, then the screening of any typed words).
  const audience = makeAudienceOf(person);
  const typed = kind === "voice" && ref.startsWith("say:") ? ref.slice(4) : "";
  const refusal = editRefusal(audience, typed);
  if (refusal) return { ok: false, status: 403, code: refusal.kind === "minor" ? "minor" : "refused", line: refusal.line };

  if (kind === "clip") {
    const found = studioClip(person, ref);
    if (!found) return { ok: false, status: 404, code: "no_clip", line: STUDIO_NO_CLIP_LINE };
    if ("locked" in found) return { ok: false, status: 403, code: "locked", line: STUDIO_LOCKED_LINE };
    const { job } = found;
    const file = job.files[0]!;
    const length = secondsOf(job);
    const adult = videoJobLockItem(job)?.madeAudience === "adult-only";
    return { ok: true, piece: { ref: file.id, src: clipUrl(job, file), label: words(job, 40), poster: posterUrl(job, file), duration_s: length, ...(adult ? { adult_only: true } : {}) } };
  }

  if (kind === "voice") {
    if (!ref.startsWith("say:")) return { ok: false, status: 422, code: "wrong_kind", line: STUDIO_WRONG_KIND_LINE };
    const line = ref.slice(4).trim();
    if (line.length < 1 || line.length > 600) return { ok: false, status: 422, code: "bad_arguments", line: STUDIO_SAY_LINE };
    const voice = await voiceChoice(person, undefined);
    if (!voice.ok) return { ok: false, status: 422, code: "no_voice", line: STUDIO_SPEECH_LINE };
    const spoken = await speakLine(line, voice.voice);
    if (!spoken) return { ok: false, status: 503, code: "speech_failed", line: STUDIO_SPEECH_LINE };
    const kept = putStudioVoice(person.id, { bytes: spoken.bytes, ext: spoken.ext, mediaType: "audio/wav", line });
    return { ok: true, piece: { ref: studioVoiceRef(kept.id), src: studioVoiceUrl(kept.id), label: line.length > 40 ? `${line.slice(0, 39).trimEnd()}…` : line, duration_s: kept.seconds } };
  }

  // music
  if (ref.startsWith("say:") || ref.startsWith(VOICE_REF_PREFIX)) return { ok: false, status: 422, code: "wrong_kind", line: STUDIO_WRONG_KIND_LINE };
  const track = ownTrackFile(person, ref, false, null);
  if (!track || !track.fileId) return { ok: false, status: 404, code: "no_track", line: STUDIO_NO_SONG_LINE };
  const row = db.select().from(attachments).where(eq(attachments.id, track.fileId)).get();
  const item = row ? lockItemOfProvenance(row.ownerPersonId, row.provenance) : null;
  if (lockState(item, person) !== "open") return { ok: false, status: 403, code: "locked", line: STUDIO_LOCKED_LINE };
  const length = songSeconds(person, track.fileId, track.file.bytes);
  if (length === null) return { ok: false, status: 422, code: "no_length", line: "I can't tell how long that sound is. Pick one of your made songs." };
  const adult = track.mark.madeAudience === "adult-only";
  return { ok: true, piece: { ref: track.fileId, src: `/api/files/${encodeURIComponent(track.fileId)}/content`, label: row?.name ? String(row.name).replace(/\.[a-z0-9]{2,4}$/i, "") : "A song", duration_s: length, ...(adult ? { adult_only: true } : {}) } };
}
