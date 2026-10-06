// ACTIVITY-01d: what the Running now panel may offer each viewer. The
// panel shows only the actions a row's `actions` names, so the service is
// the one place that decides them, per viewer and per age band.
import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "@/db";
import { approvals, jobs, people, scheduledJobs } from "@/db/schema";
import { createJob, listJobsForViewer } from "@/lib/jobs";
import { setPendingAsk } from "@/lib/conversationHistory";
import { TestClient } from "./client";
import { resetDb } from "./reset-db";

beforeEach(() => resetDb());

async function household() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correct horse battery staple" });
  const child = (await (await owner.post("/api/people", { displayName: "Nova", role: "child" })).json()) as { id: string };
  const all = db.select().from(people).all();
  const ownerRow = all.find((p) => p.displayName === "Sage")!;
  const childRow = all.find((p) => p.id === child.id)!;
  const childClient = new TestClient();
  await childClient.post("/api/auth/select", { personId: child.id });
  return { owner, ownerRow, childRow, childClient };
}

describe("ACTIVITY-01d: the actions each viewer is offered", () => {
  test("a running job the viewer may stop carries stop; a finished one carries nothing", async () => {
    const { ownerRow } = await household();
    createJob({ id: "pic-1", kind: "image", startedBy: ownerRow.id, forPerson: ownerRow.id, title: "Making a picture of a red fox", state: "running", progress: {}, provenance: {} });
    createJob({ id: "pic-2", kind: "image", startedBy: ownerRow.id, forPerson: ownerRow.id, title: "Made a picture", state: "done", progress: {}, provenance: {} });
    const rows = listJobsForViewer(ownerRow);
    expect(rows.find((r) => r.id === "pic-1")?.actions).toEqual(["stop"]);
    expect(rows.find((r) => r.id === "pic-2")?.actions).toEqual([]);
  });

  test("a child cannot stop a job a parent started for them, and is not offered it", async () => {
    const { ownerRow, childRow, childClient } = await household();
    createJob({ id: "for-child", kind: "image", startedBy: ownerRow.id, forPerson: childRow.id, title: "Drawing a dinosaur", state: "running", progress: {}, provenance: {} });
    expect(listJobsForViewer(childRow).find((r) => r.id === "for-child")?.actions).toEqual([]);
    expect(listJobsForViewer(ownerRow).find((r) => r.id === "for-child")).toMatchObject({ forPersonName: "Nova", actions: ["stop"] });
    const res = await childClient.post("/api/jobs/for-child/stop", {});
    expect(res.status).toBe(403);
    expect(db.select().from(jobs).all().find((j) => j.id === "for-child")?.state).toBe("running");
  });

  test("a child can stop a job they started themselves", async () => {
    const { childRow, childClient } = await household();
    createJob({ id: "own-child", kind: "image", startedBy: childRow.id, forPerson: childRow.id, title: "Drawing a cat", state: "running", progress: {}, provenance: {} });
    expect(listJobsForViewer(childRow).find((r) => r.id === "own-child")?.actions).toEqual(["stop"]);
    expect((await childClient.post("/api/jobs/own-child/stop", {})).status).toBe(200);
  });

  test("a scheduled routine has no stop route, so it is offered none", async () => {
    const { ownerRow } = await household();
    const now = new Date().toISOString();
    db.insert(scheduledJobs).values({ id: "routine-1", kind: "plugin", packageId: "routines", job: "morning", personId: ownerRow.id, inputs: "{}", when: "2099-01-01T00:00:00.000Z", recurring: false, nextRunAt: now, status: "pending", createdAt: now }).run();
    expect(listJobsForViewer(ownerRow).find((r) => r.id === "routine-1")?.actions).toEqual([]);
  });

  test("the hub's own housekeeping and a routine waiting for a later time are not listed as work", async () => {
    const { ownerRow } = await household();
    const now = new Date().toISOString();
    const later = new Date(Date.now() + 3_600_000).toISOString();
    db.insert(scheduledJobs).values({ id: "core-1", kind: "core", packageId: "core", job: "favicons.sweep", personId: null, inputs: "{}", when: "every 1h", recurring: true, nextRunAt: now, status: "pending", createdAt: now }).run();
    db.insert(scheduledJobs).values({ id: "routine-later", kind: "plugin", packageId: "routines", job: "morning", personId: ownerRow.id, inputs: "{}", when: later, recurring: false, nextRunAt: later, status: "pending", createdAt: now }).run();
    const ids = listJobsForViewer(ownerRow).map((r) => r.id);
    expect(ids).not.toContain("core-1");
    expect(ids).not.toContain("routine-later");
  });

  test("a reminder that fired reads in plain words, never as an engine job name", async () => {
    const { ownerRow } = await household();
    const now = new Date().toISOString();
    db.insert(scheduledJobs).values({ id: "rem-1", kind: "core", packageId: "core", job: "reminders.fire", personId: ownerRow.id, inputs: JSON.stringify({ task: "call the vet" }), when: now, recurring: false, nextRunAt: now, status: "done", createdAt: now }).run();
    db.insert(scheduledJobs).values({ id: "tim-1", kind: "core", packageId: "core", job: "timers.fire", personId: ownerRow.id, inputs: JSON.stringify({ label: "pasta" }), when: now, recurring: false, nextRunAt: now, status: "done", createdAt: now }).run();
    const rows = listJobsForViewer(ownerRow);
    expect(rows.find((r) => r.id === "rem-1")).toMatchObject({ kind: "reminder", title: "Reminder: call the vet", state: "done" });
    expect(rows.find((r) => r.id === "tim-1")).toMatchObject({ kind: "timer", title: "Timer: pasta", state: "done" });
  });

  test("a child's ask reaches an admin in plain words with approve and deny; the child sees no buttons", async () => {
    const { ownerRow, childRow } = await household();
    const now = new Date().toISOString();
    db.insert(approvals).values({ id: "approval-1", kind: "install_package", personId: childRow.id, details: JSON.stringify({ packageName: "Chess" }), status: "pending", decidedByPersonId: null, decidedAt: null, createdAt: now }).run();
    const adminView = listJobsForViewer(ownerRow).find((r) => r.id === "approval-1");
    expect(adminView).toMatchObject({ kind: "approval", state: "waiting_for_you", title: 'Nova asked to install "Chess"', actions: ["approve", "deny"] });
    const childView = listJobsForViewer(childRow).find((r) => r.id === "approval-1");
    expect(childView).toMatchObject({ kind: "approval", state: "waiting_for_you", actions: [] });
  });

  test("a chat waiting on the viewer's yes or no is listed, opens that chat, and is the viewer's only", async () => {
    const { owner, ownerRow, childRow } = await household();
    const conversation = (await (await owner.post("/api/conversations", { surface: "chat" })).json()) as { id: string };
    await owner.request(`/api/conversations/${conversation.id}`, { method: "PATCH", body: { title: "Locking up" } });
    setPendingAsk(conversation.id, { kind: "confirm", prompt: "Go ahead and lock the doors?", packageId: "lock-doors", args: {}, turnId: "turn-1" });
    const row = listJobsForViewer(ownerRow).find((r) => r.id === `ask:${conversation.id}`);
    expect(row).toMatchObject({ kind: "chat_ask", state: "waiting_for_you", title: "Locking up", conversationId: conversation.id, actions: ["open"] });
    expect(listJobsForViewer(childRow).some((r) => r.id === `ask:${conversation.id}`)).toBe(false);
  });

  test("the list route carries actions", async () => {
    const { owner, ownerRow } = await household();
    createJob({ id: "pic-3", kind: "image", startedBy: ownerRow.id, forPerson: ownerRow.id, title: "Making a picture", state: "running", progress: {}, provenance: {} });
    const rows = (await (await owner.get("/api/jobs")).json()) as Array<{ id: string; actions?: string[] }>;
    expect(rows.find((r) => r.id === "pic-3")?.actions).toEqual(["stop"]);
  });
});
