import { describe, expect, test } from "bun:test";
import { isLocalFixtureUrl } from "../scripts/bench/liveHubQuiet";

// SEARCH-HEALTH-01 (docs/dev.md's "Live bench protocol", 2026-09-24): the
// classification `refuseRealSearxngWithoutClearance` gates on - never a
// fixture (any of this codebase's own startFakeSearxng() servers) mistaken
// for the household's real instance, and vice versa.
describe("isLocalFixtureUrl", () => {
  test("127.0.0.1, localhost and ::1 are local fixtures", () => {
    expect(isLocalFixtureUrl("http://127.0.0.1:54321")).toBe(true);
    expect(isLocalFixtureUrl("http://localhost:8888")).toBe(true);
    expect(isLocalFixtureUrl("http://[::1]:8888")).toBe(true);
  });

  test("a real LAN or public host is never a local fixture", () => {
    expect(isLocalFixtureUrl("http://192.0.2.10:8888")).toBe(false);
    expect(isLocalFixtureUrl("https://searx.example.com")).toBe(false);
  });

  test("an unparseable URL is treated as local (fails at the real call site instead, never here)", () => {
    expect(isLocalFixtureUrl("not a url")).toBe(true);
  });
});
