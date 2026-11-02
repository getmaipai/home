// ADULT-LOCK-03 (docs/dev/adult-lock.md, "The Stack's full view"): the Stack redacts an adult job for every caller unless a request carries the full-view
// headers. These tests run Home's real job code against a Stack that enforces the Stack's rules (fixtures/adultStack.ts): an adult job reaches `done` with
// its clip, poster and picture because Home asked for the full view; Home's own lock still answers the placeholder or 404 before an unlock; a job that is not
// adult, a minor, a shared screen and every call that does not read a job never carry the headers; a missing, wrong or rotated key ends in one plain line and
// a Repairs row that name no key.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetDb } from "./reset-db";
import { TestClient } from "./client";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetAdultLockForTests, issueProof } from "@/lib/adultLock";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { __setVideoStatusForTests } from "@/lib/videos/ready";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { getVideoJobFor, startVideoJob } from "@/lib/videos/jobs";
import { getPictureJob, startPictureJob } from "@/lib/pictures/jobs";
import { fullViewForJob } from "@/lib/stack/fullView";
import { __setHomeViewTokenForTests } from "@/lib/stack/homeViewToken";
import { setHouseholdSettingValue } from "@/lib/settings";
import { listIssues } from "@/lib/issues";
import { createBenchPeople, type BenchPeople } from "../scripts/bench/conversationRunner";
import { useDefaultScriptedStack } from "./stackFixture";
import { installFakeVideoStack, testMp4, type FakeVideoStack } from "./videoFixture";
import { installFakeImageStack, until, type FakeImageStack } from "./pictureFixture";
import { DEFAULT_TEST_VIEW_TOKEN } from "./fixtures/viewToken";
import { enforceAdultView, STACK_TEST_TOKEN, type EnforcingStack } from "./fixtures/adultStack";
import { ADULT_PROMPT, PASSCODE, adultClip, household, markAdultOnly, unlock, unlockHeader } from "./fixtures/adultLock";
import { db } from "@/db";
import { people as peopleTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { PersonRow } from "@/types";

let video: FakeVideoStack;
let picture: FakeImageStack;
let stack: EnforcingStack;
let folder: string | null = null;
const savedDataDir = process.env.MAIPAI_STACK_DATA_DIR;
const savedEnvToken = process.env.STACK_HOME_VIEW_TOKEN;

beforeEach(() => {
  resetDb(); __resetVideoAdapterCacheForTests(); __resetAdultLockForTests(); __resetThrottleForTests(); __resetRateLimiterForTests();
  video = installFakeVideoStack();
  picture = installFakeImageStack();
  stack = enforceAdultView({ video: video.handler, picture: picture.handler });
  __setHomeViewTokenForTests(STACK_TEST_TOKEN);
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: { adult: false } as never })));
  delete process.env.STACK_HOME_VIEW_TOKEN;
});
afterEach(() => {
  video.restore(); picture.restore(); __setVideoStatusForTests(undefined); __setHomeViewTokenForTests(DEFAULT_TEST_VIEW_TOKEN);
  if (savedDataDir === undefined) delete process.env.MAIPAI_STACK_DATA_DIR; else process.env.MAIPAI_STACK_DATA_DIR = savedDataDir;
  if (savedEnvToken === undefined) delete process.env.STACK_HOME_VIEW_TOKEN; else process.env.STACK_HOME_VIEW_TOKEN = savedEnvToken;
  setHouseholdSettingValue("engines.stack.where", "this_computer");
  if (folder) { rmSync(folder, { recursive: true, force: true }); folder = null; }
});

const HEADERS = ["x-maipai-view", "x-maipai-home-token"];
const jobReads = (r: { method: string; path: string }) => r.method === "GET" && /\/v1\/(videos|images)\/generations\//.test(r.path);
const aClip = (r: { path: string }) => /\/video\.mp4$/.test(r.path);

async function plainClip(actor: PersonRow, audience: "all-ages" | "adult") {
  const job = await startVideoJob({ actor, conversationId: null, turnId: null, temporary: false, kind: "generate", prompt: "a paper boat", body: { prompt: "a paper boat", audience } as never });
  await until(() => ["done", "failed"].includes(getVideoJobFor(actor, job.id)?.state ?? ""));
  return getVideoJobFor(actor, job.id)!;
}

