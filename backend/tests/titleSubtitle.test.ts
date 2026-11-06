import { describe, expect, test } from "bun:test";
import { titleSubtitle } from "@/lib/videos/editPlan";

describe("the line under a film title (the first real film showed '...HOW A LIGHTHOUSE WORKS, FOR')", () => {
  test("a short first sentence is kept without its full stop", () => {
    expect(titleSubtitle("A quiet crossing. It starts at dawn.")).toBe("A quiet crossing");
  });
  test("a long sentence is cut at a phrase boundary, never mid-clause", () => {
    const out = titleSubtitle("A 30-second narrated film about how a lighthouse works, for curious kids who ask why.");
    expect(out).toBe("A 30-second narrated film about how a lighthouse works");
    expect(out!.endsWith("for")).toBe(false);
  });
  test("a long sentence with no phrase boundary is dropped, and empty input gives none", () => {
    expect(titleSubtitle("A very long single sentence with absolutely no comma anywhere that keeps going and going on")).toBeUndefined();
    expect(titleSubtitle(undefined)).toBeUndefined();
    expect(titleSubtitle("   ")).toBeUndefined();
  });
});
