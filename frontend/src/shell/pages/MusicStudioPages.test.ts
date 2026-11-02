import { describe, expect, test } from "bun:test";
import { createBody, editPath, isStudioPage } from "./MusicStudioPages";

describe("music studio pages", () => {
  test("only the music app's studio pages are ours", () => {
    expect(isStudioPage("music", "make-album")).toBe(true);
    expect(isStudioPage("music", "browse")).toBe(false);
    expect(isStudioPage("books", "create")).toBe(false);
  });
  test("edit address names the kind and the id", () => {
    expect(editPath("album", "malbum-abc")).toBe("/apps/music/edit?kind=album&id=malbum-abc");
  });
  test("a made album starts empty with its sound as the style", () => {
    const body = createBody("album", { title: " Porch Light ", sound: "dreamy synth pop" });
    expect(body.title).toBe("Porch Light");
    expect(body.track_media_ids).toEqual([]);
    expect((body.style as { description: string }).description).toBe("dreamy synth pop");
  });
  test("a band with no sound still gets a style line", () => {
    const body = createBody("band", { name: "Clover Lane" });
    expect((body.style as { description: string }).description.length).toBeGreaterThan(0);
  });
});
