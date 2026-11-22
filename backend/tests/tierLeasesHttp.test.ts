// TIER-LEASE-03: the shared lease API over HTTP. Holder-only touch, yield, release; pin only by admins; Pause keeps everything across a restart; Resume is a queued turn; Lower only lowers.
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
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
import { createCodingSession, getCodingSession, settleSessionsAtStartup } from "@/lib/codingSessions";
import { submitTurn, turnFinished } from "@/lib/codingTurns";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { ENV, person as makePerson, settled, startRig } from "./codingRig";

let mode: "normal" | "coding" = "normal";
const server = Bun.serve({
  port: 0, hostname: "127.0.0.1",
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === "/stack/v1/roles") return Response.json({ roles: [{ id: "coding", label: "Coding", wire: "chat", residency: "swap", endpoints: [], quality: [], sharesModelWith: null, state: { state: "ready", since: "2026-10-22T00:00:00Z" }, reason: null, model: null, check: { state: "passed", at: null, reason: null, stale: false } }] });
    if (path === "/stack/v1/coding/mode" && req.method === "POST") { mode = ((await req.json()) as { mode: "normal" | "coding" }).mode; return Response.json({ mode, state: "stable" }); }
    if (path === "/stack/v1/coding/mode") return Response.json({ mode, target: mode, state: "stable", reason: null, available: true, checks: { engine: true, pieces: true, hardware: true, memory: true, bench: true }, memory: { plan_bytes: 1, budget_bytes: 2 }, self_test: { passed_at: "2026-11-01T00:00:00.000Z", stale: false } });
    return Response.json({ error: "unscripted" }, { status: 404 });
  },
});
afterAll(() => { server.stop(true); __resetStackEngineForTests(); });

let clock = Date.now(); let restore: () => void = () => undefined;
beforeEach(() => {
  mode = "normal"; clock = Date.now();
  __setStackClientForTests(createStackClient({ baseUrl: `http://127.0.0.1:${server.port}` }));
  __resetChatLeaseForTests(() => clock);
});
afterEach(() => { restore(); restore = () => undefined; });

async function signedIn() {
  const rig = startRig(); restore = rig.restore; // resets the database, then Code's fake runtime
  setHouseholdSettingValue("coding.enabled", true); setSetupCodingChoice("later"); __setMissingCodingPieceForTests(null);
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
  return { client, actor, rig };
}
const become = (actor: { id: string }, role: "adult" | "owner") => { db.update(people).set({ role }).where(eq(people.id, actor.id)).run(); invalidateSessionCacheForPerson(actor.id); };

describe("the lease view and the holder-only calls", () => {
  test("nobody holds it: touch, yield and release are refused for everyone, the view shows counts only", async () => {
    const { client } = await signedIn();
    for (const call of ["touch", "yield", "release"]) expect((await client.post(`/api/tier-leases/chat/${call}`, {})).status).toBe(403);
    const view = await (await client.get("/api/tier-leases/chat")).json();
    expect(view).toMatchObject({ key: "chat", state: "off", held_by_you: false, waiters: { count: 0, kinds: [] } });
    expect((await client.get("/api/tier-leases/nope")).status).toBe(404);
  });
  test("a non-holder is refused while another person holds it, and the view never names the holder", async () => {
    const { client, actor } = await signedIn();
    const other = makePerson("adult");
    createGrant({ id: actor.id, role: "owner" }, { person: other.id, action: "tier.max:chat", effect: "allow", acknowledged_at: new Date().toISOString(), acknowledged_by_person_id: actor.id });
    expect((await getChatLease().acquire(other, { category: "chat" })).ok).toBe(true);
    for (const call of ["touch", "yield", "release"]) expect((await client.post(`/api/tier-leases/chat/${call}`, {})).status).toBe(403);
    expect(getChatLease().snapshot().state).toBe("held"); // nothing was released by the refused calls
    const view = await client.get("/api/tier-leases/chat");
    const text = await view.text();
    expect(text).not.toContain(other.id);
    expect(JSON.parse(text)).toMatchObject({ state: "held", held_by_you: false, releases_in_seconds: null, decision: null });
  });
  test("the holder touches, then yields: released at once with nothing in flight", async () => {
    const { client, actor } = await signedIn();
    expect((await getChatLease().acquire(actor as never, { category: "chat" })).ok).toBe(true);
    clock += 60_000; // the grace has been running a minute
    const touched = await (await client.post("/api/tier-leases/chat/touch", {})).json();
    expect(touched).toMatchObject({ held_by_you: true, state: "held" });
    const yielded = await (await client.post("/api/tier-leases/chat/yield", {})).json();
    expect(yielded).toMatchObject({ state: "off", held_by_you: false });
    expect(mode).toBe("normal");
  });
  test("a yield while a request runs waits for the next boundary and never cuts the request off", async () => {
    const { client, actor } = await signedIn();
    const lease = getChatLease();
    await lease.acquire(actor as never, { category: "chat" });
    lease.requestStarted(actor.id);
    expect(await (await client.post("/api/tier-leases/chat/yield", {})).json()).toMatchObject({ state: "held" });
    expect(await lease.tick()).toBe(false);
    lease.requestEnded(actor.id);
    expect(await lease.tick()).toBe(true);
    expect(lease.snapshot().state).toBe("off");
  });
});

