// Same live-turn fixture as videoTool: only the chat and music engines are scripted.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { resetDb } from "./reset-db";
import { createBenchPeople } from "../scripts/bench/conversationRunner";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { withStub } from "./turnMachine/toolHarness";
import { useDefaultScriptedStack } from "./stackFixture";
import { installFakeMusicStack, waitForMusic } from "./musicFixture";
import { __setMusicStatusForTests } from "@/lib/music/ready";
import { setHouseholdSettingValue } from "@/lib/settings";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import { getMusicJobFor } from "@/lib/music/jobs";
import { householdAllowsMusic } from "@/lib/music/policy";
import { MEDIA_NOT_STARTED_LINE } from "@/lib/mediaClaims";
import { getRegistryKey } from "@/lib/settingsRegistry";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
let people: ReturnType<typeof createBenchPeople>;
let fake: ReturnType<typeof installFakeMusicStack>;
beforeEach(() => {
  resetDb(); useDefaultScriptedStack(); __resetThrottleForTests(); __resetLlmSupervisorForTests(); __resetRateLimiterForTests();
  people = createBenchPeople(); fake = installFakeMusicStack(); setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
});
afterEach(() => { fake.restore(); __resetLlmSupervisorForTests(); __resetPortOwnershipForTests(); delete process.env.MAIPAI_LLAMA_SERVER_URL; });
const isPhrasing = (request: ChatCompletionRequest) => request.messages.some((m) => m.role === "tool");
const names = (request?: ChatCompletionRequest) => (request?.tools ?? []).map((t) => (t as { function: { name: string } }).function.name);
test("an adult's first turn earns generation; a made-here song earns editing on the next turn", async () => {
  const call = { id: "songcall", name: "generate_music", args: JSON.stringify({ description: "a folk song about pancakes", lyrics: "[Verse]\nMorning light\n[Chorus]\nPancakes rise" }) };
  await withStub({ calls: (r) => r.tool_choice === "none" || isPhrasing(r) ? undefined : [call], reply: () => "Your song is on its way." }, async (seen) => {
    const result = await runTurnNext(people.owner, "chat", "make a folk song about pancakes");
    if (!result.ok) throw new Error("turn failed");
    expect(names(seen.find((r) => (r.tools?.length ?? 0) > 0))).toContain("generate_music");
    expect(names(seen.find((r) => (r.tools?.length ?? 0) > 0))).not.toContain("edit_music");
    const id = result.value.music?.id; expect(id).toBeDefined();
    await waitForMusic(() => getMusicJobFor(people.owner, id!)?.state === "done");
    await withStub({ calls: () => undefined, reply: () => "Hello." }, async (nextSeen) => {
      await runTurnNext(people.owner, "chat", "hello", { conversationId: result.value.conversation_id });
      expect(names(nextSeen.find((r) => (r.tools?.length ?? 0) > 0))).toContain("edit_music");
    });
  });
});
test("children, teens, guests, spoken turns, glance screens and TVs never earn the music offer", async () => {
  await withStub({ calls: () => undefined, reply: () => "Hello." }, async (seen) => {
    for (const [actor, surface, options] of [
      [people.child, "chat", {}], [{ ...people.owner, role: "teen" }, "chat", {}], [{ ...people.owner, role: "guest" }, "chat", {}],
      [people.owner, "chat", { spoken: true }], [people.owner, "overlay", {}], [people.owner, "tv", {}],
    ] as const) {
      const before = seen.length;
      await runTurnNext(actor, surface, "hello", options);
      const offered = seen.slice(before).flatMap(names);
      expect(offered).not.toContain("generate_music"); expect(offered).not.toContain("edit_music");
    }
  });
});
test("the music household switch and Stack readiness close the live turn gate", async () => {
  for (const off of ["switch", "engine"]) {
    if (off === "switch") setHouseholdSettingValue("generation.music.enabled", false);
    else { setHouseholdSettingValue("generation.music.enabled", true); __setMusicStatusForTests(null); }
    await withStub({ calls: () => undefined, reply: () => "Hello." }, async (seen) => {
      await runTurnNext(people.owner, "chat", "hello");
      expect(seen.flatMap(names)).not.toContain("generate_music");
    });
  }
});
test("the music key is in Home's settings registry and the household switch reads false when off", () => {
  expect(getRegistryKey("generation.music.enabled")?.lives_in).toBe("household.pictures");
  expect(householdAllowsMusic()).toBe(true);
  setHouseholdSettingValue("generation.music.enabled", false);
  expect(householdAllowsMusic()).toBe(false);
  setHouseholdSettingValue("generation.music.enabled", true);
  expect(householdAllowsMusic()).toBe(true);
});
test("a song claim with no generate_music call is held and replaced by the honest line", async () => {
  await withStub({ calls: () => undefined, reply: () => "Your song is on its way." }, async () => {
    const result = await runTurnNext(people.owner, "chat", "make me a song about pancakes");
    if (!result.ok) throw new Error("turn failed");
    expect(result.value.reply.text).toBe(MEDIA_NOT_STARTED_LINE);
    expect(MEDIA_NOT_STARTED_LINE).toContain("song");
    expect(fake.submitted).toHaveLength(0);
  });
});
