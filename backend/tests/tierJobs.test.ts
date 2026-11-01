// TIER-WIRE-01: a video or picture job carries the tier the person was allowed, so the household queue sees Boost and Max jobs.
// Rule 0 and rule 8 still decide first: a teen's or a child's request stays Standard whatever the model asked.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
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
import { getPictureJob } from "@/lib/pictures/jobs";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { __setPictureStatusForTests, readyStatusForTests } from "@/lib/pictures/ready";
import { __resetAdapterCacheForTests } from "@/lib/pictures/adapters";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { requestTier } from "@/lib/jobs/householdQueue";
import { jobTier } from "@/lib/tiers";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import type { TurnStreamEvent, TurnValue } from "@/wire";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { installFakeImageStack, until, type FakeImageStack } from "./pictureFixture";
import { db } from "@/db";
import { people as peopleTable } from "@/db/schema";

let people: BenchPeople;
let video: FakeVideoStack;
let image: FakeImageStack;
const KLEIN = { id: "flux2-klein-4b", family: "flux2", installed: true, licence: "Apache-2.0", loras: true, edit: true, steps_default: 4, peak_gb: 13.5 };
const ZIMAGE = { id: "z-image-turbo", family: "z-image", installed: true, licence: "Apache-2.0", loras: true, edit: false, steps_default: 9, peak_gb: 34 };

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests(); __resetLlmSupervisorForTests(); __resetRateLimiterForTests(); __resetAdapterCacheForTests(); __resetVideoAdapterCacheForTests();
  people = createBenchPeople();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
  video = installFakeVideoStack();
  video.detailed = "installed";
  __setVideoStatusForTests(readyVideoStatusForTests({ detailed: "installed" }));
  image = installFakeImageStack();
  __setPictureStatusForTests(readyStatusForTests({ models: [KLEIN, ZIMAGE] }));
});
afterEach(() => {
  video.restore(); image.restore();
  __resetLlmSupervisorForTests(); __resetPortOwnershipForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

const isPhrasing = (request: ChatCompletionRequest) => request.messages.some((m) => m.role === "tool");
async function turn(actor: typeof people.owner, tool: string, args: Record<string, unknown>): Promise<TurnValue> {
  const call = { id: "call-t", name: tool, args: JSON.stringify({ prompt: "a paper boat floating down a rainy street, soft light", ...args }) };
  let value: TurnValue | undefined;
  await withStub({ calls: (request: ChatCompletionRequest) => (request.tool_choice === "none" || isPhrasing(request) ? undefined : [call]), reply: () => "On its way." }, async () => {
    const result = await runTurnNextStream(actor, "chat", "make one", {} as never);
    if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
    const events: TurnStreamEvent[] = [];
    for await (const event of streamTurnEvents(result, actor.id)) events.push(event as TurnStreamEvent);
    value = (events.find((e) => e.type === "done") as { value: TurnValue }).value;
  });
  return value!;
}
function asRole(id: string, role: "teen" | "child") {
  db.update(peopleTable).set({ role }).where(eq(peopleTable.id, id)).run();
  return db.select().from(peopleTable).where(eq(peopleTable.id, id)).get()!;
}

describe("jobTier", () => {
  test("keeps Boost only for a Detailed result and drops Max to Boost without a Max model", () => {
    expect(jobTier("video", "boost", "detailed")).toBe("boost");
    expect(jobTier("video", "boost", "quick")).toBe("standard");
    expect(jobTier("video", undefined, "detailed")).toBe("standard");
    expect(jobTier("video", "max", "detailed")).toBe("boost");
  });
});

describe("video jobs carry their tier", () => {
  test("an adult's Boost video is queued at boost", async () => {
    const value = await turn(people.owner, "generate_video", { tier: "boost" });
    const job = getVideoJobFor(people.owner, value.video!.id)!;
    expect(job.request.tier).toBe("boost");
    expect(requestTier(job.request)).toBe("boost");
  });
  test("a request with no tier stays standard", async () => {
    const value = await turn(people.owner, "generate_video", {});
    expect(requestTier(getVideoJobFor(people.owner, value.video!.id)!.request)).toBe("standard");
  });
  test("a teen's Boost request stays standard", async () => {
    const teen = asRole(people.child.id, "teen");
    const value = await turn(teen, "generate_video", { tier: "boost" });
    expect(requestTier(getVideoJobFor(teen, value.video!.id)!.request)).toBe("standard");
  });
  test("a child's Boost request stays standard", async () => {
    const kid = asRole(people.child.id, "child");
    const value = await turn(kid, "generate_video", { tier: "boost" });
    expect(requestTier(getVideoJobFor(kid, value.video!.id)!.request)).toBe("standard");
  });
});

describe("picture jobs carry their tier", () => {
  test("an adult's Boost picture is queued at boost, a plain one at standard", async () => {
    const boosted = await turn(people.owner, "generate_image", { tier: "boost" });
    expect(requestTier(getPictureJob(people.owner, boosted.picture!.id)!.request)).toBe("boost");
    await until(() => getPictureJob(people.owner, boosted.picture!.id)?.state === "done");
    const plain = await turn(people.owner, "generate_image", {});
    expect(requestTier(getPictureJob(people.owner, plain.picture!.id)!.request)).toBe("standard");
  });
  test("a child's Boost request stays standard", async () => {
    const kid = asRole(people.child.id, "child");
    const value = await turn(kid, "generate_image", { tier: "boost" });
    expect(requestTier(getPictureJob(kid, value.picture!.id)!.request)).toBe("standard");
  });
});
