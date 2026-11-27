import { describe, expect, test } from "bun:test";
import { createRoutePreloader } from "@/lib/routePreload";

describe("route preload", () => {
  test("runs a route loader once", async () => {
    let calls = 0;
    const preloadRoute = createRoutePreloader({ "/example": async () => { calls += 1; } });

    preloadRoute("/example");
    preloadRoute("/example");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toBe(1);
  });

  test("swallows a rejected preload and lets a later call retry", async () => {
    let calls = 0;
    const preloadRoute = createRoutePreloader({
      "/example": async () => {
        calls += 1;
        if (calls === 1) throw new Error("chunk unavailable");
      },
    });

    preloadRoute("/example");
    await new Promise((resolve) => setTimeout(resolve, 0));
    preloadRoute("/example");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toBe(2);
  });

  test("ignores an unknown path", async () => {
    let calls = 0;
    const preloadRoute = createRoutePreloader({ "/known": async () => { calls += 1; } });

    preloadRoute("/unknown");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toBe(0);
  });
  test("retries a failed preload of a route with a parameter", async () => {
    let calls = 0;
    const preloadRoute = createRoutePreloader({
      "/people/:id": async () => {
        calls += 1;
        if (calls === 1) throw new Error("chunk unavailable");
      },
    });

    preloadRoute("/people/abc");
    await new Promise((resolve) => setTimeout(resolve, 0));
    preloadRoute("/people/xyz");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toBe(2);
  });
});