describe("pin", () => {
  test("only an admin or owner sets or clears a pin; an adult is refused and nothing changes", async () => {
    const { client, actor } = await signedIn();
    await getChatLease().acquire(actor as never, { category: "chat" });
    become(actor, "adult");
    expect((await client.request("/api/tier-leases/chat/pin", { method: "PUT", body: { pinned: true } })).status).toBe(403);
    expect(getChatLease().snapshot().pinned).toBe(false);
    become(actor, "owner");
    expect(await (await client.request("/api/tier-leases/chat/pin", { method: "PUT", body: { pinned: true } })).json()).toMatchObject({ pinned: true });
    expect(await (await client.request("/api/tier-leases/chat/pin", { method: "PUT", body: { pinned: false } })).json()).toMatchObject({ pinned: false });
  });
});

describe("Pause, Resume and Lower for coding", () => {
  test("pause keeps the session through a restart with nothing lost, and an owner other than the session's is refused", async () => {
    const { client, actor } = await signedIn();
    const s = createCodingSession(actor as never, { title: "Fix the bug", repo: { kind: "none", base_branch: "main", work_branch: "code/fix" }, environment_id: ENV, tier: "standard" });
    const res = await (await client.post("/api/tier-leases/coding/pause", { session_id: s.id })).json();
    expect(res).toMatchObject({ state: "paused", pause_max_minutes: 60 });
    settleSessionsAtStartup(); // a hub restart
    expect(getCodingSession(actor as never, s.id)).toMatchObject({ state: "paused", title: "Fix the bug", tier: "standard" });
    // someone else's session is not found for this caller (never confirmed to exist)
    const other = makePerson("adult");
    const theirs = createCodingSession(other, { title: "Theirs", repo: { kind: "none", base_branch: "main", work_branch: "code/x" }, environment_id: ENV, tier: "standard" });
    expect((await client.post("/api/tier-leases/coding/pause", { session_id: theirs.id })).status).toBe(404);
    expect(getCodingSession(other, theirs.id)!.state).not.toBe("paused");
  });
  test("pause during a running turn waits for it; resume queues a new turn and a session that is not paused is refused", async () => {
    const { client, actor, rig } = await signedIn();
    const s = createCodingSession(actor as never, { title: "Work", repo: { kind: "none", base_branch: "main", work_branch: "code/w" }, environment_id: ENV, tier: "standard" });
    const sent = submitTurn(actor as never, s.id, "go"); await settled();
    expect(await (await client.post("/api/tier-leases/coding/pause", { session_id: s.id })).json()).toMatchObject({ state: "pausing" });
    rig.agent.finishAll(); await turnFinished(sent.turn_id); await settled();
    expect(getCodingSession(actor as never, s.id)!.state).toBe("paused");
    const resumed = await client.post("/api/tier-leases/coding/resume", { session_id: s.id });
    expect(resumed.status).toBe(200);
    const turnId = ((await resumed.json()) as { turn_id: string }).turn_id;
    await settled(); rig.agent.finishAll(); await turnFinished(turnId);
    expect((await client.post("/api/tier-leases/coding/resume", { session_id: s.id })).status).toBe(409);
  });
  test("lower only lowers: Max to Standard works, Standard to Standard is refused", async () => {
    const { client, actor } = await signedIn();
    const s = createCodingSession(actor as never, { title: "Tiered", repo: { kind: "none", base_branch: "main", work_branch: "code/t" }, environment_id: ENV, tier: "max" });
    expect(s.tier).toBe("max");
    expect(await (await client.post("/api/tier-leases/coding/lower", { session_id: s.id, to: "standard" })).json()).toEqual({ tier: "standard" });
    expect((await client.post("/api/tier-leases/coding/lower", { session_id: s.id, to: "standard" })).status).toBe(400);
    expect((await client.post("/api/tier-leases/coding/lower", { session_id: s.id, to: "boost" })).status).toBe(400);
  });
});
