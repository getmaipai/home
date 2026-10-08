import { beforeEach, describe, expect, test } from "bun:test";
import { consumeSupersedes, setPendingSupersedes } from "@/apps/chat/chatEditSupersedes";

describe("chatEditSupersedes", () => {
  beforeEach(() => {
    setPendingSupersedes(null);
  });
  test("returns undefined when nothing is pending", () => {
    expect(consumeSupersedes()).toBeUndefined();
  });
  test("returns the pending turn id once, then clears it", () => {
    setPendingSupersedes("turn-1");
    expect(consumeSupersedes()).toBe("turn-1");
    expect(consumeSupersedes()).toBeUndefined();
  });
  test("a later set replaces an earlier one", () => {
    setPendingSupersedes("turn-1");
    setPendingSupersedes("turn-2");
    expect(consumeSupersedes()).toBe("turn-2");
  });
  test("setting null clears a pending id", () => {
    setPendingSupersedes("turn-1");
    setPendingSupersedes(null);
    expect(consumeSupersedes()).toBeUndefined();
  });
});
