import { describe, expect, test } from "bun:test";
import { musicListOf, musicTrackOf } from "./musicHandoff";

describe("Music play handoff", () => {
  test("turns a readable audio item into a playable Music track with its media id", () => {
    expect(musicTrackOf({ id: "media-1", src: "/api/media/1", title: "One", subtitle: "Band", poster: "/cover", duration_s: 90 })).toEqual({
      key: "media-1", mediaId: "media-1", url: "/api/media/1", title: "One", subtitle: "Band", artworkUrl: "/cover", duration: 90,
      state: "done", hasFile: true, mediaType: "audio/mp4",
    });
    expect(musicTrackOf({ id: "missing", title: "No source" })).toBeNull();
  });

  test("uses the collection behind album, artist, playlist, shuffle and radio actions", () => {
    const route = (item: Record<string, unknown>, mediaId: string) => musicListOf({ pathname: "/apps/audio/album", search: "", pageState: {}, item, mediaId });
    expect(route({ queue_mode: "album", title: "Record" }, "record-id")).toMatchObject({ dataId: "album", id: "record-id" });
    expect(route({ queue_mode: "artist", title: "Band" }, "radio:artist:Band")).toMatchObject({ dataId: "artist", id: "Band" });
    expect(route({ queue_mode: "playlist" }, "shuffle:mix-id")).toMatchObject({ dataId: "playlist", id: "mix-id" });
    expect(route({ album_id: "record-id", playlist_id: "mix-id" }, "media-1")).toMatchObject({ dataId: "playlist", id: "mix-id" });
  });

  test("uses the open artist or playlist page before a row's album id", () => {
    expect(musicListOf({ pathname: "/apps/audio/artist", search: "", pageState: { id: "band" }, item: { album_id: "record" }, mediaId: "song" })).toMatchObject({ dataId: "artist", id: "band" });
    expect(musicListOf({ pathname: "/apps/audio/playlist", search: "", pageState: { id: "mix" }, item: { album_id: "record" }, mediaId: "song" })).toMatchObject({ dataId: "playlist", id: "mix" });
  });

  test("uses search and library lists when available and otherwise plays the item alone", () => {
    expect(musicListOf({ pathname: "/apps/audio/search", search: "?q=blue", pageState: {}, item: {}, mediaId: "song" })).toMatchObject({ dataId: "songs", query: "blue" });
    expect(musicListOf({ pathname: "/apps/audio/library", search: "", pageState: {}, item: { album_id: "record" }, mediaId: "song" })).toMatchObject({ dataId: "songs", scope: "library" });
    expect(musicListOf({ pathname: "/chat", search: "", pageState: {}, item: {}, mediaId: "song" })).toBeNull();
  });
});
