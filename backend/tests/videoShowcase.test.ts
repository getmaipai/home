import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { VIDEO_SHOWCASE, showcaseClipPrompt } from "@/lib/videos/recipes";

const PKG = join(import.meta.dir, "..", "packages", "video");
const sha = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");

// The Inspiration rail's clips (the showcase tiles) must show what their words say. showcase-sources.json records the sha256 of the words each clip was made from
// (showcaseClipPrompt) and of the mp4 file, so a tile with no clip, a clip shared by two tiles, a clip made from other words, or a swapped file fails here.
test("every Inspiration tile has its own clip, made from its current words", () => {
  const sources = JSON.parse(readFileSync(join(PKG, "showcase-sources.json"), "utf8")) as Record<string, { prompt: string; file: string }>;
  const seen = new Set<string>();
  for (const tile of VIDEO_SHOWCASE) {
    expect(tile.poster).toBe(`showcase/${tile.id}.mp4`); // its own file, never a shared style loop
    const clip = join(PKG, "assets", tile.poster);
    expect(existsSync(clip)).toBe(true);
    expect(existsSync(clip.replace(/\.mp4$/, ".jpg"))).toBe(true);
    const bytes = readFileSync(clip);
    expect(bytes.length).toBeGreaterThan(40_000); // a real 3 s clip at 640x360, not a tiny stand-in (the hashes below do the real check)
    const src = sources[tile.id];
    expect(src).toBeDefined();
    expect(src!.prompt).toBe(sha(showcaseClipPrompt(tile)));
    expect(src!.file).toBe(sha(bytes));
    expect(seen.has(src!.file)).toBe(false);
    seen.add(src!.file);
  }
  expect(Object.keys(sources).sort()).toEqual(VIDEO_SHOWCASE.map((tile) => tile.id).sort());
});
