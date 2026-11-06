// VIDEO-LTX-01 (owner ruling 2026-10-17): Quick or Detailed videos, the same two words as pictures. Quick is the silent five
// second clip and the default; Detailed makes the sound track with spoken words in the same pass, up to ten seconds. The choice
// is the household setting, the chat tool's `quality` argument, a length past five seconds, a style's own model, and the card's
// switch. No model name reaches the model's tool result or the card.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { setHouseholdSettingValue } from "@/lib/settings";
import { runTurnNextStream } from "@/lib/turnMachine/turnNext";
import { streamTurnEvents } from "@/routes/turn";
import { createBenchPeople, type BenchPeople } from "../scripts/bench/conversationRunner";
import { useDefaultScriptedStack } from "./stackFixture";
import { withStub } from "./turnMachine/toolHarness";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { __setVideoStatusForTests, readyVideoStatusForTests, videoStatusReady } from "@/lib/videos/ready";
import { chooseVideoQuality, etaWords, quickVideoReady } from "@/lib/videos/quality";
import { videoCardView } from "@/routes/videos";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import type { TurnStreamEvent } from "@/wire";
import { installFakeVideoStack, TEST_VIDEO_LORAS, type FakeVideoStack } from "./videoFixture";
import { until } from "./pictureFixture";
import { TestClient } from "./client";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people as peopleTable } from "@/db/schema";
import { startVideoJob } from "@/lib/videos/jobs";
import type { PersonRow } from "@/types";

let people: BenchPeople;
let fake: FakeVideoStack;

