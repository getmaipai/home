// VF-TAKES-01 (transport move, no policy change): a Max clip goes through the Stack's generic make door like Standard and Boost. The two Home policies that kept Max
// on the old door, `holdMaxAfterMemoryRefusal` and the `queue_full` hold, are pinned here ON THE DOOR with the outcomes a person gets on the old door: the clip
// waits (queued, no error, no resource word), starts when the Stack accepts, and a person's Stop works while it waits.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { db } from "@/db";
import { people as peopleTable } from "@/db/schema";
import { cancelVideoJob, getVideoJobFor, startVideoJob } from "@/lib/videos/jobs";
import { setNoRoomRecheckForTests } from "@/lib/jobs/householdQueue";
import { videoCardView } from "@/routes/videos";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { until } from "./pictureFixture";
import type { PersonRow } from "@/types";

let fake: FakeVideoStack;
beforeEach(() => { resetDb(); fake = installFakeVideoStack({ pollsToFinish: 6 }); fake.door = true; fake.ltx25max = "ready"; setNoRoomRecheckForTests(25); });
afterEach(() => { fake.restore(); setNoRoomRecheckForTests(null); });

async function owner(): Promise<{ actor: PersonRow; conversationId: string }> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(peopleTable).where(eq(peopleTable.displayName, "Sage")).get()! as PersonRow;
  const conv = await import("@/lib/conversationHistory");
  const resolved = conv.resolveOrCreateConversation(actor, "chat", undefined, {});
  if (!resolved.ok) throw new Error("no conversation");
  return { actor, conversationId: resolved.value.id };
}
const maxBody = { prompt: "a paper boat", size: "1024x576", seconds: 5, seed: 7, audience: "adult", model: "ltx25-max", tier: "max" };
const start = (who: { actor: PersonRow; conversationId: string }) =>
  startVideoJob({ actor: who.actor, conversationId: who.conversationId, turnId: null, temporary: true, kind: "generate", prompt: "a paper boat", body: maxBody, tier: "max" } as never);

describe("a Max clip on the generic door", () => {
  test("is asked for at level max with the shape and seconds only (no size, no model), is stored at Max and finishes", async () => {
    const who = await owner();
    const job = await start(who);
    await until(() => getVideoJobFor(who.actor, job.id)?.state === "done");
    expect(fake.makeRequests).toHaveLength(1);
    expect(fake.makeRequests[0]).toMatchObject({ job: "clip", level: "max", shape: "landscape", seconds: 5, seed: 7, audience: "adult" });
    expect(fake.makeRequests[0]).not.toHaveProperty("size");
    expect(fake.makeRequests[0]).not.toHaveProperty("model");
    expect(getVideoJobFor(who.actor, job.id)!.request).toMatchObject({ tier: "max" });
  });

  for (const [code, status] of [["queue_full", 429], ["no_memory", 503]] as const) {
    test(`refused with ${code} it stays queued with no error and no resource word, starts once the Stack accepts, and was asked on the door each time`, async () => {
      fake.refuseSubmit = { status, code, error: "not right now" };
      const who = await owner();
      const job = await start(who);
      await until(() => getVideoJobFor(who.actor, job.id)?.state === "queued" && fake.makeRequests.length >= 2);
      const view = videoCardView(who.actor, getVideoJobFor(who.actor, job.id)!, true).items[0]!;
      expect(view).toMatchObject({ state: "queued", error: null });
      expect(JSON.stringify(view)).not.toMatch(/memory|GB|RAM/i);
      fake.refuseSubmit = null;
      await until(() => getVideoJobFor(who.actor, job.id)?.state === "done", 15_000);
      expect(fake.makeRequests.every((request) => (request as { level?: string }).level === "max")).toBe(true);
    });
  }

  test("a person's Stop works while it waits on a refusal, and nothing is asked afterwards", async () => {
    fake.refuseSubmit = { status: 503, code: "no_memory", error: "not right now" };
    const who = await owner();
    const job = await start(who);
    await until(() => getVideoJobFor(who.actor, job.id)?.state === "queued" && fake.makeRequests.length >= 1);
    await cancelVideoJob(who.actor, job.id);
    const asked = fake.makeRequests.length;
    fake.refuseSubmit = null;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(getVideoJobFor(who.actor, job.id)!.state).toBe("cancelled");
    expect(fake.makeRequests.length).toBeLessThanOrEqual(asked + 1);
    expect(fake.jobs).toHaveLength(0);
  });

  test("a clip the Stack's watchdog stopped is started again once and keeps its tier, on the door", async () => {
    fake.memoryCancels = 1; fake.memoryStopState = "failed";
    const who = await owner();
    const job = await start(who);
    await until(() => getVideoJobFor(who.actor, job.id)?.state === "done");
    expect(fake.makeRequests).toHaveLength(2);
    expect(getVideoJobFor(who.actor, job.id)!.request).toMatchObject({ tier: "max" });
  });

  test("a Stack that does not serve Max on the door (level_not_served) sends it to the old door with its Max model and size", async () => {
    const real = globalThis.fetch;
    void real;
    fake.door = false;   // the catalog answers 404: the old door takes it, exactly as before
    const who = await owner();
    const job = await start(who);
    await until(() => getVideoJobFor(who.actor, job.id)?.state === "done");
    expect(fake.submitted[0]).toMatchObject({ model: "ltx25-max", size: "1024x576", tier: "max" });
  });
});
