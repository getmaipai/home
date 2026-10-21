import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// The rail renders core-destination icons as anonymous SVGs (AppRail.tsx), so a
// rendered DOM cannot read the icon name: check the route's own source instead.
// Videos' rail icon is "film" (backend/packages/videos/manifest.json); Media
// must not reuse it, or the two destinations look identical.
const routes = readFileSync(new URL("./Routes.tsx", import.meta.url), "utf8");

test("the Media rail destination uses the cast icon, not the Videos app's film icon", () => {
  expect(routes).toContain('name: "Media", url: "/media", icon: "cast"');
  expect(routes).not.toContain('icon: "film" }]}');
});