const LTX_LORA = { ...TEST_VIDEO_LORAS[0]!, id: "lora-4444444444444444", name: "Talking Heads", sha256: "4".repeat(64), base_model: "ltx-2.5", trigger_words: ["talkinghead"] };
const engineWith = (ltx25: "ready" | "missing" | undefined) => readyVideoStatusForTests(ltx25 ? { ltx25, ltx25Picture: true } : {});
/** A Stack that says Detailed can start from a picture (VIDEO-LTX-02, Stack d443349 and later). */
const newStack = () => readyVideoStatusForTests({ ltx25: "ready", ltx25Picture: true });

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  __resetVideoAdapterCacheForTests();
  people = createBenchPeople();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
  fake = installFakeVideoStack();
  fake.loras = [...TEST_VIDEO_LORAS, LTX_LORA];
  fake.ltx25 = "ready";
  __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready", ltx25Picture: true }));
});
afterEach(() => {
  fake.restore();
  __resetLlmSupervisorForTests();
  __resetPortOwnershipForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

const isPhrasing = (request: ChatCompletionRequest) => request.messages.some((m) => m.role === "tool");
function script(args: Record<string, unknown>) {
  const call = { id: "call-vid", name: "generate_video", args: JSON.stringify({ prompt: "a hero in a corridor says come with me if you want to live", ...args }) };
  return { calls: (request: ChatCompletionRequest) => (request.tool_choice === "none" || isPhrasing(request) ? undefined : [call]), reply: () => "On its way." };
}
async function streamValue(actor: typeof people.owner, text: string) {
  const result = await runTurnNextStream(actor, "chat", text, {} as never);
  if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
  const events: TurnStreamEvent[] = [];
  for await (const event of streamTurnEvents(result, actor.id)) events.push(event as TurnStreamEvent);
  const done = events.find((e) => e.type === "done") as { value: import("@/wire").TurnValue } | undefined;
  if (!done) throw new Error("no done event");
  return done.value;
}
const toolText = (seen: ChatCompletionRequest[]) => seen.find(isPhrasing)!.messages.find((m) => m.role === "tool")!.content!.toString();

describe("the choice", () => {
  test("Quick is the default and stays 5 seconds with no model named to the Stack", () => {
    const choice = chooseVideoQuality({ engine: engineWith("ready"), household: "quick", adultLane: true });
    expect(choice).toMatchObject({ quality: "quick", seconds: 5, note: null, announce: false, shortened: false });
  });
  test("adult Detailed requests use Boost and missing LTX-2.5 falls back to Standard", () => {
    expect(chooseVideoQuality({ requested: "detailed", engine: engineWith("ready"), household: "quick", seconds: 8, adultLane: true })).toMatchObject({ quality: "detailed", seconds: 5, announce: true, shortened: true });
    expect(chooseVideoQuality({ engine: engineWith("ready"), household: "detailed", adultLane: true })).toMatchObject({ quality: "detailed", seconds: 5, announce: false });
    expect(chooseVideoQuality({ requested: "detailed", engine: engineWith("missing"), household: "quick", seconds: 8, adultLane: true })).toMatchObject({ quality: "quick", seconds: 5, note: "detailed_not_installed", shortened: true });
    expect(chooseVideoQuality({ requested: "detailed", engine: engineWith(undefined), household: "quick", adultLane: true })).toMatchObject({ quality: "quick", note: "detailed_not_installed" });
  });
  test("Standard supports 10 seconds; Quick requests map to Standard and honor the length", () => {
    expect(chooseVideoQuality({ engine: engineWith("ready"), household: "quick", seconds: 9, adultLane: true })).toMatchObject({ quality: "quick", maker: "ltx25", seconds: 9, announce: false });
    expect(chooseVideoQuality({ engine: engineWith("ready"), household: "quick", seconds: 30, adultLane: true })).toMatchObject({ quality: "quick", seconds: 10, shortened: true });
    expect(chooseVideoQuality({ requested: "quick", engine: engineWith("ready"), household: "detailed", seconds: 8, adultLane: true })).toMatchObject({ quality: "quick", maker: "ltx25", seconds: 8, shortened: false });
  });
  test("LTX-2.5 styles use Boost, Wan styles use Quick, and retired styles are refused", () => {
    expect(chooseVideoQuality({ style: { base_model: "ltx-2.5" }, engine: engineWith("ready"), household: "quick", adultLane: true })).toMatchObject({ quality: "detailed", maker: "ltx25", announce: false, note: null });
    expect(chooseVideoQuality({ style: { base_model: "wan2.2-ti2v-5b" }, requested: "detailed", engine: engineWith("ready") })).toMatchObject({ quality: "quick", note: "style_needs_quick" });
  });
  test("a picture uses the silent path unless the Stack allows LTX-2.5 picture starts", () => {
    expect(chooseVideoQuality({ requested: "detailed", engine: newStack(), hasPicture: true, adultLane: true })).toMatchObject({ quality: "detailed", maker: "ltx25", note: null, seconds: 5, announce: true });
    expect(chooseVideoQuality({ engine: newStack(), household: "detailed", hasPicture: true, adultLane: true })).toMatchObject({ quality: "detailed", maker: "ltx25", note: null });
    expect(chooseVideoQuality({ engine: newStack(), household: "quick", seconds: 9, hasPicture: true, adultLane: true })).toMatchObject({ quality: "quick", maker: "ltx25", seconds: 9, note: null });
    expect(chooseVideoQuality({ engine: newStack(), household: "quick", hasPicture: true, adultLane: true })).toMatchObject({ quality: "quick", maker: "ltx25", note: null });
    // A teen or a child is Quick whatever the Stack can do.
    expect(chooseVideoQuality({ requested: "detailed", engine: newStack(), hasPicture: true, quickOnly: true })).toMatchObject({ quality: "quick", note: null });
    expect(chooseVideoQuality({ requested: "detailed", engine: newStack(), quickOnly: true })).toMatchObject({ quality: "quick", note: null });
  });
  test("a Stack without LTX-2.5 picture support uses Quick for picture starts", () => {
    expect(chooseVideoQuality({ requested: "detailed", engine: engineWith("ready"), hasPicture: true })).toMatchObject({ quality: "quick", maker: "wan", note: "detailed_not_installed", seconds: 5 });
    expect(chooseVideoQuality({ engine: engineWith("ready"), household: "quick", seconds: 9, hasPicture: true, adultLane: true })).toMatchObject({ quality: "quick", maker: "ltx25", note: null, seconds: 9, shortened: false });
    expect(chooseVideoQuality({ engine: engineWith("ready"), household: "detailed", hasPicture: true, adultLane: true })).toMatchObject({ quality: "detailed", maker: "ltx25", note: null });
  });
  test("a computer with only LTX-2.5 ready is video ready", () => {
    const only = readyVideoStatusForTests({ ltx25: "ready", quickMissing: true });
    expect(quickVideoReady(only)).toBe(false);
    expect(videoStatusReady(only, true)).toBe(true);
    expect(videoStatusReady(only, false)).toBe(false);
    expect(chooseVideoQuality({ engine: only, household: "quick", adultLane: true })).toMatchObject({ quality: "quick", maker: "ltx25", note: null });
    expect(videoStatusReady(readyVideoStatusForTests({ ltx25: "missing", quickMissing: true }))).toBe(false);
  });
  test("how long it takes is told in plain words", () => {
    expect(etaWords("quick", 5)).toBe("about two minutes");
    expect(etaWords("detailed", 5)).toBe("about a minute");
    expect(etaWords("detailed", 10)).toBe("about two minutes");
  });
});

describe("the tool", () => {
  test("a plain request is Quick: no model sent, 832x480, no sound, and the model is told to offer Detailed if they wanted sound", async () => {
    await withStub(script({}), async (seen) => {
      await streamValue(people.owner, "make a video of a hero in a corridor");
      const sent = fake.submitted[0]!;
      expect(sent.model).toBe("ltx25-q8");
      expect(sent).toMatchObject({ size: "512x256", seconds: 5 });
      const text = toolText(seen);
      expect(text).toContain("with sound");
      expect(text).not.toMatch(/\bwan\b|\bltx\b|gemma|fastwan/i);
    });
  });
  test("tier boost (what the old quality detailed word became; the manifest no longer declares quality) sends the model, 768x448, and tells the model to say so in one line, with no model names", async () => {
    await withStub(script({ tier: "boost" }), async (seen) => {
      const value = await streamValue(people.owner, "make a video where the hero says come with me");
      const sent = fake.submitted[0]!;
      expect(sent).toMatchObject({ model: "ltx25-q8", seconds: 5 });
      const text = toolText(seen);
      expect(text).toContain("This one has sound and speech");
      expect(text).toContain("with sound");
      expect(text).not.toMatch(/\bwan\b|\bltx\b|gemma|fastwan/i);
      await until(() => getVideoJobFor(people.owner, value.video!.id)?.state === "done");
      const job = getVideoJobFor(people.owner, value.video!.id)!;
      expect(job.files[0]).toMatchObject({ quality: "detailed", audio: true, width: 768, height: 448 });
      const card = videoCardView(people.owner, job, true, { quick: true, detailed: true });
      expect(card.items[0]).toMatchObject({ quality: "detailed", switch_to: "quick" });
      expect(card.items[0]!.clip).toMatchObject({ has_sound: true, seconds: 5 });
    });
  });
  test("a long one: 10 seconds in portrait uses Standard with LTX-2.5", async () => {
    await withStub(script({ seconds: 10, orientation: "portrait" }), async (seen) => {
      await streamValue(people.owner, "a ten second tall clip of a hero talking");
      expect(fake.submitted[0]!).toMatchObject({ model: "ltx25-q8", size: "256x512", seconds: 10 });
      expect(toolText(seen)).toContain("about two minutes");
    });
  });
  test("the household setting makes Boost the default, and a request can still ask for Standard", async () => {
    setHouseholdSettingValue("generation.video_tier", "boost");
    await withStub(script({}), async () => {
      await streamValue(people.owner, "make a video of a hero");
      expect(fake.submitted[0]!.model).toBe("ltx25-q8");
    });
    fake.submitted.length = 0;
    __resetVideoAdapterCacheForTests();
    await withStub(script({ quality: "quick" }), async () => {
      // the first clip is finished or stopped before a second one may start
      await until(() => fake.jobs[0]?.state === "done" || fake.jobs[0]?.deleted === true);
      await streamValue(people.owner, "make a quick one");
      expect(fake.submitted[0]!.model).toBe("ltx25-q8");
    });
  });
  test("missing LTX-2.5 falls back to Quick and tells the model how an admin gets it", async () => {
    fake.ltx25 = "missing";
    __setVideoStatusForTests(engineWith("missing"));
    await withStub(script({ quality: "detailed", seconds: 9 }), async (seen) => {
      await streamValue(people.owner, "make it detailed and nine seconds");
      expect(fake.submitted[0]!).toMatchObject({ size: "832x480", seconds: 5 });
      expect(fake.submitted[0]!.model).toBeUndefined();
      const text = toolText(seen);
      expect(text).toContain("need a newer video model");
      expect(text).toContain("Settings, Models and storage");
      expect(text).toContain("so it is 5");
    });
  });
  test("an LTX-2.5 style rides Max when held, otherwise refusal follows the Stack's Max LoRA flag", async () => {
    fake.ltx25max = "ready";
    setHouseholdSettingValue("engines.video.tier.max", { model: "ltx25-max", options: {} });
    setHouseholdSettingValue("engines.video.tier.boost", { model: "ltx25-q8", options: {} });
    const engine = readyVideoStatusForTests({ ltx25: "ready", ltx25max: "ready" });
    engine.qualities!.ltx25!.loras = { supported: true };
    engine.qualities!.ltx25max!.loras = { supported: true };
    __setVideoStatusForTests(engine);
    await withStub(script({ style: "Talking Heads", tier: "max" }), async (seen) => {
      await streamValue(people.owner, "a clip in the Talking Heads style");
      expect(fake.submitted[0]!).toMatchObject({ model: "ltx25-max", size: "1024x576", tier: "max" });
      expect((fake.submitted[0]!.loras as Array<{ id: string }>)[0]!.id).toBe(LTX_LORA.id);
    });
    fake.submitted.length = 0;
    const standard = readyVideoStatusForTests({ ltx25: "ready", ltx25max: "ready" });
    standard.qualities!.ltx25max!.loras = { supported: true };
    standard.qualities!.ltx25!.loras = { supported: false };
    __setVideoStatusForTests(standard);
    setHouseholdSettingValue("engines.video.tier.max", { model: "off", options: {} });
    await withStub(script({ style: "Talking Heads", tier: "max" }), async (seen) => {
      await streamValue(people.owner, "a clip in the Talking Heads style");
      expect(fake.submitted).toHaveLength(0);
      expect(toolText(seen)).toContain("can't use a style yet");
    });
  });
  test("a style made for LTX-2.5 with LTX-2.5 missing is not sent to the Stack", async () => {
    fake.ltx25 = "missing";
    __setVideoStatusForTests(engineWith("missing"));
    await withStub(script({ style: "talking heads" }), async (seen) => {
      await streamValue(people.owner, "a clip in the talking heads style");
      expect(fake.submitted).toHaveLength(0);
      expect(toolText(seen)).toContain("needs the newer video model");
    });
  });
});

describe("the card's switch and the routes", () => {
  async function owner(): Promise<{ client: TestClient; actor: PersonRow }> {
    resetDb();
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    return { client, actor: db.select().from(peopleTable).where(eq(peopleTable.displayName, "Sage")).get()! };
  }
  async function finished(actor: PersonRow, body: Record<string, unknown> = {}) {
    const conv = await import("@/lib/conversationHistory");
    const resolved = conv.resolveOrCreateConversation(actor, "chat", undefined, {});
    if (!resolved.ok) throw new Error("no conversation");
    const job = await startVideoJob({ actor, conversationId: resolved.value.id, turnId: null, temporary: true, kind: "generate", prompt: "a hero says come with me", body: { prompt: "a hero says come with me", size: "832x480", seconds: 5, audience: "adult", ...body } });
    await until(() => getVideoJobFor(actor, job.id)?.state === "done");
    return job;
  }
  test("Make it Boost makes the same words again with the Stack's own options; Make it Standard comes back", async () => {
    const { client, actor } = await owner();
    const job = await finished(actor);
    const card = await (await client.get(`/api/videos/jobs/${job.id}`)).json() as { items: Array<{ quality: string; switch_to: string | null }> };
    expect(card.items[0]).toMatchObject({ quality: "quick", switch_to: "detailed" });
    const again = await client.post(`/api/videos/jobs/${job.id}/another`, { quality: "detailed" });
    expect(again.status).toBe(200);
      expect(fake.submitted.at(-1)).toMatchObject({ model: "ltx25-q8", seconds: 5 });
    await until(() => fake.jobs.at(-1)?.state === "done");
    const second = fake.jobs.at(-1)!;
    expect(second.body.model).toBe("ltx25-q8");
    const detailedJob = await finished(actor, { model: "ltx25-q8", tier: "boost", quality: "detailed", size: "768x448" });
    const detailedCard = await (await client.get(`/api/videos/jobs/${detailedJob.id}`)).json() as { items: Array<{ quality: string; switch_to: string | null; clip: { has_sound: boolean } | null }> };
    expect(detailedCard.items.at(-1)).toMatchObject({ quality: "quick", switch_to: "detailed" });
    expect(detailedCard.items.at(-1)!.clip!.has_sound).toBe(true);
    const back = await client.post(`/api/videos/jobs/${detailedJob.id}/another`, { quality: "quick" });
    expect(back.status).toBe(200);
    expect(fake.submitted.at(-1)!.model).toBe("ltx25-q8");
    expect(fake.submitted.at(-1)).toMatchObject({ size: "512x256", seconds: 5 });
  });
  test("a video made with a style offers no switch", async () => {
    const { client, actor } = await owner();
    const job = await finished(actor, { loras: [{ id: "lora-1111111111111111", strength: 1 }] });
    const card = await (await client.get(`/api/videos/jobs/${job.id}`)).json() as { items: Array<{ switch_to: string | null }> };
    expect(card.items[0]!.switch_to).toBeNull();
  });
  test("the settings route reports the household's quality and LTX-2.5 readiness", async () => {
    const { client } = await owner();
    const body = await (await client.get("/api/videos/settings")).json() as { quality: string; detailed: { installed: boolean; component: string; licence: { id: string } | null; download_bytes: number } };
    expect(body.quality).toBe("quick");
    expect(body.detailed).toMatchObject({ installed: true, component: "ltx25-q8", download_bytes: 0 });
    fake.ltx25 = "missing";
    __setVideoStatusForTests(engineWith("missing"));
    const missing = await (await client.get("/api/videos/settings")).json() as { detailed: { installed: boolean; download_bytes: number } };
    expect(missing.detailed).toMatchObject({ installed: false, download_bytes: 0 });
  });
});
