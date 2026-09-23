import { describe, expect, test } from "bun:test";
import { surfaceClassOf, promptSurfaceClassFor } from "@/lib/surfaceClass";

// A code review caught this: register.test.ts and turnNext.test.ts only
// ever exercise surfaceClassOf indirectly (a hand-supplied string in
// one, "chat"/"robot" with spoken always false in the other) - a
// regression in its own precedence (spoken over surface, or a mapping
// swapped) would ship with nothing catching it. Direct coverage of
// every branch.
describe("surfaceClassOf", () => {
  test("chat and tv are written", () => {
    expect(surfaceClassOf("chat")).toBe("written");
    expect(surfaceClassOf("tv")).toBe("written");
  });
  test("robot, pod, and phone are spoken", () => {
    expect(surfaceClassOf("robot")).toBe("spoken");
    expect(surfaceClassOf("pod")).toBe("spoken");
    expect(surfaceClassOf("phone")).toBe("spoken");
  });
  test("overlay is glance", () => {
    expect(surfaceClassOf("overlay")).toBe("glance");
  });
  test("spoken: true forces spoken regardless of surface - a dictated chat turn", () => {
    expect(surfaceClassOf("chat", true)).toBe("spoken");
    expect(surfaceClassOf("tv", true)).toBe("spoken");
    expect(surfaceClassOf("overlay", true)).toBe("spoken");
    expect(surfaceClassOf("robot", true)).toBe("spoken");
  });
  test("spoken: false (the default) never overrides", () => {
    expect(surfaceClassOf("chat", false)).toBe("written");
  });
});

// TRUEUP-01 (a code review, 2026-09-23): contextToMessages() (messages.ts)
// and the phrasing round (nodes/model.ts) each re-derived this same
// ternary inline while both files' own comments claimed "one
// definition" - a review caught the code not matching the claim.
// Extracted here as the one real definition both call sites use now.
describe("promptSurfaceClassFor", () => {
  test('"written" only for a written, adult turn', () => {
    expect(promptSurfaceClassFor("written", "adult")).toBe("written");
  });
  test("a child's or a teen's written turn still reads spoken - the reply floor is adult-only", () => {
    expect(promptSurfaceClassFor("written", "child")).toBe("spoken");
    expect(promptSurfaceClassFor("written", "teen")).toBe("spoken");
  });
  test("a spoken turn stays spoken regardless of age band", () => {
    expect(promptSurfaceClassFor("spoken", "adult")).toBe("spoken");
  });
  test("undefined surfaceClass defaults to spoken, same as isWrittenAdultTurn", () => {
    expect(promptSurfaceClassFor(undefined, "adult")).toBe("spoken");
  });
});
