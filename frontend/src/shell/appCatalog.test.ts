import { expect, test } from "bun:test";
import { APP_CATALOG, favoriteApps, filterApps } from "./appCatalog";

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
