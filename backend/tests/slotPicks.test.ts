// TIER-HOME-04 (audit fix 8): the saved slot picks (`engines.<role>.tier.<tier>`) are what a job really runs with. A Home route or tool makes a
// Boost job, a fake Stack answers over HTTP, and the request the Stack received carries the slot's model, options and tier. A slot set to off
// makes the job at Standard, also when the slot was switched off after the job was queued (the dialog's consequence text).
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
import { startVideoJob } from "@/lib/videos/jobs";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { slotKey, slotRun } from "@/lib/tiers";
import { runGenerateMusic } from "@/lib/music/tool";
import { startMusicJob } from "@/lib/music/jobs";
import { musicForOutcomes } from "@/lib/composer";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import type { TurnStreamEvent } from "@/wire";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { installFakeMusicStack, musicState, waitForMusic } from "./musicFixture";
import { until } from "./pictureFixture";
import vocab from "@maipai/spec/vocab/resource-tiers.json";
import { SLOT_LEVELS_READ, SLOT_OPTIONS_READ } from "../../shared/tierSlotOptions";

const LTX = "ltx25-q8";
const WAN = "fastwan2-2-ti2v-5b-mlx-bf16";
let people: BenchPeople;
let video: FakeVideoStack;

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests(); __resetLlmSupervisorForTests(); __resetRateLimiterForTests(); __resetVideoAdapterCacheForTests();
  people = createBenchPeople();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
  video = installFakeVideoStack();
  video.ltx25 = "ready";
  __setVideoStatusForTests(readyVideoStatusForTests({ ltx25: "ready" }));
});
afterEach(() => { video.restore(); __resetLlmSupervisorForTests(); __resetPortOwnershipForTests(); delete process.env.MAIPAI_LLAMA_SERVER_URL; });

const isPhrasing = (request: ChatCompletionRequest) => request.messages.some((m) => m.role === "tool");
async function videoTurn(args: Record<string, unknown>): Promise<void> {
  const call = { id: "call-t", name: "generate_video", args: JSON.stringify({ prompt: "a paper boat floating down a rainy street, soft light", ...args }) };
  await withStub({ calls: (request: ChatCompletionRequest) => (request.tool_choice === "none" || isPhrasing(request) ? undefined : [call]), reply: () => "On its way." }, async () => {
    const result = await runTurnNextStream(people.owner, "chat", "make one", {} as never);
    if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
    for await (const event of streamTurnEvents(result, people.owner.id)) void (event as TurnStreamEvent);
  });
  await until(() => video.submitted.length > 0);
}
const setSlot = (category: "video" | "music", tier: "standard" | "boost" | "max", value: { model: string; options?: Record<string, boolean | number> }) =>
  setHouseholdSettingValue(slotKey(category, tier), { model: value.model, options: value.options ?? {} });

describe("slotRun: the one reading of a saved slot", () => {
  test("a custom Boost pick and its options come back; recommended is no model; off lowers to Standard", () => {
    expect(slotRun("video", "boost", "adult")).toMatchObject({ tier: "boost", model: null, options: {}, lowered: false });
    setSlot("video", "boost", { model: LTX, options: { length_seconds: 8 } });
    expect(slotRun("video", "boost", "adult")).toMatchObject({ tier: "boost", model: LTX, options: { length_seconds: 8 } });
    setSlot("video", "boost", { model: "off" });
    expect(slotRun("video", "boost", "adult")).toMatchObject({ tier: "standard", lowered: true, model: null });
    setSlot("video", "max", { model: "off" });
    expect(slotRun("video", "max", "adult")).toMatchObject({ tier: "standard", lowered: true });
  });
});

