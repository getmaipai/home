// ISOLATION-04 (Home's half): every write Home sends to the Stack carries the Stack's token; reads carry none; a refused write is sent once more
// with a freshly read key; a Stack that still refuses ends in the Stack's own sentence and one Repairs row; the row closes when a write is accepted.
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { __resetStackFetchForTests, stackFetch } from "@/lib/stack/stackFetch";
import { __setHomeViewTokenForTests } from "@/lib/stack/homeViewToken";
import { listIssues } from "@/lib/issues";
import { createStackClient } from "@/lib/stack/client";

let accepted = "k".repeat(32);
let seen: Array<{ method: string; path: string; token: string | null }> = [];
let server: ReturnType<typeof Bun.serve>;
let base = "";

beforeAll(() => {
  server = Bun.serve({
    port: 0, hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      const token = request.headers.get("x-maipai-home-token");
      seen.push({ method: request.method, path: url.pathname, token });
      if (request.method !== "GET" && token !== accepted) return Response.json({ error: "Home's token is missing.", code: token ? "home_token_refused" : "home_token_required" }, { status: 401 });
      return Response.json({ ok: true });
    },
  });
  base = `http://127.0.0.1:${server.port}`;
});
afterAll(() => server.stop(true));
beforeEach(() => { resetDb(); seen = []; accepted = "k".repeat(32); __resetStackFetchForTests(); __setHomeViewTokenForTests(accepted); });
afterEach(() => { __setHomeViewTokenForTests(undefined); });

const stackIssues = () => listIssues().filter((issue) => issue.source === "stack" && issue.key === "stack.home_token" && issue.resolved_at === null);

test("a write carries the token and a read carries none", async () => {
  expect((await stackFetch(`${base}/v1/images/generations`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(200);
  expect((await stackFetch(`${base}/stack/v1/jobs/j1`, { method: "DELETE" })).status).toBe(200);
  expect((await stackFetch(`${base}/stack/v1/jobs`)).status).toBe(200);
  expect(seen.map((s) => [s.method, s.token])).toEqual([["POST", accepted], ["DELETE", accepted], ["GET", null]]);
});

test("the spec client's own writes go through it (Home to Stack happy path)", async () => {
  const client = createStackClient({ baseUrl: base });
  await client.cancelJob?.("job-1").catch(() => undefined);
  expect(seen.some((s) => s.method !== "GET" && s.token === accepted)).toBe(true);
});

test("a key the Stack rotated is read again and the write goes through on the second try", async () => {
  __setHomeViewTokenForTests("old".repeat(12));
  accepted = "old".repeat(12);
  expect((await stackFetch(`${base}/x`, { method: "POST", body: "{}" })).status).toBe(200);
  accepted = "new".repeat(12);
  __setHomeViewTokenForTests(accepted); // the file now holds the new key; the cache is told it was refused on the next call
  expect((await stackFetch(`${base}/x`, { method: "POST", body: "{}" })).status).toBe(200);
  expect(stackIssues()).toHaveLength(0);
});

test("a Stack that keeps refusing gives back its own sentence and one Repairs row, which closes on the next accepted write", async () => {
  __setHomeViewTokenForTests("w".repeat(32));
  const res = await stackFetch(`${base}/x`, { method: "POST", body: "{}" });
  expect(res.status).toBe(401);
  expect((await res.json() as { code: string }).code).toBe("home_token_refused");
  await Bun.sleep(20);
  const rows = stackIssues();
  expect(rows).toHaveLength(1);
  expect(JSON.stringify(rows[0])).not.toContain("w".repeat(8));
  expect(rows[0]!.detail).toContain("Restart");
  __setHomeViewTokenForTests(accepted);
  expect((await stackFetch(`${base}/x`, { method: "POST", body: "{}" })).status).toBe(200);
  expect(stackIssues()).toHaveLength(0);
});

test("no key at all sends the write plainly and the Stack's refusal comes back", async () => {
  __setHomeViewTokenForTests(null);
  const res = await stackFetch(`${base}/x`, { method: "POST", body: "{}" });
  expect(res.status).toBe(401);
  expect(seen.filter((s) => s.method === "POST").every((s) => s.token === null)).toBe(true);
});
