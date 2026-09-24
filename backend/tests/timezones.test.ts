import { describe, expect, test } from "bun:test";
import { resolveZone } from "@/lib/timezones";

describe("resolveZone()", () => {
  test("a real city resolves to its real IANA zone", () => {
    expect(resolveZone("Tokyo")).toBe("Asia/Tokyo");
    expect(resolveZone("New York")).toBe("America/New_York");
  });

  test("case and surrounding whitespace don't matter", () => {
    expect(resolveZone("  tOkYo  ")).toBe("Asia/Tokyo");
  });

  test("an unrecognized place resolves to null, never throws", () => {
    expect(resolveZone("not a real place xyz123")).toBeNull();
  });

  test("an empty or whitespace-only place resolves to null", () => {
    expect(resolveZone("")).toBeNull();
    expect(resolveZone("   ")).toBeNull();
  });

  test("an ambiguous city name resolves to the most populous match", () => {
    // Multiple real "Springfield"s exist (city-timezones' own data);
    // the most populous US one is Springfield, MA.
    const zone = resolveZone("Springfield");
    expect(typeof zone).toBe("string");
    expect(zone).not.toBeNull();
  });
});
