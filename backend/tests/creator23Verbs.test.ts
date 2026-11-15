import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { db } from "@/db";
import { creations, people as peopleTable } from "@/db/schema";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { __setVideoStatusForTests } from "@/lib/videos/ready";
import type { PersonRow } from "@/types";
import { until } from "./pictureFixture";
import { installFakeEditStack, type FakeEditStack } from "./videoEditStackFixture";

let fake: FakeVideoStack;
let editFake: FakeEditStack;
beforeEach(() => { resetDb(); fake = installFakeVideoStack(); editFake = installFakeEditStack(); });
afterEach(() => { editFake.restore(); fake.restore(); __setVideoStatusForTests(undefined); });
async function household() {
  const owner = new TestClient(); await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const add = async (name: string, role: string, birthdate?: string) => {
    const res = await owner.post("/api/people", { displayName: name, role, secret: "0000", ...(birthdate ? { birthdate } : {}) });
    const { id } = await res.json() as { id: string }; const client = new TestClient(); await client.post("/api/auth/verify-secret", { personId: id, secret: "0000" }); return { id, client };
  };
  const adult = await add("Marlow", "adult"), teen = await add("Nova", "teen", "2011-03-01");
  const actor = db.select().from(peopleTable).where(eq(peopleTable.id, adult.id)).get()! as PersonRow;
  return { adult, teen, actor };
}
const prompt = "A paper boat floats down a rainy street";
async function finished(adult: { client: TestClient }, actor: PersonRow) {
  const made = await adult.client.post("/api/videos/make", { prompt }); const { id } = await made.json() as { id: string };
  await until(() => getVideoJobFor(actor, id)?.state === "done"); return id;
}

describe("CREATOR-23 page actions", () => {
  test("re-shoot repeats the saved words or appends one changed instruction and starts another job", async () => {
    const { adult, actor } = await household(), id = await finished(adult, actor);
    const same = await adult.client.post("/api/plugins/video/actions/reshoot", { id }); expect(same.status).toBe(200);
    const sameBody = await same.json() as { id: string }; expect(getVideoJobFor(actor, sameBody.id)?.request.anotherOf).toBe(id);
    await until(() => getVideoJobFor(actor, sameBody.id)?.state === "done");
    const changed = await adult.client.post("/api/plugins/video/actions/reshoot", { id: sameBody.id, change: "Make the light warmer" }); expect(changed.status).toBe(200);
    const changedBody = await changed.json() as { id: string }; expect(fake.submitted.at(-1)?.prompt).toContain("Make the light warmer");
    expect(getVideoJobFor(actor, changedBody.id)?.request.anotherOf).toBe(sameBody.id);
  });
  test.each(["wide", "three_quarter", "close", "push_in", "next_beat"] as const)("next shot %s starts a job from its parent clip", async (shot) => {
    const { adult, actor } = await household(), id = await finished(adult, actor);
    const res = await adult.client.post("/api/plugins/video/actions/next-shot", { id, shot }); expect(res.status).toBe(200);
    const { id: nextId } = await res.json() as { id: string }; const next = getVideoJobFor(actor, nextId)!;
    expect(next.request.anotherOf).toBe(id); expect(next.request.source_file_id).toBeTruthy(); expect(next.prompt).toContain("Continue");
    await until(() => getVideoJobFor(actor, nextId)?.state === "done");
    const child = db.select().from(creations).where(eq(creations.personId, actor.id)).all().find((record) => JSON.parse(record.jobIds).includes(nextId));
    const parent = db.select().from(creations).where(eq(creations.personId, actor.id)).all().find((record) => JSON.parse(record.jobIds).includes(id));
    expect(child?.parentId).toBe(parent?.id);
  });
  test("another person's source returns 404", async () => {
    const { adult, teen, actor } = await household(), id = await finished(adult, actor);
    expect((await teen.client.post("/api/plugins/video/actions/reshoot", { id })).status).toBe(404);
    expect((await teen.client.post("/api/plugins/video/actions/next-shot", { id, shot: "push_in" })).status).toBe(404);
  });
  test("a locked source is refused and a minor cannot start a shot action", async () => {
    const { adult, teen, actor } = await household(), id = await finished(adult, actor);
    expect((await adult.client.post("/api/plugins/video/actions/adult-mark", { id, action: "mark" })).status).toBe(200);
    const locked = await adult.client.post("/api/plugins/video/actions/reshoot", { id }); expect(locked.status).toBe(423);
    const minor = await teen.client.post("/api/plugins/video/actions/next-shot", { id, shot: "push_in" }); expect(minor.status).toBe(404);
    expect(fake.submitted).toHaveLength(1);
  });
});
