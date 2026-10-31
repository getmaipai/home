// MUSIC-GEN-03: the model chooses the tool. Policy and source ownership are checked again before admission.
import { tierArgument } from "@/lib/tiers";
import { z } from "zod";
import type { PersonRow } from "@/types";
import type { TurnState, ToolExecutionOutcome } from "@/lib/turnMachine/contract";
import { outcomeOf } from "@/lib/turnContext";
import { MUSIC_STARTED_LINE } from "@/lib/mediaClaims";
import { turnAgeBand } from "@/lib/turnMachine/speaker";
import { musicDenial, MUSIC_DENIAL_LINE, MUSIC_REFUSAL_LINE, refuseMusicPrompt, type MusicAudience } from "./policy";
import { musicEngineStatus, musicStatusReady } from "./ready";
import { plainMusicFailure, prepareStemsJob, readMusicFile, sourceMusicJob, startMusicJob } from "./jobs";
import { resolveMusicSection, replaceMusicSection, fitLyricsToLength, secondsForWords, hookOf } from "./sections";
import { StackMusicError, musicBody, type MusicBody } from "./stack";
import type { MusicJob, MusicRequest, MusicTask, SongLength } from "./types";
import { householdSongLength } from "./policy";
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
export const generateMusicArgs = z.object({ ...common, description: common.description.unwrap(), instrumental: z.boolean().optional(), length: z.enum(["quick", "full"]).optional(), tier: z.enum(["standard", "boost", "max"]).optional(), seconds: z.number().finite().min(10).optional(), language: z.string().max(20).regex(/^([a-z]{2,3}(-[A-Za-z]{2,4})?|unknown)$/).optional(), title: z.string().max(200).optional() });
export const editMusicArgs = z.object({
  ...common, track: z.string().min(1).max(80), change: z.enum(["remake", "restyle", "instrumental", "rewrite_section", "extend", "variation", "trim", "fade", "loudness", "make_full", "make_quick", "stems"]),
  section: z.string().max(80).optional(), from_s: z.number().finite().min(0).optional(), to_s: z.number().finite().positive().optional(),
  seconds: z.number().finite().positive().optional(), at: z.enum(["start", "end"]).optional(), where: z.enum(["in", "out", "both"]).optional(),
  strength: z.number().finite().min(0.3).max(1).optional(), lufs: z.number().finite().min(-70).max(-5).optional(),
});
export function musicRefusalFor(audience: MusicAudience, args: Record<string, unknown>) {
  const denied = musicDenial(audience);
  if (denied) return { kind: "denied" as const, why: denied, line: MUSIC_DENIAL_LINE[denied] };
  const text = [args.description, args.lyrics, args.title, args.key, args.language].filter((s) => typeof s === "string").join(" ");
  const refusal = refuseMusicPrompt(text);
  return refusal ? { kind: "prompt" as const, why: refusal, line: MUSIC_REFUSAL_LINE[refusal] } : null;
}
export type MusicToolInput = {
  state: Pick<TurnState, "actor" | "persona" | "surface" | "speakerEvidence" | "deviceId" | "planBasis" | "plan" | "conversationId" | "turnId" | "temporary" | "ephemeral">;
  args: Record<string, unknown>; callId: string; spoken: boolean;
};
const newSeed = (prior?: number | null): number => { const seed = Math.floor(Math.random() * 2_147_483_646) + 1; return seed === prior ? seed + 1 : seed; };
/** The Stack's own default (detailed on a big computer, quick on a small one); quick when it names none. */
export function defaultQualityOf(engine: { default_quality?: string }): "quick" | "detailed" { return engine.default_quality === "detailed" ? "detailed" : "quick"; }
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
export function prepareMusicEdit(source: MusicJob, args: z.infer<typeof editMusicArgs>, limits = { min_seconds: 10, max_seconds: source.request.max_seconds ?? FULL_SONG.max }): EditPlan {
  const { from_s: _from, to_s: _to, add_s: _add, at: _at, strength: _strength, edit: _edit, ...stored } = source.request;
  const request: MusicRequest = { ...stored, seconds: source.durationS ?? stored.seconds, seed: source.seed ?? stored.seed,
    ...(args.description !== undefined ? { description: args.description } : {}), ...(args.lyrics !== undefined ? { lyrics: args.lyrics } : {}),
    ...(args.bpm !== undefined ? { bpm: args.bpm } : {}), ...(args.key !== undefined ? { key: args.key } : {}) };
  delete request.retried;
  let task: MusicTask; let stackTask: MusicBody["task"];
  switch (args.change) {
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
async function runMusic(input: MusicToolInput, editing: boolean): Promise<ToolExecutionOutcome> {
  const { state, args, callId } = input; const packageId = editing ? EDIT_MUSIC_TOOL_ID : GENERATE_MUSIC_TOOL_ID;
  const failed = (code: string, kind: "bad_arguments" | "unavailable" | "errored") => outcomeOf({ callId, packageId, status: "failed", via: "tool_call", args, errorCode: code, failureKind: kind, durationMs: 0 });
  const refused = (line: string, why: string) => outcomeOf({ callId, packageId, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: `No song was made. Say this to the person and keep its meaning: ${line}` }, data: { refused: why }, actions: [] } });
  const refusal = musicRefusalFor(musicAudienceOf(state, input.spoken), args);
  if (refusal) return refused(refusal.line, refusal.why);
  const temporary = state.temporary === true || state.ephemeral === true;
  const actor = state.actor as PersonRow;
  let engine: Awaited<ReturnType<typeof musicEngineStatus>> = null;
  let request: MusicRequest; let task: MusicTask; let body: Omit<MusicBody, "timeout_ms">; let parentFileId: string | null = null;
  if (editing) {
    const parsed = editMusicArgs.safeParse(args); if (!parsed.success) return failed("bad_arguments", "bad_arguments");
    // sourceMusicJob already proved the song is this person's, made here, in this chat: no bytes are read for it.
    const source = sourceMusicJob(actor, state.conversationId, parsed.data.track, temporary);
    if (!source?.fileId) return refused(plainMusicFailure("source_not_made_here"), "source_not_made_here");
    if (parsed.data.change === "stems") {
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
    ({ request, task, body } = plan); parentFileId = source.fileId;
    // Only a task that edits the audio itself sends it; a remake or variation is a fresh text2music job and reads and hashes nothing.
    if (body.task !== "text2music") {
      const file = readMusicFile(actor, source, source.fileId);
      if (!file) return refused(plainMusicFailure("source_not_made_here"), "source_not_made_here");
      body.source = Buffer.from(file.bytes).toString("base64"); body.source_sha256 = file.sha256;
    }
  } else {
    engine = await musicEngineStatus();
    if (!musicStatusReady(engine)) return failed("no_engine", "unavailable");
    const parsed = generateMusicArgs.safeParse(args); if (!parsed.success) return failed("bad_arguments", "bad_arguments");
    const value = parsed.data;
    const lyrics = value.instrumental ? "[Instrumental]" : value.lyrics;
    const length: SongLength = value.length ?? (value.seconds !== undefined && value.seconds >= 150 ? "full" : householdSongLength());
    request = { description: value.description, lyrics, title: value.title,
      instrumental: value.instrumental ?? false, seconds: songSecondsFor(length, value.seconds, value.instrumental ? undefined : value.lyrics, engine!.limits.max_seconds),
      bpm: value.bpm, key: value.key, language: value.language, quality: defaultQualityOf(engine!), seed: newSeed(), length };
    sizeSong(request, value.lyrics, engine!.limits, value.seconds);
    task = "text2music"; body = musicBody(request, "text2music");
  }
  // A request stored before the Stack named a default (or an edit of an older song) takes the Stack's default now.
  request.max_seconds = engine!.limits.max_seconds;
  // TIER-HOME-03: the typed tier argument of a new song. Boost is the engine's Detailed maker when it has one; a lowered request says why in one line.
  const tierAsked = editing ? null : tierArgument({ person: actor, category: "music", arg: args.tier, band: musicAudienceOf(state, input.spoken).band });
  if (tierAsked?.quality && (tierAsked.quality === "quick" || engine!.quality.includes("detailed"))) request.quality = tierAsked.quality;
  request.quality ??= defaultQualityOf(engine!); body.quality = request.quality;
  request.tier = request.quality === "detailed" ? "boost" : "standard";
  // Check the effective request, including inherited words and a section replacement, before any job exists.
  const inherited = refuseMusicPrompt([request.description, request.lyrics, request.written_lyrics, request.title, request.key, request.language].join(" "));
  if (inherited) return refused(MUSIC_REFUSAL_LINE[inherited], inherited);
  if ((request.lyrics?.length ?? 0) > 4000 || (request.written_lyrics?.length ?? 0) > 4000) return failed("bad_arguments", "bad_arguments");
  if (request.seconds > engine!.limits.max_seconds || (body.task === "text2music" && request.seconds < Math.max(10, engine!.limits.min_seconds))) return failed("too_long_or_short", "bad_arguments");
  try {
    const job = await startMusicJob({ actor, conversationId: state.conversationId, turnId: state.turnId, companionId: state.persona?.id ?? null, temporary, task, request, body, parentFileId });
    return outcomeOf({ callId, packageId, status: "succeeded", via: "tool_call", args, durationMs: 0, result: {
      reply: { text: `${songOnItsWay(request)}${tierAsked?.line ? ` ${tierAsked.line}` : ""}` },
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
