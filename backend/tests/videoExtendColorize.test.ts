// Extend, Colorize and One Shot through the page routes to the job request: no chat, the same gates as Create.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { db } from "@/db";
import { creations, people as peopleTable } from "@/db/schema";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { installFakeVideoStack, testJpeg, type FakeVideoStack } from "./videoFixture";
import { installFakeEditStack, type FakeEditStack } from "./videoEditStackFixture";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { __setKeyframesForTests } from "@/lib/pictures/keyframes";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { __setVideosFetchForTests } from "@/lib/videos/stack";
import { EXTEND_DEFAULT } from "@/lib/videos/clipEditStart";
import { MAX_TAKE_SECONDS, takeProgress } from "@/lib/videos/longTake";
import { createLengthOptions } from "@/lib/media/videoCreateApp";
import { until } from "./pictureFixture";
import type { PersonRow } from "@/types";

let fake: FakeVideoStack;
let editFake: FakeEditStack;
let restyles: Array<Record<string, unknown>>;
const COLORIZER = { id: "lora-c0c0c0c0c0c0c0c0", name: "ltx-ic-colorizer", sha256: "c".repeat(64), bytes: 1000, base_model: "ltx-2.3", licence: "Apache-2.0", source_url: null, classification: "all-ages" as const, trigger_words: [], strength_default: 1, added_at: "2026-11-06T00:00:00Z" };

beforeEach(() => {
  resetDb(); __resetVideoAdapterCacheForTests();
  fake = installFakeVideoStack(); editFake = installFakeEditStack();
  fake.ltx25 = "ready"; fake.ltx25max = "ready";
  __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready", ltx25max: "ready", ltx25Picture: true, ltx25maxPicture: true }));
  __setKeyframesForTests(async () => [testJpeg(), testJpeg(), testJpeg()]);
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { adult: false } as never })));
  fake.loras.push({ ...COLORIZER });
  restyles = [];
  const base = fake.handler;
  __setVideosFetchForTests((async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if ((init?.method ?? "GET").toUpperCase() === "POST" && url.pathname === "/v1/videos/restyle") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>; restyles.push(body);
      const job = { id: `vjob-${fake.jobs.length + 1}`, body, polls: 0, state: "queued", deleted: false };
      fake.jobs.push(job as never);
      return new Response(JSON.stringify({ created: 1, job: job.id, data: [] }), { status: 202, headers: { "content-type": "application/json" } });
    }
    return base(input as never, init);
  }) as unknown as typeof fetch);
});
afterEach(async () => { editFake.restore(); fake.restore(); __setKeyframesForTests(null); __setVideoStatusForTests(undefined); await new Promise((resolve) => setTimeout(resolve, 50)); });

async function household() {
  const owner = new TestClient(); await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const add = async (name: string, role: string, birthdate?: string) => {
    const res = await owner.post("/api/people", { displayName: name, role, secret: "0000", ...(birthdate ? { birthdate } : {}) });
    const { id } = await res.json() as { id: string }; const client = new TestClient(); await client.post("/api/auth/verify-secret", { personId: id, secret: "0000" }); return { id, client };
  };
  const ownerPerson = (await (await owner.get("/api/people")).json() as Array<{ id: string; role: string }>).find((p) => p.role === "owner")!;
  const adult = await add("Marlow", "adult"), teen = await add("Nova", "teen", "2011-03-01"), child = await add("Pippa", "child", "2018-03-01");
  const actor = db.select().from(peopleTable).where(eq(peopleTable.id, adult.id)).get()! as PersonRow;
  return { adult, teen, child, actor, owner, ownerId: ownerPerson.id, ownerActor: db.select().from(peopleTable).where(eq(peopleTable.id, ownerPerson.id)).get()! as PersonRow };
}
const prompt = "A paper boat floats down a rainy street";
async function finished(adult: { client: TestClient }, actor: PersonRow) {
  const made = await adult.client.post("/api/videos/make", { prompt }); const { id } = await made.json() as { id: string };
  await until(() => getVideoJobFor(actor, id)?.state === "done"); return id;
}

describe("Extend", () => {
  test("carries on from the last frame as a new clip with the parent set, using the person's sentence", async () => {
    const { adult, actor } = await household(), id = await finished(adult, actor);
    const res = await adult.client.post("/api/plugins/video/actions/extend", { id, words: "The boat reaches a bridge." }); expect(res.status).toBe(200);
    const { id: nextId } = await res.json() as { id: string }; const next = getVideoJobFor(actor, nextId)!;
    expect(next.request.anotherOf).toBe(id); expect(next.request.source_file_id).toBeTruthy();
    expect(next.prompt).toContain(prompt); expect(next.prompt).toContain("The boat reaches a bridge.");
    expect(fake.submitted.at(-1)?.prompt).toContain("The boat reaches a bridge.");
    await until(() => getVideoJobFor(actor, nextId)?.state === "done");
    const rows = db.select().from(creations).where(eq(creations.personId, actor.id)).all();
    const child = rows.find((r) => JSON.parse(r.jobIds).includes(nextId)), parent = rows.find((r) => JSON.parse(r.jobIds).includes(id));
    expect(child?.parentId).toBe(parent?.id);
  });
  test("no sentence uses the plain keep-going line; an unfilled {words} placeholder counts as none", async () => {
    const { adult, actor } = await household(), id = await finished(adult, actor);
    const res = await adult.client.post("/api/plugins/video/actions/extend", { id, words: "{words}" }); expect(res.status).toBe(200);
    const { id: nextId } = await res.json() as { id: string };
    expect(getVideoJobFor(actor, nextId)?.prompt).toContain(EXTEND_DEFAULT);
  });
  test("a long sentence is refused in one line, and a teen, a child and a locked clip start nothing", async () => {
    const { adult, teen, child, actor } = await household(), id = await finished(adult, actor);
    const before = fake.submitted.length;
    const long = await adult.client.post("/api/plugins/video/actions/extend", { id, words: "x".repeat(301) }); expect(long.status).toBe(422);
    expect(((await long.json()) as { error: string }).error).toContain("300");
    expect((await teen.client.post("/api/plugins/video/actions/extend", { id })).status).toBe(404);
    expect((await child.client.post("/api/plugins/video/actions/extend", { id })).status).toBe(404);
    expect((await adult.client.post("/api/plugins/video/actions/adult-mark", { id, action: "mark" })).status).toBe(200);
    expect((await adult.client.post("/api/plugins/video/actions/extend", { id })).status).toBe(423);
    expect(fake.submitted.length).toBe(before);
  });
});

