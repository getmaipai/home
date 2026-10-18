// MUSIC-GEN-03: the model chooses the tool. Policy and source ownership are checked again before admission.
import { z } from "zod";
import type { PersonRow } from "@/types";
import type { TurnState, ToolExecutionOutcome } from "@/lib/turnMachine/contract";
import { outcomeOf } from "@/lib/turnContext";
import { turnAgeBand } from "@/lib/turnMachine/speaker";
import { musicDenial, MUSIC_DENIAL_LINE, MUSIC_REFUSAL_LINE, refuseMusicPrompt, type MusicAudience } from "./policy";
import { musicEngineStatus, musicStatusReady } from "./ready";
import { plainMusicFailure, readMusicFile, sourceMusicJob, startMusicJob } from "./jobs";
import { resolveMusicSection, replaceMusicSection, fitLyricsToLength } from "./sections";
import { StackMusicError, type MusicBody } from "./stack";
import type { MusicJob, MusicRequest, MusicTask, SongLength } from "./types";
import { householdSongLength } from "./policy";
export const GENERATE_MUSIC_TOOL_ID = "generate_music";
export const EDIT_MUSIC_TOOL_ID = "edit_music";
export function musicAudienceOf(state: Pick<TurnState, "actor" | "surface" | "speakerEvidence" | "planBasis" | "plan">, spoken: boolean): MusicAudience {
  const surfaceClass = state.planBasis?.surfaceClass ?? "spoken";
  return { actor: state.actor, band: turnAgeBand(state.surface, state.actor, state.speakerEvidence, new Date()), surface: state.surface, surfaceClass, spoken: spoken || surfaceClass !== "written" };
}
const common = {
  description: z.string().trim().min(3).max(1200).optional(), lyrics: z.string().max(4000).optional(),
  bpm: z.number().finite().min(20).max(300).optional(), key: z.string().max(20).regex(/^[A-G][#b]?\s?(major|minor|maj|min|m)?$/i).optional(),
  imitates_real_voice: z.boolean().optional(),
};
export const generateMusicArgs = z.object({ ...common, description: common.description.unwrap(), instrumental: z.boolean().optional(), length: z.enum(["quick", "full"]).optional(), seconds: z.number().finite().min(10).optional(), language: z.string().max(20).regex(/^([a-z]{2,3}(-[A-Za-z]{2,4})?|unknown)$/).optional(), title: z.string().max(200).optional() });
export const editMusicArgs = z.object({
  ...common, track: z.string().min(1).max(80), change: z.enum(["remake", "restyle", "instrumental", "rewrite_section", "extend", "variation", "trim", "fade", "loudness", "make_full", "make_quick"]),
  section: z.string().max(80).optional(), from_s: z.number().finite().min(0).optional(), to_s: z.number().finite().positive().optional(),
  seconds: z.number().finite().positive().optional(), at: z.enum(["start", "end"]).optional(), where: z.enum(["in", "out", "both"]).optional(),
  strength: z.number().finite().min(0.3).max(1).optional(), lufs: z.number().finite().min(-70).max(-5).optional(),
});
export function musicRefusalFor(audience: MusicAudience, args: Record<string, unknown>) {
  const denied = musicDenial(audience);
  if (denied) return { kind: "denied" as const, why: denied, line: MUSIC_DENIAL_LINE[denied] };
  const text = [args.description, args.lyrics, args.title, args.key, args.language].filter((s) => typeof s === "string").join(" ");
  const refusal = refuseMusicPrompt(text, { imitatesRealVoice: args.imitates_real_voice === true });
  return refusal ? { kind: "prompt" as const, why: refusal, line: MUSIC_REFUSAL_LINE[refusal] } : null;
}
export type MusicToolInput = {
  state: Pick<TurnState, "actor" | "surface" | "speakerEvidence" | "planBasis" | "plan" | "conversationId" | "turnId" | "temporary" | "ephemeral">;
  args: Record<string, unknown>; callId: string; spoken: boolean;
};
const newSeed = (prior?: number | null): number => { const seed = Math.floor(Math.random() * 2_147_483_646) + 1; return seed === prior ? seed + 1 : seed; };
export function musicBody(request: MusicRequest, task: MusicBody["task"]): Omit<MusicBody, "timeout_ms"> {
  return { task, caption: request.description, lyrics: request.lyrics, instrumental: request.instrumental, duration_s: request.seconds,
    bpm: request.bpm, key: request.key, language: request.language, quality: request.quality ?? "quick", seed: request.seed,
    from_s: request.from_s, to_s: request.to_s, add_s: request.add_s, at: request.at, strength: request.strength, edit: request.edit };
}
/** The Stack's own default (detailed on a big computer, quick on a small one); quick when it names none. */
export function defaultQualityOf(engine: { default_quality?: string }): "quick" | "detailed" { return engine.default_quality === "detailed" ? "detailed" : "quick"; }
/**
 * ACE-Step invents half-sung words when the lyrics are shorter than the song (design note section 5), so a song the person
 * gave no length for is as long as its words: about 4 s per sung line plus 10 s, 30 s at least, the Stack's maximum at most.
 */
export function secondsFromLyrics(lyrics: string | undefined, maxSeconds: number): number {
  const lines = (lyrics ?? "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^\[[^\]]*\]$/.test(l)).length;
  if (!lines) return Math.min(60, maxSeconds);
  return Math.min(maxSeconds, Math.max(30, lines * 4 + 10));
}

/**
 * Quick and Full songs (owner, 2026-10-17: "quick songs and full songs like videos"), measured on the Studio (design note section 16):
 * Quick is about 45 s (10 to 60 s), Full about 3 minutes (150 s to the Stack's maximum, 240 s on a 128 GB Mac) with the whole
 * structure sung. Full needs a Stack that allows 150 s or more; a smaller computer makes a Quick song and says so.
 */
export const QUICK_SONG = { min: 10, default: 45, max: 60 } as const;
export const FULL_SONG = { min: 150, default: 180, max: 240 } as const;
export function fullSongsPossible(engine: { limits: { max_seconds: number } }): boolean { return engine.limits.max_seconds >= FULL_SONG.min; }
export function songSecondsFor(length: SongLength, asked: number | undefined, lyrics: string | undefined, maxSeconds: number): number {
  if (length === "full") return Math.min(maxSeconds, FULL_SONG.max, Math.max(FULL_SONG.min, Math.round(asked ?? FULL_SONG.default)));
  // An exact length the person asked for is kept (anything under a full song's length); otherwise a quick song is as long as its
  // words up to a minute, or 45 s.
  if (asked !== undefined) return Math.min(maxSeconds, FULL_SONG.min - 1, Math.max(QUICK_SONG.min, Math.round(asked)));
  const wanted = lyrics ? secondsFromLyrics(lyrics, QUICK_SONG.max) : QUICK_SONG.default;
  return Math.min(maxSeconds, QUICK_SONG.max, Math.max(QUICK_SONG.min, Math.round(wanted)));
}
/** The length a remake of this song has, from what it was asked as, else from its length. */
export function lengthOf(request: MusicRequest, durationS: number | null): SongLength {
  return request.length ?? ((durationS ?? request.seconds) >= FULL_SONG.min ? "full" : "quick");
}
/** The line the model relays when a song starts: which kind, how long, about how long it takes (measured, design note section 16). */
export function songOnItsWay(request: MusicRequest, downgraded = false): string {
  const length = lengthOf(request, null);
  const kind = length === "full" ? `A full song of about ${Math.round(request.seconds / 60 * 2) / 2} minutes` : `A quick ${request.seconds} second song`;
  const wait = length === "full" ? "about a minute or two" : "under a minute";
  const note = (downgraded ? " Full songs need a computer with 128 GB of memory, so this one is quick; say so in one short sentence." : "")
    + (request.written_lyrics ? " The words are longer than this song, so it sings the first parts that fit and Make it full on the player sings them all; say so in one short sentence." : "");
  const title = request.title ? ` called "${request.title}"` : "";
  return `${kind}${title} is on its way. It takes ${wait} and the player appears below your reply when it is ready. Reply in one or two short sentences: say the song is on its way and about how long it takes. Do not say it is ready, do not describe it, and do not repeat the lyrics, style or tempo: the player shows the words and the person has not heard it yet.${note}`;
}
/** MUSIC-GEN-17: the song sings the whole sections of `words` that fit its length; the person's whole words are kept for Make it full. */
export function fitWords(request: MusicRequest, words: string): void {
  const fitted = fitLyricsToLength(words, request.seconds);
  request.lyrics = fitted.lyrics;
  if (fitted.cut) request.written_lyrics = words; else delete request.written_lyrics;
}
export const SECTION_LINE = "Which part should I change? Give its start and end in seconds.";
export const WHICH_PART_LINE = "Tell me which part the new words replace, for example the chorus or verse 2.";
/** New words can stand in for the song's words only when they are a whole song: section tags and at least half the stored length. */
function isWholeSong(lyrics: string, stored: string | undefined): boolean {
  return /\[(?:verse|chorus|bridge|intro|outro|pre-chorus|hook|refrain|instrumental)[^\]]*\]/i.test(lyrics) && lyrics.length >= (stored?.length ?? 0) / 2;
}
type EditPlan = { ok: true; task: MusicTask; request: MusicRequest; body: Omit<MusicBody, "timeout_ms"> } | { ok: false; line: string };
export function prepareMusicEdit(source: MusicJob, args: z.infer<typeof editMusicArgs>): EditPlan {
  const { from_s: _from, to_s: _to, add_s: _add, at: _at, strength: _strength, edit: _edit, ...stored } = source.request;
  const request: MusicRequest = { ...stored, seconds: source.durationS ?? stored.seconds, seed: source.seed ?? stored.seed,
    ...(args.description !== undefined ? { description: args.description } : {}), ...(args.lyrics !== undefined ? { lyrics: args.lyrics } : {}),
    ...(args.bpm !== undefined ? { bpm: args.bpm } : {}), ...(args.key !== undefined ? { key: args.key } : {}) };
  let task: MusicTask; let stackTask: MusicBody["task"];
  switch (args.change) {
    case "remake": task = "remake"; stackTask = "text2music"; if (args.seconds !== undefined) request.seconds = args.seconds; break;
    case "make_full": case "make_quick": {
      // The same song made again at the other length: same words, description and seed.
      task = "remake"; stackTask = "text2music";
      const length: SongLength = args.change === "make_full" ? "full" : "quick";
      const words = request.written_lyrics ?? request.lyrics;
      request.length = length; request.seconds = songSecondsFor(length, undefined, request.instrumental ? undefined : words, FULL_SONG.max);
      if (!request.instrumental && words) fitWords(request, words);
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
  const engine = await musicEngineStatus();
  if (!musicStatusReady(engine)) return failed("no_engine", "unavailable");
  const temporary = state.temporary === true || state.ephemeral === true;
  const actor = state.actor as PersonRow;
  let downgraded = false;
  let request: MusicRequest; let task: MusicTask; let body: Omit<MusicBody, "timeout_ms">; let parentFileId: string | null = null;
  if (editing) {
    const parsed = editMusicArgs.safeParse(args); if (!parsed.success) return failed("bad_arguments", "bad_arguments");
    // sourceMusicJob already proved the song is this person's, made here, in this chat: no bytes are read for it.
    const source = sourceMusicJob(actor, state.conversationId, parsed.data.track, temporary);
    if (!source?.fileId) return refused(plainMusicFailure("source_not_made_here"), "source_not_made_here");
    const plan = prepareMusicEdit(source, parsed.data);
    if (plan.ok && plan.request.length === "full" && plan.task === "remake" && !fullSongsPossible(engine!)) return refused("Full songs need a computer with 128 GB of memory. I can make quick songs here.", "full_not_here");
    if (!plan.ok) return refused(plan.line, "section_or_range");
    ({ request, task, body } = plan); parentFileId = source.fileId;
    // Only a task that edits the audio itself sends it; a remake or variation is a fresh text2music job and reads and hashes nothing.
    if (body.task !== "text2music") {
      const file = readMusicFile(actor, source, source.fileId);
      if (!file) return refused(plainMusicFailure("source_not_made_here"), "source_not_made_here");
      body.source = Buffer.from(file.bytes).toString("base64"); body.source_sha256 = file.sha256;
    }
  } else {
    const parsed = generateMusicArgs.safeParse(args); if (!parsed.success) return failed("bad_arguments", "bad_arguments");
    const value = parsed.data;
    const lyrics = value.instrumental ? "[Instrumental]" : value.lyrics;
    // Full only when asked for (the model's `length`, or a length of two and a half minutes or more), else the household's default;
    // a computer whose Stack cannot make a Full song makes a Quick one and the reply says so.
    const asked: SongLength = value.length ?? (value.seconds !== undefined && value.seconds >= FULL_SONG.min ? "full" : householdSongLength());
    const length: SongLength = asked === "full" && !fullSongsPossible(engine!) ? "quick" : asked;
    downgraded = asked === "full" && length === "quick";
    request = { description: value.description, lyrics, title: value.title,
      instrumental: value.instrumental ?? false, seconds: songSecondsFor(length, value.seconds, value.instrumental ? undefined : value.lyrics, engine!.limits.max_seconds),
      bpm: value.bpm, key: value.key, language: value.language, quality: defaultQualityOf(engine!), seed: newSeed(), length };
    if (!request.instrumental && value.lyrics) fitWords(request, value.lyrics);
    task = "text2music"; body = musicBody(request, "text2music");
  }
  // A request stored before the Stack named a default (or an edit of an older song) takes the Stack's default now.
  request.quality ??= defaultQualityOf(engine!); body.quality = request.quality;
  // Check the effective request, including inherited words and a section replacement, before any job exists.
  const inherited = refuseMusicPrompt([request.description, request.lyrics, request.written_lyrics, request.title, request.key, request.language].join(" "), { imitatesRealVoice: args.imitates_real_voice === true });
  if (inherited) return refused(MUSIC_REFUSAL_LINE[inherited], inherited);
  if ((request.lyrics?.length ?? 0) > 4000 || (request.written_lyrics?.length ?? 0) > 4000) return failed("bad_arguments", "bad_arguments");
  if (request.seconds > engine!.limits.max_seconds || (body.task === "text2music" && request.seconds < Math.max(10, engine!.limits.min_seconds))) return failed("too_long_or_short", "bad_arguments");
  try {
    const job = await startMusicJob({ actor, conversationId: state.conversationId, turnId: state.turnId, temporary, task, request, body, parentFileId });
    return outcomeOf({ callId, packageId, status: "succeeded", via: "tool_call", args, durationMs: 0, result: {
      reply: { text: songOnItsWay(request, downgraded) },
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
