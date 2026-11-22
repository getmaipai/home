// CODE-UX-01: manage Code sessions from the list: rename, pin, archive, unread, and delete with undo through the household Trash.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { codingMessages, codingSessions, people } from "@/db/schema";
import { createCodingSession, updateSession } from "@/lib/codingSessions";
import { purgeExpired } from "@/lib/trash/registry";
import { setHouseholdSettingValue } from "@/lib/settings";
import { TestClient } from "./client";
import { startRig, input } from "./codingRig";
import type { PersonRow } from "@/types";

let rig: ReturnType<typeof startRig>; let client: TestClient; let actor: PersonRow;
beforeEach(async () => {
  rig = startRig(); client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  actor = db.select().from(people).where(eq(people.displayName, "Sage")).get() as PersonRow;
});
afterEach(() => rig.restore());

const base = "/api/code/sessions";
type Listed = { id: string; title: string; state: string; pinned_at: string | null; archived_at: string | null; unread: boolean };
const list = async () => (await (await client.get(base)).json()) as Listed[];
const make = (title = "Fix the thermostat bug") => createCodingSession(actor, input({ title }));
async function otherClient(): Promise<TestClient> {
  const res = await client.post("/api/people", { displayName: "Marlow", role: "adult", secret: "0000" });
  const { id } = (await res.json()) as { id: string };
  const other = new TestClient(); await other.post("/api/auth/verify-secret", { personId: id, secret: "0000" });
  return other;
}

describe("rename, pin and archive", () => {
  test("a new session lists with no pin, no archive and no unread dot", async () => {
    make();
    expect(await list()).toMatchObject([{ pinned_at: null, archived_at: null, unread: false }]);
  });
  test("rename trims the title, refuses an empty one with a next step, and keeps the activity order", async () => {
    const s = make();
    const ok = await client.put(`${base}/${s.id}/title`, { title: "  Wire the lamp  " });
    expect(ok.status).toBe(200); expect(((await ok.json()) as Listed).title).toBe("Wire the lamp");
    const bad = await client.put(`${base}/${s.id}/title`, { title: "   " });
    expect(bad.status).toBe(400); expect(((await bad.json()) as { error: string }).error).toContain("Type a name");
    expect((await list())[0]!.title).toBe("Wire the lamp");
  });
  test("pin and unpin set and clear pinned_at without moving the activity time", async () => {
    const s = make(); const before = db.select().from(codingSessions).where(eq(codingSessions.id, s.id)).get()!.lastActivityAt;
    const pinned = (await (await client.put(`${base}/${s.id}/pin`, { pinned: true })).json()) as Listed;
    expect(pinned.pinned_at).not.toBeNull();
    expect(db.select().from(codingSessions).where(eq(codingSessions.id, s.id)).get()!.lastActivityAt).toBe(before);
    expect(((await (await client.put(`${base}/${s.id}/pin`, { pinned: false })).json()) as Listed).pinned_at).toBeNull();
  });
  test("archive keeps the state, unarchive brings it back, and a working or waiting session is refused", async () => {
    const s = make();
    const done = (await (await client.put(`${base}/${s.id}/archive`, { archived: true })).json()) as Listed;
    expect(done).toMatchObject({ state: "idle" }); expect(done.archived_at).not.toBeNull();
    expect(((await (await client.put(`${base}/${s.id}/archive`, { archived: false })).json()) as Listed).archived_at).toBeNull();
    for (const state of ["working", "needs_you"] as const) {
      updateSession(s.id, { state });
      const refused = await client.put(`${base}/${s.id}/archive`, { archived: true });
      expect(refused.status).toBe(409); expect(((await refused.json()) as { error: string }).error).toContain("archive it");
    }
  });
  test("every route is owner only: another person gets a not-found and changes nothing", async () => {
    const s = make(); const other = await otherClient();
    expect((await other.put(`${base}/${s.id}/title`, { title: "Mine now" })).status).toBe(404);
    expect((await other.put(`${base}/${s.id}/pin`, { pinned: true })).status).toBe(404);
    expect((await other.put(`${base}/${s.id}/archive`, { archived: true })).status).toBe(404);
    expect((await other.post(`${base}/${s.id}/opened`, {})).status).toBe(404);
    expect((await other.delete(`${base}/${s.id}`)).status).toBe(404);
    expect(await list()).toMatchObject([{ title: "Fix the thermostat bug", pinned_at: null, archived_at: null }]);
  });
  test("a signed-out request is refused", async () => {
    const s = make(); const anon = new TestClient();
    expect((await anon.put(`${base}/${s.id}/pin`, { pinned: true })).status).toBe(401);
  });
  test("a person whose Coding access ended cannot change the list", async () => {
    const s = make(); setHouseholdSettingValue("coding.enabled", false);
    expect((await client.put(`${base}/${s.id}/pin`, { pinned: true })).status).toBe(403);
  });
});

