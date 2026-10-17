// A reply never says a picture or video is made or on its way unless the tool ran (lib/mediaClaims.ts, nodes/model.ts):
// live QA 2026-10-17 saw the model skip the tool about 1 turn in 8 and once invent a clip in a fresh chat.
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
import { MEDIA_NOT_STARTED_LINE, MEDIA_REASK_INSTRUCTION } from "@/lib/mediaClaims";
import { PICTURE_NOT_HERE_LINE } from "@/lib/pictures/policy";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import type { TurnValue } from "@/wire";
import { installFakeImageStack, type FakeImageStack } from "./pictureFixture";
import type { PersonRow } from "@/types";

let people: BenchPeople;
let fake: FakeImageStack;
beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  people = createBenchPeople();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
  fake = installFakeImageStack();
});
afterEach(() => {
  fake.restore();
  __resetLlmSupervisorForTests();
  __resetPortOwnershipForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

const isPhrasing = (r: ChatCompletionRequest) => r.messages.some((m) => m.role === "tool");
const isReask = (r: ChatCompletionRequest) => r.messages.some((m) => m.role === "user" && String(m.content).includes(MEDIA_REASK_INSTRUCTION));
const FOX = { id: "c", name: "generate_image", args: JSON.stringify({ prompt: "a red fox in the snow" }) };
async function turn(actor: PersonRow, text: string, opts: Record<string, unknown> = {}): Promise<TurnValue> {
  const result = await runTurnNext(actor, "chat", text, opts as never);
  if (!result.ok) throw new Error(`turn refused: ${JSON.stringify(result)}`);
  return result.value as TurnValue;
}

describe("the picture claim guard", () => {
  test("a fresh chat: the first round claims a picture with no call, the one re-ask calls the tool, a job exists", async () => {
    let asked = 0;
    await withStub({
      calls: (r) => (isPhrasing(r) || r.tool_choice === "none" ? undefined : isReask(r) ? [FOX] : undefined),
      reply: (r) => { if (isReask(r)) asked++; return isPhrasing(r) ? "It is on its way." : "Your picture is on its way!"; },
    }, async (seen) => {
      const value = await turn(people.owner, "make me a picture of a red fox in the snow");
      expect(value.picture).toBeDefined();
      expect(fake.submitted).toHaveLength(1);
      expect(seen.filter(isReask)).toHaveLength(1);
      expect(value.reply.text).not.toContain(MEDIA_NOT_STARTED_LINE);
    });
  });

  test("a model that keeps claiming with no call is never believed: the honest line, no job, one re-ask only", async () => {
    await withStub({ calls: () => undefined, reply: () => "Here's your picture of a red fox!" }, async (seen) => {
      const value = await turn(people.owner, "draw a red fox in the snow");
      expect(value.reply.text).toBe(MEDIA_NOT_STARTED_LINE);
      expect(value.picture).toBeUndefined();
      expect(fake.submitted).toHaveLength(0);
      expect(seen.filter(isReask)).toHaveLength(1);
    });
  });

  test("an honest answer without a claim is released as written, with no re-ask", async () => {
    await withStub({ calls: () => undefined, reply: () => "What size would you like, square or wide?" }, async (seen) => {
      const value = await turn(people.owner, "make me a picture of a red fox");
      expect(value.reply.text).toBe("What size would you like, square or wide?");
      expect(seen.filter(isReask)).toHaveLength(0);
    });
  });

  test("the normal path is unchanged: the tool is called at once, no re-ask", async () => {
    await withStub({ calls: (r) => (isPhrasing(r) || r.tool_choice === "none" ? undefined : [FOX]), reply: () => "On its way." }, async (seen) => {
      const value = await turn(people.owner, "make me a picture of a red fox");
      expect(value.picture).toBeDefined();
      expect(seen.filter(isReask)).toHaveLength(0);
    });
  });

  test("a turn where the tool is not offered never claims a picture", async () => {
    // A child is in the cartoon lane by default (owner ruling 2026-10-17), so the tool is not offered to a child only while the home switch is off.
    setHouseholdSettingValue("generation.kids", false);
    const child = (() => { db.update(peopleTable).set({ role: "child" }).where(eq(peopleTable.id, people.child.id)).run(); return db.select().from(peopleTable).where(eq(peopleTable.id, people.child.id)).get()!; })();
    await withStub({ calls: () => undefined, reply: () => "Your picture is being made, it will show up below." }, async (seen) => {
      const value = await turn(child, "make me a picture of a red fox");
      expect(value.reply.text).toBe(PICTURE_NOT_HERE_LINE);
      expect(seen.filter(isReask)).toHaveLength(0);
      expect(fake.submitted).toHaveLength(0);
    });
  });

  test("a message that does not ask for a picture is untouched", async () => {
    await withStub({ calls: () => undefined, reply: () => "Foxes are in the dog family and hunt at dusk." }, async (seen) => {
      const value = await turn(people.owner, "tell me about foxes");
      expect(value.reply.text).toBe("Foxes are in the dog family and hunt at dusk.");
      expect(seen.filter(isReask)).toHaveLength(0);
    });
  });
});
