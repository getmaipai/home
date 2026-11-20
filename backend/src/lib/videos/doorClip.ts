// VF-DOOR-01: a plain clip goes through the Stack's generic make door (`POST /stack/v1/jobs/make`, job `clip`) instead of the old
// `/v1/videos/generations` door. Home sends what the person asked for (the level, the shape, the seconds, a start or end picture, the seed, the
// household's quiet window) and the Stack plans the rest: it names the part and the pixel size, never Home (rules E1, E2, E4, E7).
//
// Only the plain path is moved tonight. A request that carries negative words or a LoRA, a child's or a teen's request (any audience but adult), a
// companion take and every edit (extend, retake, restyle, Ingredients, a reference clip) stay on the old door: their wording and their looks wait on
// the Stack's prompt writer and style ids (docs/design/video-film-pipeline-2026-11-20.md, VF-DOOR-01). The old door is also the fallback when the
// generic one cannot take the clip: the catalog says no part serves it, the planner refuses it, or the Stack is older than the door.
import type { StackMakeClipRequest } from "@/lib/stack/makeShape";
import type { PersonRow } from "@/types";
import { clipJobAvailable, makeClip, StackVideoError, type StackClip, type StackLoraWarning, type VideoBody } from "./stack";
import { deriveStartPicture, isNeedsStartPicture, START_PICTURE_FAILED_LINE } from "./deriveStart";

/** The way back to the old door for every clip: set MAIPAI_VIDEO_LEGACY_DOOR=1 (a Stack or a part misbehaving on the generic door). */
export const legacyDoorForced = (): boolean => process.env.MAIPAI_VIDEO_LEGACY_DOOR === "1";

/** The generic clip request for a body, or null when the body is not a plain clip (it then stays on the old door). */
export function clipRequestFor(body: VideoBody): StackMakeClipRequest | null {
  if (body.audience !== "adult") return null;
  if (body.negative_prompt || (body.loras && body.loras.length > 0)) return null;
  // Max stays on the old door for now: its memory holds and the Stack's Max stop are classed by Home's own retry policy (`holdMaxAfterMemoryRefusal`) and were not part of the first proof.
  if (body.tier === "max") return null;
  if (body.source_video !== undefined || body.extend_seconds !== undefined || body.retake_from_seconds !== undefined) return null;
  if (body.size === undefined || body.seconds === undefined || body.seconds <= 0) return null;
  const size = /^(\d+)x(\d+)$/.exec(body.size);
  if (!size) return null;
  const width = Number(size[1]), height = Number(size[2]);
  const shape = width === height ? "square" : width > height ? "landscape" : "portrait";
  const level = body.tier === "boost" || body.tier === "max" ? body.tier : "standard";
  const picture = (base64: string) => `data:image/png;base64,${base64}`;
  return {
    job: "clip", audience: "adult", description: body.prompt, shape, level, seconds: body.seconds,
    ...(body.seed !== undefined ? { seed: body.seed } : {}),
    ...(body.image ? { start_picture: picture(body.image) } : {}),
    ...(body.identity_image ? { inputs: [{ role: "identity" as const, file: picture(body.identity_image) }] } : {}),
    ...(body.derived_start ? { intent: "derived_start" as const } : {}),
    ...(body.end_image ? { end_picture: picture(body.end_image) } : {}),
    ...(body.quiet_seconds !== undefined ? { quiet_seconds: body.quiet_seconds } : {}),
    ...(body.quiet_max_wait_seconds !== undefined ? { quiet_max_wait_seconds: body.quiet_max_wait_seconds } : {}),
    wait: 0,
  };
}

/** Whether this body goes through the generic door: decided without waiting, so a clip that stays on the old door runs exactly the same steps in the same order as before. */
export const doorWanted = (body: VideoBody): boolean => !legacyDoorForced() && clipRequestFor(body) !== null;

/**
 * Starts the clip on the generic door, or answers null when it must go on the old one. A Stack failure that is not a refusal (queue full, no memory,
 * memory cancelled) is thrown exactly as the old door throws it, so the queue and the holds in the job runner behave as before.
 */
export async function submitVideoViaDoor(body: VideoBody, actor?: PersonRow, onDerived?: (image: string) => void): Promise<{ job: string; done: StackClip[] | null; warnings: StackLoraWarning[]; derivedImage?: string } | null> {
  if (legacyDoorForced()) return null;
  const request = clipRequestFor(body);
  if (!request) return null;
  // The catalog is asked first so a clip that no part serves does not cost a call (a catalog that cannot be read decides nothing: the door is tried).
  if ((await clipJobAvailable()) === false) return null;
  try {
    const made = await makeClip(request);
    if (!made.ok) {
      // VF-ROUTE-DERIVE-01: only the Stack's typed answer starts a derivation, once. Home makes the first picture, gates it and resends; it never decides this itself.
      if (isNeedsStartPicture(made.refusal) && actor && body.identity_image && !body.derived_start) {
        const derived = await deriveStartPicture(actor, body, made.refusal);
        onDerived?.(derived);   // kept on the job at once: a hold after this resend never derives a second picture
        const resend = clipRequestFor({ ...body, image: derived, identity_image: undefined, derived_start: true });
        const again = resend ? await makeClip(resend) : null;
        if (!again || !again.ok) throw new StackVideoError(422, "start_picture_failed", START_PICTURE_FAILED_LINE);
        return { job: again.job, done: null, warnings: [], derivedImage: derived };
      }
      return null;   // shape_not_served, level_not_served, too_long, not_on_this_model, not_available ...: the old door decides
    }
    return { job: made.job, done: null, warnings: [] };
  } catch (error) {
    // A Stack older than the door (no such route) or one whose strict request schema does not know a key we send (the live build rejects `wait` with 400 and a raw validation line): the old door decides, and the person never sees the engine's words.
    if (error instanceof StackVideoError && [400, 404, 405, 415, 422].includes(error.status) && !String(error.code).startsWith("start_picture_")) return null;
    throw error;
  }
}
