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
import { __setMusicStatusForTests, readyMusicStatusForTests, settleMusicStatus } from "@/lib/music/ready";
import { setHouseholdSettingValue } from "@/lib/settings";
import { runTurnNext } from "@/lib/turnMachine/turnNext";
import { installFakeImageStack, until } from "./pictureFixture";
import { listConversationTurns } from "@/lib/conversationHistory";
import { getMusicJobFor } from "@/lib/music/jobs";
import { householdAllowsMusic } from "@/lib/music/policy";
import { MEDIA_NOT_STARTED_LINE, MUSIC_STARTED_LINE, SONG_LYRICS_ONLY_NOTE, SONG_LYRICS_REASK_INSTRUCTION } from "@/lib/mediaClaims";
import { getRegistryKey } from "@/lib/settingsRegistry";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
let people: ReturnType<typeof createBenchPeople>;
let pictures: ReturnType<typeof installFakeImageStack>;
let fake: ReturnType<typeof installFakeMusicStack>;
beforeEach(() => {
  resetDb(); useDefaultScriptedStack(); __resetThrottleForTests(); __resetLlmSupervisorForTests(); __resetRateLimiterForTests();
  people = createBenchPeople(); fake = installFakeMusicStack(); pictures = installFakeImageStack(); setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
});
afterEach(() => { fake.restore(); pictures.restore(); __resetLlmSupervisorForTests(); __resetPortOwnershipForTests(); delete process.env.MAIPAI_LLAMA_SERVER_URL; });
const isPhrasing = (request: ChatCompletionRequest) => request.messages.some((m) => m.role === "tool");
const names = (request?: ChatCompletionRequest) => (request?.tools ?? []).map((t) => (t as { function: { name: string } }).function.name);
test("an adult's first turn earns generation; a made-here song earns editing on the next turn", async () => {
  const call = { id: "songcall", name: "generate_music", args: JSON.stringify({ description: "a folk song about pancakes", lyrics: "[Verse]\nMorning light\n[Chorus]\nPancakes rise" }) };
  await withStub({ calls: (r) => r.tool_choice === "none" || isPhrasing(r) ? undefined : [call], reply: () => "Your song is on its way." }, async (seen) => {
    const result = await runTurnNext(people.owner, "chat", "make a folk song about pancakes");
    if (!result.ok) throw new Error("turn failed");
    expect(result.value.reply.text).toBe(MUSIC_STARTED_LINE);
    expect(names(seen.find((r) => (r.tools?.length ?? 0) > 0))).toContain("generate_music");
    expect(names(seen.find((r) => (r.tools?.length ?? 0) > 0))).not.toContain("edit_music");
    const id = result.value.music?.id; expect(id).toBeDefined();
    await waitForMusic(() => getMusicJobFor(people.owner, id!)?.state === "done");
    await until(() => Boolean(getMusicJobFor(people.owner, id!)?.coverFileId));
    expect(result.value.picture).toBeUndefined();
    const history = listConversationTurns(people.owner, result.value.conversation_id);
    expect(history.ok).toBe(true);
    if (!history.ok) throw new Error("history failed");
    const row = history.value.find((row) => row.music?.id === id);
    expect(row).toBeDefined();
    expect(row?.picture).toBeUndefined();
    await withStub({ calls: () => undefined, reply: () => "Hello." }, async (nextSeen) => {
      await runTurnNext(people.owner, "chat", "hello", { conversationId: result.value.conversation_id });
      expect(names(nextSeen.find((r) => (r.tools?.length ?? 0) > 0))).toContain("edit_music");
    });
  });
});

