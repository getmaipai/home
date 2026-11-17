import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { db } from "@/db";
import { attachments, people } from "@/db/schema";
import { storeFile } from "@/lib/attachments";
import { createMediaSubject } from "@/lib/mediaSubjects";
import { runStackSwap, __setSwapFetchForTests, __setStackSwapTimingForTests } from "@/lib/videos/stackSwap";
import { swapReferencePhotos } from "@/lib/videos/swapReferences";
import { editVideoArgs } from "@/lib/videos/editTool";
import { readyVideoStatusForTests, __setVideoStatusForTests } from "@/lib/videos/ready";
import { __resetVideoJobsForTests, getVideoJobFor } from "@/lib/videos/jobs";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { installFakeVideoStack } from "./videoFixture";
import { owner } from "./support/testAuth";
import { runEditVideo } from "@/lib/videos/editTool";
import { resolveOrCreateConversation } from "@/lib/conversationHistory";
import { newConversationTurnId } from "@/lib/id";
import { logTurn } from "@/lib/conversationHistory";
import type { PersonRow } from "@/types";

let fake: ReturnType<typeof installFakeVideoStack>;
beforeEach(() => { resetDb(); fake = installFakeVideoStack(); __setStackSwapTimingForTests({ pollMs: 1, deadlineMs: 1000 }); });
afterEach(() => { fake.restore(); __setSwapFetchForTests(null); __setVideoStatusForTests(undefined); __setAgeCheckRunnerForTests(null); __resetVideoJobsForTests(); __setStackSwapTimingForTests(null); });
function person(name: string, role = "owner"): PersonRow { const now = new Date().toISOString(), id = `person-${name}-swap`; db.insert(people).values({ id, displayName: name, role, avatarSeed: name, source: "local", createdAt: now, updatedAt: now, hlc: "1:0:test" }).run(); return db.select().from(people).where(eq(people.id, id)).get() as PersonRow; }
function photo(actor: PersonRow, n: number, provenance = "media-subject-reference"): string { const x = storeFile(actor, { conversationId: null, turnId: null, mediaType: "image/jpeg", bytes: new Uint8Array([n, 2, 3]), provenance, retention: "kept", name: `${n}.jpg` }); if (!x.ok) throw Error(x.error); return x.value.id; }

describe("swap reference selection", () => {
  test("uses ordinary photos in stored order, capped at three", () => { const refs = [1, 2, 3, 4].map((n) => ({ id: String(n), bytes: new Uint8Array([n]), mediaType: "image/jpeg", audience: "all-ages" })); expect(swapReferencePhotos({ references: refs } as never).map((r) => r.id)).toEqual(["1", "2", "3"]); });
});

