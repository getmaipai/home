import { describe, expect, test } from "bun:test";
import { classifyMediaAccessError } from "@/lib/media/getUserMediaErrorState";

describe("classifyMediaAccessError", () => {
  test("maps permission-refusal DOMExceptions to denied", () => {
    expect(classifyMediaAccessError(new DOMException("no", "NotAllowedError"))).toBe("denied");
    expect(classifyMediaAccessError(new DOMException("no", "PermissionDeniedError"))).toBe("denied");
    expect(classifyMediaAccessError(new DOMException("no", "SecurityError"))).toBe("denied");
  });

  test("maps no-device DOMExceptions to unavailable", () => {
    expect(classifyMediaAccessError(new DOMException("no", "NotFoundError"))).toBe("unavailable");
    expect(classifyMediaAccessError(new DOMException("no", "OverconstrainedError"))).toBe("unavailable");
    expect(classifyMediaAccessError(new DOMException("no", "DevicesNotFoundError"))).toBe("unavailable");
  });

  test("maps anything else, including a non-DOMException, to error", () => {
    expect(classifyMediaAccessError(new DOMException("no", "NotSupportedError"))).toBe("error");
    expect(classifyMediaAccessError(new Error("boom"))).toBe("error");
    expect(classifyMediaAccessError("boom")).toBe("error");
  });
});
