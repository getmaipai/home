import { expect, test } from "bun:test";
import { APP_CATALOG, defaultPinnedRoutes, favoriteApps, filterApps, mergeAppCatalog, railApps } from "./appCatalog";

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

// LEFTNAV-APPS-01: default pins from manifests, and the package apps the rail and its launcher list.
const weatherApp = { ...packageApp, package: "weather", label: "Weather", to: "/apps/weather", pinned_by_default: true, pin_order: 10 };
const notesApp = { ...packageApp, package: "notes", label: "Notes", icon: "calendar", to: "/apps/notes" };
const clockApp = { ...packageApp, package: "clock", label: "Clock", to: "/apps/clock", pinned_by_default: true, pin_order: 5 };
test("default pins are the apps that ask for one, lowest pin_order first, then by name", () => {
  expect(defaultPinnedRoutes([notesApp, weatherApp, clockApp])).toEqual(["/reminders", "/clock", "/apps/clock", "/apps/weather"]);
  expect(defaultPinnedRoutes([notesApp])).toEqual(["/reminders", "/clock"]);
  expect(defaultPinnedRoutes(undefined)).toEqual(["/reminders", "/clock"]);
});
test("the rail lists package apps and the starrable built-ins, pinned first in pin order, then the rest by name; a pinned fixed route is not repeated", () => {
  const apps = mergeAppCatalog([weatherApp, notesApp, clockApp], false);
  const list = railApps(apps, ["/chat", "/apps/weather"]);
  expect(list.map((app) => [app.url, app.pinned])).toEqual([["/apps/weather", true], ["/clock", false], ["/apps/clock", false], ["/apps/notes", false], ["/reminders", false], ["/wikipedia", false]]);
  expect(list[0]).toMatchObject({ name: "Weather", icon: "cloud-sun" });
});
test("an Incognito-blocked app is in neither the rail nor the launcher while Incognito is on", () => {
  const blocked = { ...weatherApp, incognito: "blocked" as const };
  expect(railApps(mergeAppCatalog([blocked, notesApp], true), ["/apps/weather"]).map((app) => app.url)).toEqual(["/clock", "/apps/notes", "/reminders", "/wikipedia"]);
  expect(railApps(mergeAppCatalog([blocked, notesApp], false), ["/apps/weather"]).map((app) => app.url)).toEqual(["/apps/weather", "/clock", "/apps/notes", "/reminders", "/wikipedia"]);
});
