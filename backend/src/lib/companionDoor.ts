// VF-COMPANION-RECIPE-01 (Home half; design record docs/design/video-door-remaining-moves-2026-11-20.md, B1): a pack companion take for an ADULT viewer asks the Stack's generic
// make door for the operation `companion_take`. Home sends the state's action in plain words (`description`), the start picture, a loop, the key colour, the frame ("state" or
// "gesture") and the quiet window; the Stack's pack recipe holds the locked-shot wording, the words to avoid and the end-picture choice, and picks the part and the size.
// Where the Stack does not list the keys, a level does not serve it, or the viewer is not an adult, this answers null and the take goes on the old door exactly as before.
import { clipCatalog, makeClip, StackVideoError } from "@/lib/videos/stack";
import type { StackMakeClipRequest } from "@/lib/stack/makeShape";

/** The keys a companion take needs the Stack to list; one missing means the old door (a dropped key would change the take). */
const NEEDED = ["operation", "description", "start_picture", "loop", "key_colour", "take_frame", "audience", "shape", "level", "seconds", "quiet_seconds", "quiet_max_wait_seconds"] as const;
/** Levels asked for in order: the higher one first (the pack clips were made on the best the Stack has), then Standard. The Stack answers level_not_served where it has no row. */
const LEVELS = ["max", "standard"] as const;
export type CompanionFrame = "state" | "gesture";

export interface CompanionDoorPlan {
  /** The size the start picture is fitted to, from the Stack's own catalog for the level asked first. */
  sizeFor(level: (typeof LEVELS)[number]): { width: number; height: number } | null;
  /** One attempt: the first level the Stack serves gets the take. Null: use the old door. A queue or memory answer is thrown as the old door throws it. */
  submit(input: { description: string; picture: (size: { width: number; height: number }) => Promise<string>; keyColour: "green" | "magenta"; frame: CompanionFrame; seconds: number; seed: number; quiet: { quiet_seconds: number; quiet_max_wait_seconds: number } }): Promise<{ job: string; level: (typeof LEVELS)[number] } | null>;
}

export async function planCompanionDoor(): Promise<CompanionDoorPlan | null> {
  if (process.env.MAIPAI_VIDEO_LEGACY_DOOR === "1") return null;
  const catalog = await clipCatalog();
  if (catalog.available !== true || !catalog.fields) return null;
  const fields = catalog.fields;
  if (NEEDED.some((key) => !fields.has(key))) return null;
  const sizeFor = (level: (typeof LEVELS)[number]) => catalog.sizes["landscape"]?.[level] ?? null;
  if (!LEVELS.some((level) => sizeFor(level))) return null;
  return {
    sizeFor,
    async submit(input) {
      for (const level of LEVELS) {
        const size = sizeFor(level);
        if (!size) continue;
        const request = {
          job: "clip", audience: "adult", operation: "companion_take", description: input.description, shape: "landscape", level, seconds: input.seconds, seed: input.seed,
          start_picture: `data:image/png;base64,${await input.picture(size)}`, loop: true, key_colour: input.keyColour, take_frame: input.frame, ...input.quiet, ...(fields.has("wait") ? { wait: 0 } : {}),
        };
        try {
          const made = await makeClip(request as unknown as StackMakeClipRequest);
          if (made.ok) return { job: made.job, level };
          // Not served at this level (or at all): the next level, then the old door. The Stack's typed lines are not shown to anyone.
        } catch (error) {
          if (error instanceof StackVideoError && [400, 404, 405, 415, 422].includes(error.status)) continue;
          throw error;
        }
      }
      return null;
    },
  };
}
