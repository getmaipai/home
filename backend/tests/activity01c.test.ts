import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { jobs, scheduledJobs, modelDownloadJobs } from "@/db/schema";
import { createJob, updateJob, listJobsForViewer, listJobsForViewerLive } from "@/lib/jobs";
import { modelDownloadJobsAsHomeJobs, pollActiveStackImageJobs, startImageProducerJob } from "@/lib/jobProducers";
import { people } from "@/db/schema";
import { runDueJobs } from "@/lib/scheduler";
import { __setStackClientForTests, __resetStackEngineForTests } from "@/lib/stackEngine";
import { startStackFixture } from "./stackFixture";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";
import { StackError } from "@/lib/stack/errors";

beforeEach(() => {
  resetDb();
  __resetStackEngineForTests();
});

const person = (id: string, role: string) => ({ id, role, birthdate: null } as never);

describe("ACTIVITY-01c producer adapters", () => {
  test("a pending image resumes polling its original Stack job id after link recovery", async () => {
    const queued = { id: "img-resume-1", kind: "image.generate", role: "image", state: "queued", percent: 0, completedBytes: 0, totalBytes: 1, status: "queued", position: null, input: { prompt: "private prompt" }, result: null, reason: null, createdAt: "2026-10-06T10:00:00.000Z", updatedAt: "2026-10-06T10:00:00.000Z" };
    const done = { ...queued, state: "done", percent: 100, status: "ready", result: { fileId: "file-resume" } };
    const fixture = startStackFixture({ "POST /stack/v1/jobs": async () => Response.json({ job: queued }, { status: 202 }) });
    try {
      const queried: string[] = [];
      const originalJob = fixture.client.job.bind(fixture.client);
      let disconnected = true;
      fixture.client.job = async (id, opts) => {
        queried.push(id);
        if (disconnected) throw new StackError("unreachable", "Stack link is unreachable");
        return id === queued.id ? done as never : originalJob(id, opts);
      };
      __setStackClientForTests(fixture.client);
      const now = new Date().toISOString();
      db.insert(people).values({ id: "adult-resume", displayName: "Adult", nickname: null, bio: null, accent: null, role: "adult", birthdate: null, avatarSeed: "a", source: "local", localOnly: false, createdAt: now, updatedAt: now, deletedAt: null, hlc: "1:0:abcdefgh", enabled: true, guestExpiresAt: null, memorializedAt: null } as never).run();
      const initial = await startImageProducerJob({ actorId: "adult-resume", prompt: "private prompt" });
      expect(initial.state).toBe("queued");
      disconnected = false;
      expect(await pollActiveStackImageJobs()).toBe(1);
      expect(queried).toEqual([queued.id, queued.id]);
      expect(db.select().from(jobs).get()).toMatchObject({ id: queued.id, state: "done", resultRef: "file-resume" });
    } finally { fixture.stop(); }
  });

  test("a child-started image producer reaches done from the Stack job", async () => {
    const stackJob = { id: "img-child-1", kind: "image", role: "image", state: "done", percent: 100, completedBytes: 1, totalBytes: 1, status: "ready", position: null, input: { prompt: "private child prompt" }, result: { fileId: "file-1" }, reason: null, createdAt: "2026-10-06T10:00:00.000Z", updatedAt: "2026-10-06T10:01:00.000Z" };
    const fixture = startStackFixture({
      "POST /stack/v1/jobs": async () => Response.json({ job: { ...stackJob, state: "queued", percent: 0, completedBytes: 0, result: null, status: "queued" } }, { status: 202 }),
      "GET /stack/v1/jobs/img-child-1": async () => Response.json({ job: stackJob }),
    });
    try {
      __setStackClientForTests(fixture.client);
      const now = new Date().toISOString();
      db.insert(people).values({ id: "child-1", displayName: "Child", nickname: null, bio: null, accent: null, role: "child", birthdate: null, avatarSeed: "c", source: "local", localOnly: false, createdAt: now, updatedAt: now, deletedAt: null, hlc: "1:0:abcdefgh", enabled: true, guestExpiresAt: null, memorializedAt: null } as never).run();
      const result = await startImageProducerJob({ actorId: "child-1", prompt: "private child prompt" });
      expect(result).toMatchObject({ id: "img-child-1", kind: "image", state: "done", startedBy: "child-1", forPerson: "child-1" });
      expect(fixture.calls).toEqual(["POST /stack/v1/jobs", "GET /stack/v1/jobs/img-child-1"]);
      expect(listJobsForViewer(person("child-1", "child"))).toContainEqual(expect.objectContaining({ id: "img-child-1", state: "done" }));
    } finally { fixture.stop(); }
  });

  test("a cancelled model download maps to cancelled and retains its legacy progress shape", () => {
    const now = new Date().toISOString();
    db.insert(modelDownloadJobs).values({ modelId: "model-a", status: "cancelled", phase: "cancelled", completedBytes: 3, totalBytes: 10, error: null, createdAt: now, updatedAt: now }).run();
    expect(modelDownloadJobsAsHomeJobs()[0]).toMatchObject({ id: "model:model-a", kind: "model_download", state: "cancelled", progress: { phase: "cancelled", completedBytes: 3, totalBytes: 10 } });
  });

  test("a cancelled Stack model download is projected as cancelled", async () => {
    const job = { id: "model-install-1", kind: "model.install", role: "chat", state: "cancelled", percent: 30, completedBytes: 3, totalBytes: 10, status: "cancelled", position: null, input: { model: "model-a" }, result: null, reason: "Cancelled", createdAt: "2026-10-06T10:00:00.000Z", updatedAt: "2026-10-06T10:01:00.000Z" };
    const fixture = startStackFixture({ "GET /stack/v1/jobs": async () => Response.json({ jobs: [job] }) });
    try {
      __setStackClientForTests(fixture.client);
      const admin = person("admin-stack", "admin");
      const mapped = await listJobsForViewerLive(admin);
      expect(mapped).toContainEqual(expect.objectContaining({ id: "stack:model-install-1", kind: "model_download", state: "cancelled", progress: expect.objectContaining({ completedBytes: 3, totalBytes: 10 }) }));
    } finally { fixture.stop(); }
  });

  test("stopping a mapped Stack job cancels it upstream before Home records cancellation", async () => {
    const cancelled = { id: "img-stop-1", kind: "image", role: "image", state: "cancelled", percent: 20, completedBytes: 0, totalBytes: 0, status: "cancelled", position: null, input: null, result: null, reason: "Cancelled", createdAt: "2026-10-06T10:00:00.000Z", updatedAt: "2026-10-06T10:01:00.000Z" };
    const fixture = startStackFixture({ "DELETE /stack/v1/jobs/img-stop-1": async () => Response.json({ job: cancelled }) });
    try {
      __setStackClientForTests(fixture.client);
      const client = new TestClient();
      await client.post("/api/auth/setup", { displayName: "Owner", secret: "correct horse battery staple" });
      const actor = db.select().from(people).all()[0]!;
      createJob({ id: "img-stop-1", kind: "image", startedBy: actor.id, forPerson: actor.id, title: "Picture", state: "running", progress: {}, provenance: { stackJobId: "img-stop-1" } });
      const response = await client.post("/api/jobs/img-stop-1/stop", {});
      expect(response.status).toBe(200);
      expect(fixture.calls).toEqual(["DELETE /stack/v1/jobs/img-stop-1"]);
      expect(db.select().from(jobs).all()[0]?.state).toBe("cancelled");
    } finally { fixture.stop(); }
  });

  test("a completed routine producer writes the Home Job state", async () => {
    const now = new Date().toISOString();
    db.insert(people).values({ id: "adult-1", displayName: "Adult", nickname: null, bio: null, accent: null, role: "adult", birthdate: null, avatarSeed: "a", source: "local", localOnly: false, createdAt: now, updatedAt: now, deletedAt: null, hlc: "1:0:abcdefgh", enabled: true, guestExpiresAt: null, memorializedAt: null } as never).run();
    db.insert(scheduledJobs).values({ id: "routine-1", kind: "plugin", packageId: "routines", job: "morning", personId: "adult-1", inputs: "{}", when: "2099-01-01T00:00:00.000Z", recurring: false, nextRunAt: new Date(0).toISOString(), status: "pending", createdAt: now }).run();
    await runDueJobs(async () => ({ ok: true, value: { steps: [] } } as never));
    const viewerJobs = listJobsForViewer(person("adult-1", "adult"));
    expect(viewerJobs).toContainEqual(expect.objectContaining({ id: "schedule:routine-1", kind: "routine", state: "done" }));
  });

  test("generic producer lifecycle stores a terminal backup job", () => {
    createJob({ id: "backup-1", kind: "backup", startedBy: "system", forPerson: null, title: "Backup", state: "running", progress: { phase: "writing" }, provenance: { producer: "backup" } });
    expect(updateJob("backup-1", { state: "done", progress: { phase: "complete" } })).toBe(true);
    const found = listJobsForViewer(person("admin-1", "admin"));
    expect(found).toContainEqual(expect.objectContaining({ id: "backup-1", state: "done" }));
  });
});