test("a successful music start replaces completion claims with only the started message", async () => {
  const call = { id: "songcall", name: "generate_music", args: JSON.stringify({ description: "a folk song", lyrics: "[Verse]\nMorning light\n[Chorus]\nPancakes rise" }) };
  for (const claim of ["The song is ready.", "The song is done.", "The song is finished.", "Here it is.", "The player should appear shortly."]) {
    await withStub({ calls: (r) => r.tool_choice === "none" || isPhrasing(r) ? undefined : [call], reply: () => claim }, async () => {
      const result = await runTurnNext(people.owner, "chat", "Make a spanish acoustic guitar funny");
      if (!result.ok) throw new Error("turn failed");
      expect(result.value.reply.text).toBe(MUSIC_STARTED_LINE);
      const id = result.value.music?.id;
      expect(id).toBeDefined();
      await waitForMusic(() => getMusicJobFor(people.owner, id!)?.state === "done");
    });
  }
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
  expect(getRegistryKey("generation.music.enabled")?.lives_in).toBe("household.ai_music");
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

const LYRICS = "Here you go.\n\n[Verse]\nYellow moon on the banana tree\nWhistling winds sing back to me\n\n[Chorus]\nBanana skies, banana skies\nSun in every pair of eyes";
const reasked = (r: ChatCompletionRequest) => r.messages.some((m) => m.role === "user" && String(m.content) === SONG_LYRICS_REASK_INSTRUCTION);
test("lyrics written as text for a song request get one re-ask, and the tool call starts the song", async () => {
  const call = { id: "songcall", name: "generate_music", args: JSON.stringify({ description: "a banana song", lyrics: "[Verse]\nYellow moon\n[Chorus]\nBanana skies" }) };
  await withStub({ calls: (r) => r.tool_choice === "none" || isPhrasing(r) ? undefined : reasked(r) ? [call] : undefined, reply: (r) => isPhrasing(r) ? "Your song is on its way." : LYRICS }, async (seen) => {
    const result = await runTurnNext(people.owner, "chat", "write me a song about bananas");
    if (!result.ok) throw new Error("turn failed");
    expect(result.value.music?.id).toBeDefined();
    expect(seen.filter(reasked)).toHaveLength(1);
    expect(result.value.reply.text).not.toContain("[Verse]");
  });
});
test("lyrics that stay text after the re-ask stand as written with the one line on how to start the music", async () => {
  await withStub({ calls: () => undefined, reply: () => LYRICS }, async (seen) => {
    const result = await runTurnNext(people.owner, "chat", "sing me a song about bananas");
    if (!result.ok) throw new Error("turn failed");
    expect(result.value.music).toBeUndefined();
    expect(result.value.reply.text).toContain("[Verse]");
    expect(result.value.reply.text).toContain(SONG_LYRICS_ONLY_NOTE);
    expect(seen.filter(reasked)).toHaveLength(1);
  });
});
test("a plain answer to a song request is untouched, and lyrics for a message that asks for none cause no re-ask", async () => {
  await withStub({ calls: () => undefined, reply: () => "Do you want it quick or a full song?" }, async (seen) => {
    const result = await runTurnNext(people.owner, "chat", "make me a song");
    if (!result.ok) throw new Error("turn failed");
    expect(result.value.reply.text).toBe("Do you want it quick or a full song?");
    expect(seen.filter(reasked)).toHaveLength(0);
  });
  await withStub({ calls: () => undefined, reply: () => LYRICS }, async (seen) => {
    await runTurnNext(people.owner, "chat", "what are the lyrics of a banana song");
    expect(seen.filter(reasked)).toHaveLength(0);
  });
});

test("a failed status read keeps the song tool offered for five minutes, a real answer does not", () => {
  const ready = { at: 1_000, status: readyMusicStatusForTests() };
  expect(settleMusicStatus(null, ready, 1_000 + 60_000)).toBe(ready.status);
  expect(settleMusicStatus(null, ready, 1_000 + 6 * 60_000)).toBeNull();
  expect(settleMusicStatus(null, null, 5)).toBeNull();
  const off = readyMusicStatusForTests({ state: "not-installed", available: false });
  expect(settleMusicStatus(off, ready, 2_000)).toBe(off);
});
