import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { keyRgb } from "@/lib/companionLook";
import { join } from "node:path";
import media from "@maipai/spec/vocab/companion-media.json";
import type { PersonRow } from "@/types";
import { readLook, versionOriginalPath, versionPath } from "@/lib/companionLook";
import { takeUsable, addTake, companionHasFinishingJob, finishTake, readStates, recordTakeFailure, recordTakeModelReported, setMotion, setTakeSeed, takePath, TAKE_LIMIT_LINE, keyframePath, writeKeyframe, readKeyframeMeta } from "@/lib/companionStates";
import { existsSync } from "node:fs";
import { routeAudience } from "@/lib/pictures/audience";
import { laneOfPerson } from "@/lib/pictures/laneGate";
import { videoDenial, VIDEO_DENIAL_LINE, VIDEO_NOT_HERE_LINE, refuseVideoPrompt, VIDEO_REFUSAL_LINE } from "@/lib/videos/policy";
import { videoEngineReady, videoEngineStatus } from "@/lib/videos/ready";
import { maxSecondsFor, quickVideoReady } from "@/lib/videos/quality";
import { resolveCompanionClip, stackVideoModel, promptHash, COMPANION_MODEL_MISMATCH_LINE } from "@/lib/companionArt";
import { cancelOrDeleteVideo, fetchClip, getVideoJob, StackVideoError, submitVideo } from "@/lib/videos/stack";
import { activeLookJob } from "@/lib/companionLookJobs";
import type { CompanionTake } from "@/lib/companionStates";

export const TAKE_RUN_BUSY_LINE = "A clip is already being made for this companion. Wait for it or stop it.";
export const TAKE_QUICK_NOT_READY_LINE = "Making a character's clips needs the standard video model. An admin can install it in Settings, Pictures and videos.";
export const TAKE_RUN_NOT_FOUND_LINE = "That clip run could not be found. Start it again.";
export const TAKE_RUN_TIMEOUT_LINE = "The video engine took too long. Try again.";
export const TAKE_RETRY_WAIT_MS = 60_000;
/** How often Home asks the engine about a running video job (a quick clip takes about 70 seconds; the old two second wait added up to two seconds per take). */
export const TAKE_POLL_MS = 500;
export const TAKE_NEGATIVE_PROMPT = "different character, changed colours, changed face, extra limbs, text, watermark, camera movement, background change, shadows";
export const TAKE_NO_REST_LINE = "Choose and approve a starting picture first.";
export const TAKE_NEEDS_KEYFRAME_LINE = "Make the picture for this animation first.";

export type TakeRunState = "queued" | "running" | "done" | "failed" | "cancelled";
export interface TakeRun {
  id: string; companionId: string; personId: string; states: string[];
  current: { state: string; take: number; index: number; of: number } | null;
  state: TakeRunState; phase: string; percent: number; label: string;
  cancelled: boolean; error: string | null; takesMade: number; stackJob: string | null;
}
const runs = new Map<string, TakeRun>();
const activeByCompanion = new Map<string, string>();
const starting = new Set<string>();
let takeRetryWaitMs = TAKE_RETRY_WAIT_MS;

const stateRows = media.states as Array<{ id: string; motion: string; motions?: string[] }>;
/** A person's own words for the animation win; otherwise one of the animation's varied motions, picked at random for each clip so the clips differ. */
const chosenMotion = (state: string, own: string | null | undefined): string => {
  if (own) return own;
  const row = stateRows.find((item) => item.id === state)!, variants = row.motions?.length ? row.motions : [row.motion];
  return variants[Math.floor(Math.random() * variants.length)]!;
};

export function takePrompt(card: { text: string }, motion: string, keyName: "green" | "magenta"): string {
  return `Static shot, the camera never moves. ${card.text.slice(0, 600)}. The character stays exactly this size and in exactly this place in the frame, whole body always visible from head to feet, the same picture in every frame. Plain solid ${keyName} background with nothing on it; the character floats on it with nothing under it. Action: ${motion}. One single smooth motion from start to end, one prop only.`;
}

export function activeTakeRun(companionId: string): TakeRun | null {
  const id = activeByCompanion.get(companionId), run = id ? runs.get(id) : null;
  return run && (run.state === "queued" || run.state === "running") ? run : null;
}
export function companionHasTakeRun(companionId: string): boolean { const id = activeByCompanion.get(companionId), run = id ? runs.get(id) : null; return starting.has(companionId) || Boolean(run && ["queued", "running", "cancelled"].includes(run.state)); }
export function __clearCompanionTakeRunsForTests(): void { runs.clear(); activeByCompanion.clear(); starting.clear(); takeRetryWaitMs = TAKE_RETRY_WAIT_MS; }
export function __setTakeRetryWaitMsForTests(value: number): void { takeRetryWaitMs = value; }
export function takeRunFor(id: string, actor: PersonRow, companionId: string): TakeRun | null { const run = runs.get(id); return run?.personId === actor.id && run.companionId === companionId ? run : null; }

