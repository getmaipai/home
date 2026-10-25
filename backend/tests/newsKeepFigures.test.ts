import { describe, expect, test } from "bun:test";
import { keepFigures, pictureKey } from "@/lib/news/article";

const figure = (src: string) => ({ type: "figure", src, alt: "", caption: "" }) as never;

describe("a story's lead picture is not shown again in its article (2026-10-25)", () => {
  test("the same picture under another size, folder or host has one key", () => {
    const lead = "https://cdn.example.com/photos/2026/10/stadium-night-1200x800.jpg?w=1200";
    for (const other of [
      "https://cdn.example.com/photos/2026/10/stadium-night-640x427.jpg",
      "https://img.example.com/resize/800/stadium-night.jpg",
      "https://cdn.example.com/photos/2026/10/stadium-night-scaled.webp",
    ]) expect(pictureKey(other)).toBe(pictureKey(lead));
  });

  test("different pictures keep different keys, and a short file name falls back to host and path", () => {
    expect(pictureKey("https://cdn.example.com/a/stadium-night.jpg")).not.toBe(pictureKey("https://cdn.example.com/a/stadium-day.jpg"));
    expect(pictureKey("https://a.example.com/x/1.jpg")).not.toBe(pictureKey("https://b.example.com/x/1.jpg"));
  });

  test("keepFigures drops the lead and repeats, keeps other pictures and all text", () => {
    const blocks = [
      { type: "paragraph", text: "one" } as never,
      figure("https://cdn.example.com/photos/stadium-night-640x427.jpg"),
      figure("https://cdn.example.com/photos/players-celebrate-1024x683.jpg"),
      figure("https://cdn.example.com/photos/players-celebrate-300x200.jpg"),
    ];
    const kept = keepFigures(blocks, "https://cdn.example.com/photos/stadium-night-1200x800.jpg");
    expect(kept.map((block) => block.type)).toEqual(["paragraph", "figure"]);
  });
});
