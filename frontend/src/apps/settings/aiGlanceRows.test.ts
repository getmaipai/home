import { describe, expect, test } from "bun:test";
import table from "../../../../shared/diskPlan.json";
import type { DiskPlan } from "../../../../shared/diskPlanMath";
import { buildAiCards } from "../../../../shared/aiChoices";
import { fakeCopy } from "../setup/planFixtures";
import { optionsOf } from "./aiGlanceRows";

describe("the minors-only video choice in the shared option list", () => {
  const plan = (table as unknown as { tiers: Record<string, DiskPlan> }).tiers.p128!;
  const videoOptions = (householdHasMinors: boolean) => {
    const cards = buildAiCards({ copy: fakeCopy, plan, components: null, settings: { pictureQuickModel: "ernie", pictureDetailedEnabled: false, videoQuality: "quick", musicEnabled: false, householdHasMinors }, freeBytes: null }).cards;
    return optionsOf(cards.find((card) => card.id === "videos")!);
  };
  test("a home with a teen or child is offered it, beside the LTX choice", () => {
    const options = videoOptions(true);
    expect(options.map((option) => option.id)).toEqual(["videos.quick", "videos.detailed"]);
    const quick = options.find((option) => option.id === "videos.quick")!;
    expect(quick.rowIds[0]).toBe("video");
    expect(quick.state).toBe("notInstalled");
  });
  test("an adult-only home sees nothing new", () => {
    expect(videoOptions(false).map((option) => option.id)).toEqual(["videos.detailed"]);
  });
  test("the hidden edit choice is never listed", () => {
    for (const option of videoOptions(true)) expect(option.id).not.toBe("pictures.edit");
  });
});
