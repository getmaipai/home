// VF-DOOR-01: a plain clip goes through the Stack's generic make door (`POST /stack/v1/jobs/make`, job `clip`) instead of the old
// `/v1/videos/generations` door. Home sends what the person asked for (the level, the shape, the seconds, a start or end picture, the seed, the
// household's quiet window) and the Stack plans the rest: it names the part and the pixel size, never Home (rules E1, E2, E4, E7).
//
// Only the plain path is moved (Max joined it with VF-TAKES-01: a transport move, its holds pinned in videoMaxDoor). A request that carries negative words or a LoRA, a child's or a teen's request (any audience but adult), a
// companion take and every edit (extend, retake, restyle, Ingredients, a reference clip) stay on the old door: their wording and their looks wait on
// the Stack's prompt writer and style ids (docs/design/video-film-pipeline-2026-11-20.md, VF-DOOR-01). The old door is also the fallback when the
// generic one cannot take the clip: the catalog says no part serves it, the planner refuses it, or the Stack is older than the door.
import type { StackMakeClipRequest } from "@/lib/stack/makeShape";
import type { PersonRow } from "@/types";
import { clipCatalog, makeClip, StackVideoError, type StackClip, type StackLoraWarning, type VideoBody } from "./stack";
import { deriveStartPicture, isNeedsStartPicture, START_PICTURE_FAILED_LINE } from "./deriveStart";

/** The way back to the old door for every clip: set MAIPAI_VIDEO_LEGACY_DOOR=1 (a Stack or a part misbehaving on the generic door). */
export const legacyDoorForced = (): boolean => process.env.MAIPAI_VIDEO_LEGACY_DOOR === "1";

/** The generic clip request for a body, or null when the body is not a plain clip (it then stays on the old door). */
/** The keys a Stack built before the catalog listed its request fields (spec before 0.1.450) is known to take on a clip: nothing newer is sent to it. */
export const OLD_CLIP_FIELDS: ReadonlySet<string> = new Set(["job", "audience", "part", "description", "shape", "level", "seconds", "start_picture", "end_picture", "styles", "seed"]);

/**
 * The generic clip request for a body, or null when the body is not a plain clip (it then stays on the old door). `fields` is the Stack's own list of the keys
 * its strict door accepts (undefined: not asked, every key is built; null: the Stack lists none, so it keeps its old contract). A key the clip needs to mean
 * what it says (the identity input, the derived-start intent, the quiet window) that the Stack does not list sends the clip to the old door instead of
 * dropping it; `wait` is only a convenience and is left out.
 */
export function clipRequestFor(body: VideoBody, fields?: ReadonlySet<string> | null): StackMakeClipRequest | null {
  const request = buildClipRequest(body);
  if (!request || fields === undefined) return request;
  const known = fields ?? OLD_CLIP_FIELDS;
  const sent: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(request)) {
    if (known.has(key)) sent[key] = value;
    else if (key !== "wait") return null;
  }
  return sent as unknown as StackMakeClipRequest;
}

