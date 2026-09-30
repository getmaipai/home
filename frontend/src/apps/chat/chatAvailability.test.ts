import { describe, expect, test } from "bun:test";
import type { EngineHealthEntry } from "@/lib/api";
import { chatAvailability } from "@/apps/chat/chatAvailability";

describe("chatAvailability", () => {
  test.each(["ready", "starting", "unavailable"] as const)("reads backend state %s", (availability) => {
    expect(chatAvailability({ kind: "stub", pid: null, alive: null, availability, reason: null })).toBe(availability);
  });

  test("missing health data stays ready", () => {
    expect(chatAvailability(undefined)).toBe("ready");
  });
});