describe("an adult clip, through Home's routes", () => {
  test("Home reads status, preview, clip and poster with the full view; the clip it keeps is the real one; before the unlock the routes answer the lock, after it the media", async () => {
    const { adult, row } = await household();
    const me = row("Marlow");
    const clip = await adultClip(adult.client, me);
    // The Stack redacts this job for anyone without the headers, so a done clip with files proves Home asked for the full view.
    const reads = stack.seen.filter(jobReads);
    expect(reads.length).toBeGreaterThan(3);
    expect(reads.every((r) => r.full && r.status === 200)).toBe(true);
    expect(reads.some(aClip)).toBe(true);
    expect(reads.some((r) => /poster\.jpg$/.test(r.path))).toBe(true);
    // Only the reads of the job carry the headers: the submit, the DELETE of the Stack's copy and the status list never do.
    for (const r of stack.seen.filter((x) => !jobReads(x))) expect({ path: r.path, method: r.method, full: r.full }).toEqual({ path: r.path, method: r.method, full: false });
    const stored = getVideoJobFor(me, clip.jobId)!;
    expect(stored.state).toBe("done");
    // Home's own redaction (ADULT-LOCK-02) before the unlock: the tile, and 404 for every file.
    expect(await (await adult.client.get(`/api/videos/jobs/${clip.jobId}`)).json()).toEqual({ locked: true, making: false });
    expect((await adult.client.get(`/api/videos/jobs/${clip.jobId}/files/${clip.fileId}`)).status).toBe(404);
    expect((await adult.client.get(`/api/videos/jobs/${clip.jobId}/files/${clip.posterId}`)).status).toBe(404);
    expect((await adult.client.get(`/api/videos/jobs/${clip.jobId}/messages.mp4`)).status).toBe(404);
    // After the unlock: the card, the real bytes, the poster and the messaging copy.
    const proof = unlockHeader(await unlock(adult.client));
    const card = await (await adult.client.get(`/api/videos/jobs/${clip.jobId}`, proof)).json() as { locked?: boolean };
    expect(card.locked).toBeUndefined();
    expect(JSON.stringify(card)).toContain(clip.fileId);
    const bytes = new Uint8Array(await (await adult.client.get(`/api/videos/jobs/${clip.jobId}/files/${clip.fileId}`, proof)).arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(testMp4()));
    expect((await adult.client.get(`/api/videos/jobs/${clip.jobId}/files/${clip.posterId}`, proof)).status).toBe(200);
    expect((await adult.client.get(`/api/videos/jobs/${clip.jobId}/messages.mp4`, proof)).status).toBe(200);
    // The messaging copy is a stateless POST of Home's own bytes: no job, so no headers.
    expect(stack.seen.filter((r) => r.path === "/v1/videos/messages").every((r) => !r.full)).toBe(true);
    // The key is never in anything Home answered.
    const text = JSON.stringify(await (await adult.client.get(`/api/videos/jobs/${clip.jobId}`, proof)).json());
    expect(text.includes(STACK_TEST_TOKEN)).toBe(false);
  });

  test("a clip that is not adult never carries the headers, even with a key at hand, and a Stack that would refuse the headers never sees them", async () => {
    const { row } = await household();
    const me = row("Marlow");
    const job = await plainClip(me, "all-ages");
    expect(job.state).toBe("done");
    for (const r of stack.seen) for (const name of HEADERS) expect({ path: r.path, name, sent: name in r.headers }).toEqual({ path: r.path, name, sent: false });
    // The Stack's own refusal of a wrong key on every route would have failed the job had Home sent one.
    stack.token = "a-different-key-0123456789";
    const again = await plainClip(me, "all-ages");
    expect(again.state).toBe("done");
  });
});

