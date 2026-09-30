import { describe, expect, test } from "bun:test";
import { chatAvailability } from "@/apps/chat/chatAvailability";

describe("chatAvailability", () => {
  test.each(["ready", "starting", "unavailable"] as const)("reads backend state %s", (availability) => {
    expect(chatAvailability({ kind: "stub", pid: null, alive: null, availability, reason: null })).toBe(availability);
  });

  test("missing health data stays ready", () => {
    expect(chatAvailability(undefined)).toBe("ready");
  });

  test("older health entries keep their kind and alive behavior", () => {
    expect(chatAvailability({ kind: "stopped", pid: null, alive: null })).toBe("unavailable");
    expect(chatAvailability({ kind: "restarting", pid: null, alive: null })).toBe("starting");
    expect(chatAvailability({ kind: "spawned", pid: 42, alive: false })).toBe("unavailable");
    expect(chatAvailability({ kind: "stub", pid: null, alive: null })).toBe("ready");
  });
});
