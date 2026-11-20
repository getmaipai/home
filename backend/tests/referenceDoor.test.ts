// VF-REFCLIP-01 (Home half, dark unless MAIPAI_REFERENCE_DOOR=1): the clip of a reference video made from a composed first picture asks the generic door for `reference_clip` with the
// composed picture as the start picture and the people's own pictures as identity inputs; the composed picture is gated first (fails closed); anything else is the old request.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { createBenchPeople } from "../scripts/bench/conversationRunner";
import { __setVideosFetchForTests } from "@/lib/videos/stack";
import { __setAgeCheckRunnerForTests } from "@/lib/pictures/ageCheck";
import { submitReferenceViaDoor, referenceDoorOn } from "@/lib/videos/referenceDoor";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const FIELDS = ["job", "audience", "description", "shape", "level", "seconds", "start_picture", "seed", "inputs", "operation", "wait", "inputs.role.identity", "inputs.role.object", "inputs.role.place", "reference_clip.max_people=2", "reference_clip.seconds.min=4", "reference_clip.seconds.max=8"];
let calls: Array<{ path: string; body: Record<string, any> | null }> = [];
let fields: string[] | null = FIELDS;
let sizes: Record<string, unknown> | null = { landscape: { max: { width: 1024, height: 576 } } };
let makeAnswers: Array<() => Response> = [];
let withheld = false;
const ok = () => json({ id: "job-r1", job: "clip", state: "running", percent: 0, status: "Making", files: [], poster: null, made_with: { part: "part-m", label: "M", pack_version: "1", shape: "landscape", seconds: 6, sound: true, notes: [], route: "start_picture" } }, 202);
const answer = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const path = new URL(String(input), "http://stack.test").pathname;
  calls.push({ path, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
  if (path === "/stack/v1/jobs/catalog") return json({ audience: "adult", jobs: [{ job: "clip", available: true, ...(fields ? { request_fields: fields } : {}), ...(sizes ? { limits: { shapes: sizes } } : {}), part: { id: "part-m", label: "M" } }] });
  if (path === "/stack/v1/jobs/make") return (makeAnswers.shift() ?? ok)();
  return json({ error: "no", code: "not_found" }, 404);
};
let actor: ReturnType<typeof createBenchPeople>["owner"];
beforeEach(() => {
  resetDb(); actor = createBenchPeople().owner; calls = []; fields = FIELDS; sizes = { landscape: { max: { width: 1024, height: 576 } } }; makeAnswers = []; withheld = false;
  process.env.MAIPAI_REFERENCE_DOOR = "1"; delete process.env.MAIPAI_VIDEO_LEGACY_DOOR;
  __setVideosFetchForTests(answer as unknown as typeof fetch);
  __setAgeCheckRunnerForTests(async (images) => images.map(() => ({ ok: true as const, verdict: withheld ? { people_count: 1, apparent_min_age_estimate: 8, label: "child" as const, is_nude_or_sexual: true, confidence: 1 } : { people_count: 1, apparent_min_age_estimate: 30, label: "adult" as const, is_nude_or_sexual: false, confidence: 1 } })));
});
afterEach(() => { __setVideosFetchForTests(null); delete process.env.MAIPAI_REFERENCE_DOOR; delete process.env.MAIPAI_VIDEO_LEGACY_DOOR; });

const input = (over: Record<string, unknown> = {}) => ({ actor, description: "She walks into the room", seconds: 6, seed: 9, identity: ["UEVSU09O"], startPicture: async () => ({ base64: "RklSU1Q=", raw: new Uint8Array([1, 2, 3]) }), ...over }) as never;
const makes = () => calls.filter((c) => c.path === "/stack/v1/jobs/make");

describe("the reference clip on the generic door", () => {
  test("dark by default: with the flag off nothing is asked", async () => {
    delete process.env.MAIPAI_REFERENCE_DOOR;
    expect(referenceDoorOn()).toBe(false);
    expect(await submitReferenceViaDoor(input())).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test("the request: reference_clip at Max, the composed picture as the start picture, the people's pictures as identity inputs, no model, no size, no negative words", async () => {
    const sizesAsked: Array<{ width: number; height: number }> = [];
    const made = await submitReferenceViaDoor(input({ startPicture: async (size: { width: number; height: number }) => { sizesAsked.push(size); return { base64: "RklSU1Q=", raw: new Uint8Array([1]) }; } }));
    expect(made).toEqual({ job: "job-r1" });
    expect(sizesAsked).toEqual([{ width: 1024, height: 576 }]);
    const sent = makes()[0]!.body!;
    expect(sent).toMatchObject({ job: "clip", operation: "reference_clip", audience: "adult", level: "max", shape: "landscape", seconds: 6, seed: 9, description: "She walks into the room", start_picture: "data:image/png;base64,RklSU1Q=", inputs: [{ role: "identity", file: "data:image/png;base64,UEVSU09O" }] });
    for (const key of ["model", "size", "negative_prompt", "end_picture", "tier"]) expect(sent).not.toHaveProperty(key);
  });

  test("the composed picture is gated first: a withheld picture ends the request with the plain line and nothing is sent", async () => {
    withheld = true;
    await expect(submitReferenceViaDoor(input())).rejects.toMatchObject({ code: "start_picture_withheld" });
    expect(makes()).toHaveLength(0);
  });

  test("the old request is used when the Stack lists no keys, lacks a needed one or the identity role, advertises other seconds, serves no Max size, or the person has no identity pictures", async () => {
    fields = null; expect(await submitReferenceViaDoor(input())).toBeNull();
    fields = FIELDS.filter((key) => key !== "inputs.role.identity"); expect(await submitReferenceViaDoor(input())).toBeNull();
    fields = FIELDS.filter((key) => key !== "operation"); expect(await submitReferenceViaDoor(input())).toBeNull();
    fields = FIELDS; expect(await submitReferenceViaDoor(input({ seconds: 9 }))).toBeNull();
    expect(await submitReferenceViaDoor(input({ seconds: 3 }))).toBeNull();
    fields = FIELDS.filter((key) => !key.startsWith("reference_clip.seconds")); expect(await submitReferenceViaDoor(input())).toBeNull();
    fields = FIELDS; sizes = { landscape: { standard: { width: 768, height: 432 } } }; expect(await submitReferenceViaDoor(input())).toBeNull();
    sizes = { landscape: { max: { width: 1024, height: 576 } } }; expect(await submitReferenceViaDoor(input({ identity: [] }))).toBeNull();
    expect(makes()).toHaveLength(0);
  });

  test("a planner refusal or a 4xx sends it back to the old request; a queue answer is thrown as the old door throws it", async () => {
    makeAnswers = [() => json({ code: "input_not_supported", line: "Send pictures for people, objects or places only." }, 422)];
    expect(await submitReferenceViaDoor(input())).toBeNull();
    makeAnswers = [() => json({ error: 'Unrecognized key: "operation"' }, 400)];
    expect(await submitReferenceViaDoor(input())).toBeNull();
    makeAnswers = [() => json({ error: "The video queue is full.", code: "queue_full" }, 429)];
    await expect(submitReferenceViaDoor(input())).rejects.toMatchObject({ code: "queue_full" });
  });
});
