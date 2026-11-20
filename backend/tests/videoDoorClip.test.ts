// VF-DOOR-01: a plain clip goes through the Stack's generic make door; everything else stays on the old one, and the old one is the way back.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { __setVideosFetchForTests, fetchClipReceipt, type VideoBody } from "@/lib/videos/stack";
import { OLD_CLIP_FIELDS, clipRequestFor, doorWanted, submitVideoViaDoor } from "@/lib/videos/doorClip";

const base = (over: Partial<VideoBody> = {}): VideoBody => ({ prompt: "a dog barks", audience: "adult", size: "864x480", seconds: 5, seed: 7, timeout_ms: 1, ...over });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let calls: Array<{ path: string; body: Record<string, unknown> | null }> = [];
let clipAvailable = true;
const ALL_FIELDS = ["job","audience","part","description","shape","level","seconds","start_picture","end_picture","styles","seed","inputs","dialogue","intent","quiet_seconds","quiet_max_wait_seconds","wait","operation","at_seconds","take_of"];
let catalogFields: string[] | "none" = ALL_FIELDS;
let makeAnswer: () => Response = () => json({ id: "job-1", job: "clip", state: "running", percent: 0, status: "Making your clip", files: [], poster: null, made_with: { part: "part-a", label: "A", pack_version: "1", shape: "landscape", seconds: 5, sound: true, notes: [] } }, 202);
const answer = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const path = new URL(String(input), "http://stack.test").pathname;
  calls.push({ path, body: typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : null });
  if (path === "/stack/v1/jobs/catalog") return json({ audience: "adult", jobs: [{ job: "clip", available: clipAvailable, ...(catalogFields === "none" ? {} : { request_fields: catalogFields }), part: { id: "part-a", label: "A" } }] });
  if (path === "/stack/v1/jobs/make") return makeAnswer();
  if (path.endsWith("/receipt.json")) return json({ version: 1, job_id: "job-1" });
  return json({ error: "no", code: "not_found" }, 404);
};
beforeEach(() => { calls = []; clipAvailable = true; catalogFields = ALL_FIELDS; delete process.env.MAIPAI_VIDEO_LEGACY_DOOR; __setVideosFetchForTests(answer as unknown as typeof fetch); });
afterEach(() => { __setVideosFetchForTests(null); delete process.env.MAIPAI_VIDEO_LEGACY_DOOR; });

test("a plain adult clip becomes a generic clip request with the level, the shape, the seconds, the seed and no wait", () => {
  expect(clipRequestFor(base())).toEqual({ job: "clip", audience: "adult", description: "a dog barks", shape: "landscape", level: "standard", seconds: 5, seed: 7, wait: 0 });
  expect(clipRequestFor(base({ size: "480x864", tier: "boost" }))).toMatchObject({ shape: "portrait", level: "boost" });
  expect(clipRequestFor(base({ size: "512x512", tier: "boost" }))).toMatchObject({ shape: "square", level: "boost" });
  expect(clipRequestFor(base({ quiet_seconds: 60, quiet_max_wait_seconds: null }))).toMatchObject({ quiet_seconds: 60, quiet_max_wait_seconds: null });
});

test("a start picture and an end picture travel as the clip's start and end pictures, and no model, size in pixels or step count is sent", () => {
  const request = clipRequestFor(base({ image: "QUJD", end_image: "REVG", model: "some-model", tier: "boost" }))!;
  expect(request).toMatchObject({ start_picture: "data:image/png;base64,QUJD", end_picture: "data:image/png;base64,REVG" });
  expect(Object.keys(request)).not.toContain("model"); expect(Object.keys(request)).not.toContain("size"); expect(Object.keys(request)).not.toContain("part");
});

test("what is not a plain clip stays on the old door: a young person's, negative words, a LoRA, an edit, a clip with no size or seconds", () => {
  expect(clipRequestFor(base({ audience: "all-ages" }))).toBeNull();
  expect(clipRequestFor(base({ tier: "max" }))).toBeNull();   // Max stays on the old door for now
  expect(clipRequestFor(base({ negative_prompt: "no cats" }))).toBeNull();
  expect(clipRequestFor(base({ loras: [{ id: "style-1", strength: 1 }] }))).toBeNull();
  expect(clipRequestFor(base({ source_video: "/clips/a.mp4", extend_seconds: 2 }))).toBeNull();
  expect(clipRequestFor(base({ retake_from_seconds: 2 }))).toBeNull();
  expect(clipRequestFor(base({ size: undefined }))).toBeNull(); expect(clipRequestFor(base({ seconds: undefined }))).toBeNull();
  expect(clipRequestFor(base({ loras: [] }))).not.toBeNull();   // an empty list is no LoRA
});

test("the door starts the clip and answers the job id the old status route polls", async () => {
  const started = await submitVideoViaDoor(base({ tier: "boost" }));
  expect(started).toEqual({ job: "job-1", done: null, warnings: [] });
  const sent = calls.find((c) => c.path === "/stack/v1/jobs/make")!.body!;
  expect(sent).toMatchObject({ job: "clip", level: "boost", wait: 0 });
});

test("when the catalog says no part serves a clip, nothing is asked of the door and the old one takes it", async () => {
  clipAvailable = false;
  expect(await submitVideoViaDoor(base())).toBeNull();
  expect(calls.some((c) => c.path === "/stack/v1/jobs/make")).toBe(false);
});

