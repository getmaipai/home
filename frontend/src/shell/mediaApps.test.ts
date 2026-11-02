import { describe, expect, test } from "bun:test";
import { playIsAlreadyOpen, playRoute } from "@/shell/mediaApps";

describe("playIsAlreadyOpen", () => {
  const to = playRoute("station", "st-1")!;
  test("the same station on its own play page is already open", () => {
    expect(playIsAlreadyOpen("st-1", "/apps/music/station", to, "st-1")).toBe(true);
  });
  test("a different station, another page or nothing held is not", () => {
    expect(playIsAlreadyOpen("st-2", "/apps/music/station", to, "st-1")).toBe(false);
    expect(playIsAlreadyOpen("st-1", "/apps/music/radio", to, "st-1")).toBe(false);
    expect(playIsAlreadyOpen(null, "/apps/music/station", to, "st-1")).toBe(false);
  });
});
