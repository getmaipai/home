// MP-02: file effects on a saved song or sound. ffmpeg runs here, in Home (CPU only, no Stack call, no model, no memory admission).
// The one ffmpeg host is mixParts.ts (`run`, `musicAudioTools`); this file builds the filters and the new-version job around it.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { conversationTurns } from "@/db/schema";
import { createAttachment } from "@/lib/attachments";
import { newFileId, newMusicJobId } from "@/lib/id";
import { checkStorageCap } from "@/lib/storage/usage";
import type { PersonRow } from "@/types";
import { provenanceFor } from "./commercial";
import { jobsForConversation, readMusicFile } from "./jobs";
import { musicJobLockState } from "./lock";
import { m4aSeconds } from "./m4a";
import { modelStampFor } from "./models";
import { musicAudioTools, run } from "./mixParts";
import { StackMusicError } from "./stack";
import { getMusicJobFor, saveMusicJob, temporarySongs } from "./store";
import { MUSIC_NOTE, type GenerationProvenance, type MusicJob, type MusicRequest } from "./types";

export const EFFECT_CHANGES = ["gain", "reverse", "speed", "pitch", "remove_silence", "limit", "echo", "reverb", "eq", "denoise"] as const;
export type EffectChange = typeof EFFECT_CHANGES[number];
export const isEffectChange = (change: string): change is EffectChange => (EFFECT_CHANGES as readonly string[]).includes(change);
export const EQ_PRESETS = ["bass_boost", "treble_boost", "vocal_clarity", "warm"] as const;
/** Centre frequencies (Hz) of the six bands; a preset is a gain in dB for each. */
export const EQ_BANDS_HZ = [60, 170, 400, 1000, 3500, 10000] as const;
const PRESET_GAINS: Record<typeof EQ_PRESETS[number], readonly number[]> = {
  bass_boost: [6, 4, 1, 0, 0, 0], treble_boost: [0, 0, 0, 1, 4, 6], vocal_clarity: [-2, -2, -1, 2, 3, 1], warm: [3, 2, 1, 0, -2, -3],
};
/** What a person sees: the version label and the Activity words. */
export const EFFECT_LABELS: Record<EffectChange, string> = {
  gain: "volume changed", reverse: "reversed", speed: "speed changed", pitch: "pitch changed", remove_silence: "silence removed",
  limit: "limited", echo: "echo", reverb: "reverb", eq: "equalizer", denoise: "noise reduced",
};
export interface EffectSpec { change: EffectChange; amount?: number; preset?: typeof EQ_PRESETS[number]; bands?: number[]; from_s?: number; to_s?: number }
export type EffectCheck = { ok: true; spec: EffectSpec } | { ok: false; line: string };
export const EFFECT_UNAVAILABLE_LINE = "This computer has no audio tool to change the sound. Install ffmpeg, then try again.";
export const EFFECT_FAILED_LINE = "The change could not be made. Try again, or try a different part of the song.";
const num = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Check an effect request against its bounds and the song's length. Pure. */
export function checkEffect(input: { change: string; amount?: unknown; preset?: unknown; bands?: unknown; from_s?: unknown; to_s?: unknown }, durationS: number): EffectCheck {
  if (!isEffectChange(input.change)) return { ok: false, line: "That change is not one I can make to a song file." };
  const spec: EffectSpec = { change: input.change };
  const bound = (what: string, min: number, max: number, unit: string): string | null => {
    if (!num(input.amount)) return `Say how much: ${what} from ${min} to ${max}${unit}.`;
    if (input.amount < min || input.amount > max) return `That is out of range. Choose ${what} from ${min} to ${max}${unit}.`;
    spec.amount = input.amount; return null;
  };
  const problem = input.change === "gain" ? bound("a volume change", -24, 24, " dB")
    : input.change === "speed" ? bound("a speed", 0.5, 2, " times")
    : input.change === "pitch" ? bound("a pitch shift", -12, 12, " semitones")
    : null;
  if (problem) return { ok: false, line: problem };
  if (input.change === "eq") {
    const bands = input.bands;
    if (bands !== undefined) {
      if (!Array.isArray(bands) || bands.length !== EQ_BANDS_HZ.length || bands.some((g) => !num(g) || g < -12 || g > 12)) return { ok: false, line: "Give six equalizer gains, each from -12 to 12 dB." };
      spec.bands = bands.map(Number);
    } else if (typeof input.preset === "string" && (EQ_PRESETS as readonly string[]).includes(input.preset)) spec.preset = input.preset as typeof EQ_PRESETS[number];
    else return { ok: false, line: `Choose an equalizer preset (${EQ_PRESETS.join(", ").replace(/_/g, " ")}) or give six band gains.` };
  }
  const from = input.from_s, to = input.to_s;
  if (from !== undefined || to !== undefined) {
    if ((from !== undefined && !num(from)) || (to !== undefined && !num(to)) || (from ?? 0) < 0 || (to !== undefined && to > durationS + 0.05) || (to !== undefined && to <= (from ?? 0)) || (from ?? 0) >= durationS) {
      return { ok: false, line: "That part is outside the song. Give a start and end within its length in seconds." };
    }
    if (from !== undefined) spec.from_s = from;
    if (to !== undefined) spec.to_s = to;
  }
  return { ok: true, spec };
}