describe("the grant", () => {
  const person = (name: string) => db.select().from(peopleTable).where(eq(peopleTable.displayName, name)).get()! as PersonRow;
  const own = (id: string) => ({ proof: { token: issueProof(id, "session-a", "page").proof, sessionKey: "session-a" }, surface: "own" as const });

  test("only an adult's adult job gets one; a minor's, and a job that is not adult, get none", async () => {
    const { row } = await household();
    expect(fullViewForJob("adult", row("Marlow"))).toBeDefined();
    expect(fullViewForJob("all-ages", row("Marlow"))).toBeUndefined();
    expect(fullViewForJob(undefined, row("Marlow"))).toBeUndefined();
    expect(fullViewForJob("adult", row("Nova"))).toBeUndefined();
    expect(fullViewForJob("adult", row("Sprout"))).toBeUndefined();
    expect(fullViewForJob("adult", row("Nova"), own(row("Nova").id))).toBeUndefined();
  });

  test("a person-present read needs their own live proof on their own screen: never a shared or spoken one, never a device without a session", async () => {
    const { row } = await household();
    const me = row("Marlow");
    expect(fullViewForJob("adult", me, own(me.id))).toBeDefined();
    expect(fullViewForJob("adult", me, { ...own(me.id), surface: "shared" })).toBeUndefined();
    expect(fullViewForJob("adult", me, { ...own(me.id), surface: "spoken" })).toBeUndefined();
    const noSession = own(me.id);
    expect(fullViewForJob("adult", me, { ...noSession, proof: { ...noSession.proof, sessionKey: null } })).toBeUndefined();
    expect(fullViewForJob("adult", me, { surface: "own", proof: { token: null, sessionKey: "session-a" } })).toBeUndefined();
    // Someone else's proof is no proof for this person.
    const other = row("Quill");
    expect(fullViewForJob("adult", me, { surface: "own", proof: own(other.id).proof })).toBeUndefined();
  });

  test("a minor's adult-audience job (which Home never makes) reaches the Stack without the headers", async () => {
    const { row } = await household();
    const teen = row("Nova");
    const job = await startVideoJob({ actor: teen, conversationId: null, turnId: null, temporary: false, kind: "generate", prompt: "a paper boat", body: { prompt: "a paper boat", audience: "adult" } as never });
    await until(() => ["done", "failed"].includes(getVideoJobFor(teen, job.id)?.state ?? ""));
    expect(stack.seen.every((r) => !r.full)).toBe(true);
  });
});

describe("pictures", () => {
  let people: BenchPeople;
  beforeEach(() => { useDefaultScriptedStack(); people = createBenchPeople(); });
  const make = async (kind: "generate" | "edit", audience: "adult" | "all-ages") => {
    const conv = await import("@/lib/conversationHistory");
    const resolved = conv.resolveOrCreateConversation(people.owner, "chat", undefined, {});
    if (!resolved.ok) throw new Error("no conversation");
    const job = await startPictureJob({ actor: people.owner, conversationId: resolved.value.id, turnId: null, temporary: true, kind, prompt: "a portrait", body: { prompt: "a portrait", size: "1024x1024", n: 1, audience } });
    await until(() => ["done", "failed"].includes(getPictureJob(people.owner, job.id)?.state ?? ""));
    return getPictureJob(people.owner, job.id)!;
  };

  test("an adult picture job is read with the full view (status, preview, the PNG) and finishes; the Stack's copy is deleted without it", async () => {
    const job = await make("generate", "adult");
    expect(job.state).toBe("done");
    const reads = stack.seen.filter(jobReads);
    expect(reads.length).toBeGreaterThan(1);
    expect(reads.every((r) => r.full && r.status === 200)).toBe(true);
    expect(reads.some((r) => /\.png$/.test(r.path))).toBe(true);
    for (const r of stack.seen.filter((x) => !jobReads(x))) expect(r.full).toBe(false);
  });

  test("a picture that is not adult carries no header", async () => {
    const job = await make("generate", "all-ages");
    expect(job.state).toBe("done");
    expect(stack.seen.every((r) => !r.full)).toBe(true);
  });
});

