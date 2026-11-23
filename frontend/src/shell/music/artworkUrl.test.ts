import { describe, expect, test } from "bun:test";
import { artworkUrlOf } from "./artworkUrl";
import { musicTrackOf } from "./musicHandoff";

describe("one artwork pick for Audio", () => {
  test("a shelf thumbnail wins over the item poster, the poster is the fallback, and blank is null", () => {
    expect(artworkUrlOf({ thumbnail: "/thumb", poster: "/poster" })).toBe("/thumb");
    expect(artworkUrlOf({ thumbnail: null, poster: "/poster" })).toBe("/poster");
    expect(artworkUrlOf({ poster: "/poster" })).toBe("/poster");
    expect(artworkUrlOf({ thumbnail: "", poster: "" })).toBeNull();
    expect(artworkUrlOf({})).toBeNull();
  });

  test("the mini player track uses the same pick as the shelves", () => {
    const track = musicTrackOf({ id: "m1", src: "/api/media/1", title: "One", thumbnail: "/thumb", poster: "/poster" });
    expect(track?.artworkUrl).toBe("/thumb");
    expect(musicTrackOf({ id: "m2", src: "/api/media/2", title: "Two" })?.artworkUrl).toBeNull();
  });
});
