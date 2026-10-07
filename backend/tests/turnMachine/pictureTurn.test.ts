// UPLOAD-IMG-02: a turn that carries sent pictures while no local vision
// engine exists (VISION-01 is not built). The chat model cannot see the
// pictures, so it is told, as context, that pictures were attached, their
// file names, and that it cannot see them or tell who a person in a photo
// is. It must never be left to guess, and the turn must still answer.
// Later turns in the same conversation keep the same fact in the window.
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { resetDb } from "../reset-db";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { useDefaultScriptedStack } from "../stackFixture";
import { createBenchPeople, type BenchPeople } from "../../scripts/bench/conversationRunner";
import { setHouseholdSettingValue } from "@/lib/settings";
import { runTurnNextStream } from "@/lib/turnMachine/turnNext";
import { drainStream, withEngine } from "./modeHarness";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";

let people: BenchPeople;

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  people = createBenchPeople();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
});

afterEach(() => {
  __resetLlmSupervisorForTests();
  __resetPortOwnershipForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

const ROBOT = { id: "file-robot0001", name: "goal-and-agents.png", width: 640, height: 480, media_type: "image/jpeg" };
const PICKER = { id: "file-picker002", name: "chat-model-picker.png", width: 800, height: 600, media_type: "image/jpeg" };

function promptText(request: ChatCompletionRequest): string {
  return request.messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content))).join("\n");
}

describe("UPLOAD-IMG-02: sent pictures while the model cannot see them", () => {
  test("the model is told each attached file name and that it cannot see pictures, and the turn still answers", async () => {
    await withEngine(() => "I can't see pictures yet, but tell me about it.", async (seen) => {
      const { value } = await drainStream(await runTurnNextStream(people.owner, "chat", "can you see these files?", { images: [ROBOT, PICKER] }));
      expect(value.reply.text).toBe("I can't see pictures yet, but tell me about it.");
      expect(value.images).toEqual([ROBOT, PICKER]);
      const prompt = promptText(seen.at(-1)!);
      expect(prompt).toContain("goal-and-agents.png");
      expect(prompt).toContain("chat-model-picker.png");
      expect(prompt).toContain("2 pictures");
      expect(prompt).toContain("You cannot see pictures yet");
      expect(prompt).toContain("You cannot tell who a person in a photo is.");
      // The person's own words remain raw at the end of the final user
      // message; request-local context leads it, and image parts stay attached.
      const last = seen.at(-1)!.messages.at(-1)!;
      expect(last.role).toBe("user");
      expect(String(last.content)).toContain("The person's words:\ncan you see these files?");
      expect(String(last.content)).toContain("2 pictures");
    });
  });

  test("a turn with no pictures carries no picture line", async () => {
    await withEngine(() => "Hello.", async (seen) => {
      await drainStream(await runTurnNextStream(people.owner, "chat", "hello there", {}));
      expect(promptText(seen.at(-1)!)).not.toContain("You cannot see pictures yet");
    });
  });

  test("a child's picture turn gets the same line (the model never claims to see it)", async () => {
    await withEngine(() => "I can't look at pictures yet.", async (seen) => {
      const { value } = await drainStream(await runTurnNextStream(people.child, "chat", "look at my drawing", { images: [ROBOT] }));
      expect(value.reply.text.length).toBeGreaterThan(0);
      const prompt = promptText(seen.at(-1)!);
      expect(prompt).toContain("1 picture");
      expect(prompt).toContain("You cannot see pictures yet");
    });
  });

  test("the next turn's window still says a picture was attached earlier and was not seen", async () => {
    await withEngine(() => "Okay.", async (seen) => {
      const first = await drainStream(await runTurnNextStream(people.owner, "chat", "this is my new robot", { images: [ROBOT] }));
      await drainStream(await runTurnNextStream(people.owner, "chat", "what color is it?", { conversationId: first.value.conversation_id }));
      const windowUser = seen.at(-1)!.messages.find((m) => m.role === "user" && String(m.content).startsWith("this is my new robot"));
      expect(String(windowUser?.content)).toContain("goal-and-agents.png");
      expect(String(windowUser?.content)).toContain("not seen");
    });
  });
});
