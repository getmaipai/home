import { z } from "zod";
import type { ToolExecutionOutcome } from "@/lib/turnMachine/contract";
import type { PersonRow } from "@/types";
import { outcomeOf } from "@/lib/turnContext";
import { MUSIC_STARTED_LINE } from "@/lib/mediaClaims";
import { musicAudienceOf, musicRefusalFor, REFUSED_PREFIX, type MusicToolInput } from "./tool";
import { musicEngineStatus, musicStatusReady, soundEngineStatus, soundStatusReady } from "./ready";
import { plainMusicFailure, startMusicJob } from "./jobs";
import { StackMusicError, musicBody } from "./stack";
import type { MusicRequest } from "./types";

export const MAKE_SOUND_TOOL_ID = "make_sound";
export const makeSoundArgs = z.object({
  description: z.string().trim().min(3).max(600),
  seconds: z.number().finite().min(1).max(60).optional().describe("Length in seconds, 1 to 60. Under the music model's minimum of 10 the sound is made at the minimum and cut to this length."),
  loop: z.boolean().optional(),
  takes: z.number().int().min(1).max(3).optional(),
  stick_to_words: z.boolean().optional(),
});

type SfxLimits = { min_seconds: number; max_seconds: number };
async function startSfx(input: MusicToolInput, data: z.infer<typeof makeSoundArgs>, limits: SfxLimits): Promise<ToolExecutionOutcome> {
  const { state, args, callId } = input;
  const seconds = Math.min(limits.max_seconds, Math.max(limits.min_seconds, data.seconds ?? 5));
  const takes = data.takes ?? 1;
  const request: MusicRequest = { description: data.description, instrumental: true, lyrics: "[Instrumental]", seconds, quality: "quick",
    sound: { loop: data.loop ?? false, surprise: data.stick_to_words === false, engine: "sfx" } };
  if (takes > 1) request.sound!.takes = { group: `snd-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`, index: 0, total: takes };
  const body = musicBody(request, "text2music"); body.quality = "quick";
  try {
    const job = await startMusicJob({ actor: state.actor as PersonRow, conversationId: state.conversationId, turnId: state.turnId, companionId: state.persona?.id ?? null,
      temporary: state.temporary === true || state.ephemeral === true, task: "text2music", request, body, parentFileId: null });
    return outcomeOf({ callId, packageId: MAKE_SOUND_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0,
      result: { reply: { text: `${MUSIC_STARTED_LINE} ${takes > 1 ? `${takes} takes of a sound effect or ambience are being made one after another and will show below as each finishes.` : "A sound effect or ambience is being made and will show below when it's finished."} Reply briefly that it has started; do not say it is ready, done or finished.` }, data: { musicJobId: job.id }, actions: [] } });
  } catch (error) {
    const code = error instanceof StackMusicError ? error.code : "failed";
    const failed = (kind: "bad_arguments" | "unavailable" | "errored") => outcomeOf({ callId, packageId: MAKE_SOUND_TOOL_ID, status: "failed", via: "tool_call", args, errorCode: code, failureKind: kind, durationMs: 0 });
    if (code === "already_making") return outcomeOf({ callId, packageId: MAKE_SOUND_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: `${REFUSED_PREFIX}${plainMusicFailure(code)}` }, data: { refused: code }, actions: [] } });
    return failed(error instanceof StackMusicError && error.status < 500 ? "bad_arguments" : "unavailable");
  }
}

export async function runMakeSound(input: MusicToolInput): Promise<ToolExecutionOutcome> {
  const { state, args, callId } = input;
  const failed = (code: string, kind: "bad_arguments" | "unavailable" | "errored") => outcomeOf({ callId, packageId: MAKE_SOUND_TOOL_ID, status: "failed", via: "tool_call", args, errorCode: code, failureKind: kind, durationMs: 0 });
  const refused = (line: string, why: string) => outcomeOf({ callId, packageId: MAKE_SOUND_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: `${REFUSED_PREFIX}${line}` }, data: { refused: why }, actions: [] } });
  const parsed = makeSoundArgs.safeParse(args);
  if (!parsed.success) return failed("bad_arguments", "bad_arguments");
  const refusal = musicRefusalFor(musicAudienceOf(state, input.spoken), { description: parsed.data.description });
  if (refusal) return refused(refusal.line, refusal.why);
  // MP-07: the sound-effects model makes a sound of 1 to 47 s; ACE-Step stays for a longer one and for a computer that has no sound model.
  const sfxStatus = await soundEngineStatus();
  const sfxReady = soundStatusReady(sfxStatus);
  const engine = await musicEngineStatus();
  const aceReady = musicStatusReady(engine);
  if (!sfxReady && !aceReady) return failed("no_engine", "unavailable");
  const useSfx = sfxReady && (!aceReady || (parsed.data.seconds ?? 5) <= sfxStatus!.limits.max_seconds);
  if (useSfx) return startSfx(input, parsed.data, sfxStatus!.limits);
  const minimum = engine!.limits.min_seconds;
  const asked = parsed.data.seconds;
  const seconds = Math.min(60, engine!.limits.max_seconds, Math.max(minimum, asked ?? 10));
  const description = `sound effect, no melody, no singing: ${parsed.data.description}${parsed.data.loop ? ", seamless loop" : ""}`;
  const request: MusicRequest = { description, instrumental: true, lyrics: "[Instrumental]", seconds, quality: "quick",
    sound: { loop: parsed.data.loop ?? false, surprise: parsed.data.stick_to_words === false } };
  if (asked !== undefined && asked < minimum) request.sound!.trimTo = asked;
  const takes = parsed.data.takes ?? 1;
  if (takes > 1) request.sound!.takes = { group: `snd-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`, index: 0, total: takes };
  request.max_seconds = engine!.limits.max_seconds;
  if (request.seconds < minimum || request.seconds > engine!.limits.max_seconds) return failed("too_long_or_short", "bad_arguments");
  const body = musicBody(request, "text2music"); body.quality = "quick";
  try {
    const job = await startMusicJob({ actor: state.actor as PersonRow, conversationId: state.conversationId, turnId: state.turnId, companionId: state.persona?.id ?? null,
      temporary: state.temporary === true || state.ephemeral === true, task: "text2music", request, body, parentFileId: null });
    const minimumNote = asked !== undefined && asked < minimum ? " The music model cannot make less than its minimum length, so the sound is made at the minimum length and then cut to the length asked." : "";
    return outcomeOf({ callId, packageId: MAKE_SOUND_TOOL_ID, status: "succeeded", via: "tool_call", args, durationMs: 0,
      result: { reply: { text: `${MUSIC_STARTED_LINE} ${takes > 1 ? `${takes} takes of a sound effect or ambience are being made one after another and will show below as each finishes.` : "A sound effect or ambience is being made and will show below when it's finished."} Reply briefly that it has started; do not say it is ready, done or finished.${minimumNote}` }, data: { musicJobId: job.id }, actions: [] } });
  } catch (error) {
    const code = error instanceof StackMusicError ? error.code : "failed";
    if (code === "already_making") return refused(plainMusicFailure(code), code);
    return failed(code, error instanceof StackMusicError && error.status < 500 ? "bad_arguments" : "unavailable");
  }
}
