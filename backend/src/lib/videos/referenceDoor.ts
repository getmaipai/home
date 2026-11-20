// VF-REFCLIP-01 (Home half; design record docs/design/video-door-remaining-moves-2026-11-20.md, B3): the final clip of a reference video made from a COMPOSED FIRST PICTURE (the first-frame
// route) asks the Stack's generic door for `operation: reference_clip` (adult, Max only): the composed picture is the start picture and the people's own pictures ride as `identity`
// inputs. The Stack plans the route, picks the part and the size; Home names no model. The composed picture goes through Home's finished-item gate (`gateFinished`, fails closed) before it
// is sent: the legacy composition skipped it (the gap this move closes). Lands DARK (shadow-first): the door is used only when MAIPAI_REFERENCE_DOOR=1, until a real run has been
// judged; the sheet route (Ingredients) and everything else stay on the old door. Null: the caller sends the old request exactly as before.
import type { PersonRow } from "@/types";
import { checkImages } from "@/lib/pictures/ageCheck";
import { gateFinished } from "@/lib/pictures/laneGate";
import type { StackMakeClipRequest } from "@/lib/stack/makeShape";
import { clipCatalog, makeClip, StackVideoError } from "./stack";

export const REFERENCE_PICTURE_WITHHELD_LINE = "I couldn't make a first picture for that video that I can show you, so I didn't make the video. Try different pictures.";
export const referenceDoorOn = (): boolean => process.env.MAIPAI_REFERENCE_DOOR === "1" && process.env.MAIPAI_VIDEO_LEGACY_DOOR !== "1";

/** The numbers the Stack's pack advertises for the reference clip (`reference_clip.seconds.min=4`, ...), or null when it advertises none. */
function advertisedSeconds(fields: ReadonlySet<string>): { min: number; max: number } | null {
  const read = (key: string): number | null => { for (const field of fields) if (field.startsWith(`${key}=`)) { const n = Number(field.slice(key.length + 1)); return Number.isFinite(n) ? n : null; } return null; };
  const min = read("reference_clip.seconds.min"), max = read("reference_clip.seconds.max");
  return min !== null && max !== null ? { min, max } : null;
}

export interface ReferenceDoorInput {
  actor: PersonRow;
  description: string;
  /** Fits the composed first picture (png bytes) to the size the Stack serves; returns the base64 png that is sent. */
  startPicture: (size: { width: number; height: number }) => Promise<{ base64: string; raw: Uint8Array }>;
  /** The people's own pictures (base64 png or jpeg), one entry per picture. */
  identity: string[];
  seconds: number;
  seed: number | null;
  signal?: AbortSignal;
}

export async function submitReferenceViaDoor(input: ReferenceDoorInput): Promise<{ job: string } | null> {
  if (!referenceDoorOn() || input.identity.length === 0) return null;
  const catalog = await clipCatalog();
  if (catalog.available !== true || !catalog.fields) return null;
  const fields = catalog.fields;
  if (!["operation", "description", "start_picture", "inputs", "shape", "level", "seconds", "audience", "inputs.role.identity"].every((key) => fields.has(key))) return null;
  if (input.seed !== null && !fields.has("seed")) return null;
  const range = advertisedSeconds(fields);
  if (!range || input.seconds < range.min || input.seconds > range.max) return null;
  const size = catalog.sizes["landscape"]?.["max"];
  if (!size) return null;
  const picture = await input.startPicture(size);
  // The finished-item gate on the composed picture (rule C5), adult-only, failing closed: a withheld picture ends the request with the plain line and nothing is sent.
  const checks = await checkImages([picture.raw], "picture");
  const decision = await gateFinished({ actor: input.actor, kind: "picture", jobId: "reference-first-picture", adultOnly: true, checks, images: [picture.raw] });
  if (decision.action === "withhold") throw new StackVideoError(422, "start_picture_withheld", REFERENCE_PICTURE_WITHHELD_LINE);
  const request = {
    job: "clip", operation: "reference_clip", audience: "adult", description: input.description, shape: "landscape", level: "max", seconds: input.seconds, ...(input.seed !== null ? { seed: input.seed } : {}),
    start_picture: `data:image/png;base64,${picture.base64}`, inputs: input.identity.map((file) => ({ role: "identity", file: `data:image/png;base64,${file}` })), ...(fields.has("wait") ? { wait: 0 } : {}),
  };
  try {
    const made = await makeClip(request as unknown as StackMakeClipRequest);
    return made.ok ? { job: made.job } : null;
  } catch (error) {
    if (error instanceof StackVideoError && [400, 404, 405, 415, 422].includes(error.status) && error.code !== "start_picture_withheld") return null;
    throw error;
  }
}