describe("the key", () => {
  /** An adult clip started now; the job is left running (a key problem never fails a clip: it keeps asking while Repairs says what to do). */
  async function startAdult(actor: PersonRow) {
    const job = await startVideoJob({ actor, conversationId: null, turnId: null, temporary: false, kind: "generate", prompt: "a paper boat", body: { prompt: "a paper boat", audience: "adult" } as never });
    const done = async () => { await until(() => ["done", "failed"].includes(getVideoJobFor(actor, job.id)?.state ?? "")); return getVideoJobFor(actor, job.id)!; };
    return { job, done };
  }
  const keyRow = () => listIssues().filter((i) => i.source === "stack" && i.key === "adult.view_key");

  test("a missing key leaves the clip running with a Repairs row that names no key; once the key is there the same clip finishes and the row closes", async () => {
    __setHomeViewTokenForTests(null);
    const { row } = await household();
    const me = row("Marlow");
    const started = await startAdult(me);
    await until(() => keyRow().length === 1);
    expect(JSON.stringify(keyRow()[0])).not.toContain(STACK_TEST_TOKEN);
    expect(getVideoJobFor(me, started.job.id)?.state).not.toBe("failed");
    expect(stack.seen.every((r) => !r.full)).toBe(true);
    __setHomeViewTokenForTests(STACK_TEST_TOKEN);
    expect((await started.done()).state).toBe("done");
    expect(keyRow()).toHaveLength(0);
  });

  test("a wrong key (the Stack refuses it 403) is asked for again once per read, the clip keeps waiting, and a fixed key finishes it", async () => {
    const { row } = await household();
    const me = row("Marlow");
    stack.token = "the-stack-has-another-key-0123";
    const started = await startAdult(me);
    await until(() => keyRow().length === 1 && stack.seen.filter((r) => r.status === 403).length >= 2);
    expect(getVideoJobFor(me, started.job.id)?.state).not.toBe("failed");
    expect(JSON.stringify(keyRow()[0])).not.toContain(STACK_TEST_TOKEN);
    stack.token = STACK_TEST_TOKEN;
    expect((await started.done()).state).toBe("done");
    expect(keyRow()).toHaveLength(0);
  });

  test("the local Stack's key file is read once and cached; a rotated key (403) is read again from the file and the call goes through", async () => {
    folder = mkdtempSync(join(tmpdir(), "stack-data-"));
    process.env.MAIPAI_STACK_DATA_DIR = folder;
    __setHomeViewTokenForTests(undefined);
    mkdirSync(join(folder, "keys"), { recursive: true });
    const write = (key: string) => writeFileSync(join(folder!, "keys", "home-view-token"), `${key}\n`, { mode: 0o600 });
    write(STACK_TEST_TOKEN);
    const { row } = await household();
    const me = row("Marlow");
    expect((await plainClip(me, "adult")).state).toBe("done");
    // The Stack's key changes (and its file with it) while Home has the old one cached.
    stack.token = "rotated-stack-key-0123456789";
    write(stack.token);
    const second = await plainClip(me, "adult");
    expect(second.state).toBe("done");
    expect(stack.seen.some((r) => r.status === 403)).toBe(true);
    expect(readFileSync(join(folder, "keys", "home-view-token"), "utf8").trim()).toBe("rotated-stack-key-0123456789");
  });

  test("a local Stack with no key file yet is asked once with a placeholder, which is how it makes the file, and Home then uses the real key", async () => {
    folder = mkdtempSync(join(tmpdir(), "stack-data-"));
    process.env.MAIPAI_STACK_DATA_DIR = folder;
    stack.keyFolder = folder;
    __setHomeViewTokenForTests(undefined);
    const { row } = await household();
    expect((await plainClip(row("Marlow"), "adult")).state).toBe("done");
    const priming = stack.seen.filter((r) => r.path === "/stack/v1/health");
    expect(priming).toHaveLength(1);
    expect(priming[0]!.headers["x-maipai-home-token"]).not.toBe(STACK_TEST_TOKEN);
  });

  test("the key can come from Home's environment", async () => {
    __setHomeViewTokenForTests(undefined);
    process.env.STACK_HOME_VIEW_TOKEN = STACK_TEST_TOKEN;
    const { row } = await household();
    expect((await plainClip(row("Marlow"), "adult")).state).toBe("done");
  });

  test("a Stack on another computer: the key an admin stores is used, encrypted at rest, and without it Repairs says what to do", async () => {
    __setHomeViewTokenForTests(undefined);
    setHouseholdSettingValue("engines.stack.where", "another_computer");
    const { owner, adult, row } = await household();
    const me = row("Marlow");
    const started = await startAdult(me);
    await until(() => keyRow().length === 1);
    expect(keyRow()[0]?.detail).toContain("admin");
    // Only an admin may store it, and a value that cannot be a key is refused.
    expect((await adult.client.put("/api/engine-link/view-token", { token: STACK_TEST_TOKEN })).status).toBe(403);
    expect((await owner.put("/api/engine-link/view-token", { token: "short" })).status).toBeGreaterThanOrEqual(400);
    const stored = await owner.put("/api/engine-link/view-token", { token: STACK_TEST_TOKEN });
    expect(stored.status).toBe(200);
    expect(await stored.json()).toEqual({ stored: true });
    expect((await started.done()).state).toBe("done");
    const { dataDir } = await import("@/lib/paths");
    expect(readFileSync(join(dataDir, "keys", "stack-link", "home-view-token.enc"), "utf8")).not.toContain(STACK_TEST_TOKEN);
    expect((await owner.delete("/api/engine-link/view-token")).status).toBe(200);
    // Unpairing the engine computer forgets its key too.
    expect((await owner.put("/api/engine-link/view-token", { token: STACK_TEST_TOKEN })).status).toBe(200);
    expect((await owner.delete("/api/engine-link/credentials")).status).toBe(200);
    expect(existsSync(join(dataDir, "keys", "stack-link", "home-view-token.enc"))).toBe(false);
  });
});

void ADULT_PROMPT; void PASSCODE; void markAdultOnly; void TestClient;