function readySheet(companionId: string): { look: ReturnType<typeof readLook>; restPath: string; originalPath: string | null; card: NonNullable<NonNullable<ReturnType<typeof readLook>["sheet"]>["card"]> } {
  const look = readLook(companionId), restPath = look.rest ? versionPath(companionId, look.rest) : null;
  if (look.sheet?.state !== "approved" || !restPath || !look.sheet.card) throw Object.assign(new Error("Approve the character sheet first, so every clip starts from the same character."), { status: 409 });
  return { look, restPath, originalPath: look.rest ? versionOriginalPath(companionId, look.rest) : null, card: look.sheet.card };
}

function errorCode(error: unknown): string | null { return error instanceof StackVideoError ? error.code : null; }
function engineShouldStop(error: unknown): boolean {
  const code = errorCode(error);
  return ["not_installed", "model_missing", "setup_failed", "unsupported", "not_available_on_this_computer", "unreachable", "no_stack", "no_memory", "out_of_memory"].includes(code ?? "") || /not installed|out[_ ]of[_ ]memory|no[_ ]memory|low on memory|isn't answering/i.test(error instanceof Error ? error.message : "");
}
function isEngineFailure(error: unknown): boolean { return error instanceof StackVideoError && (error.status >= 500 || ["generation_failed", "engine_error"].includes(error.code)); }

