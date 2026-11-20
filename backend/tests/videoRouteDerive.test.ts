// VF-ROUTE-01 / VF-ROUTE-DERIVE-01: the cast's picture travels as an `identity` input; only the Stack's typed `needs_start_picture` makes Home derive ONE first
// picture (one generic picture job, the finished-item gate, fail closed) and resend it as `start_picture` marked derived. No model, size or prompt is chosen here.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import sharp from "sharp";
import { resetDb } from "./reset-db";
import { createBenchPeople } from "../scripts/bench/conversationRunner";
import { __setVideosFetchForTests, type VideoBody } from "@/lib/videos/stack";
import { __setPicturesFetchForTests } from "@/lib/pictures/stack";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { clipRequestFor, submitVideoViaDoor } from "@/lib/videos/doorClip";
import { __setDerivePollMsForTests } from "@/lib/videos/deriveStart";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const IDENTITY = Buffer.from("identity-picture").toString("base64");
const body = (over: Partial<VideoBody> = {}): VideoBody => ({ prompt: "she waves at the sea", audience: "adult", size: "864x480", seconds: 5, seed: 7, timeout_ms: 1, identity_image: IDENTITY, ...over });

let png = "";
let calls: Array<{ path: string; body: Record<string, any> | null }> = [];
let clipAnswers: Array<() => Response> = [];
let withheld = false;
const needs = () => json({ code: "needs_start_picture", line: "This part starts a person from a first picture.", shape: "landscape", inputs: ["identity"] }, 409);
const clipOk = () => json({ id: "clip-1", job: "clip", state: "running", percent: 0, status: "Making", files: [], poster: null, made_with: { part: "part-a", label: "A", pack_version: "1", shape: "landscape", seconds: 5, sound: true, notes: [], route: "start_picture", route_reason: "A derived first picture starts it." } }, 202);
const answer = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const path = new URL(String(input), "http://stack.test").pathname;
  calls.push({ path, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
  if (path === "/stack/v1/jobs/catalog") return json({ audience: "adult", jobs: [{ job: "clip", available: true, part: { id: "part-a", label: "A" } }] });
  if (path === "/stack/v1/jobs/make") {
    const job = JSON.parse(String(init?.body)).job;
    if (job === "picture") return json({ id: "pic-1", job: "picture", state: "running", percent: 0, status: "Making", files: [], poster: null, made_with: { part: "part-p", label: "P", pack_version: "1", shape: "landscape", seconds: null, sound: false, notes: [] } }, 202);
    return (clipAnswers.shift() ?? clipOk)();
  }
  if (/\/v1\/images\/generations\/pic-1$/.test(path)) return json({ id: "pic-1", state: "done", status: "done", progress: 100, data: [{ b64_json: png }] });
  if (/\/v1\/images\/generations\/pic-1\/0/.test(path)) return new Response(Buffer.from(png, "base64"), { headers: { "content-type": "image/png" } });
  if (init?.method === "DELETE") return json({ ok: true });
  return json({ error: "no", code: "not_found" }, 404);
};
const pictureMakes = () => calls.filter((c) => c.path === "/stack/v1/jobs/make" && c.body?.job === "picture");
const clipMakes = () => calls.filter((c) => c.path === "/stack/v1/jobs/make" && c.body?.job === "clip");

let actor: ReturnType<typeof createBenchPeople>["owner"];
beforeEach(async () => {
  resetDb(); actor = createBenchPeople().owner; calls = []; clipAnswers = []; withheld = false; __setDerivePollMsForTests(1);
  png = (await sharp({ create: { width: 8, height: 8, channels: 3, background: "#cc3322" } }).png().toBuffer()).toString("base64");
  __setVideosFetchForTests(answer as unknown as typeof fetch); __setPicturesFetchForTests(answer as unknown as typeof fetch);
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: withheld
    ? { people_count: 1, apparent_min_age_estimate: 8, label: "child" as const, is_nude_or_sexual: true, confidence: 1 }
    : { people_count: 1, apparent_min_age_estimate: 30, label: "adult" as const, is_nude_or_sexual: false, confidence: 1 } })));
});
afterEach(() => { __setVideosFetchForTests(null); __setPicturesFetchForTests(null); __setAgeCheckRunnerForTests(null); __setDerivePollMsForTests(null); });