describe("video: the Stack receives the Boost slot", () => {
  test("a Boost video with the recommended slot goes to the Stack with LTX-2.5 Boost options", async () => {
    await videoTurn({ tier: "boost" });
    expect(video.submitted[0]).toMatchObject({ tier: "boost", model: "ltx25-q8", size: "768x448", seconds: 5 });
  });
  test("a Boost slot pointed at the Quick model makes a Boost job on that model, and its length option reaches the request", async () => {
    setSlot("video", "boost", { model: WAN, options: { length_seconds: 3 } });
    await videoTurn({ tier: "boost" });
    expect(video.submitted[0]).toMatchObject({ tier: "boost", model: WAN, seconds: 3, size: "832x480" });
  });
  test("a Boost slot on LTX-2.5 with 8 seconds and a lower resolution sends all three", async () => {
    setSlot("video", "boost", { model: LTX, options: { length_seconds: 8, resolution: 256 } });
    await videoTurn({ tier: "boost" });
    expect(video.submitted[0]).toMatchObject({ tier: "boost", model: LTX, seconds: 5, size: "384x256" });
  });
  test("a request the person made with their own length keeps it", async () => {
    setSlot("video", "boost", { model: LTX, options: { length_seconds: 8 } });
    await videoTurn({ tier: "boost", seconds: 6 });
    expect(video.submitted[0]).toMatchObject({ model: LTX, seconds: 5 });
  });
  test("a Standard job gets no tier and the Standard slot's options", async () => {
    setSlot("video", "standard", { model: LTX, options: { length_seconds: 2 } });
    await videoTurn({});
    expect(video.submitted[0]).toMatchObject({ model: "ltx25-q8", seconds: 2, size: "512x256" });
    expect(video.submitted[0]).not.toHaveProperty("tier");
  });
  test("a Boost slot switched off makes a Boost request at Standard", async () => {
    setSlot("video", "boost", { model: "off" });
    await videoTurn({ tier: "boost" });
    expect(video.submitted[0]).not.toHaveProperty("tier");
    expect(video.submitted[0]!.model).not.toBe("detailed");
  });
  test("a job queued at Boost while the slot was on is sent at Standard when the slot is off by the time it is sent", async () => {
    setSlot("video", "boost", { model: "off" });
    await startVideoJob({ actor: people.owner, conversationId: null, turnId: null, temporary: true, kind: "generate", prompt: "a boat", body: { prompt: "a boat", audience: "adult", model: "detailed", size: "768x448", seconds: 10 }, tier: "boost" });
    await until(() => video.submitted.length > 0);
    expect(video.submitted[0]).not.toHaveProperty("tier");
    expect(video.submitted[0]).toMatchObject({ seconds: 5 });
    expect(video.submitted[0]!.model).not.toBe("detailed");
  });
});

describe("music: the Stack receives the Boost slot", () => {
  let music: ReturnType<typeof installFakeMusicStack>;
  beforeEach(() => { music = installFakeMusicStack(); });
  afterEach(() => music.restore());
  const make = async (args: Record<string, unknown>) => {
    const outcome = await runGenerateMusic({ state: musicState(people.owner), args: { description: "a gentle folk song", instrumental: true, seconds: 30, ...args }, callId: "g", spoken: false });
    expect(outcome.status).toBe("succeeded");
    await waitForMusic(() => music.submitted.length > 0);
    return musicForOutcomes([outcome])!.id;
  };
  test("a Boost song reaches the Stack at boost on the Detailed maker", async () => {
    await make({ tier: "boost" });
    expect(music.submitted[0]).toMatchObject({ tier: "boost", quality: "detailed" });
  });
  test("a Standard song carries no tier", async () => {
    await make({});
    expect(music.submitted[0]).not.toHaveProperty("tier");
  });
  test("a song queued at Boost is sent at Standard when the Boost slot is off by the time it is sent", async () => {
    setSlot("music", "boost", { model: "off" });
    await startMusicJob({ actor: people.owner, conversationId: musicState(people.owner).conversationId, turnId: "t-slot", temporary: true, task: "text2music",
      request: { description: "a gentle folk song", instrumental: true, seconds: 30, title: "Folk", quality: "detailed", tier: "boost" } as never,
      body: { task: "text2music", caption: "a gentle folk song", instrumental: true, duration_s: 30, quality: "detailed" } });
    await waitForMusic(() => music.submitted.length > 0);
    expect(music.submitted[0]).not.toHaveProperty("tier");
    expect(music.submitted[0]).toMatchObject({ quality: "quick" });
  });
});

describe("what the dialog offers is what is read", () => {
  test("every option and level named as read exists in the spec vocabulary, and the video reader takes exactly its two options", () => {
    for (const [category, names] of Object.entries(SLOT_OPTIONS_READ)) {
      const known = (vocab.categories.find((c) => c.id === category)?.options ?? []).map((o) => o.id);
      for (const name of names) expect(known).toContain(name);
    }
    for (const category of Object.keys(SLOT_LEVELS_READ)) expect(vocab.categories.some((c) => c.id === category)).toBe(true);
    expect(SLOT_OPTIONS_READ.video).toEqual(["length_seconds", "resolution"]);
  });
});
