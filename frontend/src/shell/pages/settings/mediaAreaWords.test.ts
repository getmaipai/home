// VIDEO-SETTINGS-05 (settings-media-2026-11-02 section 12, test 1): the words of Settings, Pictures, videos and music. Quick, Detailed and Wan are retired for adults (the
// levels are Standard, Boost and Max), and people never see resource words (memory, RAM, swap, room, GB pressure). Model names and sizes may appear only where the design
// allows: the Styles tab's browse tiles, confirm panel, failure lines and Details (LTX base names, sizes and the 4 GB limit), and Models and storage (not scanned here).
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import areasFile from "@maipai/spec/settings/areas.json";
import keysFile from "@maipai/spec/settings/keys.json";

type Card = { label?: string; description?: string; group?: string; tab?: string; copy?: Record<string, string> };
type Key = { key: string; label?: string; help?: string; lives_in?: string; copy?: { does?: string; options?: Record<string, string> } };

const RETIRED = /\b(quick|detailed|wan|lora|loras|adapter|adapters)\b/i;
const RESOURCE = /\b(memory|ram|swap|room|vram|gb pressure)\b/i;
const SIZE_OR_BASE = /\b(ltx[- ]?\d|\d+(\.\d+)?\s?gb)\b/i;

const area = ((areasFile as unknown as { areas: Array<{ sections: Array<{ id: string; cards?: Card[]; tabs?: Array<{ id: string; label: string }> }> }> }).areas)
  .flatMap((a) => a.sections).find((section) => section.id === "media")!;
const cards = area.cards ?? [];
const mediaKeys = (keysFile as unknown as Key[]).filter((key) => key.lives_in?.startsWith("household.media_"));

const stringsOfCard = (card: Card) => [card.label, card.description, ...Object.values(card.copy ?? {})].filter((s): s is string => typeof s === "string");
const stringsOfKey = (key: Key) => [key.label, key.help, key.copy?.does, ...Object.values(key.copy?.options ?? {})].filter((s): s is string => typeof s === "string");

const sourceOf = (dir: string, only: (name: string) => boolean): Array<{ file: string; text: string }> =>
  readdirSync(dir).filter((name) => /\.tsx?$/.test(name) && !/\.test\./.test(name) && only(name)).map((name) => ({ file: name, text: readFileSync(join(dir, name), "utf8") }));
const withoutComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the words of Pictures, videos and music", () => {
  test("the area has the four tabs and no Media library", () => {
    expect(area.tabs?.map((tab) => tab.id)).toEqual(["pictures", "videos", "music", "styles"]);
  });

  test("the area's cards and keys use no retired level word and no resource word", () => {
    const strings = [...cards.flatMap(stringsOfCard), ...mediaKeys.flatMap(stringsOfKey)];
    expect(strings.length).toBeGreaterThan(40);
    for (const text of strings) { expect(text).not.toMatch(RETIRED); expect(text).not.toMatch(RESOURCE); }
  });

  test("outside the Styles tab no line names a model base or a size", () => {
    const outside = [...cards.filter((card) => card.tab !== "styles").flatMap(stringsOfCard), ...mediaKeys.filter((key) => key.lives_in !== "household.media_styles").flatMap(stringsOfKey)];
    for (const text of outside) expect(text).not.toMatch(SIZE_OR_BASE);
  });

  test("the tab views' own strings: no retired word, resource word, base name or size", () => {
    const views = sourceOf("src/shell/pages/settings", (name) => name === "MediaCardViews.tsx");
    expect(views.length).toBe(1);
    for (const { text } of views) {
      const code = withoutComments(text);
      expect(code).not.toMatch(RETIRED);
      expect(code).not.toMatch(RESOURCE);
      expect(code).not.toMatch(SIZE_OR_BASE);
    }
  });

  test("the Styles tab's own strings use no Quick, Detailed, Wan or resource word", () => {
    const sources = sourceOf("src/apps/settings/styles", () => true);
    expect(sources.length).toBeGreaterThan(5);
    for (const { text } of sources) {
      // Strings only: identifiers such as the API's `base_model: "wan"` stay in code; person-facing text sits in JSX and quoted sentences.
      const sentences = [...withoutComments(text).matchAll(/"([^"\n]{12,})"|`([^`\n]{12,})`|>([^<>{}\n]{12,})</g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
      for (const sentence of sentences) {
        expect(sentence).not.toMatch(/\b(quick|detailed)\b/i);
        expect(sentence).not.toMatch(RESOURCE);
      }
    }
  });

  test("the retired views and their files are gone", () => {
    const names = readdirSync("src/apps/settings");
    for (const gone of ["PicturesLibrary.tsx", "VideoLibrary.tsx"]) expect(names).not.toContain(gone);
    const views = readFileSync("src/shell/pages/settings/settingsViews.tsx", "utf8");
    expect(views).not.toMatch(/media_library|pictures_library|PicturesLibrary|VideoLibrary/);
  });
});
