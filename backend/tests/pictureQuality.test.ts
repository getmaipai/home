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
import { chooseQuality, detailedReady, isRemovedPictureModel, modelCanSpell, PICTURE_MODEL, qualityOfModel, QUALITY_NOTE_LINE, REMOVED_MODEL_LINE } from "@/lib/pictures/quality";
import { nameEditModel } from "@/lib/pictures/editTool";
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

const MINIMAX = { id: PICTURE_MODEL, family: "minimax-h3-image", installed: true, available: true, licence: "MiniMax-H3-Image Community License", loras: false, edit: true, steps_default: 6, max_references: 2, peak_gb: 22 };
const REMOVED = ["flux2-klein-4b", "ernie-image-turbo", "z-image-turbo"] as const;
const removedLora = (id: string, name: string, base: string) => ({ ...TEST_LORAS[0]!, id, name, sha256: id.slice(5, 6).repeat(64), base_model: base, trigger_words: [name.toLowerCase()] });

function engine() {
  __setPictureStatusForTests(readyStatusForTests({ models: [MINIMAX] }));
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
  fake.loras = [...TEST_LORAS, removedLora("lora-cccccccccccccccc", "Technicolor", "z-image-turbo")];
  engine();
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

describe("chooseQuality (one picture model)", () => {
  const eng = { models: [MINIMAX] };
  test("every request is the one picture model, Quick or Detailed asked", () => {
    expect(chooseQuality({ engine: eng, household: "quick" })).toEqual({ quality: "quick", model: PICTURE_MODEL, note: null, announce: false });
    expect(chooseQuality({ requested: "detailed", engine: eng })).toEqual({ quality: "quick", model: PICTURE_MODEL, note: null, announce: false });
  });
  test("a Stack that does not list it leaves the model unnamed (the Stack's own default)", () => {
    expect(chooseQuality({ engine: { models: [{ ...MINIMAX, installed: false }] } })).toEqual({ quality: "quick", note: null, announce: false });
    expect(chooseQuality({ engine: null })).toEqual({ quality: "quick", note: null, announce: false });
  });
  test("a style made for a removed model is refused (removed), never quietly run on another model", () => {
    for (const base of REMOVED) expect(chooseQuality({ style: { base_model: base }, engine: eng })).toMatchObject({ removed: true });
    expect(chooseQuality({ style: { base_model: PICTURE_MODEL }, engine: eng })).toMatchObject({ quality: "quick", model: PICTURE_MODEL });
  });
  test("only the one model maps to a quality; the removed ones map to nothing", () => {
    expect(qualityOfModel(PICTURE_MODEL)).toBe("quick");
    for (const base of REMOVED) { expect(qualityOfModel(base)).toBeNull(); expect(isRemovedPictureModel(base)).toBe(true); }
    expect(isRemovedPictureModel(PICTURE_MODEL)).toBe(false);
    expect(modelCanSpell(PICTURE_MODEL)).toBe(true);
    expect(modelCanSpell("flux2-klein-4b")).toBe(false);
  });
  test("there is no separate Detailed model to switch to", () => {
    expect(detailedReady({ models: [MINIMAX] })).toBe(false);
  });
});

describe("the chat tool", () => {
  test("a plain request names the one picture model and adds no no-text sentence", async () => {
    await run({});
    expect(fake.submitted[0]!.model).toBe(PICTURE_MODEL);
    expect(String(fake.submitted[0]!.prompt)).not.toContain("No text, no letters");
    await until(() => fake.jobs.length > 0);
  });

  test("words use the one model and append the exact words after the prompt, Detailed or not", async () => {
    await run({ words: ["  Hello  ", "World"], quality: "detailed" });
    expect(fake.submitted[0]!.model).toBe(PICTURE_MODEL);
    expect(fake.submitted[0]!.prompt).toContain('Show this text on the picture, spelled exactly as written: "Hello", "World".');
    expect(fake.submitted[0]!.prompt).not.toContain("No text, no letters");
    await until(() => fake.jobs.length > 0);
  });

  test("words with the picture model not installed are refused before a picture job starts, naming no removed model", async () => {
    __setPictureStatusForTests(readyStatusForTests({ models: [{ ...MINIMAX, installed: false }] }));
    const told = await run({ words: ["Hello"] });
    expect(told).toContain("No picture was made");
    expect(told).toContain("Words on a picture need the picture model");
    expect(told).not.toMatch(/ernie|klein|z-image/i);
    expect(fake.submitted).toHaveLength(0);
    expect(fake.jobs).toHaveLength(0);
  });

  test("the model asking for Detailed makes the same picture without a note about a second model", async () => {
    const told = await run({ quality: "detailed" }, "the most detailed, photoreal fox you can");
    expect(fake.submitted[0]!.model).toBe(PICTURE_MODEL);
    expect(told).not.toMatch(/z-image|klein|flux|ernie/i);
    expect(told).not.toContain("not on this computer yet");
  });

  test("a style made for a removed model is refused in plain words and no job starts", async () => {
    const told = await run({ style: "technicolor" });
    expect(told).toContain("no longer on this computer");
    expect(told).not.toMatch(/z-image|klein|flux|ernie/i);
    expect(fake.submitted).toHaveLength(0);
  });

  test("a style made for Klein is refused the same way", async () => {
    fake.loras = [...fake.loras, removedLora("lora-dddddddddddddddd", "Chunky", "flux2-klein-4b")];
    const told = await run({ style: "chunky" });
    expect(told).toContain("no longer on this computer");
    expect(fake.submitted).toHaveLength(0);
  });

  test("all edit forms name the one picture model", () => {
    const form = new FormData();
    nameEditModel(form);
    expect(form.get("model")).toBe(PICTURE_MODEL);
  });
});

test("no default, copy or note names a removed model", async () => {
  const settings = await Bun.file(new URL("../src/settings/pictureKeys.ts", import.meta.url)).text();
  const manifest = await Bun.file(new URL("../packages/generate_image/manifest.json", import.meta.url)).text();
  const personFacing = [settings.match(/help: "Quick draws[^"]+"/)?.[0], settings.match(/quick: "Clear words[^"]+"/)?.[0], settings.match(/detailed: "About 30 to 45[^"]+"/)?.[0], ...Object.values(QUALITY_NOTE_LINE), REMOVED_MODEL_LINE, JSON.parse(manifest).args.properties.quality.description].join(" ");
  expect(personFacing).not.toMatch(/Klein|ERNIE|Z-Image/i);
});

describe("the card and its switch", () => {
  async function made(loras = false) {
    const resolved = (await import("@/lib/conversationHistory")).resolveOrCreateConversation(people.owner, "chat", undefined, {});
    if (!resolved.ok) throw new Error("no conversation");
    const job = await startPictureJob({ actor: people.owner, conversationId: resolved.value.id, turnId: null, temporary: true, kind: "generate", prompt: "a red fox", body: { prompt: "a red fox", size: "1024x1024", n: 1, audience: "adult", ...(loras ? { loras: [{ id: "lora-aaaaaaaaaaaaaaaa", scale: 0.8 }] } : {}) } });
    await until(() => getPictureJob(people.owner, job.id)?.state === "done");
    return getPictureJob(people.owner, job.id)!;
  }

  test("a card never offers a second picture model to switch to", async () => {
    expect(cardView(people.owner, await made(), true, false)).toMatchObject({ quality: "quick", switch_to: null });
    expect(cardView(people.owner, await made(true), true, false)).toMatchObject({ switch_to: null });
  });

  test("the variation route makes the picture again on the one model", async () => {
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
    expect(fake.submitted.at(-1)!.model).toBe(PICTURE_MODEL);
  });
});

test("a style the person may use is listed with its maker (the adapters read stays as it was)", async () => {
  expect((await adaptersFor(["all-ages"])).map((a) => a.base_model).sort()).toEqual(["minimax-h3-image", "z-image-turbo"]);
});

describe("typicalWait", () => {
  const { typicalWait } = require("@/lib/pictures/quality") as typeof import("@/lib/pictures/quality");
  test("fewer than 3 samples says nothing", () => {
    expect(typicalWait([])).toBeNull();
    expect(typicalWait([20000, 21000])).toBeNull();
  });
  test("rounds to 5 seconds under a minute", () => {
    expect(typicalWait([19000, 21000, 22000])).toBe("About 20 seconds.");
    expect(typicalWait([1000, 1000, 1000])).toBe("About 5 seconds.");
    expect(typicalWait([41000, 42000, 43000])).toBe("About 40 seconds.");
  });
  test("uses the median, not the average", () => {
    expect(typicalWait([10000, 10000, 10000, 10000, 600000])).toBe("About 10 seconds.");
  });
  test("rounds to the minute above a minute", () => {
    expect(typicalWait([60000, 61000, 62000])).toBe("About 1 minute.");
    expect(typicalWait([115000, 120000, 125000])).toBe("About 2 minutes.");
  });
});
