// VIDEO-LORA-09 and -10 (docs/design/video-loras-2026-11-02.md 6.2 to 6.4): which styles a clip is made with. One resolver for every way a style arrives:
// the Create picker and a stored clip (Another take, continue) send ids, a chat tool call sends the names the person said. Both end at a `VideoAdapter` the
// person may use right now (`videoAdaptersFor`, which is `loraAccess`), so a client id is never trusted: a hidden, removed or unknown id answers the same.
// The prompt itself is built by `buildPromptPlan` (promptPlan.ts), the clip's adult-only mark by `usesAdultOnlyStyle` (adultStyle.ts, read again at job start).
import { unlockedFor } from "@/lib/adultLock";
import { speakerAgeBand } from "@/lib/ageBand";
import { loraAccess } from "@/lib/loras/access";
import { listLoraRecords } from "@/lib/loras/store";
import { matchVideoAdapter, loraSurfaceOf, videoAdaptersFor, type VideoAdapter } from "./adapters";
import type { VideoAudience } from "./policy";
import { MAX_STYLES, STYLE_STRENGTHS, type StyleStrength } from "./promptPlan";

export const STYLE_GONE_LINE = "That style isn't available any more. Choose another style, or make the video without one.";
export const STYLE_MIXED_LEVELS_LINE = "These styles were made for different kinds of video, so they can't be used together here. Pick styles made for the same kind, or make the video without one.";
export const STYLE_NOT_AT_LEVEL_LINE = "That style isn't made for this level. Pick another level, or make the video without the style.";
export const STYLES_NEED_MAX_LINE = "Styles are for Max for now. Choose Max, or make the video without a style.";

export type StyleResolution =
  | { ok: true; adapters: VideoAdapter[]; /** Names that matched none (or two) of the person's styles: the clip is made without them and the model says so. */ unmatched: string[] }
  | { ok: false; locked: true } | { ok: false; locked?: false; line: string; code: string };

/** A style strength word as a tool or a form sends it, or undefined (anything else is "not given"). */
export function strengthWord(value: unknown): StyleStrength | undefined {
  const word = typeof value === "string" ? value.trim().toLowerCase() : "";
  return (STYLE_STRENGTHS as readonly string[]).includes(word) ? (word as StyleStrength) : undefined;
}

/** The style names a chat call carries: `styles` (a list, or one string) and the older single `style`. At most MAX_STYLES, trimmed, no empty ones. */
export function styleNamesOf(args: Record<string, unknown>): string[] {
  const raw = Array.isArray(args.styles) ? args.styles : typeof args.styles === "string" ? [args.styles] : [];
  const names = [...raw, ...(typeof args.style === "string" ? [args.style] : [])].filter((n): n is string => typeof n === "string").map((n) => n.trim()).filter((n) => n !== "");
  return [...new Set(names)].slice(0, MAX_STYLES + 1);
}

const norm = (text: string): string => text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * The styles for this call. `ids` come from the Create picker or a stored clip; `names` from a chat call. An adult-only style is the lock's: with no live unlock
 * proof the answer is `locked` (nothing starts), and from chat it is found only by a name the person typed in their own words (`utterance`), never by a guess.
 */
export async function resolveStyles(input: { audience: VideoAudience; ids?: readonly string[]; names?: readonly string[]; utterance?: string }): Promise<StyleResolution> {
  const { audience } = input;
  const ids = [...new Set(input.ids ?? [])];
  const names = input.names ?? [];
  if (ids.length === 0 && names.length === 0) return { ok: true, adapters: [], unmatched: [] };
  const available = await videoAdaptersFor(audience, { includeLocked: true });
  const adapters: VideoAdapter[] = [];
  const unmatched: string[] = [];
  const add = (adapter: VideoAdapter): void => { if (!adapters.some((a) => a.id === adapter.id)) adapters.push(adapter); };
  for (const id of ids) {
    const adapter = available.find((a) => a.id === id);
    // A hidden, removed or unknown id is the same answer: the person is never told which.
    if (!adapter) return { ok: false, line: STYLE_GONE_LINE, code: "style_gone" };
    add(adapter);
  }
  const typed = typeof input.utterance === "string" ? norm(input.utterance) : null;
  for (const name of names) {
    // An adult-only style is offered to the matcher only when the person's own words contain its name.
    const pool = available.filter((a) => a.classification !== "adult-only" || typed === null || typed.includes(norm(a.name)));
    const adapter = matchVideoAdapter(pool, name);
    if (adapter) add(adapter); else unmatched.push(name);
  }
  if (adapters.length > MAX_STYLES) return { ok: false, line: "Two styles at a time is the most. Pick one or two, then try again.", code: "too_many_styles" };
  if (adapters.some((a) => a.classification === "adult-only") && !unlockedFor(audience.actor)) return { ok: false, locked: true };
  return { ok: true, adapters, unmatched };
}

/** The names the chat tool may list to the model for this person: all-ages styles they may use now, names of at most 24 characters, at most `limit` (12), in name
 * order (use is not tracked yet). An adult-only or unknown-audience style is never listed, whatever the lock says (it is found only by a name the person typed);
 * a minor, a guest and a shared or spoken screen get none. Synchronous: it reads the stored records, so the tool description can be built per turn. */
export function listableStyleNames(audience: VideoAudience, limit = 12): string[] {
  const surface = loraSurfaceOf(audience);
  if (audience.spoken || surface !== "own_written" || speakerAgeBand(audience.actor, new Date()) !== "adult") return [];
  const names: string[] = [];
  for (const lora of listLoraRecords()) {
    if (lora.media !== "video" || lora.removed_at !== null || lora.audience !== "all-ages" || lora.base_model === "unknown" || lora.compatible_with.length === 0) continue;
    if (loraAccess(audience.actor, lora, surface) !== "open") continue;
    const name = lora.name.trim();
    if (name !== "" && name.length <= 24) names.push(name);
  }
  return [...new Set(names)].sort((a, b) => a.localeCompare(b)).slice(0, limit);
}
