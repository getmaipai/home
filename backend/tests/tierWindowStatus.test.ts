// TIER-STATUS-01: the Max window line, `minutes_left` and the admin Stop follow the Stack's own governor window (a fake Stack over HTTP),
// not a flag Home keeps. A Stack that cannot say falls back to Home's record, so an older Stack still works.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { createStackClient } from "@/lib/stack/client";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { registerQueueProvider, releaseHouseholdQueue, resetTierStateForTests, type QueueJob } from "@/lib/jobs/householdQueue";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

let server: ReturnType<typeof Bun.serve>;
let memoryBody: Record<string, unknown> | "down";
let stops = 0;

beforeEach(() => {
  resetDb(); resetTierStateForTests(); stops = 0; memoryBody = { reduced_chat: false, max_window: { state: "none", owner: null, since: null } };
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
    if (new URL(req.url).pathname === "/stack/v1/memory") return memoryBody === "down" ? new Response("no", { status: 503 }) : Response.json(memoryBody);
    return new Response("not found", { status: 404 });
  } });
  __setStackClientForTests(createStackClient({ baseUrl: `http://127.0.0.1:${server.port}` }));
});
afterEach(() => { server.stop(true); __resetStackEngineForTests(); });

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  return { client, actor: db.select().from(people).where(eq(people.displayName, "Sage")).get()! };
}
/** A Max video job Home believes is running, with 7 minutes left. */
async function runningMax(): Promise<() => void> {
  const job: QueueJob = { id: "max-1", personId: "p1", jobClass: "video", tier: "max", state: "running", createdAt: Date.now(), remainingSeconds: 420 };
  const remove = registerQueueProvider(() => [{ job, save: () => undefined, stop: async () => { stops += 1; job.state = "cancelled"; } }]);
  await releaseHouseholdQueue();
  return remove;
}

describe("the Max window comes from the Stack", () => {
  test("the Stack's open window shows the line and minutes, and Stop ends the job", async () => {
    const { client } = await owner();
    const remove = await runningMax();
    try {
      memoryBody = { max_window: { state: "open", owner: "stack-job-9", since: new Date().toISOString() } };
      const body = await (await client.get("/api/ai/tier-window")).json() as { open: boolean; minutes_left: number | null; line: string | null };
      expect(body.open).toBe(true);
      expect(body.minutes_left).toBe(7);
      expect(body.line).toContain("Max job is running");
      expect(await (await client.post("/api/ai/tier-window/stop", {})).json()).toEqual({ stopped: true });
      expect(stops).toBe(1);
    } finally { remove(); }
  });

  test("Home thinks a Max job runs but the Stack says no window is open: no line, and Stop does nothing", async () => {
    const { client } = await owner();
    const remove = await runningMax();
    try {
      memoryBody = { max_window: { state: "none", owner: null, since: null } };
      const body = await (await client.get("/api/ai/tier-window")).json() as { open: boolean; minutes_left: number | null; line: string | null };
      expect(body).toMatchObject({ open: false, minutes_left: null, line: null });
      expect(await (await client.post("/api/ai/tier-window/stop", {})).json()).toEqual({ stopped: false });
      expect(stops).toBe(0);
    } finally { remove(); }
  });

  test("a window that is still draining running work is not open yet", async () => {
    const { client } = await owner();
    memoryBody = { max_window: { state: "draining", owner: "stack-job-9", since: new Date().toISOString() } };
    expect((await (await client.get("/api/ai/tier-window")).json() as { open: boolean }).open).toBe(false);
  });

  test("a Stack without the field, or one that cannot answer, falls back to Home's own record", async () => {
    const { client } = await owner();
    const remove = await runningMax();
    try {
      memoryBody = { reduced_chat: false };
      expect((await (await client.get("/api/ai/tier-window")).json() as { open: boolean; minutes_left: number }).minutes_left).toBe(7);
      memoryBody = "down";
      expect((await (await client.get("/api/ai/tier-window")).json() as { open: boolean }).open).toBe(true);
    } finally { remove(); }
  });
});
