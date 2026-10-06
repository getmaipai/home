import { describe, expect, test } from "bun:test";
import { chatCapabilitiesFrom, NO_CHAT_PICTURES } from "@/apps/chat/visionCapability";

describe("chat picture capability (VISION-02c)", () => {
  test("only the backend's explicit true turns picture parts on", () => {
    expect(chatCapabilitiesFrom({ image_parts: true })).toEqual({ image_parts: true });
    expect(chatCapabilitiesFrom({ image_parts: false })).toEqual(NO_CHAT_PICTURES);
  });

  test("anything else, a missing route or an older hub, reads as no pictures", () => {
    expect(chatCapabilitiesFrom(undefined)).toEqual(NO_CHAT_PICTURES);
    expect(chatCapabilitiesFrom(null)).toEqual(NO_CHAT_PICTURES);
    expect(chatCapabilitiesFrom({ image_parts: "yes" })).toEqual(NO_CHAT_PICTURES);
    expect(chatCapabilitiesFrom({ model: "qwen3-vl-8b-instruct-q4-k-m" })).toEqual(NO_CHAT_PICTURES);
  });
});
