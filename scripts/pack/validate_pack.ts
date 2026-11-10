#!/usr/bin/env bun
// PACK-02: validate a companion pack folder with the PACK-01 checks from @maipai/spec.
//   bun run scripts/pack/validate_pack.ts <pack folder> [more folders]
// Prints each problem, or `OK <id> <bytes>`; exits 1 when any pack has a problem.
// The spec sums every file except *.phone.mp4 twins and build-report.json (the desktop tier) against budget.bytes and 12582912.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

type Pack = Record<string, any>;
export type Files = Record<string, number>;
type Spec = { dir: string; validate: (pack: any, files?: Files) => string[] };

const SPEC_TAG = "spec-spec-v0.1.360";

/** The spec package root: MAIPAI_SPEC_DIR, the pinned @maipai/spec when it has companion-pack, else the commons-tags checkout. */
function specDir(): string {
  const has = (d: string) => existsSync(join(d, "companion", "ts", "validateCompanionPack.ts"));
  const env = process.env.MAIPAI_SPEC_DIR;
  if (env && has(env)) return env;
  try {
    const d = dirname(Bun.resolveSync("@maipai/spec/package.json", import.meta.dir));
    if (has(d)) return d;
  } catch {}
  for (let d = import.meta.dir; dirname(d) !== d; d = dirname(d)) {
    const c = join(d, "commons-tags", SPEC_TAG, "spec");
    if (has(c)) return c;
  }
  throw new Error("Cannot find @maipai/spec with companion-pack: pin spec-v0.1.360 or set MAIPAI_SPEC_DIR to its spec folder.");
}

let cached: Spec | undefined;
export async function loadSpec(): Promise<Spec> {
  if (cached) return cached;
  const dir = specDir();
  const mod = await import(join(dir, "companion", "ts", "validateCompanionPack.ts"));
  return (cached = { dir, validate: mod.validateCompanionPack });
}

/** Schema check with ajv when it can be loaded; the plain-words cross checks always run. */
async function schemaProblems(pack: Pack, spec: Spec): Promise<string[]> {
  let Ajv: any;
  try {
    Ajv = (await import("ajv/dist/2020.js")).default;
  } catch {
    try {
      Ajv = (await import(Bun.resolveSync("ajv/dist/2020.js", join(import.meta.dir, "..", "..", "backend")))).default; // the backend carries ajv
    } catch {
      return [];
    }
  }
  const schema = JSON.parse(readFileSync(join(spec.dir, "schemas", "companion-pack.schema.json"), "utf8"));
  const check = new Ajv({ strict: false, allErrors: true, validateFormats: false }).compile(schema);
  if (check(pack)) return [];
  return (check.errors ?? []).map((e: any) => `schema: ${e.instancePath || "/"} ${e.message}`);
}

/** Every file path the pack names (relative to the pack folder); folders are checked separately. */
export function referencedFiles(pack: Pack): string[] {
  const out: string[] = [pack.rest];
  for (const clips of Object.values<any[]>(pack.states ?? {})) for (const c of clips) out.push(c.file, c.trackFile);
  return out.filter((f): f is string => typeof f === "string");
}

/** The folders the pack names: mouth calm and shout, head, eyes, emotion. */
export function referencedDirs(pack: Pack): string[] {
  const m = pack.mouth ?? {};
  return [m.calm?.dir, m.shout?.dir, pack.head?.dir, pack.eyes?.dir, pack.emotion?.dir].filter((d): d is string => typeof d === "string");
}

export async function validatePack(pack: Pack, files?: Files): Promise<string[]> {
  const spec = await loadSpec();
  return [...(await schemaProblems(pack, spec)), ...spec.validate(pack, files)];
}

function walk(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name), base) : [relative(base, join(dir, e.name))],
  );
}

export async function validatePackDir(dir: string): Promise<{ problems: string[]; bytes: number; id: string }> {
  const pack: Pack = JSON.parse(readFileSync(join(dir, "pack.json"), "utf8"));
  const all = walk(dir);
  const files: Files = {};
  for (const f of all) {
    if (f === "build-report.json") continue; // phone twins stay in: the spec checks they exist and leaves them out of the desktop sum
    files[f] = statSync(join(dir, f)).size;
  }
  const problems = await validatePack(pack, files);
  for (const f of referencedFiles(pack)) if (!existsSync(join(dir, f))) problems.push(`${f} is named in pack.json but is not in the folder; add the file.`);
  for (const d of referencedDirs(pack)) if (!existsSync(join(dir, d, "meta.json"))) problems.push(`${d}/meta.json is missing; add the folder metadata.`);
  for (const f of all) if (f.toLowerCase().endsWith(".webm")) problems.push(`${f} is a WebM file; packs never hold WebM.`);
  if (pack.tile?.phone) {
    for (const clips of Object.values<any[]>(pack.states ?? {})) {
      for (const c of clips) {
        if (!c.phone) problems.push(`${c.id} has no phone clip; pack.json declares a phone tile, so build the phone tier.`);
        else if (!existsSync(join(dir, c.phone))) problems.push(`${c.phone} (phone twin of ${c.file}) is missing; build the phone tier.`);
      }
    }
  }
  for (const side of [pack.head, pack.mouth, pack.emotion]) {
    if (side?.flowEncoding === "int16-deflate" && !all.some((f) => f.endsWith(".z"))) problems.push("flowEncoding is int16-deflate but no .z file exists.");
  }
  const desktop = Object.entries(files).filter(([f]) => !f.endsWith(".phone.mp4")).reduce((a, [, b]) => a + b, 0);
  return { problems, bytes: desktop, id: pack.id };
}

if (import.meta.main) {
  const dirs = process.argv.slice(2).map((d) => resolve(d));
  if (!dirs.length) {
    console.error("Usage: bun run scripts/pack/validate_pack.ts <pack folder> [more folders]");
    process.exit(2);
  }
  let bad = false;
  for (const dir of dirs) {
    try {
      const r = await validatePackDir(dir);
      if (r.problems.length) {
        bad = true;
        for (const p of r.problems) console.log(`PROBLEM ${r.id}: ${p}`);
      } else console.log(`OK ${r.id} ${r.bytes}`);
    } catch (e) {
      bad = true;
      console.log(`PROBLEM ${dir}: ${(e as Error).message}`);
    }
  }
  process.exit(bad ? 1 : 0);
}
