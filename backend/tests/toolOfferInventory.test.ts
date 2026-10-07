// TOOL-OFFER-01 layer 1, now backed by layer 2's manifest-derived offer.
// Every bundled tool is either in the real derived set or has a visible
// reason why it is not offered; no separate hand-maintained inventory exists.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CATALOG } from "@/lib/modelCatalog";
import { resolveTurnBudget, toolOfferLabel } from "@/lib/turnMachine/budget";

const PACKAGES_DIR = join(import.meta.dir, "..", "packages");
const VIRTUAL_TOOLS = ["start_project"];
interface BundledManifest { id: string; kind: string; args?: unknown; offer?: { mode: string; reason?: string; gate?: string; bench_row?: string }; }
function bundled(): BundledManifest[] {
  return readdirSync(PACKAGES_DIR).filter((d) => existsSync(join(PACKAGES_DIR, d, "manifest.json")))
    .map((d) => JSON.parse(readFileSync(join(PACKAGES_DIR, d, "manifest.json"), "utf-8")) as BundledManifest);
}
const manifests = bundled();
const toolPackages = manifests.filter((m) => m.kind === "plugin");
const chatModels = CATALOG.filter((m) => m.role === "chat");

describe("TOOL-OFFER-01: every model-callable tool is offered or visibly reasoned out", () => {
  test("every chat model has a turn budget", () => {
    expect(chatModels.filter((m) => !m.turn_budget).map((m) => m.id)).toEqual([]);
  });
  test("manifest ids match their package folders", () => {
    const folders = readdirSync(PACKAGES_DIR).filter((d) => existsSync(join(PACKAGES_DIR, d, "manifest.json")));
    expect(manifests.map((m) => m.id).sort()).toEqual(folders.sort());
  });
  test("catalog contains chat models and bundled tool packages", () => {
    expect(chatModels.length).toBeGreaterThanOrEqual(2);
    expect(toolPackages.length).toBeGreaterThan(20);
  });
  for (const model of chatModels) {
    test(`${model.id}: every bundled tool is offered or has a visible reason`, () => {
      const offered = new Set(resolveTurnBudget(model.id, "adult").tools_offered);
      const missing = toolPackages.filter((manifest) => !offered.has(manifest.id)
        && toolOfferLabel(manifest, "enabled", false) === null).map((manifest) => manifest.id);
      expect(missing).toEqual([]);
    });
    test(`${model.id}: derived ids are registered packages or virtual tools`, () => {
      const known = new Set([...toolPackages.map((m) => m.id), ...VIRTUAL_TOOLS]);
      expect(resolveTurnBudget(model.id, "adult").tools_offered.filter((id) => !known.has(id))).toEqual([]);
    });
    test(`${model.id}: projects remain reachable through start_project`, () => {
      if (!manifests.some((m) => m.kind === "project")) return;
      expect(resolveTurnBudget(model.id, "adult").tools_offered).toContain("start_project");
    });
  }
  test("off declarations carry a reason and conditional declarations name their gate and bench row", () => {
    for (const manifest of toolPackages) {
      if (manifest.offer?.mode === "off") expect(manifest.offer.reason?.trim().length ?? 0).toBeGreaterThan(20);
      if (manifest.offer?.mode === "conditional") {
        expect(manifest.offer.gate?.length).toBeGreaterThan(0);
        expect(manifest.offer.bench_row?.length).toBeGreaterThan(0);
      }
    }
  });
});
