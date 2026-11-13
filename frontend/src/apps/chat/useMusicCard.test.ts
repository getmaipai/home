import { describe, expect, test } from "bun:test";
import { cardPath, musicRefOf, studioAsk, stillMaking } from "./useMusicCard";

// MUSIC-STUDIO-HOME: the pieces around the album, song style and band edit cards. The id and turn ride in `provenance`.

describe("musicRefOf", () => {
  test("reads the record, conversation and turn from the provenance", () => {
    expect(musicRefOf("album", "make_album:malbum-abc123:conv-1:turn-2")).toEqual({ id: "malbum-abc123", conversationId: "conv-1", turnId: "turn-2" });
    expect(musicRefOf("song_style", "make_song_style:sstyle-abc123:-:-")).toEqual({ id: "sstyle-abc123", conversationId: null, turnId: null });
    expect(musicRefOf("band", "make_band:mband-abc123:c:t")?.id).toBe("mband-abc123");
  });
  test("another producer, another kind or a bad id is not ours", () => {
    expect(musicRefOf("album", "make_band:malbum-abc123:-:-")).toBeNull();
    expect(musicRefOf("album", "make_album:../x:-:-")).toBeNull();
    expect(musicRefOf("track", "make_album:malbum-abc123:-:-")).toBeNull();
    expect(musicRefOf("band", "make_song:mband-abc123:-:-")).toBeNull();
    expect(musicRefOf("band", "make_band:../etc:-:-")).toBeNull();
    expect(musicRefOf("band", "")).toBeNull();
  });
});

describe("cardPath", () => {
  test("names the card route and where the card was made", () => {
    expect(cardPath("album", "malbum-abc123", "conv-1", "turn-2")).toBe("/api/music/albums/malbum-abc123/card?conversation_id=conv-1&turn_id=turn-2");
    expect(cardPath("song_style", "sstyle-abc123", null, null)).toBe("/api/music/styles/sstyle-abc123/card");
  });
});

describe("studioAsk", () => {
  test("carries one object link for the turn", () => {
    expect(studioAsk("make_album", "band", "mband-abc123")).toContain("maipai://audio/band/mband-abc123");
    expect(studioAsk("make_song", "song_style", "sstyle-abc123")).toContain("maipai://audio/style/sstyle-abc123");
  });
});

describe("stillMaking", () => {
  test("an album with no picture engine waits only for its songs", () => {
    expect(stillMaking("album", { tracks: [{ media_id: "m" }] }, "pending")).toBe(true);
    expect(stillMaking("album", { tracks: [{ media_id: "m" }] }, "no_engine")).toBe(false);
    expect(stillMaking("album", { tracks: [] }, "no_engine")).toBe(true);
    expect(stillMaking("album", { cover: { src: "x" }, tracks: [{ media_id: "m" }] }, "ready")).toBe(false);
    expect(stillMaking("song_style", { title: "x" }, undefined)).toBe(false);
  });
});
