import { expect, test } from "bun:test";
import type { AppRow } from "@/lib/api";
import { mediaNav } from "./mediaNav";

function row(overrides: Partial<AppRow> & { package: string }): AppRow {
  return {
    page: "index",
    label: overrides.package,
    icon: "box",
    description: "fixture",
    category: "Media",
    keywords: [],
    sections: [],
    to: `/media/${overrides.package}`,
    incognito: "unaffected",
    ...overrides,
  };
}

test("apps come back in MEDIA_APP_ORDER even when the rows arrive reversed", () => {
  const rows = [
    row({ package: "books", label: "Books" }),
    row({ package: "podcasts", label: "Podcasts" }),
    row({ package: "music", label: "Music" }),
    row({ package: "shows", label: "Shows" }),
    row({ package: "videos", label: "Videos" }),
  ];
  expect(mediaNav(rows).map((app) => app.id)).toEqual(["videos", "shows", "music", "podcasts", "books"]);
});

test("an app that is missing from the rows is simply absent, and the rest keep their place", () => {
  const rows = [row({ package: "videos", label: "Videos" }), row({ package: "music", label: "Music" })];
  expect(mediaNav(rows).map((app) => app.id)).toEqual(["videos", "music"]);
});

test("undefined and an empty array both give no apps", () => {
  expect(mediaNav(undefined)).toEqual([]);
  expect(mediaNav([])).toEqual([]);
});

test("a non-media package is dropped entirely", () => {
  const rows = [row({ package: "weather", label: "Weather" }), row({ package: "music", label: "Music" })];
  const result = mediaNav(rows);
  expect(result).toHaveLength(1);
  expect(result[0]?.id).toBe("music");
});

test("the app route is the row's own to", () => {
  const rows = [row({ package: "music", label: "Music", to: "/apps/music" })];
  const [app] = mediaNav(rows);
  expect(app?.to).toBe("/apps/music");
});

test("the input rows and their sections are not mutated", () => {
  const section = { page: "albums", label: "Albums", icon: "disc" };
  const rows = [row({ package: "music", sections: [section] })];
  mediaNav(rows);
  expect(section).toEqual({ page: "albums", label: "Albums", icon: "disc" });
  expect(rows).toHaveLength(1);
  expect(rows[0]?.to).toBe("/media/music");
});
