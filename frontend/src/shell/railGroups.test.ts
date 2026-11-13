import { describe, expect, test } from "bun:test";
import { APP_CATALOG } from "@/shell/appCatalog";
import { AUTO_COLLAPSE_PREFIXES, RAIL_GROUPS, RAIL_GROUP_BY_APP_ID, railGroupForApp, railAutoCollapseActive, railItemsForCatalog, routeAutoCollapses } from "@/shell/railGroups";

describe("rail group mapping", () => {
  test("covers every core catalog route and keeps Main heading free", () => {
    for (const app of APP_CATALOG) expect(RAIL_GROUP_BY_APP_ID[app.to] ?? railGroupForApp(app.to)).toBeTruthy();
    expect(RAIL_GROUPS[0]).toEqual({ id: "main" });
  });

  test("the media group is headed Media, holds Audio, Video and Image, and Audio and Video are there even when nothing is pinned", () => {
    expect(RAIL_GROUPS.find((group) => group.id === "create")?.label).toBe("Media");
    for (const to of ["/apps/audio", "/apps/video", "/apps/image"]) expect(railGroupForApp(to)).toBe("create");
    const apps = [
      { to: "/apps/audio", label: "Audio", icon: "headphones", description: "" },
      { to: "/apps/video", label: "Video", icon: "film", description: "" },
      { to: "/apps/image", label: "Image", icon: "image", description: "" },
    ] as unknown as Parameters<typeof railItemsForCatalog>[0];
    const none = railItemsForCatalog(apps, []).map((item) => item.href);
    expect(none).toContain("/apps/audio");
    expect(none).toContain("/apps/video");
    expect(none).not.toContain("/apps/image");
    expect(railItemsForCatalog(apps, ["/apps/image"]).map((item) => item.href)).toContain("/apps/image");
  });

  test("routes owning a side column auto-collapse, with siblings staying open", () => {
    expect(AUTO_COLLAPSE_PREFIXES).toEqual(["/chat", "/settings", "/files", "/apps/audio", "/apps/video"]);
    for (const path of ["/chat", "/chat/projects", "/settings/profile", "/files", "/apps/audio", "/apps/audio/play", "/apps/video/edit"]) {
      expect(routeAutoCollapses(path)).toBe(true);
    }
    for (const path of ["/", "/media", "/apps/weather", "/apps/news"]) expect(routeAutoCollapses(path)).toBe(false);
  });

  test("the grouped list keeps the same app destinations available in both rail states", () => {
    const items = railItemsForCatalog(APP_CATALOG);
    const destinations = new Set(items.map((item) => item.href));
    for (const path of ["/chat", "/media", "/files", "/people"]) expect(destinations.has(path)).toBe(true);
    for (const app of APP_CATALOG) expect(railGroupForApp(app.to)).toBeTruthy();
    expect(items.every((item) => Boolean(item.group))).toBe(true);
  });
});

describe("the person's click wins on pages that fold the menu", () => {
  test("chat folds by itself, a click that expands it keeps it open there, and other pages never fold", () => {
    expect(railAutoCollapseActive("/chat", false)).toBe(true);
    expect(railAutoCollapseActive("/chat", true)).toBe(false);
    expect(railAutoCollapseActive("/settings/chat", true)).toBe(false);
    expect(railAutoCollapseActive("/", false)).toBe(false);
  });
});
