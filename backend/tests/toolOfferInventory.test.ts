// TOOL-OFFER-01 layer 1: a tool can never silently go missing from what a
// chat model is offered. Every bundled package that exposes a model-callable
// tool (kind "plugin"; a "project" package is reached through the virtual
// start_project tool) must, for each chat model in the catalog, be in the
// model's turn_budget.tools_offered or be named in NOT_OFFERED below with a
// reason. The failure that prompted this: show_images was installed, enabled
// and approved by the age gates but absent from both models' hand-kept
// lists, so the model never saw it and nothing failed.
//
// NOT_OFFERED only shrinks. Adding a package to it needs the owner's word;
// the entry count is pinned, so a new package that is in neither list fails
// by name and cannot be waved through by growing this file. Layer 2 replaces
// the second hand-kept list with a manifest offer declaration.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CATALOG } from "@/lib/modelCatalog";

const PACKAGES_DIR = join(import.meta.dir, "..", "packages");
/** Virtual tools the turn offers that have no package folder (projects/tool.ts). */
const VIRTUAL_TOOLS = ["start_project"];

type Why = "pattern-only" | "deliberate" | "pending";
interface NotOffered {
  why: Why;
  reason: string;
}

const PATTERN_ONLY =
  "Answered by its exact routing pattern before the model runs (nodes/commands.ts); never measured on the ARCH-MEASURE-01 tool-calling bench, so the budget (rule 1: measured, not assumed) does not offer it to the model.";

const pattern = (): NotOffered => ({ why: "pattern-only", reason: PATTERN_ONLY });

/** Shrink-only. The count is pinned below; remove an entry when the package
 * is measured and moves into tools_offered. */
const NOT_OFFERED: Record<string, NotOffered> = {
  "almanac-holiday": pattern(),
  "almanac-moon": pattern(),
  "almanac-onthisday": pattern(),
  currency: pattern(),
  define: pattern(),
  joke: pattern(),
  knowledge: pattern(),
  "lights-off": pattern(),
  "lights-on": pattern(),
  "list-add": pattern(),
  "list-view": pattern(),
  "media-lookup": pattern(),
  music: pattern(),
  news: pattern(),
  sports: pattern(),
  translate: pattern(),
  trivia: pattern(),
  "lock-doors": {
    why: "deliberate",
    reason: "Consequential, teen-and-up action with no turn route; the model is not handed a door lock until a confirm design exists.",
  },
  recall: {
    why: "deliberate",
    reason:
      "Memory reaches the model through context (nodes/context.ts, rule 1); a recall tool is a second implementation of the same retrieval (TOOLSET-01, comment history of modelCatalog.ts).",
  },
  write_document: {
    why: "deliberate",
    reason: "Left out on the DOC-TOOL-01 measurement: re-measured with the rewritten description, three rows stayed at 0/5.",
  },
  show_images: {
    why: "pending",
    reason:
      "Package and age gates exist (ANSWER-IMG-02); turning the tool on is ANSWER-IMG-06, which needs its own architect verdict and bench rows. Remove this entry when it lands.",
  },
};
/** Pinned: the list may only shrink. */
const NOT_OFFERED_MAX = 21;

interface BundledManifest {
  id: string;
  kind: string;
  routing?: { patterns?: string[] };
}

function bundled(): BundledManifest[] {
  return readdirSync(PACKAGES_DIR)
    .filter((d) => existsSync(join(PACKAGES_DIR, d, "manifest.json")))
    .map((d) => JSON.parse(readFileSync(join(PACKAGES_DIR, d, "manifest.json"), "utf-8")) as BundledManifest);
}

const manifests = bundled();
const toolPackages = manifests.filter((m) => m.kind === "plugin");
const allChatModels = CATALOG.filter((m) => m.role === "chat");
const chatModels = allChatModels.filter((m) => m.turn_budget);

describe("TOOL-OFFER-01: every model-callable tool is offered or reasoned out", () => {
  test("every chat model in the catalog has a turn_budget to check", () => {
    expect(allChatModels.filter((m) => !m.turn_budget).map((m) => m.id)).toEqual([]);
  });

  test("a manifest id matches its folder name", () => {
    const folders = readdirSync(PACKAGES_DIR).filter((d) => existsSync(join(PACKAGES_DIR, d, "manifest.json")));
    expect(manifests.map((m) => m.id).sort()).toEqual(folders.sort());
  });

  test("the catalog has chat models and bundled tool packages to check", () => {
    expect(chatModels.length).toBeGreaterThanOrEqual(2);
    expect(toolPackages.length).toBeGreaterThan(20);
  });

  for (const model of chatModels) {
    test(`${model.id}: no tool package is in neither tools_offered nor NOT_OFFERED`, () => {
      const offered = new Set(model.turn_budget!.tools_offered ?? []);
      const missing = toolPackages.map((m) => m.id).filter((id) => !offered.has(id) && !(id in NOT_OFFERED));
      expect(missing).toEqual([]);
    });

    test(`${model.id}: every offered id is a bundled tool package or a virtual tool`, () => {
      const known = new Set([...toolPackages.map((m) => m.id), ...VIRTUAL_TOOLS]);
      const unknown = (model.turn_budget!.tools_offered ?? []).filter((id) => !known.has(id));
      expect(unknown).toEqual([]);
    });

    test(`${model.id}: a tool is never both offered and listed as not offered`, () => {
      const offered = new Set(model.turn_budget!.tools_offered ?? []);
      expect(Object.keys(NOT_OFFERED).filter((id) => offered.has(id))).toEqual([]);
    });

    test(`${model.id}: project packages are reachable because start_project is offered`, () => {
      if (!manifests.some((m) => m.kind === "project")) return;
      expect(model.turn_budget!.tools_offered).toContain("start_project");
    });
  }

  test("NOT_OFFERED names only real tool packages and only shrinks", () => {
    const ids = new Set(toolPackages.map((m) => m.id));
    expect(Object.keys(NOT_OFFERED).filter((id) => !ids.has(id))).toEqual([]);
    expect(Object.keys(NOT_OFFERED).length).toBeLessThanOrEqual(NOT_OFFERED_MAX);
  });

  test("every NOT_OFFERED entry carries a reason, and a pattern-only claim is true of the manifest", () => {
    for (const [id, entry] of Object.entries(NOT_OFFERED)) {
      expect(entry.reason.trim().length).toBeGreaterThan(20);
      if (entry.why === "pattern-only") {
        const m = toolPackages.find((p) => p.id === id)!;
        expect(m.routing?.patterns?.length ?? 0).toBeGreaterThan(0);
      }
    }
  });
});
