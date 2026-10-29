import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PackageManifest, type PackageManifest as Manifest } from "@maipai/spec/gen/ts/manifest.js";
import { dataDir } from "@/lib/paths";
import { listPackageIds, loadManifestOnly } from "@/lib/plugins";
import { deleteLook } from "@/lib/companionLook";

function root(): string { return join(process.env.MAIPAI_DATA_DIR || dataDir, "companions"); }
type Companion = NonNullable<Manifest["companion"]>;
export type CompanionAuthor = { display_name: string; person_id?: string };
const ID_PATTERN = /^hc-[a-z0-9]+(?:-[a-z0-9]+)*$/;
function validId(id: string): boolean { return ID_PATTERN.test(id) && id.length <= 40; }
function folder(id: string): string | null { return validId(id) ? join(root(), id) : null; }
/** The on-disk directory for a valid household companion. Bundled companions have no such directory. */
export function householdCompanionFolder(id: string): string | null { return folder(id); }
function read(id: string): Manifest | null {
  const dir = folder(id); if (!dir) return null;
  try {
    const value = PackageManifest.safeParse(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")));
    return value.success && value.data.kind === "companion" && value.data.id === id ? value.data : null;
  } catch { return null; }
}
const fieldLabels: Record<string, string> = {
  display_name: "Name", pronouns: "Pronouns", tagline: "One-line description", backstory: "About", interests: "Interests",
  behavior: "Behavior lines", examples: "Example lines", examples_child: "Child example lines", examples_teen: "Teen example lines",
  examples_adult: "Adult example lines", voice_id: "Voice", look_prompt: "Look prompt", formality: "Formality",
  complexity: "Word choice", engagement: "Questions back", filler_density: "Casual chatter",
  clock_style: "How it says the time", hedging: "How sure it sounds", social: "Humor, warmth and initiative",
};
type WriteResult = { ok: true; value: Manifest } | { ok: false; error: string; fields?: Record<string, string> };
function validationMessage(issue: { code: string; path: PropertyKey[]; minimum?: number | bigint; maximum?: number | bigint; origin?: string; message: string }, manifest: Manifest): { field: string; message: string } | null {
  const field = String(issue.path[issue.path.indexOf("companion") + 1] ?? "");
  const label = fieldLabels[field];
  if (!label) return null;
  const value = manifest.companion?.[field as keyof Companion];
  const tooSmall = issue.code === "too_small";
  const tooBig = issue.code === "too_big";
  const max = typeof issue.maximum === "bigint" ? Number(issue.maximum) : issue.maximum;
  const min = typeof issue.minimum === "bigint" ? Number(issue.minimum) : issue.minimum;
  const itemIndex = issue.path[issue.path.indexOf("companion") + 2];
  let message = `${label} is not valid. Check it and try again.`;
  if (tooSmall && typeof itemIndex === "number" && Array.isArray(value)) message = `${label} can't be empty. Add a few words.`;
  else if (tooBig && typeof itemIndex === "number" && Array.isArray(value)) message = `${label}, line ${itemIndex + 1}: use at most ${max ?? 0} characters.`;
  else if (tooSmall && Array.isArray(value)) message = `${label}: add at least ${min ?? 1}.`;
  else if (tooBig && Array.isArray(value)) message = `${label}: use at most ${max ?? value.length}.`;
  else if (tooSmall && typeof value === "string") message = `${label} can't be empty. Add a few words.`;
  else if (tooBig && typeof value === "string") message = `${label} is too long: use at most ${max ?? value.length} characters (you have ${value.length}).`;
  return { field: field === "display_name" ? "name" : field, message };
}
function write(manifest: Manifest): WriteResult {
  const dir = folder(manifest.id); if (!dir) return { ok: false, error: "That companion ID is not valid." };
  const parsed = PackageManifest.safeParse(manifest);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const item = validationMessage(issue as typeof issue & { minimum?: number; maximum?: number; origin?: string }, manifest);
      if (item && !fields[item.field]) fields[item.field] = item.message;
    }
    const messages = Object.values(fields);
    return { ok: false, error: messages.length ? `${messages.slice(0, 3).join(" ")}` : "The companion is not valid. Check the fields and try again.", ...(messages.length ? { fields } : {}) };
  }
  try {
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `.manifest-${crypto.randomUUID()}.tmp`);
    writeFileSync(tmp, `${JSON.stringify(parsed.data, null, 2)}\n`, { flag: "wx" });
    renameSync(tmp, join(dir, "manifest.json"));
    return { ok: true, value: parsed.data };
  } catch { return { ok: false, error: "The companion could not be saved. Check the household data folder and try again." }; }
}
function slug(name: string): string { return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40).replace(/-+$/g, "") || "companion"; }

