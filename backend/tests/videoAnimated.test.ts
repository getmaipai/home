import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people as peopleTable } from "@/db/schema";
import { getVideoJobFor, startVideoJob } from "@/lib/videos/jobs";
import { __resetAnimatedCopiesForTests } from "@/lib/videos/messagesCopy";
import { __setVideosFetchForTests } from "@/lib/videos/stack";
import { __setVideoStatusForTests } from "@/lib/videos/ready";
import type { PersonRow } from "@/types";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { installFakeVideoStack } from "./videoFixture";
import type { FakeVideoStack } from "./videoFixture";
import { until } from "./pictureFixture";
import { household } from "./fixtures/adultLock";

let fake: FakeVideoStack;
beforeEach(() => { resetDb(); __resetAnimatedCopiesForTests(); fake = installFakeVideoStack(); });
afterEach(() => { fake.restore(); __setVideoStatusForTests(undefined); __resetAnimatedCopiesForTests(); });

async function setup() {
  const owner = new TestClient();
  await owner.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(peopleTable).where(eq(peopleTable.displayName, "Sage")).get()! as PersonRow;
  const conv = await import("@/lib/conversationHistory");
  const resolved = conv.resolveOrCreateConversation(actor, "chat", undefined, {});
  if (!resolved.ok) throw new Error("no conversation");
  const job = await startVideoJob({ actor, conversationId: resolved.value.id, turnId: null, temporary: true, kind: "generate", prompt: "a paper boat", body: { prompt: "a paper boat", audience: "adult" } });
  await until(() => getVideoJobFor(actor, job.id)?.state === "done");
  return { owner, actor, job };
}

describe("saving a finished clip as an animation", () => {
  test("owner gets the selected type and a prompt filename, and a repeat is cached", async () => {
    const { owner, job } = await setup();
    let conversions = 0;
    const previous = fake.handler;
    __setVideosFetchForTests((async (input, init) => {
      if (new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname === "/v1/videos/animated") { conversions++; return new Response(new Uint8Array([71, 73, 70, 56]), { headers: { "content-type": "image/gif" } }); }
      return previous(input, init);
    }) as typeof fetch);
    const path = `/api/videos/jobs/${job.id}/animated?format=gif`;
    const res = await owner.get(path);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/gif");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="paper-boat.gif"');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([71, 73, 70, 56]));
    expect((await owner.get(path)).status).toBe(200);
    expect(conversions).toBe(1);
    __setVideosFetchForTests(null);
  });

  test("a stranger cannot fetch another person's job", async () => {
    const { adult, other, row } = await household();
    const actor = row("Marlow");
    const conv = await import("@/lib/conversationHistory");
    const resolved = conv.resolveOrCreateConversation(actor, "chat", undefined, {});
    if (!resolved.ok) throw new Error("no conversation");
    const job = await startVideoJob({ actor, conversationId: resolved.value.id, turnId: null, temporary: true, kind: "generate", prompt: "a paper boat", body: { prompt: "a paper boat", audience: "adult" } });
    await until(() => getVideoJobFor(actor, job.id)?.state === "done");
    const stranger = other.client;
    expect((await stranger.get(`/api/videos/jobs/${job.id}/animated`)).status).toBe(404);
  });

  test("adult-only clips use a generic filename", async () => {
    const { owner, actor, job } = await setup();
    getVideoJobFor(actor, job.id)!.request.adultOnly = true;
    const previous = fake.handler;
    __setVideosFetchForTests((async (input, init) => new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname === "/v1/videos/animated" ? new Response(new Uint8Array([1])) : previous(input, init)) as typeof fetch);
    const res = await owner.get(`/api/videos/jobs/${job.id}/animated?format=webp`);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="video.webp"');
    expect(res.headers.get("content-type")).toBe("image/webp");
    __setVideosFetchForTests(null);
  });

  test("WebP unavailable gives actionable 422 copy", async () => {
    const { owner, job } = await setup();
    const previous = fake.handler;
    __setVideosFetchForTests((async (input, init) => new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname === "/v1/videos/animated" ? Response.json({ code: "format_unavailable", error: "WebP encoder unavailable." }, { status: 422 }) : previous(input, init)) as typeof fetch);
    const res = await owner.get(`/api/videos/jobs/${job.id}/animated?format=webp`);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toContain("Save as GIF or MP4 instead.");
    __setVideosFetchForTests(null);
  });

  test("bad formats are rejected", async () => {
    const { owner, job } = await setup();
    expect((await owner.get(`/api/videos/jobs/${job.id}/animated?format=mp4`)).status).toBe(400);
  });
});
