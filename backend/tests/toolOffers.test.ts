import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { resetDb } from "./reset-db";
import { registerFixtureProjectType } from "./projectTypeFixture";
import { __resetProjectTypesForTests } from "@/lib/projects/projectTypes";
import { db } from "@/db";
import { people } from "@/db/schema";
import { answerImagesAllowed } from "@/lib/answerImages/turn";
import { setValue } from "@/lib/settings";
import { createBenchPeople } from "../scripts/bench/conversationRunner";
import { CATALOG } from "@/lib/modelCatalog";
import { listInstalledManifests } from "@/lib/plugins";
import { PACKAGES_DIR } from "@/lib/paths";
import { START_PROJECT_TOOL_ID, VIRTUAL_TOOL_REGISTRY } from "@/lib/projects/tool";
import { resolveTurnBudget, toolOfferLabel, withTurnToolGates } from "@/lib/turnMachine/budget";

const BASE_TOOL_IDS = ["almanac-date", "almanac-time", "convert", "math", "remember", "remind", START_PROJECT_TOOL_ID, "timer", "weather", "websearch"];

beforeEach(() => { resetDb(); registerFixtureProjectType(); });
afterAll(() => __resetProjectTypesForTests());

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

  test("IMG-OFFER-01: show_images is a conditional offer on the answerImagesAllowed gate and the answer-images bench row", () => {
    const showImages = listInstalledManifests().find((manifest) => manifest.id === "show_images");
    expect(showImages?.offer).toEqual({
      mode: "conditional",
      gate: "answerImagesAllowed",
      bench_row: "answer-images",
      reason: "owner ruling 2026-10-10: on for adults below the 85% recall bar; re-run later, back off if worse",
    });
    expect(toolOfferLabel(showImages!, "enabled")).toBe("not offered: answerImagesAllowed");
  });

  test("house is conditional on its gate and is the first studio shrink candidate", () => {
    const house = VIRTUAL_TOOL_REGISTRY.find((tool) => tool.id === "house")!;
    expect(house.offer).toEqual({ mode: "conditional", gate: "houseAllowed", bench_row: "house-tool", priority: 4 });
    const base = resolveTurnBudget("qwen3-8b-instruct-q4-k-m", "adult");
    const offered = withTurnToolGates(base, false, false, false, false, false, false, false, false, null, false, false, false, false, true);
    expect(offered.tools_offered).toContain("house");
    const cap = withTurnToolGates({ ...base, max_tools: base.tools_offered.length }, false, false, false, false, false, false, false, false, null, false, false, false, false, true);
    expect(cap.tools_offered).not.toContain("house");
  });

  test("IMG-OFFER-01: offerPassesGate offers show_images only where the turn gate passes, and the turn gate passes an adult alone", () => {
    const { owner, child } = createBenchPeople();
    const teen = db.insert(people).values({ ...owner, id: "teen-offer", displayName: "Teen", role: "teen" }).returning().get()!;
    expect(setValue(owner, `person:${child.id}`, "reference.images", true).ok).toBe(true);
    const turn = { surfaceClass: "written" as "written" | "spoken", spoken: false, temporary: false, bare: false, ephemeral: false };
    const offered = (actor: typeof owner, band: "child" | "teen" | "adult", over: Partial<typeof turn> = {}) =>
      withTurnToolGates(resolveTurnBudget("qwen3-8b-instruct-q4-k-m", band), answerImagesAllowed({ actor, band, ...turn, ...over })).tools_offered;
    expect([...offered(owner, "adult")].sort()).toEqual([...BASE_TOOL_IDS, "show_images"].sort());
    // A child's list lacks it, even once a parent turned the child's picture setting on.
    expect(offered(child, "child")).not.toContain("show_images");
    expect(offered(teen, "teen")).not.toContain("show_images");
    // Spoken, temporary, bare and ephemeral adult turns lack it too.
    expect(offered(owner, "adult", { surfaceClass: "spoken", spoken: true })).not.toContain("show_images");
    expect(offered(owner, "adult", { temporary: true })).not.toContain("show_images");
    expect(offered(owner, "adult", { bare: true })).not.toContain("show_images");
    expect(offered(owner, "adult", { ephemeral: true })).not.toContain("show_images");
    // The default resolver never offers it (the gate is closed until a turn passes it).
    expect(resolveTurnBudget("qwen3-8b-instruct-q4-k-m", "adult").tools_offered).not.toContain("show_images");
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

describe("MUSIC-GEN-03: music earns two conditional slots within the sixteen-tool cap", () => {
  test("a ready adult written chat offers sound creation through generate_music at the local Qwen cap", () => {
    const base = resolveTurnBudget("qwen3-8b-instruct-q4-k-m", "adult");
    expect(base.max_tools).toBe(16);
    // The real candidate set is the ten BASE_TOOL_IDS plus show_images, generate_image,
    // generate_video, edit_video, generate_music, edit_music, voiceover, make_film and
    // writing_format (19 total). The 16-tool result removes writing_format, show_images
    // and start_project; it keeps every requested create/edit tool. make_sound is now an
    // alias and does not consume a candidate slot.
    const offered = withTurnToolGates(base, true, true, true, true, true, false, false, true, null, true, false, true, true).tools_offered;
    const music = listInstalledManifests().find((manifest) => manifest.id === "generate_music")!;
    expect((music.args as { properties: { kind: { enum: string[] } } }).properties.kind.enum).toContain("sound");
    expect(offered).toHaveLength(16);
    expect(offered).toEqual(expect.arrayContaining(["generate_music", "edit_music", "edit_video", "make_film", "voiceover", "generate_image", "generate_video"]));
    expect(offered).toEqual(expect.arrayContaining(BASE_TOOL_IDS.filter((id) => id !== START_PROJECT_TOOL_ID)));
    expect(offered).not.toContain("make_sound");
    expect(offered).not.toEqual(expect.arrayContaining(["writing_format", "show_images", START_PROJECT_TOOL_ID]));
  });

  test("generation requires musicAllowed; editing also requires the conversation's made-here state gate", () => {
    const base = resolveTurnBudget("qwen3-8b-instruct-q4-k-m", "adult");
    expect(withTurnToolGates(base, false, false, false, false, true).tools_offered).not.toContain("edit_music");
    const make = withTurnToolGates(base, false, false, false, true, false).tools_offered;
    expect(make).toContain("generate_music"); expect(make).not.toContain("make_sound"); expect(make).not.toContain("edit_music");
    const both = withTurnToolGates(base, true, true, true, true, true).tools_offered;
    expect(both).toContain("generate_music"); expect(both).not.toContain("make_sound"); expect(both).toContain("edit_music");
    expect(both).toHaveLength(15);
  });
  test("the real worst case plus the planned link reader is exactly sixteen, and a seventeenth still throws", () => {
    const base = resolveTurnBudget("qwen3-8b-instruct-q4-k-m", "adult");
    const link = { ...VIRTUAL_TOOL_REGISTRY[0]!, id: "read_link" };
    VIRTUAL_TOOL_REGISTRY.push(link);
    try {
      const full = withTurnToolGates(base, true, true, true, true, true);
      expect(full.tools_offered).toHaveLength(16);
      expect(full.tools_offered).toEqual(expect.arrayContaining([...BASE_TOOL_IDS, "show_images", "generate_image", "generate_video", "generate_music", "edit_music", "read_link"]));
      expect(full.tools_offered).not.toContain("make_sound");
      expect(() => withTurnToolGates({ ...base, max_tools: 15 }, true, true, true, true, true)).toThrow(/exceeds the model cap/);
    } finally { VIRTUAL_TOOL_REGISTRY.pop(); }
  });
  test("VIDEO-CHAT-01: edit_video needs the video gate and a clip; past sixteen the music set shrinks first and the video set stays", () => {
    const base = resolveTurnBudget("qwen3-8b-instruct-q4-k-m", "adult");
    expect(withTurnToolGates(base, true, true, false, true, true, false, false, true).tools_offered).not.toContain("edit_video");
    expect(withTurnToolGates(base, true, true, true, true, true, false, false, false).tools_offered).not.toContain("edit_video");
    const link = { ...VIRTUAL_TOOL_REGISTRY[0]!, id: "read_link" };
    VIRTUAL_TOOL_REGISTRY.push(link);
    try {
      const full = withTurnToolGates(base, true, true, true, true, true, false, false, true).tools_offered;
      expect(full.length).toBeLessThanOrEqual(16);
      expect(full).toEqual(expect.arrayContaining(["generate_video", "edit_video", "generate_music", "read_link"]));
      expect(full).toContain("edit_music");
    } finally { VIRTUAL_TOOL_REGISTRY.pop(); }
  });
  test("FILM-04: make_film counts in the video set and music shrinks first at the cap", () => {
    const base = resolveTurnBudget("qwen3-8b-instruct-q4-k-m", "adult");
    const link = { ...VIRTUAL_TOOL_REGISTRY[0]!, id: "read_link" };
    VIRTUAL_TOOL_REGISTRY.push(link);
    try {
      const full = withTurnToolGates(base, true, true, true, true, true, false, false, true, null, false, false, false, true).tools_offered;
      expect(full).toContain("make_film");
      expect(full).toContain("edit_video");
      expect(full).toContain("generate_video");
      expect(full).toContain("read_link");
      expect(full).not.toContain("make_sound");
      expect(full.length).toBeLessThanOrEqual(16);
    } finally { VIRTUAL_TOOL_REGISTRY.pop(); }
  });
});