const fixed = (n: number): string => String(Math.round(n * 1000) / 1000);
/** The ffmpeg audio filter chain for one effect. Pure. */
export function effectFilter(spec: EffectSpec): string {
  switch (spec.change) {
    case "gain": return `volume=${fixed(spec.amount ?? 0)}dB`;
    case "reverse": return "areverse";
    case "speed": return `atempo=${fixed(spec.amount ?? 1)}`;
    case "pitch": {
      const factor = 2 ** ((spec.amount ?? 0) / 12);
      return `aresample=44100,asetrate=${fixed(44100 * factor)},aresample=44100,atempo=${fixed(1 / factor)}`;
    }
    case "remove_silence": return "silenceremove=start_periods=1:start_threshold=-50dB:stop_periods=-1:stop_duration=0.8:stop_threshold=-50dB";
    case "limit": return "alimiter=limit=0.89:attack=5:release=50:level=0";
    case "echo": return "aecho=0.8:0.88:250|500:0.4|0.25";
    case "reverb": return "aecho=0.8:0.7:35|60|95|140|190:0.45|0.35|0.28|0.2|0.14,lowpass=f=7000";
    case "denoise": return "afftdn=nr=12:nf=-40";
    case "eq": {
      const gains = spec.bands ?? PRESET_GAINS[spec.preset ?? "warm"];
      const parts = EQ_BANDS_HZ.flatMap((hz, i) => (gains[i] ?? 0) === 0 ? [] : [`equalizer=f=${hz}:t=q:w=1:g=${fixed(gains[i]!)}`]);
      return parts.length ? parts.join(",") : "anull";
    }
  }
}
/** The whole filter graph: the effect on the chosen region, the rest untouched (split, filter the middle, join). Pure. */
export function effectGraph(spec: EffectSpec): string {
  const filter = effectFilter(spec);
  const from = spec.from_s ?? 0, to = spec.to_s;
  if (from <= 0 && to === undefined) return `[0:a]${filter}[out]`;
  const pieces: string[] = [], names: string[] = [];
  if (from > 0) { pieces.push(`[0:a]atrim=end=${fixed(from)},asetpts=PTS-STARTPTS[head]`); names.push("[head]"); }
  pieces.push(`[0:a]atrim=start=${fixed(from)}${to !== undefined ? `:end=${fixed(to)}` : ""},asetpts=PTS-STARTPTS,${filter}[mid]`); names.push("[mid]");
  if (to !== undefined) { pieces.push(`[0:a]atrim=start=${fixed(to)},asetpts=PTS-STARTPTS[tail]`); names.push("[tail]"); }
  return `${pieces.join(";")};${names.join("")}concat=n=${names.length}:v=0:a=1[out]`;
}

