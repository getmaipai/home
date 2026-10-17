// REG-02: which nonverbal tags the active speech engine honors.
//
// The Stack advertises them as `tts.tags` on the tts role state (and on the
// voice entry). Absent means none: Pocket TTS rejects cues, so an older
// Stack, an engine without the flag, or a Stack that is down all read as
// "no tags", and the composer then inserts nothing nonverbal. The answer is
// cached briefly because the speech route asks once per sentence.
import { getStackClient, isStackConfigured } from "@/lib/stackEngine";
import { normalizeTagList } from "@/lib/voiceCues";

const CACHE_MS = 30_000;
let cached: { at: number; tags: string[] } | null = null;
let override: string[] | null = null;

/** Reads the flag from a role or voice object. Real shape (Stack fb93272):
 * `{ tts: { engine, requested, tags: ["[laugh]", ...], fallback_reason } }`.
 * Also accepts nested `tts.tags`, a flat
 * "tts.tags" key, or `tags`. Anything else is no tags. */
export function readTtsTags(source: unknown): string[] {
  if (!source || typeof source !== "object") return [];
  const obj = source as Record<string, unknown>;
  // The Stack fell back to another engine (Pocket): no tags, whatever else it says.
  if (obj.tts && typeof obj.tts === "object" && (obj.tts as Record<string, unknown>).fallback_reason) return [];
  const nested = obj.tts && typeof obj.tts === "object" ? (obj.tts as Record<string, unknown>).tags : undefined;
  return normalizeTagList(nested ?? obj["tts.tags"] ?? obj.tags);
}

export async function getTtsTags(): Promise<string[]> {
  if (override) return override;
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.tags;
  let tags: string[] = [];
  if (isStackConfigured()) {
    try {
      const { roles } = await getStackClient().roles();
      tags = readTtsTags(roles.find((role) => role.id === "tts"));
    } catch { tags = []; }
  }
  cached = { at: now, tags };
  return tags;
}

/** Test and stub hook: pins the capability until reset with null. */
export function __setTtsTagsForTests(tags: string[] | null): void {
  override = tags === null ? null : normalizeTagList(tags);
  cached = null;
}
