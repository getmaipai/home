import { describe, expect, test } from "bun:test";
import { CURRENT_LOCAL_VISION_CAPABILITY, localVisionCapabilityForEngine } from "@/apps/chat/visionCapability";

describe("local vision capability", () => {
  test("the current text engine does not imply image support", () => {
    expect(CURRENT_LOCAL_VISION_CAPABILITY).toEqual({ imageParts: false, engine: "text-only", transport: "local" });
    expect(localVisionCapabilityForEngine({ role: "chat", implemented: true })).toEqual(CURRENT_LOCAL_VISION_CAPABILITY);
  });

  test("only an implemented local vision role enables image parts", () => {
    expect(localVisionCapabilityForEngine({ role: "vision", implemented: false }).imageParts).toBe(false);
    expect(localVisionCapabilityForEngine({ role: "vision", implemented: true })).toEqual({ imageParts: true, engine: "vision", transport: "local" });
    expect(localVisionCapabilityForEngine(undefined).imageParts).toBe(false);
  });
});
