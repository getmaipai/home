import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

export type TypeCategory = "fontSize" | "radius" | "iconImport" | "inlineSvg";
export type TypeBaseline = Record<TypeCategory, Record<string, number>>;
export type TypeFinding = { file: string; category: TypeCategory; count: number; patterns: string[] };

const TOKEN_FILES = new Set(["shell/tokens.css", "shell/pages/settings/settingsTokens.css"]);
const BASELINE_PATH = join(import.meta.dir, "type-lint-baseline.json");
const CATEGORIES: TypeCategory[] = ["fontSize", "radius", "iconImport", "inlineSvg"];

function sourceFiles(root: string, dir = root): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(root, path);
    return /\.(?:css|tsx?|jsx?)$/.test(entry.name) ? [path] : [];
  });
}

function countMatches(source: string, regex: RegExp): string[] {
  regex.lastIndex = 0;
  return [...source.matchAll(regex)].map((match) => match[0]);
}

const FONT_UTILITY = /\btext-(?:xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl)\b|\btext-\[\d+(?:\.\d+)?(?:px|rem)\]/g;
const RADIUS_UTILITY = /\brounded(?:-[a-z]+)?-\[\d+(?:\.\d+)?(?:px|rem)\]/g;
const CSS_FONT = /font-size\s*:\s*\d/gi;
const CSS_RADIUS = /border-radius\s*:\s*\d/gi;
const ICON_IMPORT = /\bfrom\s*["'](?:lucide-react|@tabler\/[^"']+|react-icons(?:\/[^"']*)?|heroicons(?:\/[^"']*)?)["']/g;
const INLINE_SVG = /<svg\b/g;

export function typeFindings(srcRoot: string, fixtures?: Record<string, string>): TypeFinding[] {
  const sources = fixtures ?? Object.fromEntries(sourceFiles(srcRoot).map((path) => [relative(srcRoot, path), readFileSync(path, "utf8")]));
  const found: TypeFinding[] = [];
  for (const [file, source] of Object.entries(sources)) {
    if (!fixtures && (TOKEN_FILES.has(file) || /\.test\.[jt]sx?$/.test(file))) continue;
    const categories: Array<[TypeCategory, string[]]> = [
      ["fontSize", [...countMatches(source, FONT_UTILITY), ...countMatches(source, CSS_FONT)]],
      ["radius", [...countMatches(source, RADIUS_UTILITY), ...countMatches(source, CSS_RADIUS)]],
      ["iconImport", countMatches(source, ICON_IMPORT)],
      ["inlineSvg", /\.tsx$/.test(file) ? countMatches(source, INLINE_SVG) : []],
    ];
    for (const [category, patterns] of categories) if (patterns.length) found.push({ file, category, count: patterns.length, patterns });
  }
  return found;
}

export function baselineProblems(findings: TypeFinding[], baseline: Partial<TypeBaseline>): string[] {
  const measured: TypeBaseline = { fontSize: {}, radius: {}, iconImport: {}, inlineSvg: {} };
  for (const finding of findings) measured[finding.category][finding.file] = finding.count;
  const problems: string[] = [];
  for (const category of CATEGORIES) {
    const prior = baseline[category] ?? {};
    for (const [file, count] of Object.entries(measured[category])) {
      if (prior[file] === undefined) problems.push(`${category} ${file}: new finding(s) (${count}); replace literals with PRO-LOOK type-scale token classes or add a baseline only after review`);
      else if (count > prior[file]) problems.push(`${category} ${file}: grew from ${prior[file]} to ${count}; replace the literal with a PRO-LOOK type-scale token class`);
    }
    for (const [file, count] of Object.entries(prior)) {
      const actual = measured[category][file] ?? 0;
      if (actual < count) problems.push(`${category} ${file}: baseline is stale (${count}, measured ${actual}); lower the baseline number`);
    }
  }
  return problems;
}

if (process.argv.includes("--write-baseline")) {
  const root = join(import.meta.dir, "..");
  const baseline: TypeBaseline = { fontSize: {}, radius: {}, iconImport: {}, inlineSvg: {} };
  for (const finding of typeFindings(root)) baseline[finding.category][finding.file] = finding.count;
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
}
