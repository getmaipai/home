// VIDEO-GEN-04: the gates around making a video. Rule 0 of docs/design/RULES.md: age and surface gates outrank
// everything. The matrix is band by surface by LoRA class, then the two absolute lines, then every entrance (the chat
// tool, the card's routes, the status and settings routes): none of them reaches the Stack for a person or a surface
// that may not, and no household setting reaches the absolute lines or turns video on for a minor.
import { laneOfPerson } from "@/lib/pictures/laneGate";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { setHouseholdSettingValue } from "@/lib/settings";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import { createBenchPeople, type BenchPeople } from "../scripts/bench/conversationRunner";
import { useDefaultScriptedStack } from "./stackFixture";
import { withStub } from "./turnMachine/toolHarness";
import { db } from "@/db";
import { people as peopleTable } from "@/db/schema";
import { stackAudienceFor, videoAdapterAudiencesFor, videoDenial, videosAllowed, refuseVideoPrompt, VIDEO_NOT_HERE_LINE, VIDEO_REFUSAL_LINE, type VideoAudience } from "@/lib/videos/policy";
import { videoAdaptersFor } from "@/lib/videos/adapters";
import { getVideoJobFor, startVideoJob } from "@/lib/videos/jobs";
import { __setVideoStatusForTests } from "@/lib/videos/ready";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import type { TurnValue } from "@/wire";
import { hasAudioTrack, videoFileName } from "@/lib/videos/messagesCopy";
import { installFakeVideoStack, testJpeg, type FakeVideoStack } from "./videoFixture";
import { videoCardView } from "@/routes/videos";
import { until } from "./pictureFixture";
import { TestClient } from "./client";
import { invalidateSessionCacheForPerson } from "@/middleware/auth";
import type { PersonRow } from "@/types";

