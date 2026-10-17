// VIDEO-GEN-04: the household's video LoRA library as chat sees it. The Stack owns the files and their metadata;
// Home owns whether the household lets chat use each one (`video_adapter_prefs`) and who may reach which class
// (policy.ts). A person who may not use a LoRA never sees it listed or matched, so the model never gets an id it
// must not use. Same shape as lib/pictures/adapters.ts, over the video library.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { videoAdapterPrefs } from "@/db/schema";
import { listVideoLoras, type StackVideoLora } from "./stack";

export type VideoAdapterAudience = "all-ages" | "adult-only";

export interface VideoAdapter extends StackVideoLora {
  enabled: boolean;
}

let cache: { at: number; loras: StackVideoLora[] } | null = null;
const CACHE_MS = 10_000;
export function __resetVideoAdapterCacheForTests(): void { cache = null; }

async function stackLoras(): Promise<StackVideoLora[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.loras;
  try {
    const loras = await listVideoLoras();
    cache = { at: Date.now(), loras };
    return loras;
  } catch {
    return cache?.loras ?? [];
  }
}

export function dropVideoAdapterCache(): void { cache = null; }

function enabledMap(): Map<string, boolean> {
  return new Map(db.select().from(videoAdapterPrefs).all().map((row) => [row.adapterId, row.enabled]));
}

/** Every LoRA in the library with the household's switch (admin view; no audience filtering). */
export async function allVideoAdapters(): Promise<VideoAdapter[]> {
  const [loras, prefs] = [await stackLoras(), enabledMap()];
  return loras.map((lora) => ({ ...lora, enabled: prefs.get(lora.id) !== false }));
}

/** The LoRAs a person may use now: enabled, and in a class they hold. */
export async function videoAdaptersFor(audiences: readonly VideoAdapterAudience[]): Promise<VideoAdapter[]> {
  if (audiences.length === 0) return [];
  return (await allVideoAdapters()).filter((a) => a.enabled && audiences.includes(a.classification));
}

export function setVideoAdapterEnabled(id: string, enabled: boolean, by: string): void {
  const now = new Date().toISOString();
  db.insert(videoAdapterPrefs).values({ adapterId: id, enabled, updatedAt: now, updatedBy: by })
    .onConflictDoUpdate({ target: videoAdapterPrefs.adapterId, set: { enabled, updatedAt: now, updatedBy: by } }).run();
}

export function forgetVideoAdapterPref(id: string): void {
  db.delete(videoAdapterPrefs).where(eq(videoAdapterPrefs.adapterId, id)).run();
}

function norm(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** The LoRA the person named (by id, name or trigger word), or null. Never guesses between two. */
export function matchVideoAdapter(adapters: readonly VideoAdapter[], named: string): VideoAdapter | null {
  const wanted = norm(named.replace(/\b(my|the|a|an|style|look|lora)\b/gi, " "));
  if (!wanted) return null;
  const exact = adapters.filter((a) => a.id === named.trim() || norm(a.name) === wanted);
  if (exact.length === 1) return exact[0]!;
  const loose = adapters.filter((a) => norm(a.name).includes(wanted) || wanted.includes(norm(a.name)) || a.trigger_words.some((t) => norm(t) === wanted));
  return loose.length === 1 ? loose[0]! : null;
}

/** The prompt with the LoRA's trigger words added by Home, not by the model reading wording. */
export function withVideoTriggerWords(prompt: string, adapter: VideoAdapter | null): string {
  if (!adapter || adapter.trigger_words.length === 0) return prompt;
  const lower = prompt.toLowerCase();
  const missing = adapter.trigger_words.filter((word) => !lower.includes(word.toLowerCase()));
  return missing.length === 0 ? prompt : `${prompt.trim()}, ${missing.join(", ")}`;
}
