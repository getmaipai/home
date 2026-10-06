#!/usr/bin/env bun
import { readdir, readFile, realpath } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OUTPUT_PATH = join(ROOT, "frontend/src/dev/elements-adoption.json");
type PlanItem = { file: string; name?: string; group?: string; verdict: string; verdictReason?: string; [key: string]: unknown };
export type AdoptionItem = { file: string; name: string; group: string; verdict: string; verdictReason: string; implemented: boolean; reading?: string };

async function filesUnder(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await filesUnder(path));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

export function importedElementNames(source: string): Set<string> {
  const names = new Set<string>();
  const re = /\b(?:from\s*|import\s*(?:\(\s*)?)["']@maipai\/ui\/src\/elements\/([^'"\s?#]+)/g;
  for (const match of source.matchAll(re)) {
    const imported = match[1];
    if (imported) names.add(imported.split("/")[0]!);
  }
  return names;
}

function localSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const re = /\b(?:from\s*|import\s*(?:\(\s*)?)['"](\.[^'"?]+)['"]/g;
  for (const match of source.matchAll(re)) if (match[1]) specifiers.push(match[1]);
  return specifiers;
}

async function resolveLocalModule(from: string, specifier: string): Promise<string | undefined> {
  const base = join(from, "..", specifier);
  for (const candidate of [base, ...[".ts", ".tsx", ".js", ".jsx"].map((ext) => `${base}${ext}`), ...["index.ts", "index.tsx", "index.js", "index.jsx"].map((file) => join(base, file))]) {
    try { if ((await Bun.file(candidate).exists())) return await realpath(candidate); } catch { /* try next candidate */ }
  }
  return undefined;
}

async function threadReachedElements(elementsDir: string): Promise<Set<string>> {
  const thread = join(elementsDir, "thread.aui.tsx");
  // These runtime counterparts are composed inline by Thread rather than imported
  // from their standalone demo files. Keep this list tied to Thread's component names.
  const inlineThreadParts: Record<string, string> = {
    "message-actions": "AssistantActionBar",
    "message-branches": "BranchPicker",
    "edit-message": "EditComposer",
    "scroll-anchor": "ThreadScrollToBottom",
  };
  const reached = new Set<string>();
  const visited = new Set<string>();
  const visit = async (path: string): Promise<void> => {
    let canonical: string;
    try { canonical = await realpath(path); } catch { return; }
    if (visited.has(canonical) || !canonical.startsWith(`${await realpath(elementsDir)}/`)) return;
    visited.add(canonical);
    const rel = relative(elementsDir, canonical).replaceAll("\\", "/");
    if (/\.(?:tsx?|jsx?)$/.test(rel) && !/\.test\./.test(rel)) reached.add(rel.replace(/\.(?:tsx?|jsx?)$/, ""));
    const source = await readFile(canonical, "utf8");
    if (canonical === await realpath(thread)) {
      for (const [name, marker] of Object.entries(inlineThreadParts)) {
        if (new RegExp(`\\b${marker}\\b`).test(source)) reached.add(name);
      }
    }
    await Promise.all(localSpecifiers(source).map(async (specifier) => {
      const target = await resolveLocalModule(canonical, specifier);
      if (target) await visit(target);
    }));
  };
  await visit(thread);
  return reached;
}

export async function scanElements(options: { root?: string; tag?: string } = {}) {
  const root = options.root ?? ROOT;
  const pkgPath = join(root, "frontend/node_modules/@maipai/ui/package.json");
  const packageRoot = join(await realpath(pkgPath), "..");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as { version?: string };
  const elementsDir = join(packageRoot, "src/elements");
  const kitFiles = (await filesUnder(elementsDir))
    .filter((path) => !/\.test\.[^.]+$/.test(path))
    .map((path) => relative(elementsDir, path).replaceAll("\\", "/"))
    .sort();
  const plan = JSON.parse(await readFile(join(root, "frontend/src/dev/elements-plan.json"), "utf8")) as { items: PlanItem[] };
  const planByFile = new Map(plan.items.map((item) => [item.file, item]));
  const sourceDir = join(root, "frontend/src");
  const imported = new Set<string>();
  for (const path of await filesUnder(sourceDir)) {
    if (!/\.(?:tsx?|jsx?)$/.test(path)) continue;
    const rel = relative(sourceDir, path).replaceAll("\\", "/");
    if (rel.startsWith("dev/") || /\.test\.[^.]+$/.test(path)) continue;
    for (const name of importedElementNames(await readFile(path, "utf8"))) imported.add(name);
  }
  if (imported.has("thread.aui") || imported.has("thread")) {
    for (const name of await threadReachedElements(elementsDir)) imported.add(name);
  }
  const items: AdoptionItem[] = kitFiles.map((file) => {
    const planItem = planByFile.get(file);
    const stem = file.replace(/\.[^.]+$/, "");
    const verdictReason = typeof planItem?.verdictReason === "string" ? planItem.verdictReason
      : typeof planItem?.reading === "string" ? planItem.reading
      : `Recorded ${planItem?.verdict ?? "unassessed"} verdict in elements-plan.json; see the plan entry for its dependency or scope.`;
    return {
      file,
      name: planItem?.name ?? stem,
      group: planItem?.group ?? stem.split("-")[0] ?? "other",
      verdict: planItem?.verdict ?? "unassessed",
      verdictReason,
      implemented: imported.has(file) || imported.has(file.replace(/\.[^.]+$/, "")),
      ...(typeof planItem?.reading === "string" ? { reading: planItem.reading } : {}),
    };
  });
  const kitTag = options.tag ?? `ui-v${pkg.version ?? "unknown"}`;
  const planOnly = [...planByFile.keys()].filter((file) => !/\.test\.[^.]+$/.test(file) && !kitFiles.includes(file)).sort();
  return { output: { generatedAt: new Date().toISOString(), kitTag, items }, planOnly };
}

if (import.meta.main) {
  const { output, planOnly } = await scanElements();
  if (process.argv.includes("--status")) {
    console.log(`Elements implemented: ${output.items.filter((item) => item.implemented).length} / ${output.items.length}`);
    process.exit(0);
  }
  await Bun.write(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  if (planOnly.length) console.warn(`Plan files absent from kit (${planOnly.length}): ${planOnly.join(", ")}`);
  const unassessed = output.items.filter((item) => item.verdict === "unassessed");
  console.log(`Scanned ${output.items.length} kit files from ${output.kitTag}; ${output.items.filter((item) => item.implemented).length} in use; ${unassessed.length} unassessed.`);
}
