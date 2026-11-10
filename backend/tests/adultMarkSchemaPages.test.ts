import { afterEach, beforeEach, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { household, PASSCODE } from "./fixtures/adultLock";
import { attachments, people as peopleTable } from "@/db/schema";
import { db } from "@/db";
import { withMark } from "@/lib/adultLock";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { mediaAppData } from "@/lib/media/appHost";
import { PLAIN_PROMPT } from "./fixtures/adultLock";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { until } from "./pictureFixture";
import { PACKAGES_DIR } from "@/lib/paths";
import { join } from "node:path";
import UI_SCHEMA from "@maipai/spec/ui/schema.json" with { type: "json" };
import Ajv2020 from "ajv/dist/2020.js";

let fake: FakeVideoStack;
beforeEach(() => {
  resetDb(); fake = installFakeVideoStack();
});
afterEach(() => fake.restore());


async function makeAdultClip(client: TestClient, actor: ReturnType<typeof getActor>) {
  const made = await (await client.post("/api/videos/make", { prompt: PLAIN_PROMPT })).json() as { id: string };
  await until(() => getVideoJobFor(actor, made.id)?.state === "done");
  const job = getVideoJobFor(actor, made.id)!;
  const fileId = job.files[0]!.id;
  const marked = `video-gen:${JSON.stringify({ v: 1, audience: "adult-only", made_audience: "adult-only", lock: "on", job: made.id, prompt: PLAIN_PROMPT })}`;
  db.update(attachments).set({ provenance: marked }).where(eq(attachments.id, fileId)).run();
  return { jobId: made.id, fileId };
}
function getActor() { return db.select().from(peopleTable).where(eq(peopleTable.displayName, "Marlow")).get()! as import("@/types").PersonRow; }

test("video package pages validate and expose adult actions on feed and clips", async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  for (const pageName of ["create", "clips"]) {
    const page = JSON.parse(await Bun.file(join(PACKAGES_DIR, "videos", "pages", `${pageName}.json`)).text());
    expect(ajv.validate(UI_SCHEMA as object, page), JSON.stringify(ajv.errors)).toBe(true);
    expect(JSON.stringify(page)).toContain("adult-mark");
  }
});

test("Create feed flags are owner only, hidden for a minor, and locked rows carry no flags", async () => {
  const { adult, other, teen } = await household();
  const actor = getActor();
  const clip = await makeAdultClip(adult.client, actor);
  const job = getVideoJobFor(actor, clip.jobId)!;
  const lockedRow = (await import("@/lib/videos/feed")).feedRowOf(actor, job, new Set());
  expect(lockedRow).toEqual({ locked: true, making: false });
  expect(mediaAppData(actor, "videos", "recipes", { scope: "clips", view: "all" }) as unknown).toEqual([{ locked: true, making: false }]);
  // Open the file only to verify the row flags; the locked feed remains a single tile until a valid proof is supplied.
  const updated = db.select().from(attachments).where(eq(attachments.id, clip.fileId)).get()!;
  const off = withMark(updated.provenance, { lock: "off", raiseToAdult: false })!;
  db.update(attachments).set({ provenance: off }).where(eq(attachments.id, clip.fileId)).run();
  const feed = (await import("@/lib/videos/feed")).feedRowOf(actor, getVideoJobFor(actor, clip.jobId)!, new Set());
  expect(feed).toMatchObject({ can_unmark: false, can_mark: true });
  const clips = mediaAppData(actor, "videos", "recipes", { scope: "clips", view: "all" }) as unknown as Array<Record<string, unknown>>;
  expect(clips.find((row) => row.id === clip.fileId)).toMatchObject({ can_unmark: false, can_mark: true });
  expect((await import("@/lib/videos/feed")).feedRowOf(db.select().from(peopleTable).where(eq(peopleTable.displayName, "Quill")).get()! as import("@/types").PersonRow, getVideoJobFor(actor, clip.jobId)!, new Set())).toBeNull();
  expect((await import("@/lib/videos/feed")).feedRowOf(db.select().from(peopleTable).where(eq(peopleTable.displayName, "Nova")).get()! as import("@/types").PersonRow, getVideoJobFor(actor, clip.jobId)!, new Set())).toBeNull();
});

test("schema action requires the one-use fresh ticket and Library file route accepts its file-bound ticket", async () => {
  const { adult, other } = await household();
  const actor = getActor();
  const clip = await makeAdultClip(adult.client, actor);
  // A second adult in the same household is not the file owner.
  expect((await other.client.post(`/api/library/files/${clip.fileId}/adult-mark`, { action: "mark" })).status).toBe(404);
  const proof = (await (await adult.client.post("/api/adult-lock/unlock", { secret: PASSCODE })).json() as { proof: string }).proof;
  const liveProofRejected = await adult.client.post(`/api/videos/jobs/${clip.jobId}/adult-mark`, { action: "clear" }, { "x-adult-unlock": proof });
  expect(liveProofRejected.status).toBe(403);
  const ticket = (await (await adult.client.post("/api/adult-lock/confirm", { secret: PASSCODE, action: "unmark", item: clip.jobId })).json() as { ticket: string }).ticket;
  expect((await adult.client.post(`/api/videos/jobs/${clip.jobId}/adult-mark`, { action: "clear", ticket })).status).toBe(200);
  expect((await adult.client.post(`/api/videos/jobs/${clip.jobId}/adult-mark`, { action: "mark" })).status).toBe(200);
  const fileTicket = (await (await adult.client.post("/api/adult-lock/confirm", { secret: PASSCODE, action: "unmark", item: clip.fileId })).json() as { ticket: string }).ticket;
  expect((await adult.client.post(`/api/library/files/${clip.fileId}/adult-mark`, { action: "clear", ticket: fileTicket })).status).toBe(200);
  const library = await (await adult.client.get("/api/library?type=video")).json() as { items: Array<Record<string, any>> };
  expect(library.items.find((item) => item.id === clip.fileId)?.adult).toMatchObject({ can_mark: true, can_clear: false });
  expect((await adult.client.post(`/api/library/files/${clip.fileId}/adult-mark`, { action: "mark" })).status).toBe(200);
});
