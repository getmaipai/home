#!/usr/bin/env bun
import { readdir, readFile, realpath } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OUTPUT_PATH = join(ROOT, "frontend/src/dev/elements-adoption.json");
type PlanItem = { file: string; name?: string; group?: string; verdict: string; verdictReason?: string; [key: string]: unknown };
export type AdoptionItem = { file: string; name: string; group: string; verdict: string; verdictReason: string; implemented: boolean; reading?: string };
export type AdoptionInventory = { generatedAt?: string; kitTag: string; items: AdoptionItem[] };

export function sameAdoptionInventory(expected: AdoptionInventory, actual: AdoptionInventory): boolean {
  return JSON.stringify({ kitTag: actual.kitTag, items: actual.items }) === JSON.stringify({ kitTag: expected.kitTag, items: expected.items });
}

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


/** A kit pin that brings new files must not turn main red: each unassessed file gets a default verdict ("later", or "no-fit" for documentation), named as automatic so its owner can assess it properly later. */
export function autofillPlanItems(unassessed: Array<{ file: string; group?: string; name?: string }>, kitTag: string): PlanItem[] {
  return unassessed.map((item) => {
    const doc = /\.(?:md|mdx|txt|json|css|snap)$/.test(item.file);
    return {
      file: item.file,
      name: item.name ?? item.file.replace(/\.[^.]+$/, ""),
      group: item.group ?? item.file.split(/[-/]/)[0] ?? "other",
      verdict: doc ? "no-fit" : "later",
      verdictReason: doc
        ? `Not an Element: kit documentation or data added in ${kitTag} (verdict set automatically by the pin).`
        : `New in ${kitTag}; not drawn by a Home page yet (verdict "later" set automatically by the pin); assess and wire it when a page uses it.`,
      backendNeeded: null, effort: null, specTagNeeded: false, newDependency: false, bindings: [], size: "S", showcaseScenario: null, batch: null, replacesHandBuilt: [], realTurnToday: null,
    };
  });
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
  if (process.argv.includes("--check")) {
    const current = await Bun.file(OUTPUT_PATH).json().catch(() => null) as AdoptionInventory | null;
    if (!current || !sameAdoptionInventory(output, current)) {
      console.error("elements-adoption.json is stale; run 'bun run elements:scan' and commit the generated file.");
      process.exit(1);
    }
    console.log(`Elements adoption inventory is current for ${output.kitTag}.`);
    process.exit(0);
  }
  if (process.argv.includes("--status")) {
    console.log(`Elements implemented: ${output.items.filter((item) => item.implemented).length} / ${output.items.length}`);
    process.exit(0);
  }
  if (process.argv.includes("--autofill-later")) {
    const missing = output.items.filter((item) => item.verdict === "unassessed");
    if (missing.length) {
      const planPath = join(ROOT, "frontend/src/dev/elements-plan.json");
      const plan = JSON.parse(await readFile(planPath, "utf8")) as { items: PlanItem[] };
      const have = new Set(plan.items.map((item) => item.file));
      plan.items.push(...autofillPlanItems(missing.filter((item) => !have.has(item.file)), output.kitTag));
      await Bun.write(planPath, `${JSON.stringify(plan, null, 2)}\n`);
      console.log(`Added a default verdict for ${missing.length} new kit file(s): ${missing.map((item) => item.file).join(", ")}`);
      const again = await scanElements();
      await Bun.write(OUTPUT_PATH, `${JSON.stringify(again.output, null, 2)}\n`);
      console.log(`Scanned ${again.output.items.length} kit files from ${again.output.kitTag}; ${again.output.items.filter((item) => item.verdict === "unassessed").length} unassessed.`);
      process.exit(0);
    }
  }
  const existing = await Bun.file(OUTPUT_PATH).json().catch(() => null) as AdoptionInventory | null;
  if (!existing || !sameAdoptionInventory(output, existing)) await Bun.write(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  if (planOnly.length) console.warn(`Plan files absent from kit (${planOnly.length}): ${planOnly.join(", ")}`);
  const unassessed = output.items.filter((item) => item.verdict === "unassessed");
  console.log(`Scanned ${output.items.length} kit files from ${output.kitTag}; ${output.items.filter((item) => item.implemented).length} in use; ${unassessed.length} unassessed.`);
}
