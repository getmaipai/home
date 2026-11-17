// CREATOR-57b: the one start of "Swap character" on a finished clip: one cast member's likeness replaces the head of the person in the clip. The Swap page's
// action (`POST /api/plugins/video/actions/swap`) calls it; the edit is the chat tool's `edit_video` change `swap`, so the age and surface gate, the lock check,
// the cast resolution and the Max-only rule are written once, in clipEditStart and the edit tool.
import type { PersonRow } from "@/types";
import { startClipEdit, type ClipEditStart } from "./clipEditStart";

export const SWAP_NO_CLIP = "Pick the clip to swap a character in, then try again.";
export const SWAP_NO_CAST = "Pick the cast member to put in the clip, then try again.";
export const SWAP_ONE_PERSON = "Swap one person at a time. Pick one cast member.";

export function startSwap(actor: PersonRow, id: string, asked: { cast?: unknown; from_s?: unknown; seconds?: unknown }): Promise<ClipEditStart> {
  if (!id.trim()) return Promise.resolve({ ok: false, status: 422, error: SWAP_NO_CLIP, code: "no_clip" });
  const cast = (Array.isArray(asked.cast) ? asked.cast : typeof asked.cast === "string" ? [asked.cast] : []).filter((value): value is string => typeof value === "string" && value.trim() !== "" && !/^\{[a-z_]+\}$/.test(value.trim())).map((value) => value.trim());
  if (cast.length === 0) return Promise.resolve({ ok: false, status: 422, error: SWAP_NO_CAST, code: "no_cast" });
  if (cast.length > 1) return Promise.resolve({ ok: false, status: 422, error: SWAP_ONE_PERSON, code: "one_person" });
  const number = (value: unknown): number | undefined => { const n = typeof value === "string" && value.trim() && !/^\{[a-z_]+\}$/.test(value.trim()) ? Number(value) : typeof value === "number" ? value : undefined; return n !== undefined && Number.isFinite(n) ? n : undefined; };
  const from = number(asked.from_s), seconds = number(asked.seconds);
  return startClipEdit(actor, id, { change: "swap", cast, ...(from !== undefined ? { from_s: from } : {}), ...(seconds !== undefined ? { seconds } : {}) }, "I couldn't swap that character. Try again.", "swap_failed");
}
