import { afterEach, describe, expect, test } from "bun:test";
import { bedSongFirst, bedSongId, rememberBedSong } from "./musicBed";

afterEach(() => { try { sessionStorage.clear(); } catch { /* none */ } });
const songs = [{ id: "a" }, { id: "b" }, { id: "c" }];
describe("the song chosen with Use in a video", () => {
  test("is listed first and the rest keep their order", () => {
    expect(bedSongFirst(songs, "c").map((song) => song.id)).toEqual(["c", "a", "b"]);
    expect(bedSongFirst(songs, "a").map((song) => song.id)).toEqual(["a", "b", "c"]);
  });
  test("a song that is not in the list, or none chosen, changes nothing", () => {
    expect(bedSongFirst(songs, "z").map((song) => song.id)).toEqual(["a", "b", "c"]);
    expect(bedSongFirst(songs, null).map((song) => song.id)).toEqual(["a", "b", "c"]);
  });
  test("is remembered for the tab", () => {
    rememberBedSong("b");
    expect(bedSongId()).toBe("b");
    expect(bedSongFirst(songs).map((song) => song.id)).toEqual(["b", "a", "c"]);
  });
});
