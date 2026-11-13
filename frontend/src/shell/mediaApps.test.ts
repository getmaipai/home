import { describe, expect, test } from "bun:test";
import { isMediaPlayPage, playIsAlreadyOpen, playRoute } from "@/shell/mediaApps";

describe("isMediaPlayPage", () => {
  test("only pages with their own player are media play pages", () => {
    expect(isMediaPlayPage("audio", "station")).toBe(false);
    expect(isMediaPlayPage("audio", "play")).toBe(true);
    expect(isMediaPlayPage("videos", "watch")).toBe(true);
  });
});

describe("playIsAlreadyOpen", () => {
  const to = playRoute("station", "st-1")!;
  test("the same station on its own play page is already open", () => {
    expect(playIsAlreadyOpen("st-1", "/apps/audio/station", to, "st-1")).toBe(true);
  });
  test("a different station, another page or nothing held is not", () => {
    expect(playIsAlreadyOpen("st-2", "/apps/audio/station", to, "st-1")).toBe(false);
    expect(playIsAlreadyOpen("st-1", "/apps/audio/radio", to, "st-1")).toBe(false);
    expect(playIsAlreadyOpen(null, "/apps/audio/station", to, "st-1")).toBe(false);
  });
});
