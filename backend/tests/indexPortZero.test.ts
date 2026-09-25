import { describe, expect, test } from "bun:test";
describe("backend port-zero startup", () => {
  test("port zero binds an actual port suitable for the reported startup URL", () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    try {
      const startupUrl = `Home URL: http://localhost:${server.port}`;
      const port = Number(startupUrl.match(/localhost:(\d+)/)?.[1]);
      expect(server.port).toBeGreaterThan(0);
      expect(port).toBe(server.port!);
    } finally {
      server.stop(true);
    }
  });
});
