import { describe, expect, test } from "bun:test";
import { toolSpecFor } from "@/lib/turnMachine/nodes/model";
import { PICTURE_STARTED_CONFIRM_NOTE } from "./policy";

describe("the picture model decides content", () => {
  test("the adult picture tool description adds no content policy", () => {
    const spec = toolSpecFor("generate_image", "adult");
    if (spec === null) return; // tool not offered in this environment (capability off)
    expect(spec.description).not.toMatch(/real people|public figures|historical people/);
  });

  test("started jobs still get their confirmation instruction", () => { expect(PICTURE_STARTED_CONFIRM_NOTE).toContain("do not refuse"); });
});
