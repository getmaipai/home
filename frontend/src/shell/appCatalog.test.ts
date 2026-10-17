import { expect, test } from "bun:test";
import { APP_CATALOG, favoriteApps, filterApps, mergeAppCatalog } from "./appCatalog";

test("app search matches intent and multiple words", () => {
  expect(filterApps(APP_CATALOG, "saved").map((app) => app.to)).toEqual(["/memory"]);
  expect(filterApps(APP_CATALOG, "ai talk").map((app) => app.to)).toEqual(["/chat"]);
  expect(filterApps(APP_CATALOG, "missing")).toHaveLength(0);
});
test("favorites preserve personal order and ignore removed apps", () => {
  expect(favoriteApps(["/memory", "/missing", "/chat", "/memory"]).map((app) => app.to)).toEqual(["/memory", "/chat"]);
  expect(filterApps(APP_CATALOG, "", "Favorites", ["/chat"])).toHaveLength(1);
});
test("catalog filtering scales without capping the library", () => {
  const apps = Array.from({ length: 300 }, (_, i) => ({ ...APP_CATALOG[0]!, to: `/app/${i}`, label: `App ${i}` }));
  expect(filterApps(apps, "")).toHaveLength(300);
  expect(filterApps(apps, "App 299").map((app) => app.to)).toEqual(["/app/299"]);
});

// APP-KIND-04: package apps join the core list; a pin to an app that is gone stays in the stored list.
const packageApp = { package: "demo", page: "index" as const, label: "Demo weather", icon: "cloud-sun", description: "A fixture app.", category: "Utilities", keywords: ["forecast"], sections: [], to: "/apps/demo", incognito: "unaffected" as const };
test("package apps merge into the catalog, searchable by name and keyword, and pin like any app", () => {
  const apps = mergeAppCatalog([packageApp], false);
  expect(apps.map((app) => app.to)).toEqual([...APP_CATALOG.map((app) => app.to), "/apps/demo"]);
  expect(filterApps(apps, "forecast").map((app) => app.to)).toEqual(["/apps/demo"]);
  expect(filterApps(apps, "demo weather").map((app) => app.to)).toEqual(["/apps/demo"]);
  expect(favoriteApps(["/apps/demo", "/chat"], apps).map((app) => app.to)).toEqual(["/apps/demo", "/chat"]);
});
test("a package app that is gone (uninstalled, disabled, hidden) is left out of favorites but nothing rewrites the stored pins", () => {
  const pinned = ["/apps/demo", "/chat"];
  expect(favoriteApps(pinned, mergeAppCatalog([], false)).map((app) => app.to)).toEqual(["/chat"]);
  expect(pinned).toEqual(["/apps/demo", "/chat"]);
});
test("an app whose manifest blocks Incognito is hidden while Incognito is on, and a package cannot shadow a core route", () => {
  const blocked = { ...packageApp, incognito: "blocked" as const };
  expect(mergeAppCatalog([blocked], true).some((app) => app.to === "/apps/demo")).toBe(false);
  expect(mergeAppCatalog([blocked], false).some((app) => app.to === "/apps/demo")).toBe(true);
  expect(mergeAppCatalog([{ ...packageApp, to: "/chat" }], false).filter((app) => app.to === "/chat")).toHaveLength(1);
});
