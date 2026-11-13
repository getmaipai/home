import { beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { owner, child } from "./support/testAuth";
import { composerHintItem, fillComposerDefaults, resolveComposerHint } from "@/lib/composerHint";
import { getAppPage } from "@/lib/apps";
import { composeShotPrompt } from "@/lib/media/shotCard";
import { listFragments } from "@/lib/media/templates";
import type { PersonRow } from "@/types";

beforeEach(() => resetDb());

describe("Video shot card chips", () => {
  test("Video Create exposes each shot-card group with its catalog options", async () => {
    const { row } = await owner();
    const page = getAppPage(row, "video", "create");
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    const bar = ((page.value as { body: Array<{ type: string; chips?: Array<{ state: string; label: string; group: string; icon: string; options: Array<{ value: string; label: string }> }> }> }).body).find((item) => item.type === "prompt_bar")!;
    const expected = { framing: ["Framing", 9], camera: ["Camera", 7], light: ["Light", 9], look: ["Look", 8], grade: ["Grade", 7] } as const;
    for (const [group, count] of Object.entries(expected)) {
      const chip = bar.chips!.find((item) => item.state === `card_${group}`)!;
      expect(chip.label).toBe(count[0]);
      expect(chip.group).toBe("Shot");
      expect(chip.icon).toBe("camera");
      expect(chip.options[0]).toEqual({ value: "none", label: "None" });
      expect(chip.options.slice(1)).toHaveLength(count[1]);
    }
    expect(bar.chips!.filter((item) => item.state.startsWith("card_")).length).toBe(Object.keys(expected).length);
    expect(bar.chips!.length).toBeLessThanOrEqual(10); // the kit page schema's limit: more and the page does not open
  });

  test("every Video Create chip is icon-only with a registered icon, and orientation options carry icons", async () => {
    const { row } = await owner();
    const page = getAppPage(row, "video", "create");
    expect(page.ok).toBe(true);
    if (!page.ok) return;
    const bar = ((page.value as { body: Array<{ type: string; chips?: Array<{ state: string; icon?: string; icon_only?: boolean; options: Array<{ value: string; icon?: string }> }> }> }).body).find((item) => item.type === "prompt_bar")!;
    const { iconNames } = await import("../../frontend/node_modules/@maipai/ui/src/icons");
    const registry = new Set<string>(iconNames);
    expect(bar.chips!.length).toBeLessThanOrEqual(10);
    for (const chip of bar.chips!) {
      expect(chip.icon_only, chip.state).toBe(true);
      expect(registry.has(chip.icon ?? ""), `${chip.state} icon ${chip.icon}`).toBe(true);
      for (const option of chip.options) if (option.icon) expect(registry.has(option.icon), `${chip.state}/${option.value}`).toBe(true);
    }
    const orientation = bar.chips!.find((chip) => chip.state === "orientation")!;
    expect(orientation.options.find((o) => o.value === "landscape")!.icon).toBe("rectangle-horizontal");
    expect(orientation.options.find((o) => o.value === "portrait")!.icon).toBe("rectangle-vertical");
  });

  test("Video hint displays settings and fills generate_video prompt in shot-card order", async () => {
    const { row } = await owner();
    const framing = "mtpl-shotframingclose";
    const light = "mtpl-shotlightgolden";
    const hint = await resolveComposerHint(row, { mode: "video", settings: { card_framing: framing, card_light: light } }, ["generate_video"]);
    expect(hint?.settings).toEqual({ card_framing: framing, card_light: light });
    expect(composerHintItem(hint!).text).toContain("framing close-up, light warm late-day light");
    const filled = fillComposerDefaults(hint!, "generate_video", { prompt: "a dog chases a ball" });
    const expected = composeShotPrompt({ subject: "a dog chases a ball", framing, light }).prompt;
    expect(filled.prompt).toBe(expected);
    expect(String(filled.prompt).startsWith("a dog chases a ball")).toBe(true);
    expect(fillComposerDefaults(hint!, "generate_video", { prompt: expected }).prompt).toBe(expected);
  });

  test("unknown ids, other tools, and minor bands preserve existing gates", async () => {
    const { row } = await owner();
    const hint = (await resolveComposerHint(row, { mode: "video", settings: { card_framing: "missing-id" } }, ["generate_video"]))!;
    expect(fillComposerDefaults(hint, "generate_video", { prompt: "leave this" }).prompt).toBe("leave this");
    expect(fillComposerDefaults(hint, "another_tool", { prompt: "leave this" }).prompt).toBe("leave this");
    const { client } = await owner();
    const { row: kid } = await child(client);
    expect(listFragments({ actor: kid as PersonRow, group: "framing" })).toHaveLength(9);
    const teen = { ...kid, role: "teen" } as PersonRow;
    expect(listFragments({ actor: teen, group: "framing" })).toHaveLength(9);
    const denied = await resolveComposerHint(kid as PersonRow, { mode: "video", settings: { card_framing: "mtpl-shotframingclose" } }, ["generate_video"]);
    expect(denied).toBeNull();
  });
});
