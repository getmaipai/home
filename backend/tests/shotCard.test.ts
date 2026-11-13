import { describe, expect, test } from "bun:test";
import { MediaTemplate } from "@maipai/spec/gen/ts/media-template.js";
import { listFragments, listTemplates } from "@/lib/media/templates";
import { composeShotPrompt, sameShotFourLights, validatePalette, type ShotCard } from "@/lib/media/shotCard";
import type { PersonRow } from "@/types";

const actor = { id: "person-adult", role: "adult" } as PersonRow;
const groupCounts = [["camera", 7], ["lens", 4], ["focal", 6], ["aperture", 4], ["framing", 9], ["light", 9], ["film_stock", 6], ["look", 8], ["grade", 7]] as const;

describe("shot card data", () => {
  test("all groups have the requested counts and records pass the media template schema", () => {
    for (const [group, count] of groupCounts) {
      const rows = listFragments({ actor, group });
      expect(rows).toHaveLength(count);
      for (const row of rows) expect(MediaTemplate.safeParse(row).success).toBe(true);
    }
    const starters = listTemplates({ actor, kind: "video" });
    expect(starters).toHaveLength(6);
    for (const row of starters) expect(MediaTemplate.safeParse(row).success).toBe(true);
    expect(listTemplates({ actor, kind: "picture" }).every((row) => row.kind === "picture")).toBe(true);
    expect(listFragments({ actor, group: "picture_look" })).toHaveLength(56);
  });
});

describe("composeShotPrompt", () => {
  test("joins the person's words and vocabulary in a stable order", () => {
    const card: ShotCard = {
      subject: "a child flying a kite", action: "runs across a field", framing: "mtpl-shotframingwide",
      camera: "mtpl-shotcameralockedtripod", lens: "mtpl-shotlensprime", focal: "mtpl-shotfocal35mm",
      aperture: "mtpl-shotaperturewideopen", light: "mtpl-shotlightwindow", film_stock: "mtpl-shotfilmstockwarm",
      look: "mtpl-shotlooknatural", grade: "mtpl-shotgradewarm", palette: ["#aabbcc", "#112233"],
    };
    const out = composeShotPrompt(card);
    const ordered = ["a child flying a kite", "runs across a field", "a wide shot", "tripod", "prime", "35 mm", "wide aperture", "window", "film grain with warm", "natural", "warm colour grade", "colour palette"];
    let prior = -1;
    for (const phrase of ordered) { const at = out.prompt.indexOf(phrase, prior + 1); expect(at).toBeGreaterThan(prior); prior = at; }
    expect(out.used).toHaveLength(9);
    expect(out.unknown).toEqual([]);
    expect(out.prompt).toContain("colour palette: #aabbcc, #112233");
  });
  test("skips and reports unknown and wrong-group ids", () => {
    const out = composeShotPrompt({ camera: "mtpl-shotlightwindow", lens: "missing" });
    expect(out.unknown).toEqual(["mtpl-shotlightwindow", "missing"]);
    expect(out.used).toEqual([]);
  });
});

describe("palette and light variants", () => {
  test("accepts at most eight hex colours", () => {
    expect(validatePalette(["#AABBcc", "#000000"])).toEqual(["#AABBcc", "#000000"]);
    expect(validatePalette(["red", "#12345g", "#1234567", ...Array(9).fill("#112233")])).toEqual([]);
    expect(validatePalette(Array(9).fill("#112233"))).toEqual([]);
  });
  test("returns the first four distinct light ids and keeps every other field", () => {
    const card: ShotCard = { subject: "a lighthouse", action: "turns on", camera: "mtpl-shotcameralockedtripod", palette: ["#abcdef"] };
    const variants = sameShotFourLights(card);
    expect(variants).toHaveLength(4);
    expect(new Set(variants.map((v) => v.light)).size).toBe(4);
    expect(variants.map((v) => v.light)).toEqual(listFragments({ actor, group: "light" }).slice(0, 4).map((r) => r.id));
    for (const v of variants) expect({ ...v, light: undefined }).toEqual({ ...card, light: undefined });
  });
});