/** Apply one effect to m4a bytes with ffmpeg. Throws "effect_unavailable" with no ffmpeg and "effect_failed" when it does not produce a file. */
export async function applyEffect(bytes: Uint8Array, spec: EffectSpec): Promise<Uint8Array> {
  const ffmpeg = musicAudioTools().ffmpeg;
  if (!ffmpeg) throw new Error("effect_unavailable");
  const dir = mkdtempSync(join(tmpdir(), "maipai-music-fx-"));
  try {
    const input = join(dir, "in.m4a"), output = join(dir, "out.m4a");
    writeFileSync(input, bytes);
    const command = [ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", input, "-vn", "-filter_complex", effectGraph(spec), "-map", "[out]", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output];
    if (!(await run(command, dir))) throw new Error("effect_failed");
    const made = new Uint8Array(readFileSync(output));
    if (made.length < 12 || Buffer.from(made.subarray(4, 8)).toString() !== "ftyp") throw new Error("effect_failed");
    return made;
  } catch (error) {
    if (error instanceof Error && (error.message === "effect_unavailable" || error.message === "effect_failed")) throw error;
    throw new Error("effect_failed");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
function finishFailed(job: MusicJob, code: string, line: string): void { job.state = "failed"; job.errorCode = code; job.errorLine = line; saveMusicJob(job); }
const cancelled = (actor: PersonRow, job: MusicJob): boolean => getMusicJobFor(actor, job.id)?.state === "cancelled";

export interface EffectJobInput { actor: PersonRow; source: MusicJob; spec: EffectSpec; title?: string; conversationId: string; turnId: string; companionId?: string | null; temporary: boolean }
/**
 * Start an effect as a NEW version of the song (the old one stays). The job row exists while ffmpeg runs, so Activity shows it. It never enters the
 * household queue (no model, no memory). `done` settles when the version is saved or the job failed; the caller need not await it. No title, lyric or word of
 * the song is logged here (rule 6a).
 */
export async function startMusicEffectJob(input: EffectJobInput): Promise<{ job: MusicJob; done: Promise<void> }> {
  const { actor, source, spec } = input;
  if (!source.fileId || musicJobLockState(source, actor) !== "open") throw new StackMusicError(404, "source_not_made_here");
  const file = readMusicFile(actor, source, source.fileId);
  if (!file) throw new StackMusicError(404, "source_not_made_here");
  if (!musicAudioTools().ffmpeg) throw new StackMusicError(503, "effect_unavailable");
  const seconds = source.durationS ?? source.request.seconds;
  if (!checkStorageCap(actor.role, actor.id, Math.ceil(seconds * 32_000)).ok) throw new StackMusicError(403, "storage_full");
  const owned = source.request.ownedFile === true;
  const parent = owned ? null : provenanceFor(source.fileId);
  if (!owned && !parent) throw new StackMusicError(404, "source_not_made_here");
  const prior = jobsForConversation(actor, input.conversationId, input.temporary).reduce((at, j) => Math.max(at, Date.parse(j.chosenAt ?? j.createdAt)), 0);
  const now = new Date(Math.max(Date.now(), prior + 1)).toISOString();
  const { stackBody: _body, from_s: _f, to_s: _t, add_s: _a, at: _at, strength: _s, edit: _e, parts: _p, ...stored } = source.request as MusicRequest & { stackBody?: unknown };
  const { change, amount, preset, bands, from_s, to_s } = spec;
  const request: MusicRequest = { ...stored, seconds, ...(input.title ? { title: input.title } : {}), effect: { change, ...(amount !== undefined ? { amount } : {}), ...(preset ? { preset } : {}), ...(bands ? { bands } : {}), ...(from_s !== undefined ? { from_s } : {}), ...(to_s !== undefined ? { to_s } : {}) } };
  const job: MusicJob = { id: newMusicJobId(), personId: actor.id, conversationId: input.conversationId, turnId: input.turnId, companionId: input.companionId ?? null, task: "effect", request,
    stackJob: null, state: "running", stage: "effect", progress: 0.2, etaSeconds: null, position: null, errorCode: null, errorLine: null, fileId: null, parentFileId: owned ? null : source.fileId,
    coverJobId: null, coverFileId: null, seed: source.seed ?? null, durationS: null, lrc: null, timedWords: null, chosenAt: null, createdAt: now, updatedAt: now, temporary: input.temporary };
  saveMusicJob(job);
  const done = (async () => {
    try {
      const bytes = await applyEffect(file.bytes, spec);
      if (cancelled(actor, job)) return;
      const made = Math.round(m4aSeconds(bytes) ?? seconds);
      const provenance: GenerationProvenance = { kind: "music", job_id: job.id,
        // The pinned spec's task list has no effect value yet (the parts mix and the sound-in-song mix use "trim" the same way): the model stamp inherits the parent's and no model ran.
        task: "trim", ...modelStampFor("effect", null, parent), seed: null, duration_s: made, bpm: parent?.bpm ?? null, key: parent?.key ?? null,
        parent_file_id: source.fileId, source_kind: owned ? "upload" : "made_here", made_at: new Date().toISOString() };
      if (input.temporary) {
        job.fileId = newFileId(); temporarySongs.set(job.fileId, { bytes, jobId: job.id, personId: job.personId, conversationId: job.conversationId!, createdAt: Date.parse(job.createdAt), provenance });
      } else {
        let turn = false;
        for (let i = 0; i < 120; i++) {
          if (db.select({ id: conversationTurns.id }).from(conversationTurns).where(and(eq(conversationTurns.id, job.turnId!), eq(conversationTurns.personId, actor.id))).get()) { turn = true; break; }
          await wait(500);
        }
        if (cancelled(actor, job)) return;
        if (!turn) { finishFailed(job, "lost_turn", EFFECT_FAILED_LINE); return; }
        const saved = createAttachment(actor, { conversationId: job.conversationId!, turnId: job.turnId!, mediaType: "audio/mp4", bytes, provenance: MUSIC_NOTE + JSON.stringify(provenance), deduplicate: false, retention: "conversation" });
        if (!saved.ok) { finishFailed(job, saved.status === 403 ? "storage_full" : "save_failed", saved.status === 403 ? "There is no storage left for a new version. Free some space, then try again." : EFFECT_FAILED_LINE); return; }
        job.fileId = saved.value.id;
      }
      job.request = { ...job.request, seconds: made }; job.durationS = made; job.lrc = source.lrc;
      job.state = "done"; job.stage = "ready"; job.progress = 1; job.etaSeconds = 0; job.errorCode = null; job.errorLine = null;
      saveMusicJob(job);
    } catch (error) {
      const code = error instanceof Error && error.message === "effect_unavailable" ? "effect_unavailable" : "effect_failed";
      if (!cancelled(actor, job)) finishFailed(job, code, code === "effect_unavailable" ? EFFECT_UNAVAILABLE_LINE : EFFECT_FAILED_LINE);
    }
  })();
  return { job, done };
}