describe("Stack swap", () => {
  test("sends the Stack's own field names, follows the job to done and downloads video.mp4", async () => {
    const source = join(mkdtempSync(join(tmpdir(), "swap-test-")), "source.mp4"); writeFileSync(source, new Uint8Array([0, 0, 0, 8, 102, 116, 121, 112]));
    const seen: { url: string; method: string }[] = []; let form: FormData | null = null; let polls = 0; const clip = new Uint8Array([9, 8, 7, 6]);
    const handler = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(typeof input === "object" && "url" in input ? input.url : input); const method = init?.method ?? "GET"; seen.push({ url, method });
      if (method === "POST") { form = init!.body as FormData; return new Response(JSON.stringify({ created: 1, job: "job-swap-1", state: "running" }), { status: 200 }); }
      if (url.endsWith("/video.mp4")) return new Response(clip, { status: 200 });
      if (++polls === 1) return new Response(JSON.stringify({ job: "job-swap-1", state: "running", progress: 52, status: "Swapping segment 2 of 3", result: null }));
      return new Response(JSON.stringify({ job: "job-swap-1", state: "done", progress: 100, status: "done", result: { video: "/v1/videos/swap/job-swap-1/video.mp4" } }));
    };
    __setSwapFetchForTests(handler as unknown as typeof fetch);
    const progress: Array<[number, string | undefined]> = [];
    const result = await runStackSwap({ sourcePath: source, references: [{ bytes: new Uint8Array([1]), mediaType: "image/jpeg" }, { bytes: new Uint8Array([2]), mediaType: "image/png" }], description: "A person", size: "512x384", startSeconds: 1, seconds: 2.33, onProgress: (n, line) => progress.push([n, line]) });
    expect(result).toMatchObject({ ok: true, audio: true }); if (result.ok) expect([...result.bytes]).toEqual([9, 8, 7, 6]);
    // The field names are the swap route's: a wrong name would be refused by the real Stack with "Send the source MP4 as source_video."
    expect([...(form as FormData | null)!.keys()].sort()).toEqual(["description", "references", "references", "seconds", "size", "source_video", "start_seconds"]);
    expect((form as FormData | null)!.get("start_seconds")).toBe("1"); expect((form as FormData | null)!.get("seconds")).toBe("2.33");
    expect(progress.map((p) => p[0])).toEqual([52, 100]); expect(progress[0]![1]).toBe("Swapping segment 2 of 3.");
    expect(seen.map((r) => `${r.method} ${r.url.replace(/^.*\/v1/, "/v1")}`)).toEqual(["POST /v1/videos/swap", "GET /v1/videos/swap/job-swap-1", "GET /v1/videos/swap/job-swap-1", "GET /v1/videos/swap/job-swap-1/video.mp4"]);
  });
  test("a failed job gives the Stack's own sentence, and a refusal at submit gives its sentence too", async () => {
    const source = join(mkdtempSync(join(tmpdir(), "swap-test-")), "source.mp4"); writeFileSync(source, new Uint8Array([1]));
    __setSwapFetchForTests((async (_i: unknown, init?: RequestInit) => (init?.method ?? "GET") === "POST" ? new Response(JSON.stringify({ created: 1, job: "j", state: "running" })) : new Response(JSON.stringify({ state: "failed", progress: 45, error: "The head swap could not finish segment 2. Try again with a shorter clip." }))) as unknown as typeof fetch);
    expect(await runStackSwap({ sourcePath: source, references: [], description: "x", size: "512x384", startSeconds: 0, seconds: 2.33 })).toMatchObject({ ok: false, line: "The head swap could not finish segment 2. Try again with a shorter clip." });
    __setSwapFetchForTests((async () => new Response(JSON.stringify({ error: "Not enough free memory for a face swap right now. Try again when nothing else is being made.", code: "no_memory" }), { status: 503 })) as unknown as typeof fetch);
    expect(await runStackSwap({ sourcePath: source, references: [], description: "x", size: "512x384", startSeconds: 0, seconds: 2.33 })).toMatchObject({ ok: false, line: expect.stringContaining("Not enough free memory") });
  });
  test("a swap that only ever waited for its turn says memory is short, not that the clip was too long", async () => {
    const source = join(mkdtempSync(join(tmpdir(), "swap-test-")), "source.mp4"); writeFileSync(source, new Uint8Array([1]));
    __setSwapFetchForTests((async (_i: unknown, init?: RequestInit) => (init?.method ?? "GET") === "POST" ? new Response(JSON.stringify({ created: 1, job: "j", state: "queued" })) : new Response(JSON.stringify({ job: "j", state: "queued", progress: 0, status: "Waiting for its turn" }))) as unknown as typeof fetch);
    const result = await runStackSwap({ sourcePath: source, references: [], description: "x", size: "512x384", startSeconds: 0, seconds: 2.33 });
    expect(result).toMatchObject({ ok: false, code: "timeout", line: expect.stringContaining("not enough free memory") });
    expect(JSON.stringify(result)).not.toContain("shorter clip");
  });
  test("maps a route 404 to the plain unavailable line", async () => { const source = join(mkdtempSync(join(tmpdir(), "swap-test-")), "source.mp4"); writeFileSync(source, new Uint8Array([1])); __setSwapFetchForTests((async () => new Response("{}", { status: 404 })) as unknown as typeof fetch); expect(await runStackSwap({ sourcePath: source, references: [], description: "x", size: "512x384", startSeconds: 0, seconds: 1 })).toMatchObject({ ok: false, line: "Swapping a face is not available on this computer yet." }); });
});

describe("edit_video swap schema", () => {
  test("accepts a cast id and refuses missing or multiple cast ids", () => { expect(editVideoArgs.safeParse({ clip: "latest", change: "swap", cast: ["person-id"] }).success).toBe(true); expect(editVideoArgs.safeParse({ clip: "latest", change: "swap" }).success).toBe(false); expect(editVideoArgs.safeParse({ clip: "latest", change: "swap", cast: ["one", "two"] }).success).toBe(false); });
});

// CREATOR-57b: the Swap character page and its action.
import { beforeEach as swapBeforeEach } from "bun:test";
import { TestClient } from "./client";
import { startSwap } from "@/lib/videos/swapStart";

swapBeforeEach(() => resetDb());
test("the Swap character page is offered to an adult and its action asks for a clip and one cast member in plain words", async () => {
  const c = new TestClient(); await c.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const page = await c.get("/api/plugins/video/pages/swap");
  expect(page.status).toBe(200);
  expect(JSON.stringify(await page.json())).toContain("Swap character");
  const noClip = await c.post("/api/plugins/video/actions/swap", { cast: ["x"] });
  expect(noClip.status).toBe(422); expect((await noClip.json() as { code: string }).code).toBe("no_clip");
  const noCast = await c.post("/api/plugins/video/actions/swap", { id: "vid-x" });
  expect(noCast.status).toBe(422); expect((await noCast.json() as { code: string }).code).toBe("no_cast");
  const unfilled = await c.post("/api/plugins/video/actions/swap", { id: "vid-x", cast: "{cast}" });
  expect((await unfilled.json() as { code: string }).code).toBe("no_cast");
  const two = await c.post("/api/plugins/video/actions/swap", { id: "vid-x", cast: ["a", "b"] });
  expect((await two.json() as { code: string }).code).toBe("one_person");
});
test("starting a swap on a clip that is not there is the plain not-found line", async () => {
  const c = new TestClient(); await c.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const owner = db.select().from(people).get()! as PersonRow;
  const started = await startSwap(owner, "vid-missing", { cast: ["someone"] });
  expect(started.ok).toBe(false);
  if (!started.ok) expect(started.error).toContain("isn't available");
});
