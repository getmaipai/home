// CODE-FIX-02: Code says honestly whether it can run. One reason code and one plain sentence per missing piece, a session that is refused instead of started into a
// certain failure, and the same answer on GET /api/code/readiness and the Code row of Status.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { codingSessions, people } from "@/db/schema";
import { invalidateSessionCacheForPerson } from "@/middleware/auth";
import { __READY_FOR_TESTS, __setCodingReadinessForTests, readinessFrom, readinessLineFor, type CodingReadiness } from "@/lib/codingReadiness";
import type { CodeReadyId } from "@/lib/codeReady";
import { TestClient } from "./client";
import { ENV, startRig } from "./codingRig";

const missing = (id: CodeReadyId, say: string) => ({ ready: false, first_missing: { id, say, who: "an admin" as const } });
const okReady = { ready: true, first_missing: null };
const idle = { availability: "ready" as const };

describe("readinessFrom", () => {
  const ids: CodeReadyId[] = ["coding_on", "not_paused", "engine", "model", "folder", "sandbox", "exec", "gateway"];
  for (const id of ids) {
    test(`a missing ${id} is one reason code and one plain sentence with the step`, () => {
      const r = readinessFrom(missing(id, "Do the thing in Settings."), idle);
      expect(r).toMatchObject({ ready: false, reason: id });
      expect(r.sentence).toBe("Code is not ready. Do the thing in Settings.");
      expect(r.plain).toContain("Ask an admin");
    });
  }
  test("the first missing piece wins over the engine's live state", () => {
    expect(readinessFrom(missing("exec", "x"), { availability: "unavailable", cause: "offline" }).reason).toBe("exec");
  });
  test("an engine that is offline or not installed refuses; paused by an admin too; loading does not", () => {
    for (const cause of ["offline", "not_installed", "paused_by_admin"] as const) {
      const r = readinessFrom(okReady, { availability: "unavailable", cause });
      expect(r).toMatchObject({ ready: false, reason: cause }); expect(r.sentence).toStartWith("Code is not ready. ");
    }
    expect(readinessFrom(okReady, { availability: "starting", cause: "restarting" }).ready).toBe(true);
  });
  test("everything present is ready with no sentence", () => {
    expect(readinessFrom(okReady, idle)).toEqual({ ready: true, reason: "ready", sentence: null, plain: null });
  });
  test("an owner or admin reads the detail; everyone else the plain line", () => {
    const r = readinessFrom(missing("exec", "Update the engine."), idle);
    expect(readinessLineFor(r, true)).toContain("Update the engine.");
    expect(readinessLineFor(r, false)).not.toContain("Update the engine.");
  });
});

const notReady: CodingReadiness = readinessFrom(missing("exec", "The engine cannot run commands in a sandbox yet. Update the engine."), idle);
let rig: ReturnType<typeof startRig>; let client: TestClient; let actor: { id: string };
beforeEach(async () => {
  rig = startRig(); client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  actor = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
});
afterEach(() => { rig.restore(); __setCodingReadinessForTests(__READY_FOR_TESTS); });
const body = { title: "Fix it", repo: { kind: "none", base_branch: "main", work_branch: "code/fix" }, environment_id: ENV };

describe("a session never starts into a certain failure", () => {
  test("not ready: the create is refused with the sentence and nothing is stored", async () => {
    __setCodingReadinessForTests(async () => notReady);
    const res = await client.post("/api/code/sessions", body);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain("Update the engine.");
    expect(db.select().from(codingSessions).all().length).toBe(0);
  });
  test("not ready: a person who is not an admin gets the plain line, not the fix", async () => {
    db.update(people).set({ role: "adult" }).where(eq(people.id, actor.id)).run(); invalidateSessionCacheForPerson(actor.id);
    __setCodingReadinessForTests(async () => notReady);
    const res = await client.post("/api/code/sessions", body);
    expect(res.status).toBe(409);
    const error = ((await res.json()) as { error: string }).error;
    expect(error).toContain("Code is not ready"); expect(error).not.toContain("Update the engine");
  });
  test("ready: the session starts as before", async () => {
    expect((await client.post("/api/code/sessions", body)).status).toBe(201);
  });
});

describe("GET /api/code/readiness", () => {
  test("ready reads ready with no line", async () => {
    const res = await client.get("/api/code/readiness");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ready: true, reason: "ready", line: null, can_fix: true });
  });
  test("not ready: an owner reads the detail and can_fix; an adult the plain line", async () => {
    __setCodingReadinessForTests(async () => notReady);
    expect(await (await client.get("/api/code/readiness")).json()).toMatchObject({ ready: false, reason: "exec", can_fix: true, line: notReady.sentence });
    db.update(people).set({ role: "adult" }).where(eq(people.id, actor.id)).run(); invalidateSessionCacheForPerson(actor.id);
    expect(await (await client.get("/api/code/readiness")).json()).toMatchObject({ ready: false, can_fix: false, line: notReady.plain });
  });
  test("signed out is 401; Coding off is the household's refusal", async () => {
    expect((await new TestClient().get("/api/code/readiness")).status).toBe(401);
  });
});
