// VF-COMPANION-RECIPE-01 (Home half): a pack companion take for an adult viewer asks the generic door for `companion_take` with plain words and generic fields; the Stack's recipe holds
// the wording. Falls back to the old door when the Stack does not list the keys, serves no level, or the viewer is not an adult (the take loop only plans the door for an adult).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { __setVideosFetchForTests } from "@/lib/videos/stack";
import { planCompanionDoor } from "@/lib/companionDoor";
import { PACK_GESTURES, PACK_MOTIONS, packGestureDescription, packTakeDescription, packGesturePrompt, packTakePrompt } from "@/lib/companionTakes";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const FIELDS = ["job", "audience", "part", "description", "shape", "level", "seconds", "start_picture", "end_picture", "styles", "seed", "inputs", "intent", "quiet_seconds", "quiet_max_wait_seconds", "wait", "operation", "loop", "key_colour", "take_frame"];
let calls: Array<{ path: string; body: Record<string, any> | null }> = [];
let fields: string[] | null = FIELDS;
let sizes: Record<string, unknown> | null = { landscape: { standard: { width: 768, height: 432 }, max: { width: 1024, height: 576 } } };
let makeAnswers: Array<() => Response> = [];
const ok = () => json({ id: "job-c1", job: "clip", state: "running", percent: 0, status: "Making", files: [], poster: null, made_with: { part: "part-a", label: "A", pack_version: "1", shape: "landscape", seconds: 5, sound: true, notes: [], route: "companion_take" } }, 202);
const answer = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
  const path = new URL(String(input), "http://stack.test").pathname;
  calls.push({ path, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
  if (path === "/stack/v1/jobs/catalog") return json({ audience: "adult", jobs: [{ job: "clip", available: true, ...(fields ? { request_fields: fields } : {}), ...(sizes ? { limits: { shapes: sizes } } : {}), part: { id: "part-a", label: "A" } }] });
  if (path === "/stack/v1/jobs/make") return (makeAnswers.shift() ?? ok)();
  return json({ error: "no", code: "not_found" }, 404);
};
beforeEach(() => { calls = []; fields = FIELDS; sizes = { landscape: { standard: { width: 768, height: 432 }, max: { width: 1024, height: 576 } } }; makeAnswers = []; delete process.env.MAIPAI_VIDEO_LEGACY_DOOR; __setVideosFetchForTests(answer as unknown as typeof fetch); });
afterEach(() => { __setVideosFetchForTests(null); delete process.env.MAIPAI_VIDEO_LEGACY_DOOR; });

const input = (picture: (size: { width: number; height: number }) => Promise<string> = async () => "UElDVFVSRQ==") => ({ description: packTakeDescription("idle", 0), picture, keyColour: "green" as const, frame: "state" as const, seconds: 5, seed: 42, quiet: { quiet_seconds: 20, quiet_max_wait_seconds: 0 } });
const makes = () => calls.filter((c) => c.path === "/stack/v1/jobs/make");

describe("the companion take on the generic door", () => {
  test("the request is plain words and generic fields: no model, no size, no negative words, no prompt wording; the picture is fitted to the size the Stack's catalog gives", async () => {
    const plan = await planCompanionDoor();
    expect(plan).not.toBeNull();
    const sizesSeen: Array<{ width: number; height: number }> = [];
    const made = await plan!.submit(input(async (size) => { sizesSeen.push(size); return "UElDVFVSRQ=="; }));
    expect(made).toEqual({ job: "job-c1", level: "max" });
    expect(sizesSeen).toEqual([{ width: 1024, height: 576 }]);
    const sent = makes()[0]!.body!;
    expect(sent).toMatchObject({ job: "clip", operation: "companion_take", audience: "adult", shape: "landscape", level: "max", seconds: 5, seed: 42, loop: true, key_colour: "green", take_frame: "state", quiet_seconds: 20, quiet_max_wait_seconds: 0, start_picture: "data:image/png;base64,UElDVFVSRQ==", description: packTakeDescription("idle", 0) });
    for (const key of ["model", "size", "negative_prompt", "prompt", "prompt_mode", "negative"]) expect(sent).not.toHaveProperty(key);
    expect(sent.description).not.toMatch(/Static locked|plain solid/i);   // the frame wording is the pack recipe's
  });

  test("the description is exactly the text the pack prompt carries after Action, for every state and variant and every gesture", () => {
    for (const state of Object.keys(PACK_MOTIONS)) for (let variant = 0; variant < PACK_MOTIONS[state]!.length; variant++) expect(packTakePrompt({ text: "x" }, state, "green", variant)).toContain(packTakeDescription(state, variant));
    for (const gesture of PACK_GESTURES) expect(packGesturePrompt(gesture, "magenta")).toContain(packGestureDescription(gesture.id));
  });

  test("a level the Stack does not serve goes to the next level; every level refused is the old door; a queue answer is thrown as the old door throws it", async () => {
    makeAnswers = [() => json({ code: "level_not_served", line: "This model does not make max quality." }, 409)];
    const plan = (await planCompanionDoor())!;
    expect(await plan.submit(input())).toEqual({ job: "job-c1", level: "standard" });
    expect(makes().map((c) => c.body!.level)).toEqual(["max", "standard"]);
    calls = []; makeAnswers = [() => json({ code: "input_not_supported", line: "No." }, 422), () => json({ code: "input_not_supported", line: "No." }, 422)];
    expect(await plan.submit(input())).toBeNull();
    calls = []; makeAnswers = [() => json({ error: "The video queue is full.", code: "queue_full" }, 429)];
    await expect(plan.submit(input())).rejects.toMatchObject({ code: "queue_full" });
  });

  test("a Stack that does not list every key the take needs, lists none, or has no sizes keeps the old door, and nothing is sent", async () => {
    fields = null; expect(await planCompanionDoor()).toBeNull();
    fields = FIELDS.filter((key) => key !== "key_colour"); expect(await planCompanionDoor()).toBeNull();
    fields = FIELDS.filter((key) => key !== "take_frame"); expect(await planCompanionDoor()).toBeNull();
    fields = FIELDS.filter((key) => key !== "operation"); expect(await planCompanionDoor()).toBeNull();
    fields = FIELDS; sizes = null; expect(await planCompanionDoor()).toBeNull();
    expect(makes()).toHaveLength(0);
    fields = FIELDS.filter((key) => key !== "wait"); sizes = { landscape: { standard: { width: 768, height: 432 } } };
    const plan = (await planCompanionDoor())!;
    expect(await plan.submit(input())).toEqual({ job: "job-c1", level: "standard" });
    expect(makes()[0]!.body).not.toHaveProperty("wait");
  });

  test("MAIPAI_VIDEO_LEGACY_DOOR=1 keeps every take on the old door", async () => {
    process.env.MAIPAI_VIDEO_LEGACY_DOOR = "1";
    expect(await planCompanionDoor()).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
