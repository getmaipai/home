// CODE-AGENT-01 slice two: the /api/code/sessions routes over HTTP. Access checks, the household admission copy, the tier, a turn and its queue line,
// the held request, Stop and delete. The agent, sandbox and lease are the fakes from codingRig.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people } from "@/db/schema";
import { setHouseholdSettingValue } from "@/lib/settings";
import { invalidateSessionCacheForPerson } from "@/middleware/auth";
import { turnFinished } from "@/lib/codingTurns";
import { TestClient } from "./client";
import { ENV, settled, startRig } from "./codingRig";

let rig: ReturnType<typeof startRig>; let client: TestClient; let actor: { id: string };
beforeEach(async () => {
  rig = startRig(); client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
});
afterEach(() => rig.restore());
const body = (over: object = {}) => ({ title: "Fix it", repo: { kind: "none", base_branch: "main", work_branch: "code/fix" }, environment_id: ENV, ...over });
const make = async (over: object = {}) => (await (await client.post("/api/code/sessions", body(over))).json()) as { id: string; tier: string };

describe("sessions over HTTP", () => {
  test("a signed-out request is refused", async () => {
    expect((await new TestClient().get("/api/code/sessions")).status).toBe(401);
  });
  test("create with a tier, list, get, set tier, delete", async () => {
    const res = await client.post("/api/code/sessions", body({ tier: "max" }));
    expect(res.status).toBe(201); const s = (await res.json()) as { id: string; tier: string }; expect(s.tier).toBe("max");
    expect(((await (await client.get("/api/code/sessions")).json()) as unknown[]).length).toBe(1);
    const got = await (await client.get(`/api/code/sessions/${s.id}`)).json() as { session: { id: string }; waiting: unknown; requests: unknown[]; queued_messages: unknown[] };
    expect(got).toMatchObject({ session: { id: s.id }, waiting: null, requests: [], queued_messages: [] });
    const switched = await client.put(`/api/code/sessions/${s.id}/tier`, { tier: "standard" });
    expect(switched.status).toBe(200); expect(((await switched.json()) as { tier: string }).tier).toBe("standard");
    expect((await client.delete(`/api/code/sessions/${s.id}`)).status).toBe(200);
    expect((await client.get(`/api/code/sessions/${s.id}`)).status).toBe(404);
  });
  test("a tier the person may not run is refused with a next step, and an invalid body is a 400", async () => {
    db.update(people).set({ role: "adult" }).where(eq(people.id, actor.id)).run(); invalidateSessionCacheForPerson(actor.id);
    const s = await make();
    const res = await client.put(`/api/code/sessions/${s.id}/tier`, { tier: "max" });
    expect(res.status).toBe(403); expect(((await res.json()) as { error: string }).error).toContain("Pick another level");
    expect((await client.post("/api/code/sessions", { title: "" })).status).toBe(400);
  });
  test("coding switched off gives the household's admission copy on create and list", async () => {
    setHouseholdSettingValue("coding.enabled", false);
    const create = await client.post("/api/code/sessions", body()); expect(create.status).toBe(403);
    expect(((await create.json()) as { error: string }).error).toContain("turned off for this household");
    expect((await client.get("/api/code/sessions")).status).toBe(403);
  });
  test("a message starts a turn, a second one queues, the transcript shows both, Stop ends it", async () => {
    const s = await make();
    const sent = await client.post(`/api/code/sessions/${s.id}/messages`, { text: "one" });
    expect(sent.status).toBe(202); const turn = (await sent.json()) as { turn_id: string }; await settled();
    const queued = await (await client.post(`/api/code/sessions/${s.id}/messages`, { text: "two" })).json() as { queued_message_id: string; position: number };
    expect(queued.position).toBe(1);
    const view = await (await client.get(`/api/code/sessions/${s.id}`)).json() as { queued_messages: string[]; waiting: { turn_id: string } };
    expect(view.queued_messages).toEqual([queued.queued_message_id]); expect(view.waiting.turn_id).toBe(turn.turn_id);
    expect((await client.delete(`/api/code/sessions/${s.id}/queue/${queued.queued_message_id}`)).status).toBe(200);
    const transcript = await (await client.get(`/api/code/sessions/${s.id}/messages`)).json() as { role: string }[];
    expect(transcript.map((m) => m.role)).toEqual(["user"]);
    expect((await client.post(`/api/code/sessions/${s.id}/stop`)).status).toBe(200); await turnFinished(turn.turn_id);
    expect(((await (await client.get(`/api/code/sessions/${s.id}/events`)).json()) as { kind: string }[]).map((e) => e.kind)).toEqual(["stopped"]);
  });
  test("a Max turn that waits for the lease shows its line and offers Standard; the offer runs it at Standard", async () => {
    const s = await make({ tier: "max" });
    await rig.lease.acquire({ id: "person-other0001", role: "owner" } as never);
    const sent = await (await client.post(`/api/code/sessions/${s.id}/messages`, { text: "go" })).json() as { turn_id: string }; await settled();
    const view = await (await client.get(`/api/code/sessions/${s.id}`)).json() as { waiting: { line: string; offers_standard: boolean } };
    expect(view.waiting.offers_standard).toBe(true); expect(view.waiting.line).toContain("Max chat");
    expect((await client.post(`/api/code/sessions/${s.id}/turns/${sent.turn_id}/use-standard`)).status).toBe(200); await settled();
    expect(rig.agent.calls[0]!.tier).toBe("standard");
    expect(((await (await client.get(`/api/code/sessions/${s.id}`)).json()) as { session: { tier: string } }).session.tier).toBe("max");
    await client.post(`/api/code/sessions/${s.id}/stop`);
  });
  test("a session id from nowhere is a 404, never another person's record", async () => {
    expect((await client.get("/api/code/sessions/csess-nothere0001")).status).toBe(404);
    expect((await client.post("/api/code/sessions/csess-nothere0001/stop")).status).toBe(404);
  });
});
