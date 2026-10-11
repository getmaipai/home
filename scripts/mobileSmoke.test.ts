import { describe, expect, test } from "bun:test";
import { findHorizontalOverflow, isIgnorableConsoleError } from "./mobileSmoke";

describe("mobile smoke helpers (MOBILE-LIVE-01)", () => {
  test("a page wider than the phone is reported, sub-pixel rounding is not", () => {
    expect(findHorizontalOverflow({ scrollWidth: 391, clientWidth: 390 })).toBeNull();
    expect(findHorizontalOverflow({ scrollWidth: 420, clientWidth: 390 })).toContain("420px wide in a 390px window");
  });

  test("only the pre-sign-in 401 is ignorable, every other console error fails the run", () => {
    const failed401 = "Failed to load resource: the server responded with a status of 401 (Unauthorized)";
    expect(isIgnorableConsoleError(failed401, "http://192.0.2.10:1/sign-in")).toBe(true);
    expect(isIgnorableConsoleError(failed401, "http://192.0.2.10:1/chat")).toBe(false);
    expect(isIgnorableConsoleError("TypeError: crypto.randomUUID is not a function", "http://192.0.2.10:1/chat")).toBe(false);
  });
});
