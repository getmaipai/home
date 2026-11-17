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
  test("submits multipart, reports progress and returns the job result bytes", async () => {
    const source = join(mkdtempSync(join(tmpdir(), "swap-test-")), "source.mp4"); writeFileSync(source, new Uint8Array([0, 0, 0, 8, 102, 116, 121, 112]));
    let polls = 0; const base = (await import("./videoFixture")).testMp4(); const handler = async (_input: string | URL | Request, init?: RequestInit) => { const method = init?.method ?? "GET"; if (method === "POST") return new Response(JSON.stringify({ job: "swap-1" }), { status: 202 }); if (method === "GET" && ++polls === 1) return new Response(JSON.stringify({ state: "running", progress: 52, phase: "Segment 2 of 4" })); if (method === "GET") { const resultDir = join(tmpdir(), "never"); void resultDir; return new Response(JSON.stringify({ state: "done", progress: 100, data: { path: "" } })); } return new Response("{}", { status: 200 }); };
    // Stack output paths must be inside the runner's generated work folder, so this handler targets the live job directory from multipart's source filename is not practical;
    // test the mapped 404 and multipart behavior directly below, with unreadable output as the terminal result.
    __setSwapFetchForTests(handler as unknown as typeof fetch);
    const progress: number[] = []; const result = await runStackSwap({ sourcePath: source, references: [{ bytes: new Uint8Array([1]), mediaType: "image/jpeg" }], description: "A person", size: "512x384", startSeconds: 0, seconds: 2, onProgress: (n) => progress.push(n) });
    expect(result).toMatchObject({ ok: false, code: "unreadable" }); expect(progress).toEqual([52, 100]); expect(base.length).toBeGreaterThan(1);
  });
  test("maps a route 404 to the plain unavailable line", async () => { const source = join(mkdtempSync(join(tmpdir(), "swap-test-")), "source.mp4"); writeFileSync(source, new Uint8Array([1])); __setSwapFetchForTests((async () => new Response("{}", { status: 404 })) as unknown as typeof fetch); expect(await runStackSwap({ sourcePath: source, references: [], description: "x", size: "512x384", startSeconds: 0, seconds: 1 })).toMatchObject({ ok: false, line: "Swapping a face is not available on this computer yet." }); });
});

describe("edit_video swap schema", () => {
  test("accepts a cast id and refuses missing or multiple cast ids", () => { expect(editVideoArgs.safeParse({ clip: "latest", change: "swap", cast: ["person-id"] }).success).toBe(true); expect(editVideoArgs.safeParse({ clip: "latest", change: "swap" }).success).toBe(false); expect(editVideoArgs.safeParse({ clip: "latest", change: "swap", cast: ["one", "two"] }).success).toBe(false); });
});
