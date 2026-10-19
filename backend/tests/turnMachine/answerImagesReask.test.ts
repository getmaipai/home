import { afterEach, beforeEach, describe, expect, test, spyOn } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "../reset-db";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { setHouseholdSettingValue } from "@/lib/settings";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import { __setToolOfferOverridesForTests } from "@/lib/turnMachine/budget";
import { SHOW_IMAGES_REASK_INSTRUCTION } from "@/lib/turnMachine/nodes/model";
import { __setAnswerImageDepsForTests } from "@/lib/answerImages/select";
import { __resetAnswerImageFetchForTests } from "@/lib/answerImages/fetch";
import { createBenchPeople, startFakeSearxng, type BenchPeople } from "../../scripts/bench/conversationRunner";
import { useDefaultScriptedStack } from "../stackFixture";
import { fixtureWorld, type FixtureSubject } from "../answerImagesFixture";
import { withStub } from "./toolHarness";
import { db } from "@/db";
import { people as peopleTable } from "@/db/schema";
import * as plugins from "@/lib/plugins";
import * as llm from "@/lib/llm";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";

const PICTURE_SUBJECT: FixtureSubject = {
  id: "Q243", label: "Eiffel Tower", category: "Eiffel Tower", image: "Tower lead.jpg",
  files: ["Tower lead.jpg", "Tower night.jpg", "Tower river.jpg"], description: "tower in Paris",
};
const IMAGE_CALL = { id: "call-image-reask", name: "show_images", args: JSON.stringify({ subject: "Eiffel Tower", kind: "landmark" }) };
const SEARCH_CALL = { id: "call-websearch", name: "websearch", args: JSON.stringify({ expression: "Eiffel Tower history" }) };
const isReAsk = (request: ChatCompletionRequest) => request.messages.some((m) => m.content?.toString().includes(SHOW_IMAGES_REASK_INSTRUCTION));
const isToolResultRound = (request: ChatCompletionRequest) => request.messages.some((m) => m.role === "tool");

let people: BenchPeople;
let previousReAskSetting: string | undefined;
const restores: Array<() => void> = [];

beforeEach(() => {
  previousReAskSetting = process.env.MAIPAI_IMGQ09_REASK;
  delete process.env.MAIPAI_IMGQ09_REASK;
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  __resetAnswerImageFetchForTests();
  people = createBenchPeople();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
});

