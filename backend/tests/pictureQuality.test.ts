// IMGGEN-QUALITY-01 (owner ruling 2026-10-17): plain pictures stay fast (Quick); Detailed is the slower, richer maker. The
// person-facing choice is the household setting, the chat tool's `quality` argument, a style's own maker, and the card's switch.
// No model name reaches the model's tool result or the card.
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
import { getPictureJob, startPictureJob } from "@/lib/pictures/jobs";
import { __setPictureStatusForTests, readyStatusForTests } from "@/lib/pictures/ready";
import { chooseQuality, detailedReady } from "@/lib/pictures/quality";
import { cardView } from "@/routes/pictures";
import { adaptersFor, __resetAdapterCacheForTests } from "@/lib/pictures/adapters";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import type { TurnStreamEvent } from "@/wire";
import { installFakeImageStack, until, TEST_LORAS, type FakeImageStack } from "./pictureFixture";
import { TestClient } from "./client";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { people as peopleTable } from "@/db/schema";

let people: BenchPeople;
let fake: FakeImageStack;

const KLEIN = { id: "flux2-klein-4b", family: "flux2", installed: true, licence: "Apache-2.0", loras: true, edit: true, steps_default: 4, peak_gb: 13.5 };
const ZIMAGE = { id: "z-image-turbo", family: "z-image", installed: true, licence: "Apache-2.0", loras: true, edit: false, steps_default: 9, peak_gb: 34 };
const ZIMAGE_LORA = { ...TEST_LORAS[0]!, id: "lora-cccccccccccccccc", name: "Technicolor", sha256: "c".repeat(64), base_model: "z-image-turbo", trigger_words: ["technicolor"] };

