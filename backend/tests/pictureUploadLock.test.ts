import { afterEach, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments, people } from "@/db/schema";
import { storeFile } from "@/lib/attachments";
import { activityForViewer } from "@/lib/activity";
import { imageAppData } from "@/lib/imageApp";
import { pictureJobLockState } from "@/lib/pictures/lock";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { startPictureJob, getPictureJob, __resetPictureJobsForTests } from "@/lib/pictures/jobs";
import { resetDb } from "./reset-db";
import { testPng, installFakeImageStack, type FakeImageStack } from "./pictureFixture";
import { owner } from "./support/testAuth";
import type { PersonRow } from "@/types";
import { __setPicturePollMsForTests } from "@/lib/pictures/jobs";

let sage: PersonRow;
let fake: FakeImageStack;
const now = () => new Date().toISOString();
function person(id: string, role: string): PersonRow {
  db.insert(people).values({ id, displayName: id, role, avatarSeed: id, source: "local", createdAt: now(), updatedAt: now(), hlc: "1:0:test" }).run();
  return db.select().from(people).where(eq(people.id, id)).get()! as PersonRow;
}
async function file(who: PersonRow, provenance = "composer:photo") {
  const saved = storeFile(who, { conversationId: null, turnId: null, mediaType: "image/png", bytes: await testPng(), provenance, retention: "kept", deduplicate: false });
  if (!saved.ok) throw new Error(saved.error);
  return saved.value;
}
async function run(who: PersonRow, sourceId: string, options: { style?: string; edit?: boolean } = {}) {
  const job = await startPictureJob({ actor: who, conversationId: null, turnId: null, temporary: false, kind: options.edit ? "edit" : "generate", prompt: "A paper boat", sourceFileId: sourceId, ...(options.edit ? { edit: { sourceId, label: "A paper boat", method: "instruct" as const } } : {}), body: { prompt: "A paper boat", audience: "all-ages", loras: options.style ? [{ id: options.style, scale: 0.9 }] : [] }, submit: async () => ({ job: `test-${Math.random()}`, done: [{ b64_json: Buffer.from(await testPng()).toString("base64"), model: "test", ms: 0 }] }) });
  return job;
}

beforeEach(async () => {
  resetDb(); __resetPictureJobsForTests();
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { people_count: 0, apparent_min_age_estimate: null, label: "none" as const, is_nude_or_sexual: false, confidence: 1 } })));
  fake = installFakeImageStack({ pollsToFinish: 1 });
  sage = (await owner()).row;
});
afterEach(() => { fake.restore(); __setAgeCheckRunnerForTests(null); __resetPictureJobsForTests(); __setPicturePollMsForTests(null); });

test("adult-owned unlabeled Library source starts open and keeps the result all-ages", async () => {
  const source = await file(sage);
  const job = await run(sage, source.id);
  expect(pictureJobLockState(sage, job)).toBe("open");
  expect(activityForViewer(sage).items.some((item) => item.id === `picture:${job.id}`)).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 40));
  const saved = getPictureJob(sage, job.id)!;
  const row = db.select().from(attachments).where(eq(attachments.id, saved.files[0]!.id)).get()!;
  expect(row.provenance).toContain('"audience":"all-ages"');
  expect(row.provenance).toContain('"lock":"off"');
  expect((imageAppData(sage, "recent", {}) as Array<Record<string, unknown>>).some((item) => item.id === row.id)).toBe(true);
});

test("adult-only Library labels and styles keep generated results locked", async () => {
  const labeled = await file(sage, 'picture-gen:{"v":1,"audience":"adult-only","made_audience":"adult-only","lock":"on"}');
  const job = await run(sage, labeled.id);
  expect(job.request.adultLock).toBe("on");
  const styleJob = await startPictureJob({ actor: sage, conversationId: null, turnId: null, temporary: false, kind: "generate", prompt: "A boat", body: { prompt: "A boat", audience: "adult", loras: [{ id: "lora-bbbbbbbbbbbbbbbb", scale: 0.9 }] }, sources: [{ madeAudience: "all-ages", lock: "off" }], submit: async () => ({ job: "adult-style", done: null }) });
  expect(styleJob.request.adultLock).toBe("on");
});

test("minor owned unlabeled Library files have no Adult lock mark", async () => {
  const teen = person("person-uploadteen", "teen");
  const child = person("person-uploadchild", "child");
  const teenFile = await file(teen);
  const teenJob = await run(teen, teenFile.id);
  expect(teenJob.request.adultLock).toBeUndefined();
  const childFile = await file(child);
  const childJob = await run(child, childFile.id);
  expect(childJob.request.adultLock).toBeUndefined();
});
