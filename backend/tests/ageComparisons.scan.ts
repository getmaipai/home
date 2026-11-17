import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const EXEMPT_FILES = new Set([
  "backend/src/lib/audience.ts", "backend/src/lib/ageBand.ts", "backend/src/lib/turnContext.ts",
  "backend/src/lib/contentPolicy.ts", "backend/src/lib/contentCeiling.ts", "backend/src/lib/safety.ts",
  "backend/src/lib/grants.ts", "backend/src/lib/access.ts", "backend/src/lib/childDisclosure.ts",
  "frontend/src/lib/audience.ts",
]);
const EXEMPT_PREFIXES = ["backend/src/lib/contentPolicy/", "backend/src/lib/filter/", "backend/src/lib/gate/"];
const PATTERNS = [
  /\b(role|band|age_band|ageBand|controls)\b\s*(===|!==|==|!=)\s*["'](child|teen|adult|guest)["']/g,
  /["'](child|teen|adult|guest)["']\s*(===|!==|==|!=)\s*[\w.]*\b(role|band|age_band|ageBand|controls)\b/g,
  /\[\s*["']child["']\s*,\s*["']teen["']\s*\]\.includes\(/g,
];
const CASE_PATTERN = /\bcase\s+["'](child|teen)["']\s*:/g;

export interface AgeComparison { file: string; line: number; text: string }

export function scanSource(file: string, source: string): AgeComparison[] {
  const normalized = file.split(sep).join("/");
  if (EXEMPT_FILES.has(normalized) || EXEMPT_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return [];
  const importsAgeBand = (source.match(/\bimport\b[\s\S]*?\bfrom\s*["'][^"']+["']/g) ?? [])
    .some((statement) => /\b(?:AgeBand|speakerAgeBand|audienceBand)\b/.test(statement));
  const found: AgeComparison[] = [];
  source.split(/\r?\n/).forEach((text, index) => {
    const patterns = importsAgeBand ? [...PATTERNS, CASE_PATTERN] : PATTERNS;
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) found.push({ file: normalized, line: index + 1, text });
    }
  });
  return found;
}

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !path.split(sep).includes("__tests__") ? [path] : [];
  });
}

export function scanTree(repoRoot: string): AgeComparison[] {
  const roots = [join(repoRoot, "backend/src"), join(repoRoot, "frontend/src")];
  return roots.flatMap((root) => walk(root)
    .filter((path) => !(path.includes(`${sep}frontend${sep}src${sep}dev${sep}`)))
    .flatMap((path) => scanSource(relative(repoRoot, path), readFileSync(path, "utf8"))));
}

export function countsByFile(comparisons: readonly AgeComparison[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of comparisons) counts[item.file] = (counts[item.file] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}