async function runTakes(run: TakeRun, count: number, actor: PersonRow, motionOverride?: string, pass = 1): Promise<void> {
  run.state = "running";
  let consecutiveEngineFailures = 0;
  // Finishing (key-colour matte, encode, art check) runs while the next clip generates; the run ends only when every finish has settled.
  const finishing: Promise<void>[] = [];
  const look = readLook(run.companionId), sheet = readySheet(run.companionId), keyName = sheet.look.sheet!.key === "#FF00FF" ? "magenta" : "green";
  try {
    for (let stateIndex = 0; stateIndex < run.states.length; stateIndex++) {
      const state = run.states[stateIndex]!;
      // The video model starts from the picture on the key colour it is told to keep, so the clip can be keyed out afterwards; a transparent picture would arrive on black. It is shrunk to the clip size here and sharpened there, because the model smooths fine detail and sharpening before the shrink is mostly lost.
      const [keyR, keyG, keyB] = keyRgb(sheet.look.sheet!.key);
      const pictureB64 = Buffer.from(await sharp(readFileSync(keyframePath(run.companionId, state))).flatten({ background: { r: keyR, g: keyG, b: keyB } }).resize(media.generate.width, media.generate.height, { fit: "fill", kernel: "lanczos3" }).sharpen({ sigma: 1.2, m1: 1, m2: 2 }).png().toBuffer()).toString("base64");
      if (run.cancelled) break;
      if (motionOverride !== undefined && run.states.length === 1) setMotion(run.companionId, state, motionOverride);
      const stored = readStates(run.companionId).states[state];
      for (let index = 1; index <= count; index++) {
        if (run.cancelled) break;
        const prompt = takePrompt(sheet.card, chosenMotion(state, stored?.motion), keyName);
        run.current = { state, take: index, index: stateIndex + 1, of: run.states.length };
        run.phase = "generating"; run.percent = Math.round(((run.takesMade) / (run.states.length * count)) * 100);
        run.label = `Making the ${stateLabel(state)} animation${count > 1 ? ` (try ${index} of ${count})` : ""}`;
        let take: CompanionTake | null = null;
        let stackJob: string | null = null;
        let engineFailure = false;
        try {
          let seed = Math.floor(Math.random() * 2_147_483_647);
          const art = await resolveCompanionClip(laneOfPerson(actor) === "adult" ? "detailed" : "quick");
          const seconds = Math.min(media.generate.seconds, maxSecondsFor(art.quality));
          take = addTake(run.companionId, state, { source: "generated", seed, label: `Candidate ${index}`, model: art.model, quality: art.quality, prompt_hash: promptHash(prompt) });
          let done: Awaited<ReturnType<typeof submitVideo>>["done"] = null;
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const submitted = await submitVideo({ prompt, negative_prompt: TAKE_NEGATIVE_PROMPT, size: `${media.generate.width}x${media.generate.height}`, seconds, model: stackVideoModel(art), seed, image: pictureB64, image_source: sheet.originalPath || readKeyframeMeta(run.companionId, state)?.model ? "generated" : "uploaded", audience: "all-ages", timeout_ms: 1 });
              stackJob = submitted.job; run.stackJob = stackJob; done = submitted.done;
              const deadline = Date.now() + 15 * 60_000;
              while (!done) {
                if (run.cancelled) break;
                if (Date.now() > deadline) throw new Error(TAKE_RUN_TIMEOUT_LINE);
                const status = await getVideoJob(stackJob);
                if (status.state === "failed") throw new StackVideoError(500, status.code ?? "video_failed", status.error ?? "The video engine could not make this clip. Try again.", stackJob);
                if (status.state === "cancelled") throw Object.assign(new Error("The video engine stopped this clip. Try again."), { cancelled: true });
                if (status.state === "done") done = status.data;
                else { const progress = Math.max(0, Math.min(99, status.progress)); run.percent = Math.min(79, Math.round((run.takesMade / (run.states.length * count)) * 100 + progress / (run.states.length * count))); }
                if (!done) await new Promise((resolve) => setTimeout(resolve, TAKE_POLL_MS));
              }
              break;
            } catch (error) {
              if (!(error as { cancelled?: boolean })?.cancelled || attempt > 0 || run.cancelled) throw error;
              if (stackJob) await cancelOrDeleteVideo(stackJob);
              run.stackJob = null; stackJob = null;
              run.phase = "waiting"; run.label = "Waiting for memory, then trying again";
              await new Promise((resolve) => setTimeout(resolve, takeRetryWaitMs));
              if (run.cancelled) break;
              const nextSeed = Math.floor(Math.random() * 2_147_483_647);
              seed = nextSeed === seed ? (seed + 1) % 2_147_483_647 : nextSeed;
              setTakeSeed(run.companionId, state, take.id, seed);
            }
          }
          if (run.cancelled) break;
          const reported = done?.find((clip) => typeof clip.model === "string")?.model ?? null;
          const reportedQuality = done?.find((clip) => clip.quality)?.quality ?? null;
          if ((reportedQuality && reportedQuality !== art.quality) || (reported && reported !== take.model && reported !== stackVideoModel(art))) throw new Error(COMPANION_MODEL_MISMATCH_LINE);
          recordTakeModelReported(run.companionId, state, take.id, reported);
          run.phase = "finishing"; run.label = `Finishing the ${stateLabel(state)} animation${count > 1 ? ` (try ${index} of ${count})` : ""}`; run.percent = Math.min(99, run.percent + 1);
          const completedStackJob = stackJob!;
          const clip = await fetchClip(completedStackJob);
          if (run.cancelled) { await cancelOrDeleteVideo(completedStackJob); break; }
          const sourcePath = takePath(run.companionId, state, take.id, "source.mp4")!;
          writeFileSync(sourcePath, clip);
          await cancelOrDeleteVideo(completedStackJob); run.stackJob = null; stackJob = null;
          // finishTake records its own failure on the take; a finishing failure never stops the run.
          finishing.push(finishTake(run.companionId, state, take.id, { alpha: false, actor }).catch(() => undefined));
          consecutiveEngineFailures = 0;
        } catch (error) {
          if (stackJob && !run.cancelled) await cancelOrDeleteVideo(stackJob);
          run.stackJob = null;
          if (take) recordTakeFailure(run.companionId, state, take.id, error instanceof Error ? error.message : "This clip could not be made. Try again.");
          engineFailure = isEngineFailure(error);
          if (engineFailure) consecutiveEngineFailures++; else consecutiveEngineFailures = 0;
          if (run.cancelled) break;
          if ((error as { cancelled?: boolean })?.cancelled) { run.error = error instanceof Error ? error.message : "The video engine stopped this clip. Try again."; run.state = "failed"; break; }
          if (engineShouldStop(error) || consecutiveEngineFailures >= 2) {
            run.error = error instanceof Error ? error.message : "The video engine could not continue. Check it, then try again.";
            run.state = "failed"; break;
          }
        }
        run.takesMade++;
      }
      if (run.state === "failed" || run.cancelled) break;
    }
  } catch (error) {
    run.error = error instanceof Error ? error.message : "The clip run could not finish. Try again.";
    run.state = "failed";
  } finally {
    if (finishing.length) { run.phase = "finishing"; run.label = "Finishing the last clip"; await Promise.allSettled(finishing); }
    // A clip whose key colour did not come out is a box, not a character: draw that animation once more with a new seed before the run ends.
    const again = pass === 1 && !run.cancelled && run.state !== "failed" ? run.states.filter((state) => { const takes = readStates(run.companionId).states[state]?.takes ?? []; return takes.some((take) => take.report) && !takes.some((take) => take.report?.ok && takeUsable(take)); }) : [];
    if (again.length) { run.states = again; run.takesMade = 0; run.percent = 0; run.label = "Making the clips that did not come out again"; await runTakes(run, count, actor, motionOverride, 2); return; }
    if (run.cancelled) run.state = "cancelled";
    else if (run.state !== "failed") { run.state = "done"; run.percent = 100; }
    run.phase = run.state;
    if (activeByCompanion.get(run.companionId) === run.id) activeByCompanion.delete(run.companionId);
    run.stackJob = null;
  }
}

