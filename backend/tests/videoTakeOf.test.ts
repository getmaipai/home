// VF-TAKES-01 (Home half): another take of a plain clip names the first take's Stack job (`take_of`) on the generic door. The Stack resolves it from the live result or from
// its take record (kept after the result is deleted), answers 409 not_available when it knows neither (the clip then goes on the old door, as today), and a Stack whose
// catalog does not list the key never gets it (the clip goes on the old door instead of losing it).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { db } from "@/db";
import { people as peopleTable } from "@/db/schema";
import { getVideoJobFor, markAnotherTake, startVideoJob } from "@/lib/videos/jobs";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { until } from "./pictureFixture";
import type { PersonRow } from "@/types";

let fake: FakeVideoStack;
beforeEach(() => { resetDb(); fake = installFakeVideoStack({ pollsToFinish: 3 }); fake.door = true; });
afterEach(() => { fake.restore(); });

async function owner(): Promise<{ actor: PersonRow; conversationId: string }> {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(peopleTable).where(eq(peopleTable.displayName, "Sage")).get()! as PersonRow;
  const conv = await import("@/lib/conversationHistory");
  const resolved = conv.resolveOrCreateConversation(actor, "chat", undefined, {});
  if (!resolved.ok) throw new Error("no conversation");
  return { actor, conversationId: resolved.value.id };
}
const body = (seed: number) => ({ prompt: "a paper boat", size: "832x480", seconds: 5, seed, audience: "adult" });
const start = (who: { actor: PersonRow; conversationId: string }, seed: number, takeOf?: string) =>
  startVideoJob({ ...(takeOf ? { takeOf, anotherOf: takeOf } : {}), actor: who.actor, conversationId: who.conversationId, turnId: null, temporary: true, kind: "generate", prompt: "a paper boat", body: body(seed) } as never);

/** The first take, then another take of it. */
async function takes(who: { actor: PersonRow; conversationId: string }, firstDone: boolean) {
  const first = await start(who, 11);
  await until(() => !!getVideoJobFor(who.actor, first.id)?.stackJob);
  if (firstDone) await until(() => getVideoJobFor(who.actor, first.id)?.state === "done");
  const firstStack = getVideoJobFor(who.actor, first.id)!.stackJob!;
  const second = await start(who, 22, first.id);
  markAnotherTake(second, first);
  await until(() => ["done", "failed"].includes(getVideoJobFor(who.actor, second.id)?.state ?? ""), 15_000);
  return { firstStack, second };
}

describe("another take on the door", () => {
  test("with the first take's result still live: take_of is the first take's Stack job and the new seed rides along", async () => {
    fake = (fake.restore(), installFakeVideoStack({ pollsToFinish: 12 })); fake.door = true;
    const who = await owner();
    const { firstStack, second } = await takes(who, false);
    expect(getVideoJobFor(who.actor, second.id)!.state).toBe("done");
    const request = fake.makeRequests.find((r) => (r as { seed?: number }).seed === 22)!;
    expect(request).toMatchObject({ take_of: firstStack, seed: 22, job: "clip" });
  });

  test("with only the Stack's take record (the result was deleted after Home saved the clip): the door still takes it", async () => {
    const who = await owner();
    const { firstStack, second } = await takes(who, true);
    expect(fake.jobs.find((j) => j.id === firstStack)?.deleted).toBe(true);
    expect(getVideoJobFor(who.actor, second.id)!.state).toBe("done");
    expect(fake.makeRequests.find((r) => (r as { seed?: number }).seed === 22)).toMatchObject({ take_of: firstStack });
    expect(fake.submitted.at(-1)).toHaveProperty("via", "door");
  });

  test("with neither (409 not_available): the clip is made on the old door, as today, never failed", async () => {
    fake.keepsTakeRecords = false;
    const who = await owner();
    const { second } = await takes(who, true);
    expect(getVideoJobFor(who.actor, second.id)!.state).toBe("done");
    expect(fake.submitted.at(-1)).not.toHaveProperty("via");
    expect(JSON.stringify(fake.submitted.at(-1))).not.toContain("take_of");
  });

  test("a Stack whose catalog does not list take_of never receives it: the old door makes the clip", async () => {
    fake.catalogFields = ["job", "audience", "part", "description", "shape", "level", "seconds", "start_picture", "end_picture", "styles", "seed", "inputs", "intent", "quiet_seconds", "quiet_max_wait_seconds", "wait"];
    const who = await owner();
    const { second } = await takes(who, true);
    expect(getVideoJobFor(who.actor, second.id)!.state).toBe("done");
    expect(fake.makeRequests.every((r) => !("take_of" in (r as object)))).toBe(true);
    expect(fake.submitted.at(-1)).not.toHaveProperty("via");
  });

  test("a clip that is not another take sends no take_of", async () => {
    const who = await owner();
    const first = await start(who, 11);
    await until(() => getVideoJobFor(who.actor, first.id)?.state === "done");
    expect(fake.makeRequests.every((r) => !("take_of" in (r as object)))).toBe(true);
  });

  test("the real Another take entry carries the link from the start (no race with the first release)", async () => {
    const { anotherTakeFor } = await import("@/lib/videos/make");
    const who = await owner();
    const first = await start(who, 11);
    await until(() => getVideoJobFor(who.actor, first.id)?.state === "done");
    const firstStack = getVideoJobFor(who.actor, first.id)!.stackJob!;
    const made = await anotherTakeFor(who.actor, getVideoJobFor(who.actor, first.id)!);
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    await until(() => ["done", "failed"].includes(getVideoJobFor(who.actor, made.job.id)?.state ?? ""), 15_000);
    expect(getVideoJobFor(who.actor, made.job.id)!.state).toBe("done");
    expect(fake.makeRequests.at(-1)).toMatchObject({ take_of: firstStack });
    expect(fake.makeRequests.at(-1)!.seed).not.toBe(11);
  });
});
