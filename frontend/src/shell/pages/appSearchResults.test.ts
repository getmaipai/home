import { describe, expect, test } from "bun:test";
import { appSearchGroups, APP_SEARCH_DATA } from "./appSearchResults";

const app = { to: "/apps/audio", label: "Audio" };
const rows = [
  { id: "t1", title: "Moon River", channel: "Audrey", thumbnail: "/a.jpg" },
  { id: "t 2", title: "Moonlight", channel: null, thumbnail: null },
];

describe("appSearchGroups", () => {
  test("a query under two letters lists nothing", () => {
    expect(appSearchGroups(app, " m ", rows)).toEqual([]);
  });

  test("songs show in place as rows that open the play page, with no second row to a search page", () => {
    const [group] = appSearchGroups(app, "moon", rows);
    expect(group?.heading).toBe("Audio");
    expect(group?.results.map((r) => r.title)).toEqual(["Moon River", "Moonlight"]);
    expect(group?.results[0]).toMatchObject({ id: "t1", subtitle: "Audrey", thumbnail: "/a.jpg", href: "/apps/audio/play?id=t1" });
    expect(group?.results[1]?.href).toBe("/apps/audio/play?id=t%202");
    expect(group!.results.some((r) => r.href.includes("/search"))).toBe(false);
  });

  test("no matches lists nothing, so the dialog's own empty line shows and there is no page to click through to", () => {
    expect(appSearchGroups(app, "zzzz", [])).toEqual([]);
  });

  test("at most twenty song rows", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, title: `Song ${i}` }));
    expect(appSearchGroups(app, "song", many)[0]!.results).toHaveLength(20);
  });

  test("Audio asks the songs data, Video the library", () => {
    expect(APP_SEARCH_DATA.audio).toMatchObject({ data: "songs", playPage: "play" });
    expect(APP_SEARCH_DATA.video).toMatchObject({ data: "library", playPage: "watch" });
  });
});