function buildClipRequest(body: VideoBody): StackMakeClipRequest | null {
  if (body.audience !== "adult") return null;
  if (body.negative_prompt || (body.loras && body.loras.length > 0)) return null;
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
    ...(body.take_of ? { take_of: body.take_of } : {}),
    // A film shot: the Stack picks the recipe from the operation and the level; Home sends the look, the line and, for another take, the first take's job.
    ...(body.film_shot ? { operation: "clip_film_shot" as const, ...(body.film_shot.look ? { look: body.film_shot.look } : {}), ...(body.film_shot.dialogue?.length ? { dialogue: body.film_shot.dialogue } : {}), ...(body.film_shot.take_of ? { take_of: body.film_shot.take_of } : {}) } : {}),
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
export async function submitVideoViaDoor(body: VideoBody, actor?: PersonRow, onDerived?: (image: string) => void, isStopped?: () => boolean): Promise<{ job: string; done: StackClip[] | null; warnings: StackLoraWarning[]; /** The Stack's one plain line on the route it chose (a film shot says whether it is full HD and why not). */ routeReason?: string | null; derivedImage?: string } | null> {
  if (legacyDoorForced()) return null;
  if (!clipRequestFor(body)) return null;
  // The catalog is asked first so a clip that no part serves does not cost a call (a catalog that cannot be read decides nothing: the door is tried), and
  // so only the keys this Stack lists are sent (a Stack that lists none keeps its old contract).
  const catalog = await clipCatalog();
  if (catalog.available === false) return null;
  const request = clipRequestFor(body, catalog.available === null ? undefined : catalog.fields);
  if (!request) return null;
  try {
    const made = await makeClip(request);
    if (!made.ok) {
      // VF-ROUTE-DERIVE-01: only the Stack's typed answer starts a derivation, once. Home makes the first picture, gates it and resends; it never decides this itself.
      if (isNeedsStartPicture(made.refusal) && actor && body.identity_image && !body.derived_start) {
        const derived = await deriveStartPicture(actor, body, made.refusal, isStopped);
        onDerived?.(derived);   // kept on the job at once: a hold after this resend never derives a second picture
        const resend = clipRequestFor({ ...body, image: derived, derived_start: true }, catalog.available === null ? undefined : catalog.fields);
        // A queue or memory answer is thrown as the old door throws it (the job holds, and the derived picture is already kept); any other failure here ends the request: the picture is never swapped for the old door's start.
        const again = resend ? await makeClip(resend).catch((error: unknown) => { if (error instanceof StackVideoError && ["queue_full", "no_memory", "out_of_memory", "memory_cancelled"].includes(String(error.code))) throw error; throw new StackVideoError(422, "start_picture_failed", START_PICTURE_FAILED_LINE); }) : null;
        if (!again || !again.ok) throw new StackVideoError(422, "start_picture_failed", START_PICTURE_FAILED_LINE);
        return { job: again.job, done: null, warnings: [], derivedImage: derived };
      }
      return null;   // shape_not_served, level_not_served, too_long, not_on_this_model, not_available ...: the old door decides
    }
    return { job: made.job, done: null, warnings: [], ...(made.routeReason ? { routeReason: made.routeReason } : {}) };
  } catch (error) {
    // A Stack older than the door (no such route) or one whose strict request schema does not know a key we send (the live build rejects `wait` with 400 and a raw validation line): the old door decides, and the person never sees the engine's words.
    if (error instanceof StackVideoError && [400, 404, 405, 415, 422].includes(error.status) && !String(error.code).startsWith("start_picture_")) return null;
    throw error;
  }
}

/**
 * VF-TAKES-01: an extend or a retake of a Max clip through the generic door (`operation` extend or retake_from with the clip as the `edit_source` input), or null
 * when the Stack's catalog does not list every key the edit needs (or lists none: an older Stack), the planner refuses it (the pack has no row for the
 * operation, an unreadable input) or the Stack is older than the door: the caller then sends it on the old door exactly as before. Home validates nothing
 * here that it did not validate before (the ranges are the caller's); this only moves the transport.
 */
export async function submitEditViaDoor(edit: { mode: "extend" | "retake"; prompt: string; sourcePath: string; seconds: number; atSeconds?: number }): Promise<{ job: string } | null> {
  if (legacyDoorForced()) return null;
  const catalog = await clipCatalog();
  if (catalog.available !== true || !catalog.fields) return null;
  const request: Record<string, unknown> = {
    job: "clip", audience: "adult", description: edit.prompt, shape: "landscape", level: "max", seconds: edit.seconds,
    operation: edit.mode === "extend" ? "extend" : "retake_from",
    ...(edit.mode === "retake" && edit.atSeconds !== undefined ? { at_seconds: edit.atSeconds } : {}),
    inputs: [{ role: "edit_source", file: edit.sourcePath }], wait: 0,
  };
  for (const key of Object.keys(request)) {
    if (!catalog.fields.has(key)) { if (key === "wait") delete request[key]; else return null; }
  }
  try {
    const made = await makeClip(request as unknown as StackMakeClipRequest);
    return made.ok ? { job: made.job } : null;
  } catch (error) {
    if (error instanceof StackVideoError && [400, 404, 405, 415, 422].includes(error.status)) return null;
    throw error;
  }
}
