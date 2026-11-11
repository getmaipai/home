import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { captureFileName } from "./screenshotRoutes";

const root = join(import.meta.dir, "..");
const inventory = readFileSync(join(root, "docs/design/ROUTE-INVENTORY.md"), "utf8");
function parseRoutes() {
  const match = inventory.match(/```json\s*([\s\S]*?)\s*```/);
  if (!match) throw new Error("Inventory JSON block not found");
  return JSON.parse(match[1]!) as Array<{ slug: string; path: string; auth: string }>;
}

describe("route screenshot baseline", () => {
  test("inventory contains valid unique routes", () => {
    const routes = parseRoutes();
    expect(routes.length).toBeGreaterThan(0);
    expect(new Set(routes.map((route) => route.path)).size).toBe(routes.length);
    for (const route of routes) expect(route).toMatchObject({ slug: expect.any(String), path: expect.stringMatching(/^\//), auth: expect.stringMatching(/^(sage|none)$/) });
  });
  test("every registered frontend route is represented", () => {
    const source = readFileSync(join(root, "frontend/src/shell/Routes.tsx"), "utf8");
    const paths = [...source.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => `/${match[1]!.replace(/^\//, "")}`);
    const inventoryPaths = new Set(parseRoutes().map((route) => route.path));
    const missing = paths.filter((path) => path !== "/*" && path !== "/*/*" && !path.endsWith("/*") && !path.includes(":") && !inventoryPaths.has(path));
    expect(missing).toEqual([]);
  });
  test("capture file-name builder matches the baseline convention", () => {
    expect(captureFileName("home", 1440, 900, "dark")).toBe("home-1440x900-dark.png");
    expect(captureFileName("apps-music-index", 402, 874, "light")).toBe("apps-music-index-402x874-light.png");
  });
});
