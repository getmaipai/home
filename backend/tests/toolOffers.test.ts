import { beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resetDb } from "./reset-db";
import { CATALOG } from "@/lib/modelCatalog";
import { listInstalledManifests } from "@/lib/plugins";
import { PACKAGES_DIR } from "@/lib/paths";
import { START_PROJECT_TOOL_ID, VIRTUAL_TOOL_REGISTRY } from "@/lib/projects/tool";
import { resolveTurnBudget, toolOfferLabel, withTurnToolGates } from "@/lib/turnMachine/budget";

const BASE_TOOL_IDS = ["almanac-date", "almanac-time", "convert", "math", "remember", "remind", START_PROJECT_TOOL_ID, "timer", "weather", "websearch"];

beforeEach(() => resetDb());

describe("TOOL-OFFER-01 manifest-derived tool offers", () => {
  test("every bundled package with args and every virtual tool resolves to a declared or not-measured decision", () => {
    const bundled = readdirSync(PACKAGES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => JSON.parse(readFileSync(join(PACKAGES_DIR, entry.name, "manifest.json"), "utf8")) as { id: string; args?: unknown });
    const manifests = listInstalledManifests();
    for (const raw of bundled.filter((manifest) => manifest.args !== undefined)) {
      const loaded = manifests.find((manifest) => manifest.id === raw.id);
      expect(loaded, `${raw.id} loads`).toBeDefined();
      const decision = loaded?.offer?.mode ?? "not_measured";
      expect(["base", "conditional", "off", "not_measured"]).toContain(decision);
      if (decision === "not_measured") expect(toolOfferLabel(loaded!, "enabled")).toBe("not offered: not measured");
      if (decision === "conditional") {
        expect(loaded?.offer?.gate).toBeTruthy();
        expect(loaded?.offer?.bench_row).toBeTruthy();
      }
      if (decision === "off") expect(loaded?.offer?.reason?.trim().length).toBeGreaterThan(0);
    }
    for (const manifest of manifests) {
      if (manifest.offer?.mode === "off") expect(manifest.offer.reason?.trim().length, `${manifest.id} off reason`).toBeGreaterThan(0);
    }
    for (const tool of VIRTUAL_TOOL_REGISTRY) {
      expect(tool.id).toBeTruthy();
      expect(["base", "conditional", "off"]).toContain(tool.offer.mode);
      if (tool.offer.mode === "conditional") {
        expect(tool.offer.gate).toBeTruthy();
        expect(tool.offer.bench_row).toBeTruthy();
      }
      if (tool.offer.mode === "off") expect(tool.offer.reason?.trim().length).toBeGreaterThan(0);
    }
  });

  test("the derived base set is exactly the ten measured tools; off and unmeasured tools stay out", () => {
    const budget = resolveTurnBudget("qwen3-8b-instruct-q4-k-m", "adult");
    expect([...budget.tools_offered].sort()).toEqual([...BASE_TOOL_IDS].sort());
    expect(budget.tools_offered).not.toContain("show_images");
    expect(budget.tools_offered).not.toContain("write_document");
    expect(budget.tools_offered).not.toContain("recall");
  });

  test("an earned image gate still cannot offer show_images while its policy is off", () => {
    const budget = resolveTurnBudget("qwen3-8b-instruct-q4-k-m", "adult");
    const withImageGate = withTurnToolGates(budget, true);
    const showImages = listInstalledManifests().find((manifest) => manifest.id === "show_images");
    if (showImages?.offer?.mode === "conditional") {
      expect(withImageGate.tools_offered).toContain("show_images");
    } else {
      expect(showImages?.offer).toEqual({ mode: "off", reason: "measured recall below bar" });
      expect(withImageGate.tools_offered).not.toContain("show_images");
    }
  });

  test("every catalog chat model declares a cap of at most sixteen that holds its derived set", () => {
    const chatModels = CATALOG.filter((model) => model.role === "chat" && model.turn_budget);
    expect(chatModels.length).toBeGreaterThan(0);
    for (const model of chatModels) {
      const cap = model.turn_budget!.max_tools;
      expect(cap, `${model.id} max_tools`).toBeDefined();
      expect(cap).toBeGreaterThanOrEqual(0);
      expect(cap).toBeLessThanOrEqual(16);
      const derived = resolveTurnBudget(model.id, "adult").tools_offered;
      expect([...derived].sort()).toEqual([...BASE_TOOL_IDS].sort());
      expect(derived.length).toBeLessThanOrEqual(cap!);
    }
  });

  test("an over-cap offer fails explicitly rather than silently dropping a tool", () => {
    const model = CATALOG.find((entry) => entry.id === "qwen3-8b-instruct-q4-k-m")!;
    const original = model.turn_budget;
    model.turn_budget = { ...original!, max_tools: BASE_TOOL_IDS.length - 1 };
    try {
      expect(() => resolveTurnBudget(model.id, "adult")).toThrow(/exceeds the model cap/);
    } finally {
      model.turn_budget = original;
    }
  });

  test("modelCatalog has no literal package or virtual tool ids", () => {
    const source = readFileSync(join(import.meta.dir, "../src/lib/modelCatalog.ts"), "utf8");
    const ids = [
      ...listInstalledManifests().filter((manifest) => manifest.offer || manifest.args !== undefined).map((manifest) => manifest.id),
      ...VIRTUAL_TOOL_REGISTRY.map((tool) => tool.id),
    ];
    for (const id of ids) expect(source).not.toContain(`"${id}"`);
  });
});
