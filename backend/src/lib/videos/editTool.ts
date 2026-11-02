// VIDEO-CHAT-01 (C2): the `edit_video` tool, the video twin of `edit_music`. Three changes, all on a clip made here: another take (same words
// and choices, new seed), remix (the same recipe plus the fields the person changed) and make it max (the same clip at Max). Each one calls
// `makeVideoFor`, the one function the Create page's buttons call, so the gates, the level rules and the one-clip-at-a-time rule are the
// same in chat and on the page. The model decides when a person wants one of these (rule 1); nothing here reads wording. The result is
// `data: { videoJobId }` like `generate_video`, so the same card follows the job. A failed tool tells the model only the failure kind
// (rule 6); a refusal keeps its own plain line.
import { z } from "zod";
import type { PersonRow } from "@/types";
import type { ToolExecutionOutcome } from "@/lib/turnMachine/contract";
import { outcomeOf } from "@/lib/turnContext";
import { MAX_NEEDS_ADMIN_LINE, jobTier, tierArgument } from "@/lib/tiers";
import { etaWords } from "./quality";
import { bodyOfVideoJob, makeVideoFor, type MakeVideoBody } from "./make";
import { sourceVideoJob } from "./jobs";
import { VIDEO_LOOKS, VIDEO_RECIPES, VIDEO_VOICES } from "./recipes";
import { prepareVideoRerun } from "./rerun";
import { videoAudienceOf, videoRefusalFor, type GenerateVideoState, type RunGenerateVideoInput } from "./tool";

export const EDIT_VIDEO_TOOL_ID = "edit_video";

const ids = <T extends { id: string }>(list: readonly T[]) => list.map((item) => item.id) as [string, ...string[]];

export const editVideoArgs = z.object({
  clip: z.string().trim().min(1).max(80),
  change: z.enum(["another_take", "remix", "make_it_max"]),
  prompt: z.string().trim().min(3).max(1200).optional(),
  look: z.enum(ids(VIDEO_LOOKS)).optional(),
  camera: z.enum(ids(VIDEO_RECIPES)).optional(),
  voices: z.enum(ids(VIDEO_VOICES)).optional(),
  tier: z.enum(["standard", "boost", "max"]).optional(),
  seconds: z.number().int().min(1).max(10).optional(),
  keep_seed: z.boolean().optional(),
});

export const NO_CLIP_LINE = "I can't find that video. Ask for a new one, or open the video you mean and try again.";
export const WHAT_TO_CHANGE_LINE = "Tell me what to change: the words, the look, the camera move, the sound, the length or the level.";
export const NO_PICTURE_LINE = "The picture that video started from is not available any more, so I can't make it again. Ask for a new video.";
export const ALREADY_MAX_LINE = "That video is already made at Max.";

export interface RunEditVideoInput { state: GenerateVideoState; args: Record<string, unknown>; callId: string; spoken: boolean }

const packageId = EDIT_VIDEO_TOOL_ID;

function refused(callId: string, args: Record<string, unknown>, line: string, why: string): ToolExecutionOutcome {
  return outcomeOf({ callId, packageId, status: "succeeded", via: "tool_call", args, durationMs: 0, result: { reply: { text: `No video was made. Say this to the person in your own words and keep its meaning: ${line}` }, data: { refused: why }, actions: [] } });
}

function failed(callId: string, args: Record<string, unknown>, code: string, kind: "unavailable" | "errored" | "bad_arguments"): ToolExecutionOutcome {
  return outcomeOf({ callId, packageId, status: "failed", via: "tool_call", args, errorCode: code, failureKind: kind, durationMs: 0 });
}