afterEach(() => {
  for (const restore of restores.splice(0)) restore();
  __setToolOfferOverridesForTests(null);
  __setAnswerImageDepsForTests(null);
  __resetLlmSupervisorForTests();
  __resetPortOwnershipForTests();
  if (previousReAskSetting === undefined) delete process.env.MAIPAI_IMGQ09_REASK;
  else process.env.MAIPAI_IMGQ09_REASK = previousReAskSetting;
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

function setupImages(offered = ["show_images"]): void {
  __setToolOfferOverridesForTests(offered);
  __setAnswerImageDepsForTests(fixtureWorld([PICTURE_SUBJECT]).deps);
}

function callsFor(firstPass?: { id: string; name: string; args: string }) {
  return (request: ChatCompletionRequest) => {
    if (isReAsk(request)) return [IMAGE_CALL];
    if (isToolResultRound(request)) return undefined;
    return firstPass ? [firstPass] : undefined;
  };
}

async function runPictureQuestion(firstPass?: { id: string; name: string; args: string }, offered = ["show_images"]) {
  setupImages(offered);
  return withStub({
    calls: callsFor(firstPass),
    reply: (request) => isToolResultRound(request) ? "The Eiffel Tower is a landmark in Paris." : "It is a landmark in Paris.",
  }, async (seen) => {
    const result = await runTurnNext(people.owner, "chat", "Tell me about the Eiffel Tower");
    return { result, seen };
  });
}

describe("IMGQ-09: answer image re-ask", () => {
  test("an automatic lead gallery suppresses the redundant after-answer re-ask", async () => {
    const { result, seen } = await runPictureQuestion();
    expect(result.ok && result.kind === "immediate" ? result.value.blocks?.filter((b) => b.kind === "image_gallery") : []).toHaveLength(1);
    // The automatic lead already supplied the picture, so the after-answer
    // re-ask must not do the same job a second time.
    expect(seen.filter(isReAsk)).toHaveLength(0);
  });

  test("a successful websearch outcome still permits the re-ask", async () => {
    const searxng = startFakeSearxng();
    setHouseholdSettingValue("search.searxng_url", searxng.url);
    try {
      const { result, seen } = await runPictureQuestion(SEARCH_CALL, ["show_images", "websearch"]);
      expect(searxng.queries.length).toBeGreaterThan(0);
      expect(result.ok && result.kind === "immediate" ? result.value.blocks?.filter((b) => b.kind === "image_gallery") : []).toHaveLength(1);
      expect(seen.filter(isReAsk)).toHaveLength(1);
    } finally {
      searxng.stop();
    }
  });

  test("a failed outcome skips the re-ask", async () => {
    setupImages(["show_images", "weather"]);
    const pluginSpy = spyOn(plugins, "runPlugin").mockImplementation(async () => ({
      ok: false as const, status: 502 as const, error: "offline", code: "weather_unavailable",
      fallback_reply: { reply: { text: "unused" }, actions: [] },
    }) as never);
    restores.push(() => pluginSpy.mockRestore());
    await withStub({
      calls: (request) => isToolResultRound(request) || isReAsk(request) ? undefined : [{ id: "weather-call", name: "weather", args: JSON.stringify({ place: "Paris" }) }],
      reply: (request) => isToolResultRound(request) ? "The lookup failed, but Paris is in France." : "Checking the weather.",
    }, async (seen) => {
      const result = await runTurnNext(people.owner, "chat", "What is the weather in Paris?");
      expect(result.ok).toBe(true);
      expect(seen.filter(isReAsk)).toHaveLength(0);
    });
  });

  test("a successful outcome from a package outside the lookup allow-list skips the re-ask", async () => {
    setupImages(["show_images", "timer"]);
    let timerRuns = 0;
    const pluginSpy = spyOn(plugins, "runPlugin").mockImplementation(async () => {
      timerRuns++;
      return ({
        ok: true as const, value: { reply: { text: "Timer set." }, actions: [], data: {} },
      }) as never;
    });
    restores.push(() => pluginSpy.mockRestore());
    await withStub({
      calls: (request) => isToolResultRound(request) || isReAsk(request) ? undefined : [{ id: "timer-call", name: "timer", args: JSON.stringify({ expression: "5 minutes" }) }],
      reply: (request) => isToolResultRound(request) ? "Your timer is set." : "Setting a timer.",
    }, async (seen) => {
      const result = await runTurnNext(people.owner, "chat", "Please start a five minute timer now, thanks.");
      expect(result.ok).toBe(true);
      expect(timerRuns).toBe(1);
      expect(seen.filter(isReAsk)).toHaveLength(0);
    });
  });

  test("MAIPAI_IMGQ09_REASK=0 turns the re-ask off", async () => {
    process.env.MAIPAI_IMGQ09_REASK = "0";
    const { result, seen } = await runPictureQuestion();
    expect(result.ok).toBe(true);
    expect(seen.filter(isReAsk)).toHaveLength(0);
  });

  test("a teen, a child and a spoken turn never get the re-ask or a gallery (the offer gate is the adult written chat's alone)", async () => {
    setupImages();
    db.update(peopleTable).set({ role: "teen" }).where(eq(peopleTable.id, people.child.id)).run();
    const teen = db.select().from(peopleTable).where(eq(peopleTable.id, people.child.id)).get()!;
    await withStub({
      calls: callsFor(),
      reply: () => "It is a landmark in Paris.",
    }, async (seen) => {
      const galleries = (result: Awaited<ReturnType<typeof runTurnNext>>) => (result.ok && result.kind === "immediate" ? (result.value.blocks ?? []).filter((block) => block.kind === "image_gallery").length : 0);
      expect(galleries(await runTurnNext(people.child, "chat", "What does the Eiffel Tower look like?"))).toBe(0);
      expect(galleries(await runTurnNext(teen, "chat", "What does the Eiffel Tower look like?"))).toBe(0);
      expect(galleries(await runTurnNext(people.owner, "chat", "What does the Eiffel Tower look like?", { spoken: true }))).toBe(0);
      expect(seen.filter(isReAsk)).toHaveLength(0);
    });
  });

  test("a thrown re-ask failure leaves the completed text answer successful without a gallery", async () => {
    setupImages();
    const original = llm.startCompleteStreamPieces.bind(llm);
    let reAskAttempts = 0;
    const modelSpy = spyOn(llm, "startCompleteStreamPieces").mockImplementation(async (role, messages, opts, signal) => {
      if (messages.some((m) => m.content?.toString().includes(SHOW_IMAGES_REASK_INSTRUCTION))) { reAskAttempts++; throw new Error("re-ask failed"); }
      return original(role, messages, opts, signal);
    });
    restores.push(() => modelSpy.mockRestore());
    await withStub({ calls: () => undefined, reply: () => "It is a landmark in Paris." }, async (seen) => {
      // A broad topic has no single resolver-selected subject, so the
      // automatic lead does not run; the IMGQ-09 re-ask still does.
      const result = await runTurnNext(people.owner, "chat", "Tell me about famous landmarks");
      expect(result.ok && result.kind === "immediate" ? result.value.reply.text : "").toContain("landmark");
      expect(result.ok && result.kind === "immediate" ? (result.value.blocks ?? []).filter((b) => b.kind === "image_gallery") : []).toHaveLength(0);
      expect(reAskAttempts).toBe(1);
      expect(seen.filter(isReAsk)).toHaveLength(0);
    });
  });
});
