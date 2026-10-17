// IMGGEN-LORA-01 (Home half): the household's style (LoRA) library as chat sees it. The Stack owns the files and
// their metadata; Home owns whether the household lets chat use each one (`picture_adapter_prefs`) and who may
// reach which audience (policy.ts). A person who may not use an adapter never sees it listed or matched, so the
// model never gets an id it must not use.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { pictureAdapterPrefs } from "@/db/schema";
import { listLoras, type StackLora } from "./stack";

export type AdapterAudience = "all-ages" | "adult-only";

export interface Adapter extends StackLora {
  enabled: boolean;
}

let cache: { at: number; loras: StackLora[] } | null = null;
const CACHE_MS = 10_000;
export function __resetAdapterCacheForTests(): void { cache = null; }

async function stackLoras(): Promise<StackLora[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.loras;
  try {
    const loras = await listLoras();
    cache = { at: Date.now(), loras };
    return loras;
  } catch {
    return cache?.loras ?? [];
  }
}

export function dropAdapterCache(): void { cache = null; }

function enabledMap(): Map<string, boolean> {
  return new Map(db.select().from(pictureAdapterPrefs).all().map((row) => [row.adapterId, row.enabled]));
}

/** Every adapter in the library with the household's switch (admin view; no audience filtering). */
export async function allAdapters(): Promise<Adapter[]> {
  const [loras, prefs] = [await stackLoras(), enabledMap()];
  return loras.map((lora) => ({ ...lora, enabled: prefs.get(lora.id) !== false }));
}

/** The adapters a person may use now: enabled, and in an audience they hold. */
export async function adaptersFor(audiences: readonly AdapterAudience[]): Promise<Adapter[]> {
  if (audiences.length === 0) return [];
  return (await allAdapters()).filter((a) => a.enabled && audiences.includes(a.classification));
}

export function setAdapterEnabled(id: string, enabled: boolean, by: string): void {
  const now = new Date().toISOString();
  db.insert(pictureAdapterPrefs).values({ adapterId: id, enabled, updatedAt: now, updatedBy: by })
    .onConflictDoUpdate({ target: pictureAdapterPrefs.adapterId, set: { enabled, updatedAt: now, updatedBy: by } }).run();
}

export function forgetAdapterPref(id: string): void {
  db.delete(pictureAdapterPrefs).where(eq(pictureAdapterPrefs.adapterId, id)).run();
}

function norm(text: string): string {
  return text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/** The adapter the person named, or null. Matches the id, the name or a word of it, never guesses between two. */
export function matchAdapter(adapters: readonly Adapter[], named: string): Adapter | null {
  const wanted = norm(named.replace(/\b(my|the|a|an|style|look|lora)\b/gi, " "));
  if (!wanted) return null;
  const exact = adapters.filter((a) => a.id === named.trim() || norm(a.name) === wanted);
  if (exact.length === 1) return exact[0]!;
  // A name too short to mean anything ("A", "!!!") only matches exactly, never by being found inside other words.
  const loose = wanted.length < 3 ? [] : adapters.filter((a) => { const name = norm(a.name); return (name.length >= 3 && (name.includes(wanted) || wanted.includes(name))) || a.trigger_words.some((t) => norm(t) === wanted); });
  return loose.length === 1 ? loose[0]! : null;
}

/** The prompt with the adapter's trigger words added by Home, not by the model reading wording. */
export function withTriggerWords(prompt: string, adapter: Adapter | null): string {
  if (!adapter || adapter.trigger_words.length === 0) return prompt;
  const lower = prompt.toLowerCase();
  const missing = adapter.trigger_words.filter((word) => !lower.includes(word.toLowerCase()));
  return missing.length === 0 ? prompt : `${prompt.trim()}, ${missing.join(", ")}`;
}
