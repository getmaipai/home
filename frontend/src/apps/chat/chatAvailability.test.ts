import { describe, expect, test } from "bun:test";
import type { EngineHealthEntry } from "@/lib/api";
import { chatAvailability } from "@/apps/chat/chatAvailability";

const cases: Array<[EngineHealthEntry["kind"], boolean | null, "ready" | "starting" | "unavailable"]> = [
  ["url", true, "ready"], ["url", false, "unavailable"], ["url", null, "ready"],
  ["override", true, "ready"], ["override", false, "unavailable"], ["override", null, "ready"],
  ["selection", true, "ready"], ["selection", false, "unavailable"], ["selection", null, "ready"],
  ["stub", true, "ready"], ["stub", false, "ready"], ["stub", null, "ready"],
  ["stopped", true, "unavailable"], ["stopped", false, "unavailable"], ["stopped", null, "unavailable"],
  ["starting", true, "starting"], ["starting", false, "starting"], ["starting", null, "starting"],
  ["stalled", true, "unavailable"], ["stalled", false, "unavailable"], ["stalled", null, "unavailable"],
  ["none", true, "ready"], ["none", false, "ready"], ["none", null, "ready"],
  ["spawned", true, "ready"], ["spawned", false, "unavailable"], ["spawned", null, "ready"],
  ["restarting", true, "starting"], ["restarting", false, "starting"], ["restarting", null, "starting"],
  ["failed", true, "unavailable"], ["failed", false, "unavailable"], ["failed", null, "unavailable"],
  ["blocked", true, "unavailable"], ["blocked", false, "unavailable"], ["blocked", null, "unavailable"],
];

describe("chatAvailability", () => {
  test.each(cases)("%s with alive=%s is %s", (kind, alive, expected) => {
    expect(chatAvailability({ kind, pid: null, alive })).toBe(expected);
  });

  test("missing health data stays ready", () => {
    expect(chatAvailability(undefined)).toBe("ready");
  });
});
