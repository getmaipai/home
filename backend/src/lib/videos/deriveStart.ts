// VF-ROUTE-DERIVE-01: the Stack answered a clip request `needs_start_picture` (the serving pack holds a person only through a first picture). Home makes
// that picture through ONE generic `picture` job carrying the typed `identity` input and the scene words, passes it through the finished-item gate
// (gateFinished, RULES.md C5; fails closed) and hands it back to be resent as the clip's `start_picture`. Home decides nothing about the picture: the shape
// and the inputs come from the Stack's answer, no model, size, prompt template or compositing lives here, and nothing is logged but counts and timings.
// The legacy referenceFirstFrame.ts and firstPictureHarmony.ts are not extended by this.
import type { PersonRow } from "@/types";
import { checkImages } from "@/lib/pictures/ageCheck";
import { gateFinished } from "@/lib/pictures/laneGate";
import { fetchPicture, getGenerationJob, makePicture, cancelOrDelete } from "@/lib/pictures/stack";
import { fullViewForJob } from "@/lib/stack/fullView";
import { StackVideoError, type VideoBody } from "./stack";

/** The refusal the Stack answers (spec-v0.1.447): the picture's shape and the inputs to use. */
export interface NeedsStartPicture { code: "needs_start_picture"; line: string; shape: "landscape" | "portrait" | "square"; inputs: string[] }

export const START_PICTURE_WITHHELD_LINE = "I couldn't make a first picture for that video that I can show you, so I didn't make the video. Try asking for it another way.";
export const START_PICTURE_FAILED_LINE = "I couldn't make the first picture for that video. Try again in a few minutes.";
const DERIVE_TIMEOUT_MS = 10 * 60_000;
let derivePollMs = 700;
export function __setDerivePollMsForTests(ms: number | null): void { derivePollMs = ms ?? 700; }

export function isNeedsStartPicture(refusal: { code: string }): refusal is NeedsStartPicture {
  const r = refusal as Partial<NeedsStartPicture>;
  return r.code === "needs_start_picture" && typeof r.shape === "string" && Array.isArray(r.inputs);
}

/** The first picture (base64 png) made from the body's identity picture, or a thrown plain failure. One call is one derivation. */
export async function deriveStartPicture(actor: PersonRow, body: VideoBody, refusal: NeedsStartPicture, isStopped: () => boolean = () => false): Promise<string> {
  const identity = body.identity_image;
  // The Stack names the inputs to use; the only one Home holds is the identity picture. Anything else asked for ends the request plainly.
  if (!identity || refusal.inputs.some((role) => role !== "identity")) throw new StackVideoError(422, "start_picture_failed", START_PICTURE_FAILED_LINE);
  const started = Date.now();
  const made = await makePicture({ job: "picture", audience: "adult", description: body.prompt, shape: refusal.shape, level: "standard", intent: "derived_start", inputs: [{ role: "identity", file: `data:image/png;base64,${identity}` }] });
  if (!made.ok) throw new StackVideoError(422, "start_picture_failed", START_PICTURE_FAILED_LINE);
  const view = fullViewForJob("adult", actor);
  let bytes: Uint8Array | null = null;
  try {
    while (Date.now() - started < DERIVE_TIMEOUT_MS) {
      if (isStopped()) throw new StackVideoError(409, "cancelled", "Stopped.");   // a Stop while the first picture is made ends it: nothing is gated, saved or sent
      const status = await getGenerationJob(made.job, view);
      if (status.state === "failed" || status.state === "cancelled") throw new StackVideoError(422, "start_picture_failed", START_PICTURE_FAILED_LINE);
      if (status.state === "done") {
        const pic = status.data[0];
        if (!pic) throw new StackVideoError(502, "start_picture_failed", START_PICTURE_FAILED_LINE);
        bytes = pic.b64_json ? new Uint8Array(Buffer.from(pic.b64_json, "base64")) : await fetchPicture(made.job, 0, view);
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, derivePollMs));
    }
  } catch (error) {
    void cancelOrDelete(made.job);
    if (error instanceof StackVideoError) throw error;
    throw new StackVideoError(422, "start_picture_failed", START_PICTURE_FAILED_LINE);
  }
  void cancelOrDelete(made.job);
  if (isStopped()) throw new StackVideoError(409, "cancelled", "Stopped.");
  if (!bytes) throw new StackVideoError(422, "start_picture_failed", START_PICTURE_FAILED_LINE);
  // The finished-item gate (the cast's audience: adult-only, fails closed). A withheld picture ends the request; nothing else is tried in its place.
  const checks = await checkImages([bytes], "picture");
  const decision = await gateFinished({ actor, kind: "picture", jobId: made.job, adultOnly: true, checks, images: [bytes] });
  if (decision.action === "withhold") throw new StackVideoError(422, "start_picture_withheld", START_PICTURE_WITHHELD_LINE);
  console.log(`[derive-start] made in ${Date.now() - started} ms, 1 picture`);
  return Buffer.from(bytes).toString("base64");
}
