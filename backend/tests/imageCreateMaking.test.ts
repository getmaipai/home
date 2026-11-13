import { beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, people, pictureJobs } from "@/db/schema";
import { imageAppData } from "@/lib/imageApp";
import { newItemMark, markFields } from "@/lib/adultLock";
import { pictureJobLockState } from "@/lib/pictures/lock";
import { resetDb } from "./reset-db";
import { owner } from "./support/testAuth";

beforeEach(() => resetDb());

const now = () => new Date().toISOString();
function job(id: string, personId: string, values: Partial<typeof pictureJobs.$inferInsert> = {}) {
  db.insert(pictureJobs).values({
    id, personId, conversationId: null, turnId: null, kind: "generate", state: "queued", stackJob: null,
    percent: 0, phase: "queued", position: 1, prompt: "A bright paper kite", request: JSON.stringify({ size: "1024x1024", n: 1, seed: null, loras: [], source_file_id: null, audience: "all-ages" }),
    error: null, files: "[]", createdAt: now(), updatedAt: now(), hlc: "1:0:test", ...values,
  }).run();
}

test("Create shelf shows own queued and running jobs before finished pictures with Activity copy", async () => {
  const { row } = await owner();
  job("queued-create", row.id, { updatedAt: "2026-11-13T00:00:01.000Z" });
  job("running-create", row.id, { state: "running", phase: "loading", percent: 37, prompt: "A blue paper kite", updatedAt: "2026-11-13T00:00:02.000Z" });
  job("failed-create", row.id, { state: "failed", phase: null, error: "I couldn't make that picture. Try again or change the request.", prompt: "A red paper kite", updatedAt: "2026-11-13T00:00:03.000Z" });
  job("conversation", row.id, { conversationId: "chat-1", prompt: "A chat picture" });
  job("purpose", row.id, { purpose: "cover", prompt: "A cover picture" });
  const list = imageAppData(row, "recent", {}) as Array<Record<string, unknown>>;
  expect(list.slice(0, 3)).toMatchObject([
    { id: "picture-job:failed-create", title: "A red paper kite", subtitle: "I couldn't make that picture. Try again or change the request." },
    { id: "picture-job:running-create", title: "A blue paper kite", subtitle: "loading", badge: "37%" },
    { id: "picture-job:queued-create", title: "A bright paper kite", subtitle: "You are next." },
  ]);
  expect(list.map((item) => item.id)).not.toContain("picture-job:conversation");
  expect(list.map((item) => item.id)).not.toContain("picture-job:purpose");
});

test("Create shelf hides another person's making job", async () => {
  const { row: viewer } = await owner();
  const someoneElse = db.insert(people).values({ id: "other-person", displayName: "Other", role: "adult", avatarSeed: "other", source: "local", createdAt: now(), updatedAt: now(), hlc: "1:0:test" }).returning().get();
  job("private-job", someoneElse.id, { prompt: "Private picture" });
  const list = imageAppData(viewer, "recent", {}) as Array<Record<string, unknown>>;
  expect(JSON.stringify(list)).not.toContain("Private picture");
});

test("Create shelf draws locked queued, running and finished pictures as one content-free tile", async () => {
  const { row } = await owner();
  const mark = markFields(newItemMark([{ madeAudience: "adult-only", lock: "on" }], false));
  const request = JSON.stringify({ size: "1024x1024", n: 1, seed: null, loras: [], source_file_id: null, audience: "adult", adultLock: "on" });
  job("secret-queued", row.id, { prompt: "QUEUED SECRET PROMPT", request, updatedAt: "2026-11-13T00:00:01.000Z" });
  job("secret-running", row.id, { state: "running", phase: "loading", percent: 37, prompt: "RUNNING SECRET PROMPT", request, updatedAt: "2026-11-13T00:00:02.000Z" });
  job("secret-finished", row.id, { state: "done", phase: null, percent: 100, files: JSON.stringify([{ id: "secret-file-id", width: 64, height: 64, seed: null, model: null, steps: null, ms: null }]), prompt: "FINISHED SECRET PROMPT", request, updatedAt: "2026-11-13T00:00:03.000Z" });
  db.insert(attachments).values({ id: "secret-file-id", ownerPersonId: row.id, conversationId: null, turnId: null, mediaType: "image/png", size: 1, sha256: "f".repeat(64), storagePath: "unused", retention: "kept", provenance: `picture-gen:${JSON.stringify({ ...mark, job: "secret-finished" })}`, origin: "sent", mediaSourceId: null, deletedAt: null, trashUntil: null, name: "FINISHED SECRET FILE", createdAt: now(), hlc: "1:0:test" }).run();

  expect(pictureJobLockState(row, (await import("@/lib/pictures/jobStore")).getPictureJob(row, "secret-queued")!)).toBe("locked");
  const list = imageAppData(row, "recent", {}) as Array<Record<string, unknown>>;
  const locked = list.filter((item) => item.title === "Locked picture");
  expect(locked).toHaveLength(3);
  expect(locked).toMatchObject([
    { id: "picture-job:secret-finished", title: "Locked picture", subtitle: "Unlock your adult items to see it.", thumbnail: "", badge: "Locked", meta: "" },
    { id: "picture-job:secret-running", title: "Locked picture", subtitle: "Unlock your adult items to see it.", thumbnail: "", badge: "Locked", meta: "" },
    { id: "picture-job:secret-queued", title: "Locked picture", subtitle: "Unlock your adult items to see it.", thumbnail: "", badge: "Locked", meta: "" },
  ]);
  const serialized = JSON.stringify(locked);
  for (const secret of ["QUEUED SECRET PROMPT", "RUNNING SECRET PROMPT", "FINISHED SECRET PROMPT", "FINISHED SECRET FILE", "secret-file-id"]) expect(serialized).not.toContain(secret);
});
