// MUSIC-GEN-03: the model chooses the tool. Policy and source ownership are checked again before admission.
import { tierArgument } from "@/lib/tiers";
import { z } from "zod";
import type { PersonRow } from "@/types";
import type { TurnState, ToolExecutionOutcome } from "@/lib/turnMachine/contract";
import { outcomeOf } from "@/lib/turnContext";
import { MUSIC_STARTED_LINE } from "@/lib/mediaClaims";
import { turnAgeBand } from "@/lib/turnMachine/speaker";
import { musicDenial, MUSIC_DENIAL_LINE, MUSIC_REFUSAL_LINE, refuseMusicPrompt, type MusicAudience } from "./policy";
import { musicEngineStatus, musicStatusReady, musicMaxOffered, musicMaxInstalled, musicQualityFor, musicTierOf, MUSIC_MAX_NOT_INSTALLED_LINE } from "./ready";
import { plainMusicFailure, prepareStemsJob, prepareOwnedStemsJob, readMusicFile, resolveSongSource, startMusicJob } from "./jobs";
import { resolveMusicSection, replaceMusicSection, fitLyricsToLength, secondsForWords, hookOf } from "./sections";
import { StackMusicError, musicBody, type MusicBody } from "./stack";
import type { MusicJob, MusicRequest, MusicTask, SongLength } from "./types";
import { householdSongLength } from "./policy";
import { resolveSound } from "./sound";
import { EFFECT_CHANGES, EQ_PRESETS, EFFECT_UNAVAILABLE_LINE, checkEffect, isEffectChange, startMusicEffectJob } from "./effects";
import { readClonedVoiceClip } from "@/lib/clonedVoices";
import { getHouseholdSettingValue } from "@/lib/settings";
import { companionVoiceKey } from "@/settings/companionVoiceKeys";
import { VOICE_ENGINE_DEFAULT } from "@/settings/voiceKeys";
/** What a refused song's reply starts with; the Make a song page strips it to show the person the plain line. */
export const REFUSED_PREFIX = "No song was made. Say this to the person and keep its meaning: ";
export const GENERATE_MUSIC_TOOL_ID = "generate_music";
export const EDIT_MUSIC_TOOL_ID = "edit_music";
export function musicAudienceOf(state: Pick<TurnState, "actor" | "surface" | "speakerEvidence" | "deviceId" | "planBasis" | "plan">, spoken: boolean): MusicAudience {
  const surfaceClass = state.planBasis?.surfaceClass ?? "spoken";
  return { actor: state.actor, band: turnAgeBand(state.surface, state.actor, state.speakerEvidence, new Date(), state.deviceId), surface: state.surface, surfaceClass, spoken: spoken || surfaceClass !== "written" };
}
const common = {
  description: z.string().trim().min(3).max(1200).optional(), lyrics: z.string().max(4000).optional(),
  bpm: z.number().finite().min(20).max(300).optional(), key: z.string().max(20).regex(/^[A-G][#b]?\s?(major|minor|maj|min|m)?$/i).optional(),
};
export const generateMusicArgs = z.object({ ...common, description: common.description.unwrap(), kind: z.enum(["song", "sound"]).optional(), instrumental: z.boolean().optional(), length: z.enum(["quick", "full"]).optional(), tier: z.enum(["standard", "boost", "max"]).optional(), seconds: z.number().finite().min(1).optional(), loop: z.boolean().optional(), stick_to_words: z.boolean().optional(), language: z.string().max(20).regex(/^([a-z]{2,3}(-[A-Za-z]{2,4})?|unknown)$/).optional(), title: z.string().max(200).optional(),
  /** MUSIC-STUDIO-STYLE: make the song in a saved song style, a made band's sound, or an album (ids the person can read). */
  song_style: z.string().regex(/^sstyle-[a-z0-9]{6,}$/).optional(), band: z.string().regex(/^mband-[a-z0-9]{6,}$/).optional(), album: z.string().regex(/^malbum-[a-z0-9]{6,}$/).optional(),
  /** MP-05: 1 to 3 takes of one request (each its own queue job, shown as one card) and the seed of the first take. */
  takes: z.number().int().min(1).max(3).optional(), seed: z.number().int().min(1).max(2_147_483_646).optional() }).superRefine((value, ctx) => {
    if (value.kind === "sound" && value.description.length > 600) ctx.addIssue({ code: "custom", path: ["description"], message: "A sound description can be at most 600 characters." });
    if (value.kind === "sound" && value.seconds !== undefined && value.seconds > 60) ctx.addIssue({ code: "custom", path: ["seconds"], message: "A sound can be at most 60 seconds." });
    if (value.kind !== "sound" && value.seconds !== undefined && value.seconds < 10) ctx.addIssue({ code: "custom", path: ["seconds"], message: "A song must be at least 10 seconds." });
  });
export const editMusicArgs = z.object({
  ...common, title: z.string().trim().min(1).max(200).optional(), track: z.string().min(1).max(80), change: z.enum(["remake", "restyle", "instrumental", "rewrite_section", "extend", "variation", "trim", "fade", "loudness", "make_full", "make_quick", "stems", "parts", "voice_swap", ...EFFECT_CHANGES]),
  parts: z.object({ keep: z.array(z.string()).min(1).optional(), drop: z.array(z.string()).min(1).optional() }).optional(),
  section: z.string().max(80).optional(), from_s: z.number().finite().min(0).optional(), to_s: z.number().finite().positive().optional(),
  seconds: z.number().finite().positive().optional(), at: z.enum(["start", "end"]).optional(), where: z.enum(["in", "out", "both"]).optional(),
  strength: z.number().finite().min(0.3).max(1).optional(), lufs: z.number().finite().min(-70).max(-5).optional(),
  voice: z.string().min(1).max(80).optional(),
  /** MP-02 file effects: gain dB, speed times, pitch semitones. */ amount: z.number().finite().min(-24).max(24).optional(),
  preset: z.enum(EQ_PRESETS).optional(), bands: z.array(z.number().finite().min(-12).max(12)).length(6).optional(),
  /** MP-04 `compress`: any field left out takes the Studio panel's default; bounds are checked by checkEffect. */ compressor: z.object({ threshold_db: z.number().finite().optional(), ratio: z.number().finite().optional(), attack_ms: z.number().finite().optional(), release_ms: z.number().finite().optional(), makeup_db: z.number().finite().optional() }).optional(),
}).superRefine((value, ctx) => { if (value.change === "voice_swap" && !value.voice) ctx.addIssue({ code: "custom", path: ["voice"], message: "Choose a voice." }); });
/** Shared attached-file edit preparation used by the tool and Music Create. */
export function prepareOwnedMusicEdit(source: MusicJob, args: { change: "restyle" | "instrumental" | "parts" | "stems" | "voice_swap"; style?: string; parts?: { keep?: string[]; drop?: string[] } }, limits: { min_seconds: number; max_seconds: number }) {
  if (args.change === "stems") return { ok: true as const, task: "stems" as const, request: source.request, body: musicBody(source.request, "edit") };
  const plan = prepareMusicEdit(source, { track: source.fileId!, change: args.change, ...(args.style ? { description: args.style } : {}), ...(args.parts ? { parts: args.parts } : {}) }, limits);
  return plan;
}
/** Start the owned-file parts job used by both edit_music and the Library edit route. */
export async function startOwnedMusicPartsJob(input: { actor: PersonRow; source: MusicJob; parts: z.infer<typeof editMusicArgs>["parts"]; title?: string; conversationId: string; turnId: string; companionId?: string | null; temporary: boolean }) {
  const kept = keptMusicParts(input.parts);
  if (!kept) return { ok: false as const, line: "Choose one or more parts to keep or drop, and leave at least one part." };
  if (!input.source.fileId) return { ok: false as const, line: plainMusicFailure("source_not_made_here") };
  const prepared = await prepareOwnedStemsJob(input.actor, input.source.fileId);
  if (!prepared.ok) return { ok: false as const, line: prepared.line, status: prepared.status };
  const file = readMusicFile(input.actor, input.source, input.source.fileId);
  if (!file) return { ok: false as const, line: plainMusicFailure("source_not_made_here") };
  const request = { ...prepared.request, title: input.title ?? input.source.request.title ?? "Song", parts: kept };
  const body = { ...prepared.body, source: Buffer.from(file.bytes).toString("base64"), source_sha256: file.sha256 };
  const job = await startMusicJob({ actor: input.actor, conversationId: input.conversationId, turnId: input.turnId, companionId: input.companionId ?? null, temporary: input.temporary, task: "trim", request, body, parentFileId: input.source.fileId });
  return { ok: true as const, job, parts: kept };
}
export function musicRefusalFor(audience: MusicAudience, args: Record<string, unknown>) {
  const denied = musicDenial(audience);
  if (denied) return { kind: "denied" as const, why: denied, line: MUSIC_DENIAL_LINE[denied] };
  const text = [args.description, args.lyrics, args.title, args.key, args.language].filter((s) => typeof s === "string").join(" ");
  const refusal = refuseMusicPrompt(text);
  return refusal ? { kind: "prompt" as const, why: refusal, line: MUSIC_REFUSAL_LINE[refusal] } : null;
}
export type MusicToolInput = {
  state: Pick<TurnState, "actor" | "persona" | "surface" | "speakerEvidence" | "deviceId" | "planBasis" | "plan" | "conversationId" | "turnId" | "temporary" | "ephemeral" | "audio">;
  args: Record<string, unknown>; callId: string; spoken: boolean;
  /** MUSIC-LIKE-01: set by make_band only (never by a model argument): the song is this band's first single. */
  band?: { id: string; name: string };
  /** MUSIC-STUDIO-ALBUM: set by make_album only: the song is this album's first track. */
  album?: { id: string };
};
const newSeed = (prior?: number | null): number => { const seed = Math.floor(Math.random() * 2_147_483_646) + 1; return seed === prior ? seed + 1 : seed; };
/** The Stack's own default (detailed on a big computer, quick on a small one); quick when it names none. A default of Max is read as Boost: Max is only ever chosen, never a default (a person's grant decides it). */
export function defaultQualityOf(engine: { default_quality?: string }): "quick" | "detailed" { return engine.default_quality === "detailed" || engine.default_quality === "max" ? "detailed" : "quick"; }
/** Instrumentals retain their usual lengths; songs with words follow those words. */
export const QUICK_SONG = { min: 10, default: 45, max: 60 } as const;
export const FULL_SONG = { min: 150, default: 180, max: 240 } as const;
export function songSecondsFor(length: SongLength, asked: number | undefined, lyrics: string | undefined, maxSeconds: number): number {
  if (lyrics) return Math.min(maxSeconds, Math.max(10, asked ?? secondsForWords(lyrics)));
  if (length === "full") return Math.min(maxSeconds, FULL_SONG.max, Math.max(FULL_SONG.min, Math.round(asked ?? FULL_SONG.default)));
  return Math.min(maxSeconds, asked !== undefined ? FULL_SONG.min - 1 : QUICK_SONG.max, Math.max(QUICK_SONG.min, Math.round(asked ?? QUICK_SONG.default)));
}
/** Select the words first, then fit only when a requested length or the computer's ceiling requires it. */
export function sizeSong(request: MusicRequest, whole: string | undefined, limits: { min_seconds: number; max_seconds: number }, asked?: number): void {
  delete request.cut; delete request.retried; delete request.written_lyrics;
  request.max_seconds = limits.max_seconds;
  const words = !request.instrumental && whole ? (request.length === "quick" ? hookOf(whole) : whole) : undefined;
  request.seconds = Math.max(limits.min_seconds, songSecondsFor(request.length ?? "full", asked, words, limits.max_seconds));
  if (words !== undefined) {
    request.lyrics = words;
    if (secondsForWords(words) > request.seconds) {
      request.lyrics = fitLyricsToLength(words, request.seconds).lyrics;
      request.cut = asked !== undefined ? "asked" : "ceiling";
    }
    if (request.lyrics !== whole) request.written_lyrics = whole;
  }
}
/** The length a remake of this song has, from what it was asked as, else from its length. */
export function lengthOf(request: MusicRequest, durationS: number | null): SongLength {
  return request.length ?? ((durationS ?? request.seconds) >= FULL_SONG.min ? "full" : "quick");
}
/** A length as a person says it: seconds under a minute and a half, else whole or half minutes ("2 and a half minutes"). */
export function spokenLength(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} seconds`;
  const halves = Math.round(seconds / 30); const whole = Math.floor(halves / 2);
  return halves % 2 ? `${whole} and a half minutes` : `${whole} minutes`;
}
/** What the model is told when the Stack has accepted a song job. It says the song STARTED (never "ready"): the person has not heard it
 * yet, and a reply that claims it is done is held and replaced by MUSIC_STARTED_LINE (lib/mediaClaims.ts). */
export function songOnItsWay(request: MusicRequest): string {
  const length = lengthOf(request, null);
  const duration = spokenLength(request.seconds);
  const kind = `a ${length} song of about ${duration}${length === "quick" && !request.instrumental ? ": the hook, the first verse and chorus" : ""}`;
  const wait = request.seconds >= 150 ? "about a minute or two" : "under a minute";
  const note = request.cut === "asked" ? " The words are longer than the length asked for, so it sings the first parts that fit."
    : request.cut === "ceiling" ? ` The words are longer than the longest song this computer makes (${spokenLength(request.max_seconds ?? request.seconds)}), so it sings the first parts that fit.` : "";
  const title = request.title ? ` called "${request.title}"` : "";
  return `${MUSIC_STARTED_LINE} It is ${kind}${title}, and it takes ${wait}. Reply in one or two short sentences: say you have started it and about how long it takes. Never say it is ready, done or finished (the person has not heard it yet), do not describe it, and do not repeat the lyrics, style or tempo.${note}`;
}
export const SECTION_LINE = "Which part should I change? Give its start and end in seconds.";
export const WHICH_PART_LINE = "Tell me which part the new words replace, for example the chorus or verse 2.";
/** New words can stand in for the song's words only when they are a whole song: section tags and at least half the stored length. */
function isWholeSong(lyrics: string, stored: string | undefined): boolean {
  return /\[(?:verse|chorus|bridge|intro|outro|pre-chorus|hook|refrain|instrumental)[^\]]*\]/i.test(lyrics) && lyrics.length >= (stored?.length ?? 0) / 2;
}
type EditPlan = { ok: true; task: MusicTask; request: MusicRequest; body: Omit<MusicBody, "timeout_ms"> } | { ok: false; line: string };
export const MUSIC_PARTS = ["vocals", "drums", "bass", "other"] as const;
export function keptMusicParts(parts: z.infer<typeof editMusicArgs>["parts"]): { keep: Array<typeof MUSIC_PARTS[number]>; drop: Array<typeof MUSIC_PARTS[number]> } | null {
  if (!parts || (!!parts.keep === !!parts.drop)) return null;
  const chosen = parts.keep ?? parts.drop!;
  if (chosen.some((part) => !(MUSIC_PARTS as readonly string[]).includes(part))) return null;
  const selected = new Set(chosen);
  const keep = parts.keep ? MUSIC_PARTS.filter((part) => selected.has(part)) : MUSIC_PARTS.filter((part) => !selected.has(part));
  const drop = MUSIC_PARTS.filter((part) => !keep.includes(part));
  return keep.length ? { keep: [...keep], drop: [...drop] } : null;
}
export function partsDoneLine(parts: { keep: readonly string[]; drop: readonly string[] }): string {
  if (parts.keep.length === 1) return `Here it is with just the ${parts.keep[0]}.`;
  if (parts.drop.length === 1) return `Here it is without the ${parts.drop[0]}.`;
  return `Here it is with the ${parts.keep.join(" and ")} kept.`;
}
export function prepareMusicEdit(source: MusicJob, args: z.infer<typeof editMusicArgs>, limits = { min_seconds: 10, max_seconds: source.request.max_seconds ?? FULL_SONG.max }): EditPlan {
  // A stem of a file the person owns is never an edit, cover or remake source (stem-splitting 10.2 point 3; a stem lives only as a split result).
  if (source.request.ownedFile && source.task === "stems") return { ok: false, line: "That file is yours, not a song made here, so it can only be split into stems." };
  // Owned uploads are admitted by resolveSongSource after its ownership and generated-file checks.
  if (source.request.ownedFile && ["remake", "variation", "make_full", "make_quick", "stems"].includes(args.change)) {
    return { ok: false, line: "That change needs a song made here. Try restyle, instrumental, trim, fade or loudness on this file." };
  }
  const { from_s: _from, to_s: _to, add_s: _add, at: _at, strength: _strength, edit: _edit, takes: _takes, ...stored } = source.request;
  const request: MusicRequest = { ...stored, seconds: source.durationS ?? stored.seconds, seed: source.seed ?? stored.seed,
    ...(args.description !== undefined ? { description: args.description } : {}), ...(args.lyrics !== undefined ? { lyrics: args.lyrics } : {}),
    ...(args.title !== undefined ? { title: args.title } : {}),
    ...(args.bpm !== undefined ? { bpm: args.bpm } : {}), ...(args.key !== undefined ? { key: args.key } : {}) };
  delete request.retried;
  let task: MusicTask; let stackTask: MusicBody["task"];
  switch (args.change) {
    case "voice_swap": task = "stems"; stackTask = "edit"; break;
    case "stems": task = "stems"; stackTask = "edit"; break;
    case "remake": task = "remake"; stackTask = "text2music"; if (args.seconds !== undefined) request.seconds = args.seconds; break;
    case "make_full": case "make_quick": {
      // The same song made again at the other length: same words, description and seed.
      task = "remake"; stackTask = "text2music";
      const length: SongLength = args.change === "make_full" ? "full" : "quick";
      const words = request.written_lyrics ?? request.lyrics;
      request.length = length; sizeSong(request, words, limits);
      break;
    }
    case "variation": task = "variation"; stackTask = "text2music"; request.seed = newSeed(source.seed); if (args.seconds !== undefined) request.seconds = args.seconds; break;
    case "restyle": task = "cover"; stackTask = "cover"; request.strength = args.strength ?? 0.6; break;
    case "instrumental": task = "cover"; stackTask = "cover"; request.instrumental = true; request.lyrics = "[Instrumental]"; request.strength = args.strength ?? 0.6; break;
    case "rewrite_section": {
      task = "repaint"; stackTask = "repaint";
      const range = args.section ? resolveMusicSection(source.request.lyrics, source.lrc, args.section, request.seconds) : null;
      if (range) {
        Object.assign(request, range);
        // MUSIC-GEN-06: the chat model often sends the whole revised song, tags and all. Splicing that into one section
        // duplicated the verse inside the chorus; a whole song replaces the words, a bare fragment replaces the one section.
        if (args.lyrics !== undefined) request.lyrics = isWholeSong(args.lyrics, source.request.lyrics) ? args.lyrics : replaceMusicSection(source.request.lyrics!, args.section!, args.lyrics);
      }
      else if (args.from_s !== undefined && args.to_s !== undefined) {
        request.from_s = args.from_s; request.to_s = args.to_s;
        // The words must stay the whole song's words: a fragment never replaces them.
        if (args.lyrics !== undefined) { if (isWholeSong(args.lyrics, source.request.lyrics)) request.lyrics = args.lyrics; else { request.lyrics = source.request.lyrics; return { ok: false, line: WHICH_PART_LINE }; } }
      }
      else return { ok: false, line: SECTION_LINE };
      break;
    }
    case "extend":
      if (args.seconds === undefined) return { ok: false, line: "How many seconds should I add to the song?" };
      task = "extend"; stackTask = "extend"; request.add_s = args.seconds; request.at = args.at ?? "end"; request.seconds += args.seconds; break;
    case "trim":
      if (args.from_s === undefined || args.to_s === undefined) return { ok: false, line: "Give the start and end in seconds to keep." };
      task = "trim"; stackTask = "edit"; request.edit = { op: "trim", from_s: args.from_s, to_s: args.to_s }; request.seconds = args.to_s - args.from_s; break;
    case "fade":
      task = "fade"; stackTask = "edit"; request.edit = { op: "fade", seconds: args.seconds ?? 3, where: args.where ?? "out" }; break;
    case "loudness": task = "loudness"; stackTask = "edit"; request.edit = { op: "loudness", lufs: args.lufs ?? -14 }; break;
    case "parts": {
      const parts = keptMusicParts(args.parts);
      if (!parts) return { ok: false, line: "Choose one or more parts to keep or drop, and leave at least one part." };
      task = "trim"; stackTask = "edit"; request.parts = parts;
      break;
    }
    // MP-02 file effects run on the saved file in Home (effects.ts), never as a Stack job.
    default: return { ok: false, line: "That change is made on the saved file, not as a new song." };
  }
  // New words (or none, for an instrumental) replace the person's kept words: Make it full must sing what this version sings.
  if (args.change !== "make_full" && args.change !== "make_quick" && (args.lyrics !== undefined || request.instrumental)) { delete request.written_lyrics; delete request.cut; }
  const duration = source.durationS ?? source.request.seconds;
  const from = request.edit?.op === "trim" ? request.edit.from_s : request.from_s;
  const to = request.edit?.op === "trim" ? request.edit.to_s : request.to_s;
  if ((from !== undefined || to !== undefined) && (from === undefined || to === undefined || to <= from || to > duration)) return { ok: false, line: "That part is outside the song. Give a start and end within its length in seconds." };
  if (request.edit?.op === "fade" && request.edit.seconds! > duration) return { ok: false, line: "That fade is longer than the song. Give a shorter fade in seconds." };
  return { ok: true, task, request, body: musicBody(request, stackTask) };
}
/** The song's own arguments win; a sound fills what they leave out. The style words come first, so the song's own description refines them. */
export function applySound<T extends z.infer<typeof generateMusicArgs>>(value: T, style: import("./sound").SoundStyle | null): T {
  if (!style) return value;
  const description = `${style.description}${value.description ? `. ${value.description}` : ""}`.slice(0, 1200);
  return { ...value, description,
    instrumental: value.instrumental ?? (style.instrumental || undefined),
    bpm: value.bpm ?? style.bpm ?? undefined, key: value.key ?? style.key ?? undefined,
    language: value.language ?? style.language ?? undefined,
    seconds: value.seconds ?? (value.length === undefined && style.length_s ? style.length_s : undefined) };
}
async function runMusic(input: MusicToolInput, editing: boolean): Promise<ToolExecutionOutcome> {
  const { state, args, callId } = input; const packageId = editing ? EDIT_MUSIC_TOOL_ID : GENERATE_MUSIC_TOOL_ID;
  const failed = (code: string, kind: "bad_arguments" | "unavailable" | "errored") => outcomeOf({ callId, packageId, status: "failed", via: "tool_call", args, errorCode: code, failureKind: kind, durationMs: 0 });
  const refused = (line: string, why: string) => outcomeOf({ callId, packageId, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: `${REFUSED_PREFIX}${line}` }, data: { refused: why }, actions: [] } });
  const musicAudience = musicAudienceOf(state, input.spoken);
  const refusal = musicRefusalFor(musicAudience, args);
  if (refusal) return refused(refusal.line, refusal.why);
  const temporary = state.temporary === true || state.ephemeral === true;
  const actor = state.actor as PersonRow;
  let engine: Awaited<ReturnType<typeof musicEngineStatus>> = null;
  let request: MusicRequest; let task: MusicTask; let body: Omit<MusicBody, "timeout_ms">; let parentFileId: string | null = null;
  if (editing) {
    const parsed = editMusicArgs.safeParse(args); if (!parsed.success) return failed("bad_arguments", "bad_arguments");
    if (parsed.data.change === "parts") {
      const source = resolveSongSource(actor, parsed.data.track === "attached" ? state.audio?.[0]?.id ?? "" : parsed.data.track, state.conversationId, temporary);
      if (!source?.fileId) return refused(plainMusicFailure("source_not_made_here"), "source_not_made_here");
      const result = await startOwnedMusicPartsJob({ actor, source, parts: parsed.data.parts, title: parsed.data.title, conversationId: state.conversationId, turnId: state.turnId, companionId: state.persona?.id ?? null, temporary });
      if (!result.ok) return "status" in result && result.status === 503 ? failed("stems_unavailable", "unavailable") : refused(result.line, "source_not_made_here");
      return outcomeOf({ callId, packageId, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: partsDoneLine(result.parts) }, data: { musicJobId: result.job.id }, actions: [] } });
    }
    if (isEffectChange(parsed.data.change)) {
      // MP-02: a file effect runs in Home (ffmpeg), makes a new version, and needs no music model.
      const source = resolveSongSource(actor, parsed.data.track === "attached" ? state.audio?.[0]?.id ?? "" : parsed.data.track, state.conversationId, temporary);
      if (!source?.fileId || (source.request.ownedFile && source.task === "stems")) return refused(plainMusicFailure("source_not_made_here"), "source_not_made_here");
      const checked = checkEffect(parsed.data, source.durationS ?? source.request.seconds);
      if (!checked.ok) return refused(checked.line, "section_or_range");
      try {
        const { job } = await startMusicEffectJob({ actor, source, spec: checked.spec, title: parsed.data.title, conversationId: state.conversationId, turnId: state.turnId, companionId: state.persona?.id ?? null, temporary });
        return outcomeOf({ callId, packageId, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: "The change is on the way and takes a few seconds. Reply in one short sentence; do not say it is done." }, data: { musicJobId: job.id }, actions: [] } });
      } catch (error) {
        const code = error instanceof StackMusicError ? error.code : "failed";
        if (code === "effect_unavailable") return refused(EFFECT_UNAVAILABLE_LINE, code);
        if (code === "source_not_made_here" || code === "storage_full") return refused(plainMusicFailure(code), code);
        return failed(code, "errored");
      }
    }
    if (parsed.data.track === "attached" && (state.audio?.length ?? 0) !== 1) return refused("Attach one audio file to your message.", "source_not_made_here");
    if (parsed.data.track === "attached" && parsed.data.change === "stems") {
      const prepared = await prepareOwnedStemsJob(actor, state.audio![0]!.id);
      if (!prepared.ok) return refused(prepared.line, "source_not_made_here");
      const job = await startMusicJob({ actor, conversationId: state.conversationId, turnId: state.turnId, companionId: state.persona?.id ?? null, temporary, task: "stems", request: prepared.request, body: prepared.body, parentFileId: null });
      return outcomeOf({ callId, packageId, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: "The stems are on the way." }, data: { musicJobId: job.id }, actions: [] } });
    }
    const source = resolveSongSource(actor, parsed.data.track === "attached" ? state.audio![0]!.id : parsed.data.track, state.conversationId, temporary);
    if (!source?.fileId) return refused(plainMusicFailure("source_not_made_here"), "source_not_made_here");
    if (parsed.data.change === "voice_swap") {
      const requestedVoice = parsed.data.voice!;
      let voiceId = requestedVoice;
      if (requestedVoice === "companion") {
        const companionVoice = state.persona?.id ? getHouseholdSettingValue(companionVoiceKey(state.persona.id)) : null;
        voiceId = String(companionVoice && companionVoice !== VOICE_ENGINE_DEFAULT ? companionVoice : getHouseholdSettingValue("tts.home_voice") ?? VOICE_ENGINE_DEFAULT);
      }
      const clip = readClonedVoiceClip(voiceId);
      if (!clip) return refused("That voice has no sample to sing with.", "voice_sample_missing");
      const prepared = source.request.ownedFile
        ? await prepareOwnedStemsJob(actor, source.fileId)
        : await prepareStemsJob(actor, source);
      if (!prepared.ok) return prepared.status === 503 ? failed("stems_unavailable", "unavailable") : refused(prepared.line, "source_not_made_here");
      const request = { ...prepared.request, title: parsed.data.title ?? source.request.title ?? "Song", ownedFile: source.request.ownedFile === true, voiceSwap: { voiceId } };
      const job = await startMusicJob({ actor, conversationId: state.conversationId, turnId: state.turnId, companionId: state.persona?.id ?? null, temporary, task: "stems", request, body: prepared.body, parentFileId: source.request.ownedFile ? null : source.fileId });
      return outcomeOf({ callId, packageId, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: `Here it is sung by ${clip.label}.` }, data: { musicJobId: job.id }, actions: [] } });
    }
    if (parsed.data.change === "stems") {
      if (source.request.ownedFile) return refused("Choose Stems from the file in your Library.", "source_not_made_here");
      const prepared = await prepareStemsJob(actor, source);
      if (!prepared.ok) return failed(prepared.status === 503 ? "stems_unavailable" : "source_not_made_here", prepared.status === 503 ? "unavailable" : "bad_arguments");
      ({ request, task, body } = prepared); parentFileId = source.fileId;
      const job = await startMusicJob({ actor, conversationId: state.conversationId, turnId: state.turnId, companionId: state.persona?.id ?? null, temporary, task, request, body, parentFileId });
      return outcomeOf({ callId, packageId, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: "The stems are on the way." }, data: { musicJobId: job.id }, actions: [] } });
    }
    engine = await musicEngineStatus();
    if (!musicStatusReady(engine)) return failed("no_engine", "unavailable");
    const plan = prepareMusicEdit(source, parsed.data, engine!.limits);
    if (!plan.ok) return refused(plan.line, "section_or_range");
    ({ request, task, body } = plan); parentFileId = source.request.ownedFile ? null : source.fileId;
    // Only a task that edits the audio itself sends it; a remake or variation is a fresh text2music job and reads and hashes nothing.
    if (body.task !== "text2music") {
      const file = readMusicFile(actor, source, source.fileId);
      if (!file) return refused(plainMusicFailure("source_not_made_here"), "source_not_made_here");
      body.source = Buffer.from(file.bytes).toString("base64"); body.source_sha256 = file.sha256;
      if (source.request.ownedFile) body.origin = "owned_file";
    }
  } else {
    engine = await musicEngineStatus();
    if (!musicStatusReady(engine)) return failed("no_engine", "unavailable");
    const parsed = generateMusicArgs.safeParse(args); if (!parsed.success) return failed("bad_arguments", "bad_arguments");
    const sound = resolveSound(actor, { song_style: parsed.data.song_style, band: parsed.data.band ?? input.band?.id, album: parsed.data.album ?? input.album?.id });
    if (!sound.ok) return refused(sound.line, "sound_not_available");
    const value = applySound(parsed.data, sound.value.style);
    const lyrics = value.instrumental ? "[Instrumental]" : value.lyrics;
    const length: SongLength = value.length ?? (value.seconds !== undefined && value.seconds >= 150 ? "full" : householdSongLength());
    request = { description: value.description, lyrics, title: value.title,
      instrumental: value.instrumental ?? false, seconds: songSecondsFor(length, value.seconds, value.instrumental ? undefined : value.lyrics, engine!.limits.max_seconds),
      bpm: value.bpm, key: value.key, language: value.language, quality: defaultQualityOf(engine!), seed: value.seed ?? newSeed(), length };
    if ((value.takes ?? 1) > 1) request.takes = { group: `tks-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`, index: 0, total: value.takes! };
    const band = input.band ?? sound.value.band;
    if (band) request.band = band;
    if (sound.value.album) request.album = sound.value.album;
    sizeSong(request, value.lyrics, engine!.limits, value.seconds);
    task = "text2music"; body = musicBody(request, "text2music");
  }
  // A request stored before the Stack named a default (or an edit of an older song) takes the Stack's default now.
  request.max_seconds = engine!.limits.max_seconds;
  // TIER-HOME-03: the typed tier argument of a new song. Boost is the engine's Detailed maker when it has one; a lowered request says why in one line.
  // MUSIC-MAX-01: Max is the engine's XL SFT maker, granted exactly as Boost is (authorizeTier inside tierArgument); asked while the models are not installed it runs, and says it ran, as Boost.
  const tierAsked = editing ? null : tierArgument({ person: actor, category: "music", arg: args.tier, band: musicAudienceOf(state, input.spoken).band, maxAvailable: musicMaxOffered(engine) });
  if (tierAsked?.tier) request.quality = musicQualityFor(engine, tierAsked.tier);
  request.quality ??= defaultQualityOf(engine!); body.quality = request.quality;
  request.tier = musicTierOf(request.quality);
  const maxNotInstalled = tierAsked?.tier === "max" && musicMaxOffered(engine) && !musicMaxInstalled(engine);
  const tierLine = [tierAsked?.line, maxNotInstalled ? MUSIC_MAX_NOT_INSTALLED_LINE : null].filter(Boolean).join(" ");
  // Check the effective request, including inherited words and a section replacement, before any job exists.
  const inherited = refuseMusicPrompt([request.description, request.lyrics, request.written_lyrics, request.title, request.key, request.language].join(" "));
  if (inherited) return refused(MUSIC_REFUSAL_LINE[inherited], inherited);
  if ((request.lyrics?.length ?? 0) > 4000 || (request.written_lyrics?.length ?? 0) > 4000) return failed("bad_arguments", "bad_arguments");
  if (request.seconds > engine!.limits.max_seconds || (body.task === "text2music" && request.seconds < Math.max(10, engine!.limits.min_seconds))) return failed("too_long_or_short", "bad_arguments");
  try {
    const job = await startMusicJob({ actor, conversationId: state.conversationId, turnId: state.turnId, companionId: state.persona?.id ?? null, temporary, task, request, body, parentFileId });
    return outcomeOf({ callId, packageId, status: "succeeded", via: "tool_call", args, durationMs: 0, result: {
      reply: { text: `${songOnItsWay(request)}${request.takes ? ` ${request.takes.total} takes are being made one after another and show as one song card, with a way to switch between them.` : ""}${tierLine ? ` ${tierLine}` : ""}` },
      data: { musicJobId: job.id }, actions: [],
    } });
  } catch (error) {
    const code = error instanceof StackMusicError ? error.code : "failed";
    if (code === "already_making") return refused(plainMusicFailure(code), code);
    // Rule 6: no raw Stack text, arguments or user words enter failure details for the model.
    return failed(code, error instanceof StackMusicError && error.status < 500 ? "bad_arguments" : "unavailable");
  }
}
export const runGenerateMusic = (input: MusicToolInput): Promise<ToolExecutionOutcome> => runMusic(input, false);
export const runEditMusic = (input: MusicToolInput): Promise<ToolExecutionOutcome> => runMusic(input, true);
