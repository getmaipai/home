// TIER-HOME-05: the Max chat lease end to end across Home's HTTP routes to a fake Stack that also speaks HTTP (the real Stack client
// talks to a Bun.serve on loopback). Holder rules, the not_ready answer that names the self-test, the self-test route, and the idle release.
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { createGrant } from "@/lib/grants";
import { invalidateSessionCacheForPerson } from "@/middleware/auth";
import { setHouseholdSettingValue } from "@/lib/settings";
import { setSetupCodingChoice } from "@/lib/setupState";
import { __setMissingCodingPieceForTests } from "@/lib/stackCodingPieces";
import { __resetStackEngineForTests, __setStackClientForTests } from "@/lib/stackEngine";
import { __resetChatLeaseForTests, getChatLease } from "@/lib/chatLeaseRuntime";
import { createStackClient } from "@/lib/stack/client";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

let mode: "normal" | "coding" = "normal";
let selfTestPassedAt: string | null = null;
let stale = false;
let swapFails = false;
let requests: string[] = [];

const server = Bun.serve({
  port: 0, hostname: "127.0.0.1",
  async fetch(req) {
    const path = new URL(req.url).pathname;
    requests.push(`${req.method} ${path}`);
    if (path === "/stack/v1/roles") {
      return Response.json({ roles: [{ id: "coding", label: "Coding", wire: "chat", residency: "swap", endpoints: [], quality: [], sharesModelWith: null, state: { state: "ready", since: "2026-10-22T00:00:00Z" }, reason: null, model: null, check: { state: "passed", at: null, reason: null, stale: false } }] });
    }
    if (path === "/stack/v1/coding/mode/self-test") {
      selfTestPassedAt = new Date().toISOString(); stale = false;
      return Response.json({ accepted: true }, { status: 202 });
    }
    if (path === "/stack/v1/coding/mode" && req.method === "POST") {
      if (swapFails) return Response.json({ reason: "The big model did not pass its check." }, { status: 503 });
      mode = ((await req.json()) as { mode: "normal" | "coding" }).mode;
      return Response.json({ mode, state: "stable" });
    }
    if (path === "/stack/v1/coding/mode") {
      return Response.json({
        mode, target: mode, state: "stable", reason: null, available: true,
        checks: { engine: true, pieces: true, hardware: true, memory: true, bench: true },
        memory: { plan_bytes: 1, budget_bytes: 2 }, self_test: { passed_at: selfTestPassedAt, stale },
      });
    }
    return Response.json({ error: "unscripted" }, { status: 404 });
  },
});
afterAll(() => { server.stop(true); __resetStackEngineForTests(); });

let clock = Date.now();
beforeEach(() => {
  resetDb(); mode = "normal"; selfTestPassedAt = "2026-11-01T00:00:00.000Z"; stale = false; swapFails = false; requests = []; clock = Date.now();
  __setStackClientForTests(createStackClient({ baseUrl: `http://127.0.0.1:${server.port}` }));
  setHouseholdSettingValue("coding.enabled", true);
  setSetupCodingChoice("later");
  __setMissingCodingPieceForTests(null);
  __resetChatLeaseForTests(() => clock);
});

async function owner() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, actor };
}
/** The signed-in owner becomes another role after the grant is written, so the same session plays the grant holder, the teen and the child. */
function become(actor: { id: string }, role: "adult" | "teen" | "child") {
  db.update(people).set({ role }).where(eq(people.id, actor.id)).run();
  invalidateSessionCacheForPerson(actor.id);
}
function grantMax(actor: { id: string; role: never }) {
  const made = createGrant({ id: actor.id, role: "owner" }, { person: actor.id, action: "tier.max:chat", effect: "allow", acknowledged_at: new Date().toISOString(), acknowledged_by_person_id: actor.id });
  expect(made.ok).toBe(true);
}

describe("Max chat lease over HTTP (TIER-HOME-05)", () => {
  test("an adult with the Max chat grant takes the lease, the Stack swaps once, and giving it back swaps the standard model in", async () => {
    const { client, actor } = await owner();
    grantMax(actor as never); become(actor, "adult");
    expect(await (await client.get("/api/ai/chat-lease")).json()).toMatchObject({ state: "off", can_use: true, held_by_you: false });
    const taken = await (await client.post("/api/ai/chat-lease", {})).json();
    expect(taken).toMatchObject({ state: "held", held_by_you: true, pinned: false });
    expect(mode).toBe("coding");
    expect(requests.filter((r) => r === "POST /stack/v1/coding/mode")).toHaveLength(1);
    const released = await (await client.delete("/api/ai/chat-lease")).json();
    expect(released).toMatchObject({ state: "off", held_by_you: false });
    expect(mode).toBe("normal");
  });

  test("an adult with no grant is refused with a plain line and nothing is swapped", async () => {
    const { client, actor } = await owner();
    become(actor, "adult");
    expect(await (await client.get("/api/ai/chat-lease")).json()).toMatchObject({ can_use: false });
    const res = await client.post("/api/ai/chat-lease", {});
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "not_a_holder", error: expect.stringContaining("Ask an admin") });
    expect(mode).toBe("normal");
  });

  test("a teen and a child never hold it, even with the grant row present", async () => {
    for (const role of ["teen", "child"] as const) {
      resetDb(); mode = "normal"; requests = []; __resetChatLeaseForTests(() => clock);
      const { client, actor } = await owner();
      grantMax(actor as never); become(actor, role);
      expect(await (await client.get("/api/ai/chat-lease")).json()).toMatchObject({ can_use: false });
      expect((await client.post("/api/ai/chat-lease", {})).status).toBe(403);
      expect(requests.filter((r) => r === "POST /stack/v1/coding/mode")).toHaveLength(0);
    }
  });

  test("a stale self-test answers not_ready and says the self-test is the missing step", async () => {
    const { client } = await owner();
    stale = true;
    const res = await client.post("/api/ai/chat-lease", {});
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: "not_ready", first_unmet: "self_test", error: "Max needs a self-test first." });
    expect(mode).toBe("normal");
  });

  test("the self-test route (owner and admin) refreshes the record, and the next request gets the lease", async () => {
    const { client } = await owner();
    stale = true;
    expect((await client.post("/api/ai/chat-lease", {})).status).toBe(409);
    expect((await client.post("/api/coding/mode/self-test", {})).status).toBe(202);
    const mine = await (await client.get("/api/coding/mode")).json() as { readiness: { ready: boolean } };
    expect(mine.readiness.ready).toBe(true);
    expect((await client.post("/api/ai/chat-lease", {})).status).toBe(200);
    expect(mode).toBe("coding");
  });

  test("a failed swap leaves chat as it was and says so", async () => {
    const { client } = await owner();
    swapFails = true;
    const res = await client.post("/api/ai/chat-lease", {});
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: "swap_failed" });
    expect(await (await client.get("/api/ai/chat-lease")).json()).toMatchObject({ state: "off" });
  });

  test("the lease ends by itself after 30 quiet minutes and the Stack is told to return the standard model", async () => {
    const { client } = await owner();
    expect((await client.post("/api/ai/chat-lease", {})).status).toBe(200);
    getChatLease().requestStarted(); getChatLease().requestEnded();
    clock += 29 * 60_000;
    expect(await getChatLease().tick()).toBe(false);
    expect(mode).toBe("coding");
    clock += 2 * 60_000;
    expect(await getChatLease().tick()).toBe(true);
    expect(mode).toBe("normal");
    expect(await (await client.get("/api/ai/chat-lease")).json()).toMatchObject({ state: "off", held_by_you: false });
  });
});
