// PACK-06: a companion may carry a pack folder (data/companions/<id>/pack/, layout in scripts/pack/README.md). Validated once per mtime.
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import packSchema from "@maipai/spec/schemas/companion-pack.schema.json";
import { validateCompanionPack } from "@maipai/spec/companion/ts/validateCompanionPack";
import { householdCompanionFolder } from "@/lib/householdCompanions";

export type PackManifest = Record<string, unknown>;
export const PACK_TYPES: Record<string, string> = { ".mp4": "video/mp4", ".webp": "image/webp", ".json": "application/json", ".z": "application/octet-stream" };

function walk(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(dir, e.name), base) : [relative(base, join(dir, e.name))]);
}

let schemaCheck: ReturnType<Ajv2020["compile"]> | null = null;
/** The JSON schema pass: the spec's cross checks alone passed a pack with state names the schema rejects (found on the first real pack), so the maker and the installer run both. */
function schemaProblems(pack: unknown): string[] {
  schemaCheck ??= new Ajv2020({ strict: false, allErrors: true, validateFormats: false }).compile(packSchema as object);
  return schemaCheck(pack) ? [] : (schemaCheck.errors ?? []).map((e) => `schema: ${e.instancePath || "/"} ${e.message}`);
}

/** The plain reasons a pack folder is unusable (empty when it is fine). Mirrors scripts/pack/validate_pack.ts, schema pass included. */
export function packFolderProblems(dir: string, pack: any): string[] {
  const files: Record<string, number> = {};
  const all = walk(dir);
  for (const f of all) if (f !== "build-report.json") files[f] = statSync(join(dir, f)).size;
  const problems = [...validateCompanionPack(pack, files), ...schemaProblems(pack)];
  for (const f of all) if (lstatSync(join(dir, f)).isSymbolicLink()) problems.push(`${f} is a link; packs hold plain files only.`);
  const named = [pack.rest, ...Object.values<any[]>(pack.states ?? {}).flatMap((clips) => clips.flatMap((c) => [c.file, c.trackFile, c.phone]))];
  for (const f of named) if (typeof f === "string" && !existsSync(join(dir, f))) problems.push(`${f} is named in pack.json but is not in the folder; add the file.`);
  for (const f of all) if (f.toLowerCase().endsWith(".webm")) problems.push(`${f} is a WebM file; packs never hold WebM.`);
  return problems;
}

export function packFolder(id: string): string | null {
  const root = householdCompanionFolder(id);
  return root ? join(root, "pack") : null;
}

const cache = new Map<string, { mtime: number; manifest: PackManifest | null }>();

/** The validated manifest of a companion's pack, or null (a failing pack logs its reason once per change). */
export function readCompanionPack(id: string): PackManifest | null {
  const dir = packFolder(id);
  if (!dir || !existsSync(join(dir, "pack.json"))) return null;
  const mtime = Math.max(statSync(join(dir, "pack.json")).mtimeMs, statSync(dir).mtimeMs);
  const hit = cache.get(id);
  if (hit && hit.mtime === mtime) return hit.manifest;
  let manifest: PackManifest | null = null;
  try {
    const pack = JSON.parse(readFileSync(join(dir, "pack.json"), "utf8"));
    const problems = packFolderProblems(dir, pack);
    if (problems.length) console.warn(`Companion ${id} pack is not used: ${problems.slice(0, 3).join(" ")}`);
    else manifest = pack;
  } catch (error) {
    console.warn(`Companion ${id} pack is not used: pack.json could not be read (${(error as Error).message}); rebuild the pack.`);
  }
  cache.set(id, { mtime, manifest });
  return manifest;
}

/** A path inside the pack folder, or null when it escapes it or is not a file. */
export function packFile(id: string, rel: string): string | null {
  const dir = packFolder(id);
  if (!dir || !rel || rel.includes("\0")) return null;
  const path = resolve(dir, rel);
  if (!path.startsWith(resolve(dir) + sep) || !existsSync(path) || lstatSync(path).isSymbolicLink() || !statSync(path).isFile()) return null;
  try { if (!realpathSync(path).startsWith(realpathSync(dir) + sep)) return null; } catch { return null; }
  return path;
}
