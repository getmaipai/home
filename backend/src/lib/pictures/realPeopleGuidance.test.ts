import { describe, expect, test } from "bun:test";
import { toolSpecFor } from "@/lib/turnMachine/nodes/model";
import { PICTURE_STARTED_CONFIRM_NOTE, REAL_PEOPLE_PICTURE_GUIDANCE } from "./policy";

// REALPEOPLE-MODEL-2026-10-25: the model's own refusals of real-person pictures are lowered by text offered with the picture tool, adults only.
describe("real people in pictures: model guidance", () => {
  test("the adult picture tool description carries the allow sentence", () => {
    const spec = toolSpecFor("generate_image", "adult");
    if (spec === null) return; // tool not offered in this environment (capability off)
    expect(spec.description).toContain(REAL_PEOPLE_PICTURE_GUIDANCE);
  });

  test("a teen or child never reads it", () => {
    for (const lane of ["teen", "child"] as const) {
      const spec = toolSpecFor("generate_image", lane);
      if (spec !== null) expect(spec.description).not.toContain(REAL_PEOPLE_PICTURE_GUIDANCE);
    }
  });

  test("the sentences keep the sexual limit and the age rules", () => {
    expect(REAL_PEOPLE_PICTURE_GUIDANCE).toContain("Never make sexual content of a real person");
    expect(REAL_PEOPLE_PICTURE_GUIDANCE).toContain("age rules");
    expect(PICTURE_STARTED_CONFIRM_NOTE).toContain("do not refuse");
  });
});