export function getHouseholdCompanion(id: string): Manifest | null { return read(id); }
export function householdCompanionAuthorId(id: string): string | null {
  const dir = folder(id); if (!dir) return null;
  try { const value = JSON.parse(readFileSync(join(dir, "owner.json"), "utf8")) as { person_id?: unknown }; return typeof value.person_id === "string" ? value.person_id : null; }
  catch { return null; }
}
export function listHouseholdCompanionIds(): string[] {
  try { return readdirSync(root(), { withFileTypes: true }).filter((entry) => entry.isDirectory() && validId(entry.name) && read(entry.name)).map((entry) => entry.name).sort(); }
  catch { return []; }
}
export function createHouseholdCompanion(input: Companion, author: CompanionAuthor, startingAudience: "adult" | "teen" = "adult"): WriteResult {
  const name = typeof input?.display_name === "string" ? input.display_name.trim() : "";
  if (!name) return { ok: false, error: "Name can't be empty. Add a few words.", fields: { name: "Name can't be empty. Add a few words." } };
  const clean: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(input)) {
    if (typeof raw === "string") { const value = raw.trim(); if (value) clean[key] = value; }
    else if (raw === null) continue;
    else if (Array.isArray(raw)) { const value = raw.map((item) => typeof item === "string" ? item.trim() : item).filter((item) => item !== ""); if (value.length) clean[key] = value; }
    else clean[key] = raw;
  }
  const base = `hc-${slug(name).slice(0, 37).replace(/-+$/g, "")}`;
  const occupied = new Set([...listPackageIds(), ...listHouseholdCompanionIds()]);
  let id = base, suffix = 2;
  while (occupied.has(id)) { const tail = `-${suffix++}`; id = `${base.slice(0, 40 - tail.length).replace(/-+$/g, "")}${tail}`; }
  const companion = Object.assign({ formality: "neutral", complexity: "standard", engagement: "balanced", filler_density: "light" }, clean, { display_name: name, audience: startingAudience, status: "draft" });
  const manifest = { id, version: "0.1.0", kind: "companion", category: "Fun", display: name, description: typeof clean.tagline === "string" ? clean.tagline : "A companion made at home.", author: author.display_name, license: "AGPL-3.0", homepage: "https://github.com/getmaipai/home", companion, incognito: "unaffected", requires: [], optional: [], platforms: ["home", "bot"], min_role: "adult", consequential: false, offline: "full", config: [], notifications: [], backup: "exclude", background: false, contributes: {}, min_app: "0.1.0", tier: 0, quality_scale: "bronze", channel: "stable" } as unknown as Manifest;
  const result = write(manifest);
  if (result.ok && author.person_id) {
    const dir = folder(result.value.id)!;
    writeFileSync(join(dir, "owner.json"), `${JSON.stringify({ person_id: author.person_id })}\n`, { flag: "wx" });
  }
  return result;
}
export function updateHouseholdCompanion(id: string, patch: Partial<Companion>): WriteResult {
  const current = read(id); if (!current?.companion) return { ok: false, error: "That household companion could not be found." };
  const allowed = ["display_name", "pronouns", "tagline", "backstory", "interests", "formality", "complexity", "engagement", "filler_density", "clock_style", "hedging", "social", "behavior", "examples", "examples_child", "examples_teen", "examples_adult", "voice_id", "look_prompt"] as const;
  const fields = Object.fromEntries(allowed.filter((key) => Object.hasOwn(patch, key)).map((key) => [key, patch[key]]));
  return write({ ...current, companion: { ...current.companion, ...fields } });
}
export function deleteHouseholdCompanion(id: string): boolean {
  const dir = folder(id); if (!dir || !read(id)) return false;
  try { deleteLook(id); rmSync(dir, { recursive: true, force: true }); return true; } catch { return false; }
}
export function copyBundledCompanion(bundledId: string, author: CompanionAuthor): { ok: true; value: Manifest } | { ok: false; error: string } {
  const loaded = loadManifestOnly(bundledId);
  if (!loaded.ok || loaded.value.kind !== "companion" || !loaded.value.companion) return { ok: false, error: "That bundled companion could not be found." };
  const source = loaded.value.companion;
  return createHouseholdCompanion({ ...source, display_name: `${source.display_name} (copy)`, audience: "adult", status: "draft", review: undefined }, author);
}
export function copyHouseholdCompanion(sourceId: string, author: CompanionAuthor): { ok: true; value: Manifest } | { ok: false; error: string } {
  const source = read(sourceId)?.companion;
  if (!source) return { ok: false, error: "That household companion could not be found." };
  return createHouseholdCompanion({ ...source, display_name: `${source.display_name} (copy)`, audience: "adult", status: "draft", review: undefined }, author);
}
/** Moves a companion's audience while keeping its all-ages review on record: used only to hold a companion at a stricter audience until its art can be checked, and to put it back. An admin's own change goes through setHouseholdCompanionAudience. */
export function holdHouseholdCompanionAudience(id: string, audience: "adult" | "teen" | "all"): WriteResult {
  const current = read(id); if (!current?.companion) return { ok: false, error: "That household companion could not be found." };
  return write({ ...current, companion: { ...current.companion, audience } });
}
export function setHouseholdCompanionAudience(id: string, audience: "adult" | "teen" | "all", reviewer?: CompanionAuthor): { ok: true; value: Manifest } | { ok: false; error: string } {
  const current = read(id); if (!current?.companion) return { ok: false, error: "That household companion could not be found." };
  if (audience === "all" && !reviewer?.display_name?.trim()) return { ok: false, error: "A reviewer must confirm an all ages companion." };
  const companion = { ...current.companion, audience, ...(audience === "all" ? { review: { confirmed_by: reviewer!.display_name.trim(), confirmed_at: new Date().toISOString() } } : { review: undefined }) };
  return write({ ...current, companion });
}
export function setHouseholdCompanionStatus(id: string, status: NonNullable<Companion["status"]>): { ok: true; value: Manifest } | { ok: false; error: string } {
  const current = read(id); if (!current?.companion) return { ok: false, error: "That household companion could not be found." };
  return write({ ...current, companion: { ...current.companion, status } });
}
export function setHouseholdCompanionAnimation(id: string, animation: Companion["animation"] | null): { ok: true; value: Manifest } | { ok: false; error: string } {
  const current = read(id); if (!current?.companion) return { ok: false, error: "That household companion could not be found." };
  const next = { ...current, companion: { ...current.companion, ...(animation === null ? { animation: undefined } : { animation }) } };
  return write(next);
}