function engine(withDetailed: boolean) {
  __setPictureStatusForTests(readyStatusForTests({ models: withDetailed ? [KLEIN, ZIMAGE] : [KLEIN] }));
}

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  __resetAdapterCacheForTests();
  people = createBenchPeople();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
  fake = installFakeImageStack();
  fake.loras = [...TEST_LORAS, ZIMAGE_LORA];
  engine(true);
});
afterEach(() => {
  fake.restore();
  __resetLlmSupervisorForTests();
  __resetPortOwnershipForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

const isPhrasing = (request: ChatCompletionRequest) => request.messages.some((m) => m.role === "tool");
function call(args: Record<string, unknown>) {
  const c = { id: "call-q", name: "generate_image", args: JSON.stringify({ prompt: "a red fox in the snow, soft morning light", ...args }) };
  return { calls: (request: ChatCompletionRequest) => (request.tool_choice === "none" || isPhrasing(request) ? undefined : [c]), reply: () => "On its way." };
}
/** Runs one chat turn that calls the tool; returns what the model was told about the result. */
async function run(args: Record<string, unknown>, text = "draw a red fox"): Promise<string> {
  let told = "";
  await withStub(call(args), async (seen) => {
    const result = await runTurnNextStream(people.owner, "chat", text, {} as never);
    if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
    const events: TurnStreamEvent[] = [];
    for await (const event of streamTurnEvents(result, people.owner.id)) events.push(event as TurnStreamEvent);
    told = seen.find(isPhrasing)!.messages.find((m) => m.role === "tool")!.content!.toString();
  });
  return told;
}

describe("chooseQuality", () => {
  const withZ = { models: [KLEIN, ZIMAGE] };
  const withoutZ = { models: [KLEIN] };
  test("no ask and no setting is Quick with no model named", () => {
    expect(chooseQuality({ engine: withZ, household: "quick" })).toEqual({ quality: "quick", note: null, announce: false });
  });
  test("the household's Detailed uses Detailed when it is installed, and falls back to Quick with a note when it is not", () => {
    expect(chooseQuality({ engine: withZ, household: "detailed" })).toMatchObject({ quality: "detailed", model: "z-image-turbo", note: null });
    expect(chooseQuality({ engine: withoutZ, household: "detailed" })).toEqual({ quality: "quick", note: "detailed_not_installed", announce: false });
    expect(detailedReady({ models: [{ ...ZIMAGE, available: false }] })).toBe(false);
  });
  test("an asked-for kind beats the setting, and Detailed asked for outright is announced", () => {
    expect(chooseQuality({ requested: "quick", engine: withZ, household: "detailed" })).toMatchObject({ quality: "quick" });
    expect(chooseQuality({ requested: "detailed", engine: withZ, household: "quick" })).toMatchObject({ quality: "detailed", announce: true });
  });
  test("a style decides the maker: Detailed on its own with a note, Quick kept for a Quick style", () => {
    expect(chooseQuality({ style: { base_model: "z-image-turbo" }, engine: withZ, household: "quick" })).toMatchObject({ quality: "detailed", model: "z-image-turbo", note: "style_needs_detailed", announce: true });
    expect(chooseQuality({ style: { base_model: "z-image-turbo" }, engine: withZ, household: "detailed" })).toMatchObject({ quality: "detailed", note: null });
    expect(chooseQuality({ style: { base_model: "flux2-klein-4b" }, requested: "detailed", engine: withZ })).toMatchObject({ quality: "quick", note: "style_needs_quick" });
    expect(chooseQuality({ style: { base_model: "flux2-klein-4b" }, engine: withZ, household: "detailed" })).toMatchObject({ quality: "quick", note: null });
  });
});

describe("the chat tool", () => {
  test("a plain request is Quick: the Stack is told no model", async () => {
    await run({});
    expect(fake.submitted[0]!.model).toBeUndefined();
    await until(() => fake.jobs.length > 0);
  });

  test("the model asking for Detailed makes a Detailed picture and is told to say so in one sentence, without a model name", async () => {
    const told = await run({ quality: "detailed" }, "the most detailed, photoreal fox you can");
    expect(fake.submitted[0]!.model).toBe("z-image-turbo");
    expect(told).toContain("Detailed picture");
    expect(told).not.toMatch(/z-image|klein|flux/i);
  });

  test("the household's Detailed setting applies when nothing is asked", async () => {
    setHouseholdSettingValue("generation.picture_quality", "detailed");
    await run({});
    expect(fake.submitted[0]!.model).toBe("z-image-turbo");
  });

  test("Detailed that is not installed makes a Quick picture and tells the model how an admin gets it", async () => {
    engine(false);
    const told = await run({ quality: "detailed" });
    expect(fake.submitted[0]!.model).toBeUndefined();
    expect(told).toContain("not on this computer yet");
    expect(told).toContain("Settings, Pictures and videos");
    expect(told).not.toMatch(/z-image|klein|flux/i);
  });

  test("a style made for the detailed maker picks Detailed on its own, with a plain note", async () => {
    const told = await run({ style: "technicolor" });
    expect(fake.submitted[0]!.model).toBe("z-image-turbo");
    expect(fake.submitted[0]!.loras).toEqual([{ id: "lora-cccccccccccccccc", scale: 0.8 }]);
    expect(told).toContain("only works with Detailed");
  });

  test("a style made for the quick maker stays Quick even when Detailed is asked for", async () => {
    const told = await run({ style: "pixel", quality: "detailed" });
    expect(fake.submitted[0]!.model).toBe("flux2-klein-4b");
    expect(told).toContain("only works with Quick");
  });
});

describe("the card and its switch", () => {
  async function made(model?: string, loras = false) {
    const resolved = (await import("@/lib/conversationHistory")).resolveOrCreateConversation(people.owner, "chat", undefined, {});
    if (!resolved.ok) throw new Error("no conversation");
    const job = await startPictureJob({ actor: people.owner, conversationId: resolved.value.id, turnId: null, temporary: true, kind: "generate", prompt: "a red fox", body: { prompt: "a red fox", size: "1024x1024", n: 1, audience: "adult", ...(model ? { model } : {}), ...(loras ? { loras: [{ id: "lora-aaaaaaaaaaaaaaaa", scale: 0.8 }] } : {}) } });
    await until(() => getPictureJob(people.owner, job.id)?.state === "done");
    return getPictureJob(people.owner, job.id)!;
  }

  test("a Quick card offers Detailed when it is installed; a Detailed card offers Quick; a styled card offers nothing", async () => {
    expect(cardView(people.owner, await made(), true, true)).toMatchObject({ quality: "quick", switch_to: "detailed" });
    expect(cardView(people.owner, await made(), true, false)).toMatchObject({ quality: "quick", switch_to: null });
    expect(cardView(people.owner, await made("z-image-turbo"), true, true)).toMatchObject({ quality: "detailed", switch_to: "quick" });
    expect(cardView(people.owner, await made(undefined, true), true, true)).toMatchObject({ switch_to: null });
  });

  test("the variation route makes the picture again as the other kind, and keeps its own kind when none is given", async () => {
    resetDb();
    const client = new TestClient();
    await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
    const actor = db.select().from(peopleTable).where(eq(peopleTable.displayName, "Sage")).get()!;
    const resolved = (await import("@/lib/conversationHistory")).resolveOrCreateConversation(actor, "chat", undefined, {});
    if (!resolved.ok) throw new Error("no conversation");
    const job = await startPictureJob({ actor, conversationId: resolved.value.id, turnId: null, temporary: true, kind: "generate", prompt: "a red fox", body: { prompt: "a red fox", size: "1024x1024", n: 1, audience: "adult" } });
    await until(() => getPictureJob(actor, job.id)?.state === "done");
    const again = await client.post(`/api/pictures/jobs/${job.id}/variation`, { quality: "detailed" });
    expect(again.status).toBe(200);
    expect(fake.submitted.at(-1)!.model).toBe("z-image-turbo");
    await until(() => getPictureJob(actor, job.id)?.state === "done" && fake.jobs.every((j) => j.state === "done"));
    const kept = await client.post(`/api/pictures/jobs/${job.id}/variation`, {});
    expect(kept.status).toBe(200);
    expect(fake.submitted.at(-1)!.model).toBeUndefined();
  });
});

test("a style the person may use is listed with its maker (the adapters read stays as it was)", async () => {
  expect((await adaptersFor(["all-ages"])).map((a) => a.base_model).sort()).toEqual(["flux2-klein-4b", "z-image-turbo"]);
});
