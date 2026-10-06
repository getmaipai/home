import { describe, expect, test } from "bun:test";
import { chatCapabilitiesFrom, modelThinks, NO_CHAT_PICTURES } from "@/apps/chat/visionCapability";

describe("chat picture capability (VISION-02c)", () => {
  test("only the backend's explicit true turns picture parts on", () => {
    expect(chatCapabilitiesFrom({ image_parts: true }).image_parts).toBe(true);
    expect(chatCapabilitiesFrom({ image_parts: false })).toEqual(NO_CHAT_PICTURES);
  });

  test("anything else, a missing route or an older hub, reads as no pictures", () => {
    expect(chatCapabilitiesFrom(undefined)).toEqual(NO_CHAT_PICTURES);
    expect(chatCapabilitiesFrom(null)).toEqual(NO_CHAT_PICTURES);
    expect(chatCapabilitiesFrom({ image_parts: "yes" })).toEqual(NO_CHAT_PICTURES);
    expect(chatCapabilitiesFrom({ model: "qwen3-vl-8b-instruct-q4-k-m" })).toEqual(NO_CHAT_PICTURES);
  });
});

describe("the thinking control follows the model's record (VISION-02d, rule 8)", () => {
  test("shown only for a switchable model", () => {
    const caps = chatCapabilitiesFrom({ image_parts: true, thinking: "none", thinking_modes: { "qwen3-vl-8b-instruct-q4-k-m": "none", "qwen3-8b-instruct-q4-k-m": "switchable", odd: "maybe" } });
    expect(modelThinks(caps, "qwen3-vl-8b-instruct-q4-k-m")).toBe(false);
    expect(modelThinks(caps, "qwen3-8b-instruct-q4-k-m")).toBe(true);
    expect(caps.thinking_modes.odd).toBeUndefined();
    expect(modelThinks(caps, undefined)).toBe(false);
    expect(modelThinks(chatCapabilitiesFrom({ thinking: "always" }), undefined)).toBe(false);
  });

  test("an older hub keeps today's thinking control", () => {
    expect(modelThinks(chatCapabilitiesFrom(undefined), "any-model")).toBe(true);
  });
});
