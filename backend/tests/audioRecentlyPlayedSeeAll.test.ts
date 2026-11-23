// AUDIO-SEEALL-01: the Recently played shelf on Audio home has a "See all" that opens a grid page of the same list.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pages = join(import.meta.dir, "..", "packages", "audio", "pages");
type Block = { type: string; heading?: string; bind?: { path?: string; params?: Record<string, string> }; see_all?: { label: string; action: { navigate: { to: string } } }; orientation?: string; empty_state?: unknown; on_select?: unknown };
const body = (name: string) => (JSON.parse(readFileSync(join(pages, `${name}.json`), "utf8")) as { body: Block[] }).body;

describe("Audio Recently played see all", () => {
  test("the home shelf links to the history page", () => {
    const shelf = body("index").find((block) => block.type === "media_shelf" && block.heading === "Recently played");
    expect(shelf?.see_all).toEqual({ label: "See all", action: { navigate: { to: "/apps/audio/history" } } });
  });

  test("the history page is a full grid of the same list, with an empty state", () => {
    const [first, ...rest] = body("history");
    expect(rest).toEqual([]);
    expect(first).toMatchObject({ type: "media_shelf", heading: "Recently played", bind: { path: "history" } });
    expect(first?.bind?.params?.scope).toBeUndefined();
    expect(first?.orientation).toBe("vertical");
    expect(first?.empty_state).toMatchObject({ type: "empty_state", text: "Songs you played lately will show up here." });
    expect(first?.on_select).toBeDefined();
  });
});
