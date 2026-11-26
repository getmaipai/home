// IMGGEN-LORA-01 (Home half), rebuilt by STACK-LORAS-01 slice 4: the household's picture style (LoRA) library as chat sees it. The Stack holds the library and
// every fact of it (`/stack/v1/loras`, read into a short snapshot by lib/loras/stackLibrary.ts); Home keeps no record. Whether chat may use one is
// `availability.who` on the Stack's record, and its age setting is the Stack's `classification`. A person who may not use an adapter never sees it listed or
// matched, so the model never gets an id it must not use. A style whose drive is not connected (`drive_missing`) is not offered.
import { callStack, dropLoraSnapshot, getLoraRecord, listLoraRecords, refreshLoras, stackViewOf, type Lora } from "@/lib/loras/stackLibrary";
import type { StackLora } from "./stack";

export type AdapterAudience = "all-ages" | "adult-only";

export interface Adapter extends StackLora {
  /** An admin made it usable beyond admins (`availability.who` is adults or people), and its file can be read now. */
  enabled: boolean;
  /** Always false: the one licence accept at the Stack replaced the per-style confirmation. Kept so the admin payload keeps its shape. */
  needs_confirmation: boolean;
}
export function __resetAdapterCacheForTests(): void { dropLoraSnapshot(); }
export function dropAdapterCache(): void { dropLoraSnapshot(); }

function adapterOf(lora: Lora): Adapter {
  const view = stackViewOf(lora.id);
  return {
    id: lora.id, name: lora.name, sha256: lora.file.sha256, bytes: lora.file.bytes, base_model: view?.base_model ?? lora.base_model, licence: view?.licence ?? lora.licence.id, source_url: lora.source.url,
    classification: lora.audience, classification_note: null, trigger_words: lora.trigger_words, strength_default: lora.strength.default, added_by: lora.added_by, added_at: lora.added_at,
    enabled: lora.removed_at === null && lora.status !== "drive_missing" && lora.availability.who !== "admins", needs_confirmation: false,
  };
}

/** Every picture adapter in the library with the household's switch (admin view; no audience filtering). Empty when the Stack cannot be read: fail closed. */
export async function allAdapters(): Promise<Adapter[]> {
  await refreshLoras();
  return listLoraRecords().filter((lora) => lora.media === "picture" && lora.removed_at === null).sort((a, b) => a.added_at.localeCompare(b.added_at) || a.id.localeCompare(b.id)).map(adapterOf);
}

/** The adapters a person may use now: enabled, and in an audience they hold. */
export async function adaptersFor(audiences: readonly AdapterAudience[]): Promise<Adapter[]> {
  if (audiences.length === 0) return [];
  return (await allAdapters()).filter((a) => a.enabled && audiences.includes(a.classification));
}

/** An admin turns a style on for adults or back to admins only (`availability.who` on the Stack's record). */
export async function setAdapterEnabled(id: string, enabled: boolean, _by: string): Promise<void> {
  await refreshLoras();
  const lora = getLoraRecord(id);
  if (!lora || lora.media !== "picture") return;
  const who = enabled ? (lora.availability.who === "admins" ? "adults" : lora.availability.who) : "admins";
  await callStack("PATCH", `/stack/v1/loras/${encodeURIComponent(id)}`, { availability_who: who });
  await refreshLoras(true);
}

/** The style left the library with its file: the Stack removed its record with it, so Home only drops what it read. */
export function forgetAdapterPref(_id: string): void {
  dropLoraSnapshot();
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
