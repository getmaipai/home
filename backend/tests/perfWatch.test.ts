import { afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { OpenAPIHono } from "@hono/zod-openapi";
import { createHash } from "node:crypto";
import { db } from "@/db";
import { people, sessions } from "@/db/schema";
import { resetDb } from "./reset-db";
import { __resetPerfWatchForTests, getPerfSnapshot, slowRequestMiddleware } from "@/lib/perfWatch";
import { performanceRoutes } from "@/routes/performance";

afterEach(() => { resetDb(); __resetPerfWatchForTests(); });

test("slow middleware records only slow requests and uses a route template", async () => {
  const app = new Hono();
  app.use("*", slowRequestMiddleware);
  app.get("/items/:id", async (c) => { await Bun.sleep(c.req.query("delay") === "800" ? 800 : 100); return c.text("ok"); });
  await app.request("http://localhost/items/private-story?delay=800");
  await app.request("http://localhost/items/private-story?delay=100");
  const lines = getPerfSnapshot().slow_requests;
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain("GET /items/:id");
  expect(lines[0]).toContain("status 200");
  expect(lines[0]).not.toContain("delay");
  expect(lines[0]).not.toContain("private-story");
});

function session(id: string, role: string): string {
  const now = new Date().toISOString();
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run();
  const token = `token-${id}`;
  db.insert(sessions).values({ id: `session-${id}`, personId: id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 60_000).toISOString(), createdAt: now }).run();
  return token;
}

test("perf endpoint is owner only", async () => {
  const app = new OpenAPIHono();
  app.route("/api/performance", performanceRoutes);
  const owner = session("perf-owner", "owner");
  const adult = session("perf-adult", "adult");
  const denied = await app.request("http://localhost/api/performance/perf", { headers: { cookie: `session=${adult}` } });
  const allowed = await app.request("http://localhost/api/performance/perf", { headers: { cookie: `session=${owner}` } });
  expect(denied.status).toBe(403);
  expect(allowed.status).toBe(200);
  expect((await allowed.json() as { slow_requests: string[] }).slow_requests).toEqual([]);
});

test("slow request lines omit query strings", async () => {
  const app = new Hono();
  app.use("*", slowRequestMiddleware);
  app.get("/items/:id", async (c) => { await Bun.sleep(710); return c.text("ok"); });
  await app.request("http://localhost/items/story?secret=value");
  const [line] = getPerfSnapshot().slow_requests;
  expect(line).toContain("GET /items/:id");
  expect(line).not.toContain("?");
  expect(line).not.toContain("secret");
});

test("existing performance dashboard endpoint remains at its original path", async () => {
  const app = new OpenAPIHono();
  app.route("/api/performance", performanceRoutes);
  const token = session("perf-dashboard-owner", "owner");
  const response = await app.request("http://localhost/api/performance", { headers: { cookie: `session=${token}` } });
  expect(response.status).toBe(200);
});
