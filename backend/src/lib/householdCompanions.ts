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
function write(manifest: Manifest): { ok: true; value: Manifest } | { ok: false; error: string } {
  const dir = folder(manifest.id); if (!dir) return { ok: false, error: "That companion ID is not valid." };
  const parsed = PackageManifest.safeParse(manifest);
  if (!parsed.success) return { ok: false, error: "One or more companion fields are invalid. Check the values and try again." };
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
export function createHouseholdCompanion(input: Companion, author: CompanionAuthor): { ok: true; value: Manifest } | { ok: false; error: string } {
  const name = typeof input?.display_name === "string" ? input.display_name.trim() : "";
  if (!name) return { ok: false, error: "Add a display name for the companion." };
  const base = `hc-${slug(name).slice(0, 37).replace(/-+$/g, "")}`;
  const occupied = new Set([...listPackageIds(), ...listHouseholdCompanionIds()]);
  let id = base, suffix = 2;
  while (occupied.has(id)) { const tail = `-${suffix++}`; id = `${base.slice(0, 40 - tail.length).replace(/-+$/g, "")}${tail}`; }
  const manifest = { id, version: "0.1.0", kind: "companion", category: "Fun", display: name, description: input.tagline, author: author.display_name, license: "AGPL-3.0", homepage: "https://github.com/getmaipai/home", companion: { ...input, display_name: name, audience: "adult", status: "draft" }, incognito: "unaffected", requires: [], optional: [], platforms: ["home", "bot"], min_role: "adult", consequential: false, offline: "full", config: [], notifications: [], backup: "exclude", background: false, contributes: {}, min_app: "0.1.0", tier: 0, quality_scale: "bronze", channel: "stable" } as Manifest;
  const result = write(manifest);
  if (result.ok && author.person_id) {
    const dir = folder(result.value.id)!;
    writeFileSync(join(dir, "owner.json"), `${JSON.stringify({ person_id: author.person_id })}\n`, { flag: "wx" });
  }
  return result;
}
export function updateHouseholdCompanion(id: string, patch: Partial<Companion>): { ok: true; value: Manifest } | { ok: false; error: string } {
  const current = read(id); if (!current?.companion) return { ok: false, error: "That household companion could not be found." };
  const allowed = ["display_name", "pronouns", "tagline", "backstory", "interests", "formality", "complexity", "engagement", "filler_density", "behavior", "examples", "examples_child", "examples_teen", "examples_adult", "voice_id", "look_prompt"] as const;
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