describe("the identity input", () => {
  test("a clip with the cast's picture sends it as an identity input and no start picture", () => {
    const request = clipRequestFor(body())!;
    expect(request.inputs).toEqual([{ role: "identity", file: `data:image/png;base64,${IDENTITY}` }]);
    expect(request).not.toHaveProperty("start_picture");
    expect(request).not.toHaveProperty("intent");
  });
  test("a young person's request never builds a clip request, so an identity picture never leaves Home for them (C8, C10)", async () => {
    expect(clipRequestFor(body({ audience: "all-ages" }))).toBeNull();
    expect(await submitVideoViaDoor(body({ audience: "all-ages" }), actor)).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("needs_start_picture", () => {
  test("Home makes one generic picture from the identity picture with the Stack's shape, gates it, and resends it as the derived start", async () => {
    clipAnswers = [needs, clipOk];
    const derived: string[] = [];
    const made = await submitVideoViaDoor(body(), actor, (image) => derived.push(image));
    expect(made).toMatchObject({ job: "clip-1", derivedImage: png });
    expect(derived).toEqual([png]);
    expect(pictureMakes()).toHaveLength(1);
    expect(pictureMakes()[0]!.body).toMatchObject({ job: "picture", audience: "adult", shape: "landscape", intent: "derived_start", description: "she waves at the sea", inputs: [{ role: "identity", file: `data:image/png;base64,${IDENTITY}` }] });
    expect(pictureMakes()[0]!.body).not.toHaveProperty("model");
    expect(pictureMakes()[0]!.body).not.toHaveProperty("size");
    const [first, second] = clipMakes();
    expect(first!.body).toHaveProperty("inputs");
    expect(second!.body).toMatchObject({ start_picture: `data:image/png;base64,${png}`, intent: "derived_start" });
    expect(second!.body).not.toHaveProperty("inputs");
  });
  test("a picture the gate withholds ends the request with the plain line, and nothing else is tried", async () => {
    clipAnswers = [needs, clipOk]; withheld = true;
    await expect(submitVideoViaDoor(body(), actor)).rejects.toMatchObject({ code: "start_picture_withheld" });
    expect(clipMakes()).toHaveLength(1);
    expect(pictureMakes()).toHaveLength(1);
  });
  test("a second needs_start_picture after the resend ends the request: one derivation per request", async () => {
    clipAnswers = [needs, needs];
    await expect(submitVideoViaDoor(body(), actor)).rejects.toMatchObject({ code: "start_picture_failed" });
    expect(pictureMakes()).toHaveLength(1);
  });
  test("a resend that already carries the derived start is never derived again", async () => {
    clipAnswers = [needs];
    expect(await submitVideoViaDoor(body({ identity_image: undefined, image: png, derived_start: true }), actor)).toBeNull();
    expect(pictureMakes()).toHaveLength(0);
  });
  test("only the typed answer starts a derivation: any other refusal goes back to the old door", async () => {
    clipAnswers = [() => json({ code: "shape_not_served", line: "No." }, 409)];
    expect(await submitVideoViaDoor(body(), actor)).toBeNull();
    expect(pictureMakes()).toHaveLength(0);
  });
  test("an answer that asks for an input Home does not hold ends the request plainly, with no picture made", async () => {
    clipAnswers = [() => json({ code: "needs_start_picture", line: "x", shape: "landscape", inputs: ["wardrobe"] }, 409)];
    await expect(submitVideoViaDoor(body(), actor)).rejects.toMatchObject({ code: "start_picture_failed" });
    expect(pictureMakes()).toHaveLength(0);
  });
  test("a Stop while the first picture is made ends it: no gate, no resend", async () => {
    clipAnswers = [needs, clipOk];
    let stopped = false;
    const run = submitVideoViaDoor(body(), actor, undefined, () => stopped);
    stopped = true;
    await expect(run).rejects.toMatchObject({ code: "cancelled" });
    expect(clipMakes()).toHaveLength(1);
  });
  test("a failure of the resend ends the request with the plain line, never the old door's start in its place", async () => {
    clipAnswers = [needs, () => json({ error: 'Unrecognized key: "intent"' }, 400)];
    await expect(submitVideoViaDoor(body(), actor)).rejects.toMatchObject({ code: "start_picture_failed" });
  });
  test("a full line on the resend is thrown as the old door throws it, after the derived picture was kept", async () => {
    clipAnswers = [needs, () => json({ error: "The video queue is full.", code: "queue_full" }, 429)];
    const kept: string[] = [];
    await expect(submitVideoViaDoor(body(), actor, (image) => kept.push(image))).rejects.toMatchObject({ code: "queue_full" });
    expect(kept).toEqual([png]);
    expect(pictureMakes()).toHaveLength(1);
  });
});
