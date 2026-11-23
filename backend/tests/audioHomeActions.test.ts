// AUDIO-HOME-CLICK-01: every tile and button on the Audio home does something that works for any song, tagged or not.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "packages", "audio");
type Node = Record<string, unknown>;
const index = JSON.parse(readFileSync(join(root, "pages", "index.json"), "utf8")) as { body: Node[] };
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as { contributes: { pages: Array<{ id: string }> } };

function navigates(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) value.forEach((v) => navigates(v, out));
  else if (value && typeof value === "object") {
    const nav = (value as { navigate?: { to?: string } }).navigate;
    if (nav?.to) out.push(nav.to);
    Object.values(value).forEach((v) => navigates(v, out));
  }
  return out;
}

describe("Audio home actions", () => {
  test("every navigate on the home opens a page the manifest declares", () => {
    const ids = new Set(manifest.contributes.pages.map((page) => page.id));
    for (const to of navigates(index.body)) {
      const page = to.replace(/^\/apps\/audio\/?/, "") || "index";
      expect(ids.has(page)).toBe(true);
    }
  });

  test("the Recently played shelf plays the tapped song (a song with no album has no album page to open)", () => {
    const shelf = index.body.find((node) => node.type === "media_shelf" && node.heading === "Recently played");
    expect(shelf?.on_select).toEqual({ play: { media_id: "{id}" } });
  });
});
