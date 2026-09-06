// Real `kind: "skill"` packages (2026-09-05): plain instructions,
// Claude-`SKILL.md`-compatible, no permissions, no recipe - composed into
// the chat model's system prompt when relevant to the turn (see
// turnEngine.ts's buildSystemPrompt()), never run on their own the way a
// plugin's recipe does. Distinct from lib/plugins.ts's plugin packages
// (self-contained, permissioned, their own network access via a recipe) -
// see docs/dev.md's "Naming: skill, plugin, command, connector" entry for
// the full research and reasoning behind the split.
//
// Deliberately the smallest possible surface: no host, no permission
// check, no recipe interpreter. A skill's manifest.json can declare
// `permissions` (the schema doesn't forbid it), but nothing here or in
// packageHost.ts ever reads that field for a skill - there is no `Host`
// for a skill to hold in the first place, so a declared permission is
// simply inert, not a bypass. Safe by construction, not by a validation
// rule that could drift from the real enforcement.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PackageManifest } from "@maipai/spec/gen/ts/manifest.js";
import { PACKAGES_DIR, statMtimeMs, isValidPackageId } from "@/lib/paths";

export interface LoadedSkill {
  manifest: PackageManifest;
  /** The instruction text, already stripped of any Claude-format
   * frontmatter - see stripFrontmatter()'s own comment for why. */
  body: string;
}

// A real Claude-format SKILL.md starts with YAML frontmatter
// (`---\n...\n---\n`, typically `name`/`description`). MaiPai's own
// manifest.json is the authoritative metadata regardless (routing,
// category, min_role - fields Claude's format has no equivalent of), so
// frontmatter here is stripped, never parsed. This is what lets an
// unmodified Claude skill file be dropped in with just a sibling
// manifest.json added, not a claim that MaiPai reads Claude's own
// frontmatter fields.
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

function stripFrontmatter(raw: string): string {
  return raw.replace(FRONTMATTER_RE, "").trim();
}

/** Every bundled skill package's id - a directory under `packages/` with
 * a `SKILL.md` file, distinguishing it from a plugin directory (which has
 * `recipe.json` instead) without needing to parse every manifest just to
 * list ids. */
export function listSkillIds(): string[] {
  try {
    return readdirSync(PACKAGES_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(PACKAGES_DIR, e.name, "SKILL.md")))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

// mtime-keyed cache (a latency review, 2026-09-06: loadAllSkills() re-reads
// and re-Zod-validates every bundled skill's manifest.json AND SKILL.md
// every single turn, none of it ever changing between household
// messages) - the same shape and rationale as lib/plugins.ts's
// manifestCache/packageCache: unchanged files return the cached parse for
// free, an edited or reinstalled skill (either file's mtime moves)
// re-reads on its very next read. `statMtimeMs()` lives in lib/paths.ts,
// shared with plugins.ts's identical caches (a code review, 2026-09-06,
// found this file and that one had each written their own copy).
const skillCache = new Map<string, { manifestMtimeMs: number; bodyMtimeMs: number; value: LoadedSkill }>();

export function __resetSkillCacheForTests(): void {
  skillCache.clear();
}

/** Null for anything unloadable (missing files, a manifest that fails
 * validation, or a manifest whose `kind` isn't actually `"skill"` - e.g.
 * a directory that happens to also carry a stray `SKILL.md`) rather than
 * throwing: a skill failing to load should never take a chat turn down,
 * the same "an unloadable package is reported, not fatal" posture
 * lib/plugins.ts's loadPackage() already takes. */
export function loadSkill(id: string): LoadedSkill | null {
  // SEC-2 (code review, 2026-09-06): the same PACKAGES_DIR-traversal
  // guard lib/plugins.ts's loaders and lib/denoHost.ts's callTier1Handle()
  // got - see lib/paths.ts's isValidPackageId() for the full rationale.
  if (!isValidPackageId(id)) return null;
  const manifestPath = join(PACKAGES_DIR, id, "manifest.json");
  const bodyPath = join(PACKAGES_DIR, id, "SKILL.md");
  const manifestMtimeMs = statMtimeMs(manifestPath);
  const bodyMtimeMs = statMtimeMs(bodyPath);
  if (manifestMtimeMs === null || bodyMtimeMs === null) {
    skillCache.delete(id);
    return null;
  }
  const cached = skillCache.get(id);
  if (cached && cached.manifestMtimeMs === manifestMtimeMs && cached.bodyMtimeMs === bodyMtimeMs) return cached.value;

  let manifestJson: unknown, bodyRaw: string;
  try {
    manifestJson = JSON.parse(readFileSync(manifestPath, "utf-8"));
    bodyRaw = readFileSync(bodyPath, "utf-8");
  } catch {
    return null;
  }
  const parsed = PackageManifest.safeParse(manifestJson);
  if (!parsed.success || parsed.data.kind !== "skill") return null;
  const value: LoadedSkill = { manifest: parsed.data, body: stripFrontmatter(bodyRaw) };
  skillCache.set(id, { manifestMtimeMs, bodyMtimeMs, value });
  return value;
}

/** Every loadable skill, sorted by id for the same deterministic-order
 * reason turnEngine.ts's loadAllManifests() already documents (a stable
 * tie-break when more than one skill scores equally against a turn). */
export function loadAllSkills(): LoadedSkill[] {
  return listSkillIds()
    .map(loadSkill)
    .filter((s): s is LoadedSkill => s !== null)
    .sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
}