let people: BenchPeople;
let fake: FakeVideoStack;

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  people = createBenchPeople();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
  fake = installFakeVideoStack();
});
afterEach(() => {
  fake.restore();
  __resetLlmSupervisorForTests();
  __resetPortOwnershipForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

function asRole(id: string, role: "teen" | "guest" | "child" | "adult" | "admin"): PersonRow {
  db.update(peopleTable).set({ role }).where(eq(peopleTable.id, id)).run();
  return db.select().from(peopleTable).where(eq(peopleTable.id, id)).get()!;
}
const audience = (actor: PersonRow, over: Partial<VideoAudience> = {}): VideoAudience => ({ actor, band: actor.role === "child" ? "child" : actor.role === "teen" ? "teen" : "adult", surface: "chat", surfaceClass: "written", spoken: false, ...over });

describe("band by surface", () => {
  test("an owner, an admin and an adult may, on their own written chat screen", () => {
    expect(videoDenial(audience(people.owner))).toBeNull();
    expect(videoDenial(audience(asRole(people.child.id, "admin")))).toBeNull();
    expect(videoDenial(audience(asRole(people.child.id, "adult")))).toBeNull();
  });
  test("a child is in the strict cartoon lane while the home switch is on, even if a caller lies about the band; a teen may too (owner rulings 2026-10-17) and never depends on the adult switch", () => {
    setHouseholdSettingValue("generation.video.enabled", true);
    const child = asRole(people.child.id, "child");
    expect(videoDenial(audience(child))).toBeNull();
    setHouseholdSettingValue("generation.kids", false);
    expect(videoDenial(audience(child))).toBe("minor");
    setHouseholdSettingValue("generation.kids", true);
    const teen = asRole(people.child.id, "teen");
    expect(videoDenial(audience(teen))).toBeNull();
    expect(videoDenial(audience(teen, { band: "adult" }))).toBeNull();
    expect(laneOfPerson(child)).toBe("child");
    setHouseholdSettingValue("generation.kids", false);
    expect(videoDenial(audience(child, { band: "adult" }))).toBe("minor");
    setHouseholdSettingValue("generation.kids", true);
    expect(videoDenial(audience(teen, { spoken: true }))).toBe("spoken");
    setHouseholdSettingValue("generation.video.enabled", false);
    expect(videoDenial(audience(teen))).toBe("household_off");
  });
  test("a guest may not", () => {
    expect(videoDenial(audience(asRole(people.child.id, "guest"), { band: "adult" }))).toBe("guest");
  });
  test("a spoken turn, a glance screen, a TV, a robot, a pod and a phone call may not", () => {
    expect(videoDenial(audience(people.owner, { spoken: true }))).toBe("spoken");
    expect(videoDenial(audience(people.owner, { surface: "overlay", surfaceClass: "glance" }))).toBe("shared_screen");
    expect(videoDenial(audience(people.owner, { surface: "tv" }))).toBe("shared_screen");
    expect(videoDenial(audience(people.owner, { surface: "robot", surfaceClass: "spoken" }))).toBe("spoken");
    expect(videoDenial(audience(people.owner, { surface: "pod", surfaceClass: "spoken" }))).toBe("spoken");
    expect(videoDenial(audience(people.owner, { surface: "phone", surfaceClass: "spoken" }))).toBe("spoken");
  });
  test("the household video switch turns adults off, and the picture switch does not touch video", () => {
    setHouseholdSettingValue("generation.video.enabled", false);
    expect(videoDenial(audience(people.owner))).toBe("household_off");
    expect(videosAllowed(audience(asRole(people.child.id, "teen")))).toBe(false);
    setHouseholdSettingValue("generation.video.enabled", true);
    setHouseholdSettingValue("generation.adults", false);
    expect(videoDenial(audience(people.owner))).toBeNull();
  });
});

describe("LoRA classes", () => {
  test("an adult gets all-ages and adult-only by default (audience adult); the household can restrict adult-only", () => {
    expect(videoAdapterAudiencesFor(audience(people.owner))).toEqual(["all-ages", "adult-only"]);
    expect(stackAudienceFor(audience(people.owner))).toBe("adult");
    setHouseholdSettingValue("generation.video.adult_adapters", "restricted");
    expect(videoAdapterAudiencesFor(audience(people.owner))).toEqual(["all-ages"]);
    expect(stackAudienceFor(audience(people.owner))).toBe("all-ages");
  });
  test("nobody who may not make a video is allowed any LoRA, adult-only included, and the Stack is told all-ages", () => {
    for (const a of [audience(asRole(people.child.id, "guest"), { band: "adult" }), audience(people.owner, { spoken: true }), audience(people.owner, { surface: "tv" })]) {
      expect(videoAdapterAudiencesFor(a)).toEqual([]);
      expect(stackAudienceFor(a)).toBe("all-ages");
    }
  });
  test("a teen is offered exactly the all-ages LoRAs and the Stack is told all-ages, whatever the household says about adult-only ones", () => {
    for (const value of ["allowed", "restricted"]) {
      setHouseholdSettingValue("generation.video.adult_adapters", value);
      const a = audience(asRole(people.child.id, "teen"));
      expect(videoAdapterAudiencesFor(a)).toEqual(["all-ages"]);
      expect(stackAudienceFor(a)).toBe("all-ages");
    }
  });
  test("the library lists only what the classes allow", async () => {
    expect((await videoAdaptersFor(["all-ages", "adult-only"])).map((a) => a.id).sort()).toEqual(["lora-1111111111111111", "lora-2222222222222222"]);
    expect((await videoAdaptersFor(["all-ages"])).map((a) => a.id)).toEqual(["lora-1111111111111111"]);
    expect(await videoAdaptersFor([])).toEqual([]);
  });
});

describe("the two absolute lines", () => {
  test("a sexual request with a child, or anyone who looks like one, is refused for everyone", () => {
    for (const prompt of ["a nude little girl on a beach", "sexy schoolgirl dancing in lingerie", "erotic clip of a teen", "naked 12 year old", "loli nsfw", "a childlike woman, topless, dancing"]) {
      expect(refuseVideoPrompt(prompt)).toBe("minor_sexual");
    }
    expect(VIDEO_REFUSAL_LINE.minor_sexual).toBe("I can't make that. Videos of children in sexual situations are never allowed.");
  });
  test("ordinary clips pass", () => {
    for (const prompt of ["a paper boat in the rain", "children building a snowman, time lapse", "a woman in a bikini walking on a beach at sunset", "a baby sleeping"]) {
      expect(refuseVideoPrompt(prompt)).toBeNull();
    }
  });
  test("adults may depict real people (models censor); a teen and a child keep the block", () => {
    expect(refuseVideoPrompt("the mayor waving", { depictsRealPerson: true })).toBeNull();
    expect(refuseVideoPrompt("a sexual video of the mayor", { depictsRealPerson: true })).toBeNull();
    expect(refuseVideoPrompt("a sexual video of the mayor", { depictsRealPerson: true, lane: "teen" })).toBe("real_person");
    expect(VIDEO_REFUSAL_LINE.real_person).toBe("I won't make sexual videos of a real person, because they can't agree to it. I can make one of an invented person or a character instead.");
    expect(refuseVideoPrompt("the mayor waving", { depictsRealPerson: true, lane: "teen" })).toBe("real_person");
    expect(refuseVideoPrompt("the mayor waving", { depictsRealPerson: true, lane: "child" })).toBe("child_content");
    setHouseholdSettingValue("generation.video.enabled", true);
    setHouseholdSettingValue("generation.video.adult_adapters", "allowed");
    expect(refuseVideoPrompt("naked child")).toBe("minor_sexual");
  });
});

const isPhrasing = (request: ChatCompletionRequest) => request.messages.some((m) => m.role === "tool");
async function turn(actor: PersonRow, text: string, surface: "chat" | "overlay" | "tv" = "chat", opts: Record<string, unknown> = {}): Promise<TurnValue> {
  const result = await runTurnNext(actor, surface, text, opts as never);
  if (!result.ok) throw new Error(`turn refused: ${JSON.stringify(result)}`);
  return result.value as TurnValue;
}
const call = (args: Record<string, unknown>) => ({ id: "c", name: "generate_video", args: JSON.stringify(args) });
const calling = (args: Record<string, unknown>, reply = "ignored") => ({ calls: (r: ChatCompletionRequest) => (isPhrasing(r) || r.tool_choice === "none" ? undefined : [call(args)]), reply: () => reply });

describe("the chat tool, even when a model calls it without being offered it", () => {
  test("a guest, and a child while the home switch is off, who somehow get a video call are refused and no job starts", async () => {
    setHouseholdSettingValue("generation.kids", false);
    for (const role of ["child", "guest"] as const) {
      const actor = asRole(people.child.id, role);
      await withStub(calling({ prompt: "a paper boat in the rain" }, "Here you go."), async () => {
        const value = await turn(actor, "make a video of a paper boat");
        expect(value.video).toBeUndefined();
        expect(fake.submitted).toHaveLength(0);
      });
    }
  });
  test("an adult on a spoken turn gets no job (the glance and TV screens are in the policy matrix)", async () => {
    for (const [surface, opts] of [["chat", { spoken: true }]] as const) {
      await withStub(calling({ prompt: "a paper boat" }, "Sorry."), async () => {
        const value = await turn(people.owner, "make a video of a paper boat", surface, opts);
        expect(value.video).toBeUndefined();
      });
    }
    expect(fake.submitted).toHaveLength(0);
  });
  test("an absolute-line prompt on an adult's own screen is refused in plain words and no job starts", async () => {
    await withStub(calling({ prompt: "a topless teen dancing by the sea" }), async () => {
      const value = await turn(people.owner, "make a video of a girl by the sea");
      expect(value.reply.text).toBe(VIDEO_REFUSAL_LINE.minor_sexual);
      expect(value.video).toBeUndefined();
      expect(fake.submitted).toHaveLength(0);
    });
  });
  test("an adult real-person request starts a job", async () => {
    await withStub(calling({ prompt: "the president waving", depicts_real_person: true }), async () => {
      const value = await turn(people.owner, "make a video of the president waving");
      expect(value.video).toBeDefined();
      expect(fake.submitted).toHaveLength(1);
    });
  });
  test("a sexual real-person request from an adult is not refused by the tool gate (the model decides); a teen's is", async () => {
    const { videoRefusalFor } = await import("@/lib/videos/tool");
    const args = { prompt: "a sexual video of the president", depicts_real_person: true };
    const adult = { actor: people.owner, band: "adult" as const, surface: "chat" as const, surfaceClass: "written" as const, spoken: false } as never;
    expect(videoRefusalFor(adult, args)).toBeNull();
    const teen = { actor: people.owner, band: "teen" as const, surface: "chat" as const, surfaceClass: "written" as const, spoken: false } as never;
    expect(videoRefusalFor(teen, args)).not.toBeNull();
  });
  test("a call on a turn that was never offered the tool (no video model) is refused", async () => {
    __setVideoStatusForTests(null);
    await withStub(calling({ prompt: "a paper boat" }), async () => {
      const value = await turn(people.owner, "make a video of a paper boat");
      expect(value.reply.text).toBe(VIDEO_NOT_HERE_LINE);
      expect(fake.submitted).toHaveLength(0);
    });
  });
  test("an adult-only style is dropped for an adult when the household restricted them, and the model never sees the library", async () => {
    setHouseholdSettingValue("generation.video.adult_adapters", "restricted");
    await withStub(calling({ prompt: "a woman by a window", style: "boudoir motion" }, "On its way."), async (seen) => {
      await turn(people.owner, "a clip of a woman by a window in boudoir motion style");
      expect(fake.submitted[0]!.loras).toBeUndefined();
      expect(fake.submitted[0]!.audience).toBe("all-ages");
      const tools = JSON.stringify(seen.find((r) => (r.tools?.length ?? 0) > 0)?.tools ?? []);
      expect(tools).not.toContain("Boudoir");
      expect(tools).not.toContain("lora-");
    });
  });
  test("with adult-only styles allowed, an adult's named adult-only style rides along with audience adult", async () => {
    await withStub(calling({ prompt: "a woman by a window", style: "boudoir motion" }, "On its way."), async () => {
      await turn(people.owner, "a clip of a woman by a window in boudoir motion style");
      expect(fake.submitted[0]!.loras).toEqual([{ id: "lora-2222222222222222", strength: 0.9 }]);
      expect(fake.submitted[0]!.audience).toBe("adult");
    });
  });
});

describe("the routes", () => {
  async function signedIn(name: string, role: string): Promise<{ client: TestClient; actor: PersonRow }> {
    resetDb();
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: name, secret: "correcthorse" });
    const actor = db.select().from(peopleTable).where(eq(peopleTable.displayName, name)).get()!;
    if (role !== "owner") asRole(actor.id, role as never);
    return { client, actor: db.select().from(peopleTable).where(eq(peopleTable.id, actor.id)).get()! };
  }
  async function finishedJob(actor: PersonRow) {
    const conv = await import("@/lib/conversationHistory");
    const resolved = conv.resolveOrCreateConversation(actor, "chat", undefined, {});
    if (!resolved.ok) throw new Error("no conversation");
    const job = await startVideoJob({ actor, conversationId: resolved.value.id, turnId: null, temporary: true, kind: "generate", prompt: "a paper boat", body: { prompt: "a paper boat", size: "832x480", seconds: 5, audience: "adult" } });
    await until(() => getVideoJobFor(actor, job.id)?.state === "done");
    return job;
  }

  test("GENPREVIEW-01: a running clip's card carries the stage in words, the ETA and, once the motion is done, the first frame, served to its owner only; all of it is gone when the clip is done", async () => {
    fake.live = { stage_label: "Putting the frames together, part 3 of 12", eta_seconds: 70 };
    fake.pollsToFinish = 14;
    const owner = await signedIn("Sage", "owner");
    const conv = await import("@/lib/conversationHistory");
    const resolved = conv.resolveOrCreateConversation(owner.actor, "chat", undefined, {});
    if (!resolved.ok) throw new Error("no conversation");
    const job = await startVideoJob({ actor: owner.actor, conversationId: resolved.value.id, turnId: null, temporary: true, kind: "generate", prompt: "a paper boat", body: { prompt: "a paper boat", audience: "adult" } });
    const card = () => videoCardView(owner.actor, getVideoJobFor(owner.actor, job.id)!, true).items[0]!;
    await until(() => card().preview_url !== null);
    const running = card();
    expect(running).toMatchObject({ state: "running", label: "Putting the frames together, part 3 of 12", eta_seconds: 70, preview_url: `/api/videos/jobs/${job.id}/preview?v=1` });
    expect(fake.previewFetches).toBe(1);
    const served = await owner.client.get(`/api/videos/jobs/${job.id}/preview`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/jpeg");
    expect(Array.from(new Uint8Array(await served.arrayBuffer()))).toEqual(Array.from(testJpeg()));
    expect((await new TestClient().get(`/api/videos/jobs/${job.id}/preview`)).status).toBe(401);
    await until(() => getVideoJobFor(owner.actor, job.id)?.state === "done");
    expect(card()).toMatchObject({ state: "done", label: "", eta_seconds: null, preview_url: null });
    expect((await owner.client.get(`/api/videos/jobs/${job.id}/preview`)).status).toBe(404);
  });

  test("status says an adult can, with the limits in plain words, and says why a child cannot", async () => {
    const adult = await signedIn("Sage", "owner");
    const res = await adult.client.get("/api/videos/status");
    expect(res.status).toBe(200);
    const body = await res.json() as { can_make: boolean; limits: string; styles: Array<{ id: string }> };
    expect(body.can_make).toBe(true);
    expect(body.limits).toBe("Quick videos are 5 seconds at 480p with no sound and take about 2 minutes. Detailed videos have sound and speech, run up to 10 seconds and take a minute or two.");
    expect(body.styles.map((s) => s.id).sort()).toEqual(["lora-1111111111111111", "lora-2222222222222222"]);
    asRole(adult.actor.id, "child");
    invalidateSessionCacheForPerson(adult.actor.id);
    setHouseholdSettingValue("generation.kids", false);
    const teenBody = await (await adult.client.get("/api/videos/status")).json() as { can_make: boolean; reason: string | null; styles: unknown[] };
    expect(teenBody.can_make).toBe(false);
    expect(teenBody.reason).toContain("off for this profile");
    expect(teenBody.styles).toEqual([]);
  });

  test("Make another works for the owner; the same route, Animate, and the card's other actions are refused for a child with nothing sent", async () => {
    const owner = await signedIn("Sage", "owner");
    const job = await finishedJob(owner.actor);
    const ok = await owner.client.post(`/api/videos/jobs/${job.id}/another`, {});
    expect(ok.status).toBe(200);
    expect(fake.submitted).toHaveLength(2);
    setHouseholdSettingValue("generation.kids", false);
    asRole(owner.actor.id, "child");
    invalidateSessionCacheForPerson(owner.actor.id);
    const another = await owner.client.post(`/api/videos/jobs/${job.id}/another`, {});
    expect(another.status).toBe(403);
    const animate = await owner.client.post("/api/videos/animate", { conversation_id: job.conversationId, turn_id: "turn-x", prompt: "make it move" });
    expect(animate.status).toBe(403);
    expect(fake.submitted).toHaveLength(2);
  });

  test("Animate refuses a turn that is not the person's own, and a picture the Stack did not make", async () => {
    const owner = await signedIn("Sage", "owner");
    const job = await finishedJob(owner.actor);
    const foreign = await owner.client.post("/api/videos/animate", { conversation_id: job.conversationId, turn_id: "turn-x", file_id: "file-nothere", prompt: "make it move" });
    expect(foreign.status).toBe(404);
    let turnId = "";
    await withStub({ calls: () => undefined, reply: () => "Hi." }, async () => {
      const value = await turn(owner.actor, "hello", "chat", { conversationId: job.conversationId });
      turnId = value.turn_id;
    });
    const res = await owner.client.post("/api/videos/animate", { conversation_id: job.conversationId, turn_id: turnId, file_id: "file-nothere", prompt: "make it move" });
    expect(res.status).toBe(422);
    expect(fake.submitted).toHaveLength(1);
  });

  test("a person can have one clip in the making at a time; a second request is refused in plain words and sends nothing", async () => {
    fake.pollsToFinish = 1000;
    const owner = await signedIn("Sage", "owner");
    const conv = await import("@/lib/conversationHistory");
    const resolved = conv.resolveOrCreateConversation(owner.actor, "chat", undefined, {});
    if (!resolved.ok) throw new Error("no conversation");
    const body = { prompt: "a paper boat", audience: "adult" as const };
    await startVideoJob({ actor: owner.actor, conversationId: resolved.value.id, turnId: null, temporary: true, kind: "generate", prompt: "a paper boat", body });
    await expect(startVideoJob({ actor: owner.actor, conversationId: resolved.value.id, turnId: null, temporary: true, kind: "generate", prompt: "another", body })).rejects.toThrow("already have a video being made");
    expect(fake.submitted).toHaveLength(1);
  });

  test("an unsatisfiable Range is a 416, never the whole file", async () => {
    const owner = await signedIn("Sage", "owner");
    const job = await finishedJob(owner.actor);
    const file = getVideoJobFor(owner.actor, job.id)!.files[0]!;
    const res = await owner.client.get(`/api/videos/jobs/${job.id}/files/${file.id}`, { Range: "bytes=999999-" });
    expect(res.status).toBe(416);
    expect(res.headers.get("content-range")).toBe("bytes */4096");
  });

  test("switching an unknown LoRA on or off is a 404 and leaves no row behind", async () => {
    const owner = await signedIn("Sage", "owner");
    const res = await owner.client.request("/api/videos/adapters/lora-ffffffffffffffff", { method: "PATCH", body: { enabled: false } });
    expect(res.status).toBe(404);
    const { videoAdapterPrefs } = await import("@/db/schema");
    expect(db.select().from(videoAdapterPrefs).all()).toHaveLength(0);
  });

  test("a clip streams with Range for its owner only; a missing job and a stranger's job read the same", async () => {
    const owner = await signedIn("Sage", "owner");
    const job = await finishedJob(owner.actor);
    const file = getVideoJobFor(owner.actor, job.id)!.files[0]!;
    const whole = await owner.client.get(`/api/videos/jobs/${job.id}/files/${file.id}`);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-type")).toBe("video/mp4");
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    const part = await owner.client.get(`/api/videos/jobs/${job.id}/files/${file.id}`, { Range: "bytes=0-99" });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 0-99/4096");
    expect((await part.arrayBuffer()).byteLength).toBe(100);
    expect((await owner.client.get("/api/videos/jobs/vid-nope")).status).toBe(404);
    expect((await owner.client.get(`/api/videos/jobs/${job.id}/files/file-other`)).status).toBe(404);
  });

  test("the messaging copy is named from the prompt, and a clip without sound is converted by the Stack once", async () => {
    const { __resetMessagesCopiesForTests } = await import("@/lib/videos/messagesCopy");
    __resetMessagesCopiesForTests();
    const owner = await signedIn("Sage", "owner");
    const job = await finishedJob(owner.actor);
    const res = await owner.client.get(`/api/videos/jobs/${job.id}/messages.mp4`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="paper-boat.mp4"');
    const body = new Uint8Array(await res.arrayBuffer());
    expect(hasAudioTrack(body)).toBe(true);
    expect(fake.converted).toEqual(["a paper boat"]);
    await owner.client.get(`/api/videos/jobs/${job.id}/messages.mp4`);
    expect(fake.converted).toHaveLength(1);
    // The original download is untouched: the stored bytes, no sound track.
    const file = getVideoJobFor(owner.actor, job.id)!.files[0]!;
    const original = new Uint8Array(await (await owner.client.get(`/api/videos/jobs/${job.id}/files/${file.id}`)).arrayBuffer());
    expect(hasAudioTrack(original)).toBe(false);
    expect((await owner.client.get("/api/videos/jobs/vid-nope/messages.mp4")).status).toBe(404);
  });

  test("a stranger cannot fetch the messaging copy of a clip", async () => {
    const owner = await signedIn("Sage", "owner");
    const job = await finishedJob(owner.actor);
    const stranger = new TestClient();
    expect((await stranger.get(`/api/videos/jobs/${job.id}/messages.mp4`)).status).toBe(401);
  });

  test("Stop cancels a clip that is being made and frees the Stack", async () => {
    fake.pollsToFinish = 1000;
    const owner = await signedIn("Sage", "owner");
    const conv = await import("@/lib/conversationHistory");
    const resolved = conv.resolveOrCreateConversation(owner.actor, "chat", undefined, {});
    if (!resolved.ok) throw new Error("no conversation");
    const job = await startVideoJob({ actor: owner.actor, conversationId: resolved.value.id, turnId: null, temporary: true, kind: "generate", prompt: "a paper boat", body: { prompt: "a paper boat", audience: "adult" } });
    const res = await owner.client.post(`/api/videos/jobs/${job.id}/cancel`, {});
    expect(res.status).toBe(200);
    expect(getVideoJobFor(owner.actor, job.id)!.state).toBe("cancelled");
    expect(fake.jobs[0]!.deleted).toBe(true);
  });

  test("a newly added style is off for everyone until an admin confirms it, and an unsure add is adults only", async () => {
    const owner = await signedIn("Sage", "owner");
    const form = new FormData();
    form.set("file", new File([new Uint8Array(16)], "ink.safetensors"));
    form.set("name", "Ink");
    form.set("licence", "apache-2.0");
    form.set("looks_like", "nobody");
    const res = await owner.client.postForm("/api/videos/adapters", form);
    expect(res.status).toBe(200);
    const added = await res.json() as { id: string; classification: string; enabled: boolean; needs_confirmation: boolean };
    expect(added).toMatchObject({ classification: "adult-only", enabled: false, needs_confirmation: true });
    // Off for everyone: not in any person's list, an adult's included.
    expect((await videoAdaptersFor(["all-ages", "adult-only"])).map((a) => a.id)).not.toContain(added.id);
    const confirmed = await owner.client.request(`/api/videos/adapters/${added.id}`, { method: "PATCH", body: { enabled: true } });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toMatchObject({ enabled: true, needs_confirmation: false });
    expect((await videoAdaptersFor(["all-ages", "adult-only"])).map((a) => a.id)).toContain(added.id);
    expect((await videoAdaptersFor(["all-ages"])).map((a) => a.id)).not.toContain(added.id);
  });

  test("the settings routes are for owners and admins only", async () => {
    const adult = await signedIn("Sage", "adult");
    expect((await adult.client.get("/api/videos/settings")).status).toBe(403);
    expect((await adult.client.request("/api/videos/adapters/lora-1111111111111111", { method: "PATCH", body: { enabled: false } })).status).toBe(403);
    const owner = await signedIn("Sage", "owner");
    const res = await owner.client.get("/api/videos/settings");
    expect(res.status).toBe(200);
    const body = await res.json() as { enabled: boolean; minors: string; adapters: Array<{ id: string; classification: string }> };
    expect(body.enabled).toBe(true);
    expect(body.minors).toContain("off for children and teens");
    expect(body.adapters.map((a) => a.classification).sort()).toEqual(["adult-only", "all-ages"]);
  });
});

describe("messaging file names", () => {
  test("a file is named after the prompt", () => {
    expect(videoFileName("A paper boat in the rain")).toBe("paper-boat-rain.mp4");
    expect(videoFileName("Make me a video of a golden retriever puppy chasing a red ball across the lawn")).toBe("golden-retriever-puppy-chasing-red-ball.mp4");
    expect(videoFileName("café à la crème!!")).toBe("cafe-la-creme.mp4");
    expect(videoFileName("the a an")).toBe("the-a-an.mp4");
    expect(videoFileName("???")).toBe("video.mp4");
    expect(videoFileName("x".repeat(200))).toHaveLength(52);
  });
});
