import { describe, expect, test } from "bun:test";
import { visibleJobFor } from "@/lib/jobs";
import type { PersonRow } from "@/types";

const person = (id: string, role: string): PersonRow => ({ id, role, birthdate: null } as PersonRow);
const job = { id: "j1", kind: "research", state: "running", title: "Teen's private question", startedBy: "teen-1", forPerson: "teen-1", createdAt: "2026-10-06T10:00:00Z", updatedAt: "2026-10-06T10:01:00Z", progress: { fraction: 0.2 }, resultRef: "secret", raw: "private details", provenance: {} };

describe("ACTIVITY-01b job visibility", () => {
  test("the owner sees their job without admin-only raw details", () => {
    const view = visibleJobFor(person("teen-1", "teen"), job)!;
    expect(view).toMatchObject({ title: job.title, resultRef: "secret" });
    expect(view).not.toHaveProperty("raw");
  });
  test("admin sees only kind, person and duration for a teen job", () => {
    expect(visibleJobFor(person("admin-1", "admin"), job)).toEqual({ id: "j1", kind: "research", forPerson: "teen-1", durationSeconds: 60 });
  });
  test("admin sees their own job and a child's job in full", () => {
    expect(visibleJobFor(person("admin-1", "admin"), { ...job, forPerson: "admin-1" })).toMatchObject({ title: job.title, raw: "private details" });
    expect(visibleJobFor(person("admin-1", "admin"), { ...job, forPerson: "kid-1" }, new Map([["kid-1", "child"]]))).toMatchObject({ title: job.title });
  });
  test("other members cannot see another person's job", () => {
    expect(visibleJobFor(person("adult-2", "adult"), job)).toBeNull();
  });
  test("system jobs are visible to admins only", () => {
    const systemJob = { ...job, forPerson: null };
    expect(visibleJobFor(person("admin-1", "admin"), systemJob)).toMatchObject({ title: job.title });
    expect(visibleJobFor(person("member-1", "adult"), systemJob)).toBeNull();
  });
  test("a child sees their job without raw details or numeric ETA", () => {
    const view = visibleJobFor(person("child-1", "child"), { ...job, forPerson: "child-1", progress: { fraction: 0.4, eta_seconds: 125 }, raw: "stack error" })!;
    expect(view).not.toHaveProperty("raw");
    expect(view.progress).toEqual({ fraction: 0.4 });
  });
});

describe("POST /api/jobs/:id/stop with damaged provenance (AUDIT-ROUTES-01)", () => {
  test("stops the job and records the stop even when the provenance column is not JSON", async () => {
    const { TestClient } = await import("./client");
    const { resetDb } = await import("./reset-db");
    const { db } = await import("@/db");
    const { jobs, people } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    resetDb();
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const sage = db.select().from(people).where(eq(people.displayName, "Sage")).get()!;
    const now = new Date().toISOString();
    db.insert(jobs).values({ id: "job-bad-prov", kind: "research", startedBy: sage.id, forPerson: sage.id, title: "Look into it", state: "running", provenance: "{not json", createdAt: now, updatedAt: now }).run();
    const res = await client.post("/api/jobs/job-bad-prov/stop");
    expect(res.status).toBe(200);
    const row = db.select().from(jobs).where(eq(jobs.id, "job-bad-prov")).get()!;
    expect(row.state).toBe("cancelled");
    expect(JSON.parse(row.provenance).actions[0].action).toBe("stop");
  });
});
