import { describe, expect, test } from "bun:test";
import { appSearchGroups, APP_SEARCH_DATA } from "./appSearchResults";

const app = { to: "/apps/audio", label: "Audio", searchTo: "/apps/audio/search" };
const rows = [
  { id: "t1", title: "Moon River", channel: "Audrey", thumbnail: "/a.jpg" },
  { id: "t 2", title: "Moonlight", channel: null, thumbnail: null },
];

describe("appSearchGroups", () => {
  test("a query under two letters lists nothing", () => {
    expect(appSearchGroups(app, " m ", rows)).toEqual([]);
  });

  test("songs show in place as rows that open the play page, then one See all row", () => {
    const [group] = appSearchGroups(app, "moon", rows);
    expect(group?.heading).toBe("Audio");
    expect(group?.results.map((r) => r.title).slice(0, 2)).toEqual(["Moon River", "Moonlight"]);
    expect(group?.results[0]).toMatchObject({ id: "t1", subtitle: "Audrey", thumbnail: "/a.jpg", href: "/apps/audio/play?id=t1" });
    expect(group?.results[1]?.href).toBe("/apps/audio/play?id=t%202");
    const last = group!.results[group!.results.length - 1]!;
    expect(last.href).toBe("/apps/audio/search?q=moon");
    expect(group!.results).toHaveLength(3);
  });

  test("no matches still offers the search page row", () => {
    const [group] = appSearchGroups(app, "zzzz", []);
    expect(group?.results).toHaveLength(1);
    expect(group?.results[0]?.href).toBe("/apps/audio/search?q=zzzz");
  });

  test("at most eight song rows", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, title: `Song ${i}` }));
    expect(appSearchGroups(app, "song", many)[0]!.results).toHaveLength(9);
  });

  test("Audio asks the songs data, Video the library", () => {
    expect(APP_SEARCH_DATA.audio).toMatchObject({ data: "songs", playPage: "play" });
    expect(APP_SEARCH_DATA.video).toMatchObject({ data: "library", playPage: "watch" });
  });
});