describe("unread", () => {
  const later = (s: { id: string }, state: "idle" | "needs_you" | "working" | "failed") => updateSession(s.id, { state, lastActivityAt: new Date(Date.now() + 5000).toISOString() });
  test("a session that settles after it was last opened is unread, and opening it clears the dot", async () => {
    const s = make(); later(s, "idle");
    expect((await list())[0]!.unread).toBe(true);
    expect(((await (await client.post(`${base}/${s.id}/opened`, {})).json()) as Listed).unread).toBe(false);
    expect((await list())[0]!.unread).toBe(false);
  });
  test("needs you and failed also count, a working turn does not, and an archived session never does", async () => {
    const a = make("A"); const b = make("B"); const c = make("C"); const d = make("D");
    later(a, "needs_you"); later(b, "failed"); later(c, "working"); later(d, "idle");
    await client.put(`${base}/${d.id}/archive`, { archived: true });
    const byTitle = Object.fromEntries((await list()).map((r) => [r.title, r.unread]));
    expect(byTitle).toEqual({ A: true, B: true, C: false, D: false });
  });
  test("a session that existed before this change starts as seen (the migration backfill)", async () => {
    const s = make(); const row = db.select().from(codingSessions).where(eq(codingSessions.id, s.id)).get()!;
    expect(row.lastOpenedAt).toBe(row.lastActivityAt);
  });
});

describe("delete and undo through the Trash", () => {
  test("delete hides the session, the Trash lists it, restore brings it back idle, and another person cannot restore it", async () => {
    const s = make(); const other = await otherClient();
    expect((await client.delete(`${base}/${s.id}`)).status).toBe(200);
    expect(await list()).toEqual([]);
    const rows = ((await (await client.get("/api/trash")).json()) as { rows: { kind: string; id: string; can_restore: boolean }[] }).rows;
    expect(rows).toMatchObject([{ kind: "coding_session", id: s.id, can_restore: true }]);
    expect((await other.post(`/api/trash/coding_session/${s.id}/restore`, {})).status).toBe(404);
    expect((await client.post(`/api/trash/coding_session/${s.id}/restore`, {})).status).toBe(200);
    expect(await list()).toMatchObject([{ id: s.id, state: "idle" }]);
  });
  test("an expired session is purged with its transcript, and a purge by hand removes it too", async () => {
    const a = make("A"); const b = make("B");
    for (const id of [a.id, b.id]) db.insert(codingMessages).values({ id: `cmsg-${id}`, sessionId: id, personId: actor.id, seq: 1, role: "user", parts: [{ type: "text", text: "hi" }], createdAt: new Date().toISOString(), hlc: "1:0:aaaaaa" }).run();
    await client.delete(`${base}/${a.id}`); await client.delete(`${base}/${b.id}`);
    db.update(codingSessions).set({ trashUntil: "2020-01-01T00:00:00.000Z" }).where(eq(codingSessions.id, a.id)).run();
    purgeExpired();
    expect(db.select().from(codingSessions).where(eq(codingSessions.id, a.id)).get()).toBeUndefined();
    expect(db.select().from(codingMessages).where(eq(codingMessages.sessionId, a.id)).all()).toEqual([]);
    expect(db.select().from(codingSessions).where(eq(codingSessions.id, b.id)).get()).toBeDefined();
    expect((await client.delete(`/api/trash/coding_session/${b.id}`)).status).toBe(200);
    expect(db.select().from(codingSessions).where(eq(codingSessions.id, b.id)).get()).toBeUndefined();
  });
});
