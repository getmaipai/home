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
import { chooseVideoQuality, detailedVideoReady, etaWords, quickVideoReady } from "@/lib/videos/quality";
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

const LTX_LORA = { ...TEST_VIDEO_LORAS[0]!, id: "lora-4444444444444444", name: "Talking Heads", sha256: "4".repeat(64), base_model: "ltx-2.3", trigger_words: ["talkinghead"] };
const engineWith = (detailed: "installed" | "missing" | undefined) => readyVideoStatusForTests(detailed ? { detailed } : {});

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
  fake.detailed = "installed";
  __setVideoStatusForTests(engineWith("installed"));
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
    const choice = chooseVideoQuality({ engine: engineWith("installed"), household: "quick" });
    expect(choice).toMatchObject({ quality: "quick", seconds: 5, note: null, announce: false, shortened: false });
  });
  test("a request, or the household, can choose Detailed; Detailed that is not installed falls back to Quick with a note and 5 seconds", () => {
    expect(chooseVideoQuality({ requested: "detailed", engine: engineWith("installed"), household: "quick", seconds: 8 })).toMatchObject({ quality: "detailed", seconds: 8, announce: true });
    expect(chooseVideoQuality({ engine: engineWith("installed"), household: "detailed" })).toMatchObject({ quality: "detailed", seconds: 5, announce: false });
    expect(chooseVideoQuality({ requested: "detailed", engine: engineWith("missing"), household: "quick", seconds: 8 })).toMatchObject({ quality: "quick", seconds: 5, note: "detailed_not_installed", shortened: true });
    expect(chooseVideoQuality({ requested: "detailed", engine: engineWith(undefined), household: "quick" })).toMatchObject({ quality: "quick", note: "detailed_not_installed" });
  });
  test("a length past 5 seconds needs Detailed on its own; 10 is the most; Quick holds 5", () => {
    expect(chooseVideoQuality({ engine: engineWith("installed"), household: "quick", seconds: 9 })).toMatchObject({ quality: "detailed", seconds: 9, announce: true });
    expect(chooseVideoQuality({ engine: engineWith("installed"), household: "quick", seconds: 30 })).toMatchObject({ quality: "detailed", seconds: 10, shortened: true });
    expect(chooseVideoQuality({ requested: "quick", engine: engineWith("installed"), household: "detailed", seconds: 8 })).toMatchObject({ quality: "quick", seconds: 5, shortened: true });
  });
  test("a style decides its own model: LTX makes it Detailed, Wan keeps it Quick, each with a note when it overrides the ask", () => {
    expect(chooseVideoQuality({ style: { base_model: "ltx-2.3" }, engine: engineWith("installed"), household: "quick" })).toMatchObject({ quality: "detailed", announce: true, note: null });
    expect(chooseVideoQuality({ style: { base_model: "ltx-2.3" }, requested: "quick", engine: engineWith("installed") })).toMatchObject({ quality: "detailed", note: "style_needs_detailed" });
    expect(chooseVideoQuality({ style: { base_model: "wan2.2-ti2v-5b" }, requested: "detailed", engine: engineWith("installed") })).toMatchObject({ quality: "quick", note: "style_needs_quick" });
  });
  test("a picture starts a Quick clip only: Detailed asked for outright (or by length) is made Quick with the reason; the household default stays quiet", () => {
    expect(chooseVideoQuality({ requested: "detailed", engine: engineWith("installed"), hasPicture: true })).toMatchObject({ quality: "quick", note: "picture_needs_quick", seconds: 5 });
    expect(chooseVideoQuality({ engine: engineWith("installed"), household: "quick", seconds: 9, hasPicture: true })).toMatchObject({ quality: "quick", note: "picture_needs_quick", seconds: 5, shortened: true });
    expect(chooseVideoQuality({ engine: engineWith("installed"), household: "detailed", hasPicture: true })).toMatchObject({ quality: "quick", note: null });
    expect(chooseVideoQuality({ engine: engineWith("installed"), household: "quick", hasPicture: true })).toMatchObject({ quality: "quick", note: null });
  });
  test("a computer with only Detailed installed makes Detailed videos, and is ready", () => {
    const only = readyVideoStatusForTests({ detailed: "installed", quickMissing: true });
    expect(quickVideoReady(only)).toBe(false);
    expect(detailedVideoReady(only)).toBe(true);
    expect(videoStatusReady(only)).toBe(true);
    expect(chooseVideoQuality({ engine: only, household: "quick" })).toMatchObject({ quality: "detailed", note: "quick_not_installed" });
    expect(videoStatusReady(readyVideoStatusForTests({ detailed: "missing", quickMissing: true }))).toBe(false);
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
      expect(sent.model).toBeUndefined();
      expect(sent).toMatchObject({ size: "832x480", seconds: 5 });
      const text = toolText(seen);
      expect(text).toContain("A Quick video has no sound");
      expect(text).not.toMatch(/\bwan\b|\bltx\b|gemma|fastwan/i);
    });
  });
  test("quality detailed sends the model, 768x448, and tells the model to say so in one line, with no model names", async () => {
    await withStub(script({ quality: "detailed" }), async (seen) => {
      const value = await streamValue(people.owner, "make a video where the hero says come with me");
      const sent = fake.submitted[0]!;
      expect(sent).toMatchObject({ model: "detailed", size: "768x448", seconds: 5 });
      const text = toolText(seen);
      expect(text).toContain("Detailed video");
      expect(text).toContain("with sound and speech");
      expect(text).not.toMatch(/\bwan\b|\bltx\b|gemma|fastwan/i);
      await until(() => getVideoJobFor(people.owner, value.video!.id)?.state === "done");
      const job = getVideoJobFor(people.owner, value.video!.id)!;
      expect(job.files[0]).toMatchObject({ quality: "detailed", audio: true, width: 768, height: 448 });
      const card = videoCardView(people.owner, job, true, { quick: true, detailed: true });
      expect(card.items[0]).toMatchObject({ quality: "detailed", switch_to: "quick" });
      expect(card.items[0]!.clip).toMatchObject({ has_sound: true, seconds: 5 });
    });
  });
  test("a long one: 10 seconds in portrait is Detailed at 448x768 without asking", async () => {
    await withStub(script({ seconds: 10, orientation: "portrait" }), async (seen) => {
      await streamValue(people.owner, "a ten second tall clip of a hero talking");
      expect(fake.submitted[0]!).toMatchObject({ model: "detailed", size: "448x768", seconds: 10 });
      expect(toolText(seen)).toContain("about two minutes");
      expect(toolText(seen)).toContain("clearest in a clip of 5 seconds or less");
    });
  });
  test("the household setting makes Detailed the default, and a request can still ask for Quick", async () => {
    setHouseholdSettingValue("generation.video_quality", "detailed");
    await withStub(script({}), async () => {
      await streamValue(people.owner, "make a video of a hero");
      expect(fake.submitted[0]!.model).toBe("detailed");
    });
    fake.submitted.length = 0;
    __resetVideoAdapterCacheForTests();
    await withStub(script({ quality: "quick" }), async () => {
      // the first clip is finished or stopped before a second one may start
      await until(() => fake.jobs[0]?.state === "done" || fake.jobs[0]?.deleted === true);
      await streamValue(people.owner, "make a quick one");
      expect(fake.submitted[0]!.model).toBeUndefined();
    });
  });
  test("Detailed that is not installed makes a Quick video and tells the model how an admin gets it", async () => {
    fake.detailed = "missing";
    __setVideoStatusForTests(engineWith("missing"));
    await withStub(script({ quality: "detailed", seconds: 9 }), async (seen) => {
      await streamValue(people.owner, "make it detailed and nine seconds");
      expect(fake.submitted[0]!).toMatchObject({ size: "832x480", seconds: 5 });
      expect(fake.submitted[0]!.model).toBeUndefined();
      const text = toolText(seen);
      expect(text).toContain("not on this computer yet");
      expect(text).toContain("Settings, Models and storage");
      expect(text).toContain("so it is 5");
    });
  });
  test("a style made for Detailed makes the video Detailed and sends its id; with Detailed missing nothing is sent", async () => {
    await withStub(script({ style: "talking heads" }), async (seen) => {
      await streamValue(people.owner, "a clip in the talking heads style");
      expect(fake.submitted[0]!).toMatchObject({ model: "detailed", size: "768x448" });
      expect((fake.submitted[0]!.loras as Array<{ id: string }>)[0]!.id).toBe(LTX_LORA.id);
      expect(toolText(seen)).toContain("Detailed video");
    });
  });
  test("a style made for Detailed with Detailed missing is not sent to the Stack", async () => {
    fake.detailed = "missing";
    __setVideoStatusForTests(engineWith("missing"));
    await withStub(script({ style: "talking heads" }), async (seen) => {
      await streamValue(people.owner, "a clip in the talking heads style");
      expect(fake.submitted).toHaveLength(0);
      expect(toolText(seen)).toContain("only works with Detailed videos");
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
  test("Make it Detailed makes the same words again as Detailed with the Stack's own sizes; Make it Quick comes back", async () => {
    const { client, actor } = await owner();
    const job = await finished(actor);
    const card = await (await client.get(`/api/videos/jobs/${job.id}`)).json() as { items: Array<{ quality: string; switch_to: string | null }> };
    expect(card.items[0]).toMatchObject({ quality: "quick", switch_to: "detailed" });
    const again = await client.post(`/api/videos/jobs/${job.id}/another`, { quality: "detailed" });
    expect(again.status).toBe(200);
    expect(fake.submitted.at(-1)).toMatchObject({ model: "detailed", size: "768x448", seconds: 5 });
    await until(() => fake.jobs.at(-1)?.state === "done");
    const second = fake.jobs.at(-1)!;
    expect(second.body.model).toBe("detailed");
    const detailedJob = await finished(actor, { model: "detailed", size: "768x448" });
    const detailedCard = await (await client.get(`/api/videos/jobs/${detailedJob.id}`)).json() as { items: Array<{ quality: string; switch_to: string | null; clip: { has_sound: boolean } | null }> };
    expect(detailedCard.items.at(-1)).toMatchObject({ quality: "detailed", switch_to: "quick" });
    expect(detailedCard.items.at(-1)!.clip!.has_sound).toBe(true);
    const back = await client.post(`/api/videos/jobs/${detailedJob.id}/another`, { quality: "quick" });
    expect(back.status).toBe(200);
    expect(fake.submitted.at(-1)!.model).toBeUndefined();
    expect(fake.submitted.at(-1)).toMatchObject({ size: "832x480", seconds: 5 });
  });
  test("a video made with a style offers no switch", async () => {
    const { client, actor } = await owner();
    const job = await finished(actor, { loras: [{ id: "lora-1111111111111111", strength: 1 }] });
    const card = await (await client.get(`/api/videos/jobs/${job.id}`)).json() as { items: Array<{ switch_to: string | null }> };
    expect(card.items[0]!.switch_to).toBeNull();
  });
  test("the settings route reports the household's quality, Detailed's state, size and licence", async () => {
    const { client } = await owner();
    const body = await (await client.get("/api/videos/settings")).json() as { quality: string; detailed: { installed: boolean; component: string; licence: { id: string } | null; download_bytes: number } };
    expect(body.quality).toBe("quick");
    expect(body.detailed).toMatchObject({ installed: true, component: "ltx-2-3-distilled-mlx", download_bytes: 0 });
    expect(body.detailed.licence!.id).toBe("ltx-2.x-community-2026-08-11");
    fake.detailed = "missing";
    __setVideoStatusForTests(engineWith("missing"));
    const missing = await (await client.get("/api/videos/settings")).json() as { detailed: { installed: boolean; download_bytes: number } };
    expect(missing.detailed).toMatchObject({ installed: false, download_bytes: 73_572_000_000 });
  });
});
