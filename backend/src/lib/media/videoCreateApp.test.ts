import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { videoShape } from "./videoCreateApp";

describe("video creation details", () => {
  test("uses shape words for frame dimensions", () => {
    expect(videoShape(1920, 1080)).toBe("wide");
    expect(videoShape(1080, 1920)).toBe("tall");
    expect(videoShape(1080, 1080)).toBe("square");
  });

  test("does not expose an engine and model row", () => {
    const source = readFileSync(new URL("./videoCreateApp.ts", import.meta.url), "utf8");
    expect(source).not.toContain("Engine and model");
    expect(source).not.toContain("modelWords");
  });
});

test("Video empty message is not attached to a filtered index shelf", () => {
  const page = JSON.parse(readFileSync(new URL("../../../packages/video/pages/index.json", import.meta.url), "utf8")) as { body: Array<Record<string, any>> };
  expect(page.body.some((node) => node.empty_state?.text?.includes("No videos yet"))).toBe(false);
});

test("Film maker inspiration uses showcase rows to fill its prompt", () => {
  const page = JSON.parse(readFileSync(new URL("../../../packages/video/pages/film-maker.json", import.meta.url), "utf8")) as { body: Array<Record<string, any>> };
  const shelf = page.body.find((node) => node.heading === "Inspiration");
  expect(shelf?.bind.params.scope).toBe("showcase");
  expect(shelf?.on_select.navigate.state.prompt).toBe("{prompt}");
});
