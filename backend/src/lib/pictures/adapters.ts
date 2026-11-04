// IMGGEN-LORA-01 (Home half), moved onto the `Lora` record by VIDEO-LORA-12: the household's style (LoRA) library as chat sees it. The Stack owns the files and
// their facts (hash, size, base model); Home owns the record (lib/loras/store.ts, `media: "picture"`): whether the household lets chat use each one
// (`availability`), whether an admin has confirmed it (the licence acknowledgement) and its age setting. The old `picture_adapter_prefs` rows are folded into
// records by lib/loras/sync.ts. A person who may not use an adapter never sees it listed or matched, so the model never gets an id it must not use.
import { adoptPictureLoras } from "@/lib/loras/sync";
import { deleteLoraRecord, getLoraRecord, saveLora, type Lora } from "@/lib/loras/store";
import { listLoras, type StackLora } from "./stack";

export type AdapterAudience = "all-ages" | "adult-only";

export interface Adapter extends StackLora {
  /** An admin made it usable beyond admins (`availability.who` is adults or people). */
  enabled: boolean;
  /** Added but not yet confirmed by an admin. */
  needs_confirmation: boolean;
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

function adapterOf(stack: StackLora, lora: Lora): Adapter {
  return {
    ...stack, name: lora.name, classification: lora.audience, trigger_words: lora.trigger_words,
    enabled: lora.removed_at === null && lora.availability.who !== "admins", needs_confirmation: lora.licence.acknowledged_by === null,
  };
}

/** Every adapter in the library with the household's switch (admin view; no audience filtering). */
export async function allAdapters(): Promise<Adapter[]> {
  const stack = await stackLoras();
  await adoptPictureLoras(stack);
  const out: Adapter[] = [];
  for (const s of stack) {
    const lora = getLoraRecord(s.id);
    // A file with no valid record is not offered (fail closed).
    if (lora && lora.media === "picture" && lora.removed_at === null) out.push(adapterOf(s, lora));
  }
  return out;
}

/** The adapters a person may use now: enabled, and in an audience they hold. */
export async function adaptersFor(audiences: readonly AdapterAudience[]): Promise<Adapter[]> {
  if (audiences.length === 0) return [];
  return (await allAdapters()).filter((a) => a.enabled && audiences.includes(a.classification));
}

/** An admin turns a style on for adults or back to admins only; turning it on is also the confirmation of a style that was added and not yet read. */
export function setAdapterEnabled(id: string, enabled: boolean, by: string): void {
  const lora = getLoraRecord(id);
  if (!lora || lora.media !== "picture") return;
  const now = new Date().toISOString();
  const confirm = enabled && lora.licence.acknowledged_by === null;
  saveLora({
    ...lora,
    availability: enabled ? (lora.availability.who === "admins" ? { who: "adults", people: [] } : lora.availability) : { who: "admins", people: [] },
    licence: confirm ? { ...lora.licence, acknowledged_by: by, acknowledged_at: now } : lora.licence,
  }, by);
}

/** An admin's change of a style's name, words or age setting (the Stack has the same change). Lowering to all-ages is the admin's explicit choice and is recorded as such. */
export function updatePictureRecord(id: string, patch: { name?: string; trigger_words?: string[]; classification?: "all-ages" | "adult-only" }, by: string): void {
  const lora = getLoraRecord(id);
  if (!lora || lora.media !== "picture") return;
  const now = new Date().toISOString();
  const audience = patch.classification ?? lora.audience;
  saveLora({
    ...lora,
    name: patch.name?.trim().slice(0, 80) || lora.name,
    trigger_words: patch.trigger_words ? patch.trigger_words.map((w) => w.trim()).filter(Boolean).slice(0, 12) : lora.trigger_words,
    audience,
    audience_set_by: audience === "all-ages" ? (audience === lora.audience ? lora.audience_set_by : by) : null,
    audience_set_at: audience === "all-ages" ? (audience === lora.audience ? lora.audience_set_at : now) : null,
  }, by);
}

/** The style left the library with its file: its record goes too. */
export function forgetAdapterPref(id: string): void {
  const lora = getLoraRecord(id);
  if (lora && lora.media === "picture") deleteLoraRecord(id);
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
