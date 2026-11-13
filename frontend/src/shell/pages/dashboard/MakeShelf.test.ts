import { describe, expect, test } from "bun:test";
import { MAKE_TILES, visibleMakeTiles } from "./MakeShelf";

describe("Home Make shelf", () => {
  test("each tile has its intended destination", () => {
    expect(Object.fromEntries(MAKE_TILES.map(({ id, href }) => [id, href]))).toEqual({
      ask: "/chat?ask=Help%20me%20plan%20something",
      picture: "/chat?ask=Make%20a%20picture",
      video: "/apps/videos/create?prompt=Make%20a%20short%20video",
      song: "/apps/audio/create?prompt=Make%20a%20song",
      watch: "/media",
      news: "/apps/news",
    });
  });
  test("hides age restricted and unavailable app tiles", () => {
    expect(visibleMakeTiles("child", [{ to: "/apps/videos" }, { to: "/apps/audio" }, { to: "/apps/news" }]).map((tile) => tile.id)).toEqual(["ask", "watch"]);
    expect(visibleMakeTiles("owner", []).map((tile) => tile.id)).toEqual(["ask", "picture", "watch"]);
  });
});