describe("Colorize", () => {
  test("starts the colorizer restyle job for the clip's own file and keeps the original (the owner may use Max)", async () => {
    const { owner, ownerActor: actor } = await household(), id = await finished({ client: owner }, actor);
    const res = await owner.post("/api/plugins/video/actions/colorize", { id });
    expect(res.status, JSON.stringify(await res.clone().json())).toBe(200);
    const { id: jobId } = await res.json() as { id: string };
    await until(() => restyles.length > 0);
    expect(restyles[0]).toMatchObject({ lora: COLORIZER.id, conditioning: "source", model: "ltx25-max" });
    expect(getVideoJobFor(actor, jobId)).toBeTruthy(); expect(getVideoJobFor(actor, id)?.state).toBe("done");
  });
  test("with no colorizer installed it says so in one plain line and starts nothing", async () => {
    const { owner, ownerActor: actor } = await household(), id = await finished({ client: owner }, actor);
    fake.loras.length = 0; __resetVideoAdapterCacheForTests();
    const res = await owner.post("/api/plugins/video/actions/colorize", { id }); expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error.length).toBeGreaterThan(10); expect(restyles.length).toBe(0);
  });
  test("an adult without Max rights gets the plain Max line and nothing starts", async () => {
    const { adult, actor } = await household(), id = await finished(adult, actor);
    const res = await adult.client.post("/api/plugins/video/actions/colorize", { id }); expect(res.status).toBe(422);
    expect(restyles.length).toBe(0);
  });
  test("a teen, a child and a locked clip start nothing", async () => {
    const { adult, teen, child, actor } = await household(), id = await finished(adult, actor);
    expect([403, 404, 422]).toContain((await teen.client.post("/api/plugins/video/actions/colorize", { id })).status);
    expect([403, 404, 422]).toContain((await child.client.post("/api/plugins/video/actions/colorize", { id })).status);
    await adult.client.post("/api/plugins/video/actions/adult-mark", { id, action: "mark" });
    expect((await adult.client.post("/api/plugins/video/actions/colorize", { id })).status).toBe(423);
    expect(restyles.length).toBe(0);
  });
});

describe("One Shot", () => {
  test("the Length list adds whole multiples of the longest piece up to the longest unbroken take, marked as made in parts", () => {
    const options = createLengthOptions();
    expect(options.at(-1)?.value).toBe(MAX_TAKE_SECONDS);
    expect(options.filter((o) => o.label.endsWith("made in parts")).length).toBeGreaterThan(0);
    expect(options.every((o) => o.value <= MAX_TAKE_SECONDS)).toBe(true);
  });
  test("Generate with 20 seconds starts a two-part long take with the plain notice, and it finishes as one kept clip", async () => {
    const { adult, actor } = await household();
    const res = await adult.client.post("/api/plugins/video/actions/make", { prompt, seconds: 20, tier: "standard" }); expect(res.status).toBe(200);
    const body = await res.json() as { id: string; long_take: boolean; notice: string };
    expect(body.long_take).toBe(true); expect(body.notice).toContain("2 parts");
    await until(() => ["done", "failed"].includes(takeProgress(actor, body.id)?.state ?? ""), 20000);
    expect(takeProgress(actor, body.id)).toMatchObject({ state: "done", parts_done: 2 });
  });
  test("a picture on a long take, a child and a teen are each refused in one line with nothing started", async () => {
    const { adult, teen, child } = await household();
    const before = fake.submitted.length;
    const withPicture = await adult.client.post("/api/plugins/video/actions/make", { prompt, seconds: 20, start_frame: "file-x" }); expect(withPicture.status).toBe(422);
    for (const who of [teen, child]) { const r = await who.client.post("/api/plugins/video/actions/make", { prompt, seconds: 20 }); expect([403, 404, 422]).toContain(r.status); }
    expect(fake.submitted.length).toBe(before);
  });
  test("a length at or under one piece still makes a normal clip", async () => {
    const { adult } = await household();
    const res = await adult.client.post("/api/plugins/video/actions/make", { prompt, seconds: 5 }); expect(res.status).toBe(200);
    expect(((await res.json()) as { long_take?: boolean }).long_take).toBeUndefined();
  });
});
