// CREATOR-13 (CREATOR-PORT-2026-11-13): the picture presets are `media_template` fragment records read by the one templates reader.
import { beforeEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MediaTemplate } from "@maipai/spec/gen/ts/media-template.js";
import { getFragment, listFragments, listTemplates } from "@/lib/media/templates";
import { composePicturePrompt, pictureFragmentChips, RELIGHT_KEEP } from "@/lib/media/pictureFragments";
import type { PersonRow } from "@/types";
import { generateImageSchema } from "@/lib/mediaOps/chatSchema";
import type { TurnState } from "@/lib/turnMachine/contract";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());
const actor = (role: string) => ({ id: `person-${role}`, role } as PersonRow);
const dir = join(import.meta.dir, "../packages/generate_image/images/templates/fragments");
const bundled = () => readdirSync(dir).filter((n) => n.endsWith(".json")).flatMap((n) => JSON.parse(readFileSync(join(dir, n), "utf8")) as unknown[]);

describe("the bundled preset records", () => {
  test("every record is a valid fragment, ids are unique, and the families have the audited counts", () => {
    const rows = bundled().map((r) => MediaTemplate.parse(r));
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    const count = (g: string) => rows.filter((r) => r.group === g).length;
    expect([count("picture_look"), count("relight"), count("format"), count("angle")]).toEqual([56, 10, 5, 8]);
    for (const r of rows) { expect(r.kind).toBe("fragment"); expect(r.prompt.length).toBeLessThanOrEqual(240); expect(r.prompt).not.toContain("—"); }
  });
  test("a look names its family through its category and no look is typed into code", () => {
    const looks = listFragments({ actor: actor("adult"), group: "picture_look" });
    expect(new Set(looks.map((r) => r.category))).toEqual(new Set(["art", "story", "portrait", "product", "other"]));
  });
});

describe("the one reader", () => {
  test("the template list never returns a fragment, the fragment list never returns a template", () => {
    expect(listTemplates({ actor: actor("adult") }).some((r) => (r.kind as string) === "fragment")).toBe(false);
    expect(listFragments({ actor: actor("adult") }).every((r) => r.kind === "fragment")).toBe(true);
    expect(getFragment("mtpl-lookwatercolour")?.group).toBe("picture_look");
    expect(getFragment("mtpl-productmarble")).toBeNull();
  });
  test("a child and an adult both see every all-ages preset", () => {
    expect(listFragments({ actor: actor("child"), group: "relight" })).toHaveLength(10);
  });
});

describe("composePicturePrompt", () => {
  test("a new picture gets the chosen words after its own, in one place, in a fixed order", () => {
    const out = composePicturePrompt("a fox in the snow", { look: "mtpl-lookwatercolour", light: "mtpl-lightgolden", angle: "mtpl-anglelow" }, { edit: false });
    expect(out.prompt.startsWith("a fox in the snow, ")).toBe(true);
    expect(out.prompt.indexOf("watercolour")).toBeLessThan(out.prompt.indexOf("golden-hour"));
    expect(out.prompt.indexOf("golden-hour")).toBeLessThan(out.prompt.indexOf("from below"));
    expect(out.prompt).not.toContain(RELIGHT_KEEP);
  });
  test("a change keeps the picture's own parts: a light ends with the shared keep sentence", () => {
    const out = composePicturePrompt("", { light: "mtpl-lightleft" }, { edit: true });
    expect(out.prompt.endsWith(RELIGHT_KEEP)).toBe(true);
  });
  test("a format with an aspect sets the shape, one without only adds its words", () => {
    expect(composePicturePrompt("a lake", { format: "mtpl-formatwide169" }, { edit: false }).aspect).toBe("16:9");
    expect(composePicturePrompt("a lake", { format: "mtpl-formatportrait45" }, { edit: false }).aspect).toBeNull();
  });
  test("no choice leaves the words as they were", () => {
    expect(composePicturePrompt("a lake", {}, { edit: false })).toEqual({ prompt: "a lake", aspect: null });
  });
});

describe("pictureFragmentChips", () => {
  test("Look is split by family into chips of at most 24, then Light, Angle and Format, each starting at None", () => {
    const chips = pictureFragmentChips(actor("adult"));
    expect(chips.map((c) => c.id)).toEqual(["look_art", "look_story", "look_portrait", "look_product", "look_other", "light", "angle", "format"]);
    for (const c of chips) { expect(c.default).toBe("none"); expect(c.options[0]).toMatchObject({ value: "none" }); expect(c.options.length - 1).toBeLessThanOrEqual(24); }
    expect(chips.reduce((n, c) => n + c.options.length - 1, 0)).toBe(79);
  });
});

describe("chat's picture tool", () => {
  test("offers one presets object, an enum of record ids per family and nothing longer", () => {
    const { args } = generateImageSchema({ type: "object", properties: {} }, "", { actor: actor("adult") } as unknown as TurnState);
    const presets = (args.properties as Record<string, { properties: Record<string, { enum: string[] }>; description: string }>).presets!;
    expect(Object.keys(presets.properties)).toEqual(["look", "light", "angle", "format"]);
    expect(presets.properties.look!.enum).toHaveLength(56);
    expect(presets.description.length).toBeLessThan(100);
  });
});

describe("the Images Create page", () => {
  test("a person's Create page groups preset chips under Style and keeps their ids in the submit call", async () => {
    const { getAppPage } = await import("@/lib/apps");
    await import("@/lib/imageApp");
    const { owner } = await import("./support/testAuth");
    const { row } = await owner();
    const page = getAppPage(row as PersonRow, "image", "create");
    expect(page.ok).toBe(true);
    const bar = JSON.stringify(page.ok ? page.value : {});
    const node = (JSON.parse(bar).body as Array<Record<string, any>>).find((n) => n.type === "prompt_bar")!;
    const presets = node.chips.filter((c: { state: string }) => !["shape", "count"].includes(c.state));
    expect(presets.every((c: { group: string }) => c.group === "Style")).toBe(true);
    expect(presets.map((c: { state: string }) => c.state)).toEqual(["look_art", "look_story", "look_portrait", "look_product", "look_other", "light", "angle", "format"]);
    expect(node.chips.length).toBeLessThanOrEqual(10);
    expect(presets.every((c: { options: unknown[] }) => c.options.length <= 24)).toBe(true);
    const args = node.submit.call.args as Record<string, unknown>;
    expect(Object.keys(args)).toEqual(presets.map((c: { state: string }) => c.state));
    for (const chip of presets as Array<{ state: string }>) {
      expect(args[chip.state]).toBe(`{${chip.state}}`);
    }
  });
});
