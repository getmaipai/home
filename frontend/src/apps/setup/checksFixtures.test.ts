import { describe, expect, test } from "bun:test";
import { CHECK_FIXTURES, CHECK_ROW_IDS, TAILNET_CHECK_FIXTURES, TAILNET_STATUS_FIXTURES } from "./checksFixtures";

describe("setup checks screen fixtures", () => {
  test("seed scenarios cover all-green, one amber and one red", () => {
    expect(CHECK_FIXTURES.green.every((row) => row.state === "green")).toBe(true);
    expect(CHECK_FIXTURES.amber.filter((row) => row.state === "amber")).toHaveLength(1);
    expect(CHECK_FIXTURES.red.filter((row) => row.state === "red")).toHaveLength(1);
    for (const state of ["green", "amber", "red"] as const) {
      expect(CHECK_FIXTURES[state].map((row) => row.id)).toEqual([...CHECK_ROW_IDS]);
    }
  });
  test("tailnet seed fixtures cover every requested engine route state with synthetic names and addresses", () => {
    expect(Object.keys(TAILNET_CHECK_FIXTURES).sort()).toEqual(["allow_off", "direct", "not_installed", "peer_offline", "relay", "stopped"]);
    expect(TAILNET_STATUS_FIXTURES.direct).toContain("192.0.2.20");
    expect(TAILNET_STATUS_FIXTURES.direct).toContain("engine.example.com");
    expect(Object.values(TAILNET_STATUS_FIXTURES).join(" ")).not.toMatch(/ts\.net|tailscale\.com/);
    for (const rows of Object.values(TAILNET_CHECK_FIXTURES)) expect(rows.length).toBeGreaterThan(0);
  });
});