export async function runEditVideo(input: RunEditVideoInput): Promise<ToolExecutionOutcome> {
  const { state, args, callId } = input;
  const parsed = editVideoArgs.safeParse(args);
  if (!parsed.success) return failed(callId, args, "bad_arguments", "bad_arguments");
  const value = parsed.data;
  const actor = state.actor as PersonRow;
  const audience = videoAudienceOf(state as Parameters<typeof videoAudienceOf>[0], input.spoken);
  // The surface and age gate, then the same screening any typed prompt gets (a remix's new words are screened like a first request).
  const refusal = videoRefusalFor(audience, { prompt: value.change === "remix" ? value.prompt ?? "" : "" });
  if (refusal) return refused(callId, args, refusal.line, refusal.why);

  const temporary = state.temporary === true || state.ephemeral === true;
  const source = sourceVideoJob(actor, state.conversationId, value.clip, temporary);
  if (!source) return refused(callId, args, NO_CLIP_LINE, "no_clip");

  const body: MakeVideoBody = bodyOfVideoJob(source);
  // A clip that started from a picture (made here or an attached photo) starts from it again, through the same loader and input screening a Make another uses.
  let prepared: RunGenerateVideoInput["prepared"];
  if (source.request.source_file_id) {
    const prep = source.conversationId
      ? await prepareVideoRerun({ actor, audience, conversationId: source.conversationId, temporary: source.temporary, prompt: value.change === "remix" ? value.prompt ?? source.prompt : source.prompt, sourceFileId: source.request.source_file_id, adapters: [], styleIds: [] })
      : null;
    if (!prep) return refused(callId, args, NO_PICTURE_LINE, "reference");
    if (!prep.ok) return refused(callId, args, prep.line, prep.code);
    if (prep.image) prepared = { image: prep.image, imageSource: prep.imageSource ?? "generated", sourceFileId: source.request.source_file_id, width: prep.width, height: prep.height };
  }
  if (value.change === "remix") {
    const changed = value.prompt !== undefined || value.look !== undefined || value.camera !== undefined || value.voices !== undefined || value.tier !== undefined || value.seconds !== undefined;
    if (!changed) return refused(callId, args, WHAT_TO_CHANGE_LINE, "nothing_to_change");
    if (value.prompt !== undefined) body.prompt = value.prompt;
    if (value.look !== undefined) body.look = value.look;
    if (value.camera !== undefined) body.recipe = value.camera;
    if (value.voices !== undefined) body.voices = value.voices;
    if (value.tier !== undefined) body.tier = value.tier;
    if (value.seconds !== undefined) body.seconds = value.seconds;
    if (value.keep_seed && source.request.seed) body.seed = source.request.seed;
  } else if (value.change === "make_it_max") {
    if (body.tier === "max") return refused(callId, args, ALREADY_MAX_LINE, "already_max");
    // The same grant check the tool and the Create page use; without it nothing is made.
    if (tierArgument({ person: actor, category: "video", arg: "max", band: audience.band }).line === MAX_NEEDS_ADMIN_LINE) return refused(callId, args, MAX_NEEDS_ADMIN_LINE, "max_needs_admin");
    body.tier = "max";
    // The same clip, made better: the same picture of the idea, so the seed stays.
    if (source.request.seed) body.seed = source.request.seed;
  }

  const made = await makeVideoFor(actor, body, { audience, state, callId, ...(prepared ? { prepared } : {}) });
  if (!made.ok) {
    if (made.status === 503) return failed(callId, args, made.code, "unavailable");
    if (made.status === 502) return failed(callId, args, made.code, "errored");
    return refused(callId, args, made.error, made.code);
  }
  const job = made.job;
  const quality = job.request.quality ?? "quick";
  const level = jobTier("video", job.request.tier, quality);
  const note = made.notice ? ` ${made.notice}` : "";
  return outcomeOf({
    callId, packageId, status: "succeeded", via: "tool_call", args, durationMs: 0,
    result: {
      reply: { text: `A new ${job.request.seconds} second version of the video is being made at ${level === "max" ? "Max" : level === "boost" ? "Boost" : "Standard"}; the first one is kept. It takes ${etaWords(quality, job.request.seconds)} and appears below your reply when it is ready. You have not seen it or heard it: do not describe how it looks or sounds. Tell the person in one short sentence that it is on its way and about how long it takes.${note}` },
      data: { videoJobId: job.id },
      actions: [],
    },
  });
}