test("a planner refusal (shape not served and the like) sends the clip back to the old door", async () => {
  makeAnswer = () => json({ code: "shape_not_served", line: "That shape is not served." }, 409);
  expect(await submitVideoViaDoor(base())).toBeNull();
  makeAnswer = () => json({ code: "too_long", line: "Too long.", limit: 5 }, 409);
  expect(await submitVideoViaDoor(base())).toBeNull();
});

test("a Stack older than the door (no such route) sends the clip back to the old door; a real Stack failure is thrown as the old door throws it", async () => {
  makeAnswer = () => json({ error: "not found", code: "not_found" }, 404);
  expect(await submitVideoViaDoor(base())).toBeNull();
  makeAnswer = () => json({ error: "The video queue is full. Try again in a few minutes.", code: "queue_full" }, 429);
  await expect(submitVideoViaDoor(base())).rejects.toMatchObject({ code: "queue_full", status: 429 });
});

test("a Stack that validates strictly and does not know a key we send (the live build: 400, { error: 'Unrecognized key: \"wait\"' }) sends the clip back to the old door, never to the person", async () => {
  makeAnswer = () => json({ error: 'Unrecognized key: "wait"' }, 400);
  expect(await submitVideoViaDoor(base())).toBeNull();
  makeAnswer = () => json({ error: "Invalid input" }, 422);
  expect(await submitVideoViaDoor(base())).toBeNull();
  makeAnswer = () => json({ error: "Try again", code: "no_memory" }, 503);
  await expect(submitVideoViaDoor(base())).rejects.toMatchObject({ code: "no_memory" });
});

test("MAIPAI_VIDEO_LEGACY_DOOR=1 keeps every clip on the old door without a call", async () => {
  process.env.MAIPAI_VIDEO_LEGACY_DOOR = "1";
  expect(await submitVideoViaDoor(base())).toBeNull();
  expect(calls).toHaveLength(0);
});

test("a clip's receipt is read from the Stack's owner route, and a missing one is null", async () => {
  expect(await fetchClipReceipt("job-1")).toEqual({ version: 1, job_id: "job-1" });
  expect(await fetchClipReceipt("job-gone-404")).toEqual({ version: 1, job_id: "job-1" });   // the stub answers any receipt path
  __setVideosFetchForTests((async () => json({ error: "no", code: "no_receipt" }, 404)) as unknown as typeof fetch);
  expect(await fetchClipReceipt("job-1")).toBeNull();
});

test("a clip that stays on the old door is decided without waiting (no extra step before the old door runs)", () => {
  expect(doorWanted(base())).toBe(true);
  expect(doorWanted(base({ tier: "max" }))).toBe(false);
  expect(doorWanted(base({ audience: "all-ages" }))).toBe(false);
  process.env.MAIPAI_VIDEO_LEGACY_DOOR = "1";
  expect(doorWanted(base())).toBe(false);
});

test("the engine's raw validation words never reach a person's toast on any video path", async () => {
  const { plainVideoFailure } = await import("@/lib/videos/jobs");
  const { StackVideoError } = await import("@/lib/videos/stack");
  const line = plainVideoFailure(new StackVideoError(400, "http_400", 'Unrecognized key: "wait"'));
  expect(line).not.toContain("Unrecognized");
  expect(line).toContain("Try again");
});

test("the Stack's own list of request keys decides what is sent: a Stack that lists none keeps its old contract and gets no wait or quiet window; a list that lacks a key the clip needs sends it to the old door", async () => {
  catalogFields = "none";
  makeAnswer = () => json({ id: "job-1", job: "clip", state: "running", percent: 0, status: "Making", files: [], poster: null, made_with: { part: "part-a", label: "A", pack_version: "1", shape: "landscape", seconds: 5, sound: true, notes: [] } }, 202);
  expect(await submitVideoViaDoor(base())).toMatchObject({ job: "job-1" });
  const sent = calls.find((c) => c.path === "/stack/v1/jobs/make")!.body!;
  expect(sent).not.toHaveProperty("wait");
  expect(Object.keys(sent).every((key) => OLD_CLIP_FIELDS.has(key))).toBe(true);
  // A quiet window the Stack does not list would be lost: the old door takes the clip.
  calls = [];
  expect(await submitVideoViaDoor(base({ quiet_seconds: 60 }))).toBeNull();
  expect(calls.filter((c) => c.path === "/stack/v1/jobs/make")).toHaveLength(0);
  // A list with `wait` missing but everything else: the clip is sent without it.
  catalogFields = ALL_FIELDS.filter((key) => key !== "wait");
  calls = [];
  expect(await submitVideoViaDoor(base({ quiet_seconds: 60 }))).toMatchObject({ job: "job-1" });
  expect(calls.find((c) => c.path === "/stack/v1/jobs/make")!.body).not.toHaveProperty("wait");
  // A list with `inputs` missing: an identity clip goes to the old door, nothing is derived.
  catalogFields = ALL_FIELDS.filter((key) => key !== "inputs");
  calls = [];
  expect(await submitVideoViaDoor(base({ identity_image: "aWRlbnRpdHk=" }))).toBeNull();
  expect(calls.filter((c) => c.path === "/stack/v1/jobs/make")).toHaveLength(0);
});