function stateLabel(state: string): string { return state.split("_").map((part) => part[0]!.toUpperCase() + part.slice(1)).join(" "); }

export async function startStateTakes(input: { actor: PersonRow; companionId: string; states: string[]; count: number; motion?: string }): Promise<string> {
  const promptText = input.states.map((state) => {
    const current = readStates(input.companionId).states[state], motion = input.motion ?? current?.motion ?? stateRows.find((row) => row.id === state)?.motion ?? "";
    const card = readLook(input.companionId).sheet?.card;
    return takePrompt(card ?? { text: "" }, motion, readLook(input.companionId).sheet?.key === "#FF00FF" ? "magenta" : "green");
  }).join(" ");
  const audience = routeAudience(input.actor), denial = videoDenial(audience);
  if (denial) throw Object.assign(new Error(VIDEO_DENIAL_LINE[denial]), { status: 403 });
  const refused = refuseVideoPrompt(promptText, { lane: "adult" });
  if (refused) throw Object.assign(new Error(VIDEO_REFUSAL_LINE[refused]), { status: 422 });
  const sheet = readySheet(input.companionId);
  for (const state of input.states) {
    const path = keyframePath(input.companionId, state);
    // An animation with no picture of its own starts from the approved starting picture, so a clip needs no separate picture step; editing the keyframe later changes it.
    if (!existsSync(path)) {
      const bytes = new Uint8Array(readFileSync(sheet.restPath)), now = new Date().toISOString();
      writeKeyframe(input.companionId, state, bytes, { source: "generated", style: readLook(input.companionId).versions.find((version) => version.id === readLook(input.companionId).rest)?.style ?? "keep", prompt_hash: promptHash("Keyframe copied from approved rest picture"), model: null, created_at: now, edited_at: now });
    }
  }
  const engineReady = await videoEngineReady(), engineStatus = await videoEngineStatus();
  if (!engineReady && (!engineStatus || engineStatus.available === false || engineStatus.state === "unsupported" || engineStatus.state === "off")) throw Object.assign(new Error(VIDEO_NOT_HERE_LINE), { status: 503 });
  if (companionHasTakeRun(input.companionId) || companionHasFinishingJob(input.companionId) || activeLookJob(input.companionId)) throw Object.assign(new Error(TAKE_RUN_BUSY_LINE), { status: 409 });
  const states = readStates(input.companionId);
  if (input.states.some((state) => (states.states[state]?.takes.length ?? 0) + input.count > 12)) throw Object.assign(new Error(TAKE_LIMIT_LINE), { status: 409 });
  starting.add(input.companionId);
  try {
    if (!quickVideoReady(engineStatus)) throw Object.assign(new Error(TAKE_QUICK_NOT_READY_LINE), { status: 503 });
    const id = crypto.randomUUID();
    const run: TakeRun = { id, companionId: input.companionId, personId: input.actor.id, states: input.states, current: null, state: "queued", phase: "queued", percent: 0, label: "Getting ready to make animations", cancelled: false, error: null, takesMade: 0, stackJob: null };
    runs.set(id, run); activeByCompanion.set(input.companionId, id);
    void runTakes(run, input.count, input.actor, input.motion).catch(() => undefined);
    return id;
  } finally { starting.delete(input.companionId); }
}

export async function cancelTakeRun(id: string, actor: PersonRow, companionId: string): Promise<boolean> {
  const run = takeRunFor(id, actor, companionId);
  if (!run) return false;
  if (run.state === "queued" || run.state === "running") {
    run.cancelled = true; run.state = "cancelled"; run.error = null; run.label = "Stopping clip making";
    if (run.stackJob) { await cancelOrDeleteVideo(run.stackJob); run.stackJob = null; }
  }
  return true;
}

export function publicTakeRun(run: TakeRun) { return { state: run.state, label: run.label, percent: run.percent, current: run.current, takes_made: run.takesMade, error: run.error }; }
