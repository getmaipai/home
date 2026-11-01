// TIER-PRIO-07: live-fit admission runs for real picture and video Boost jobs (a fake Stack over HTTP behind the real job stores), and a job that
// would only fit below its pick asks first: Allow runs it lower, Wait keeps it queued, and no answer turns into Wait after the timeout.
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
import { useDefaultScriptedStack } from "./stackFixture";
import { withStub } from "./turnMachine/toolHarness";
import { getVideoJobFor } from "@/lib/videos/jobs";
import { getPictureJob } from "@/lib/pictures/jobs";
import { __setVideoStatusForTests, readyVideoStatusForTests } from "@/lib/videos/ready";
import { __setPictureStatusForTests, readyStatusForTests } from "@/lib/pictures/ready";
import { __resetAdapterCacheForTests } from "@/lib/pictures/adapters";
import { __resetVideoAdapterCacheForTests } from "@/lib/videos/adapters";
import { requestTier, resetFitAsksForTests, resetFitMemoryForTests, resetTierStateForTests, setBudgetReader, setFitAskTimeoutForTests, releaseHouseholdQueue } from "@/lib/jobs/householdQueue";
import { setProfileSource } from "@/lib/jobs/admissionFit";
import type { ProfileRow } from "@/lib/jobs/profileTable";
import { TestClient } from "./client";
import { phaseLabel } from "@/routes/pictures";
import { jobTier } from "@/lib/tiers";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import type { TurnStreamEvent, TurnValue } from "@/wire";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { installFakeImageStack, until, type FakeImageStack } from "./pictureFixture";
import { db } from "@/db";
import { people as peopleTable } from "@/db/schema";

let video: FakeVideoStack;
let image: FakeImageStack;
const KLEIN = { id: "flux2-klein-4b", family: "flux2", installed: true, licence: "Apache-2.0", loras: true, edit: true, steps_default: 4, peak_gb: 13.5 };
const ZIMAGE = { id: "z-image-turbo", family: "z-image", installed: true, licence: "Apache-2.0", loras: true, edit: false, steps_default: 9, peak_gb: 34 };

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests(); __resetLlmSupervisorForTests(); __resetRateLimiterForTests(); __resetAdapterCacheForTests(); __resetVideoAdapterCacheForTests();
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


const row = (lead: "picture" | "video", tier: "boost" | "standard"): ProfileRow => ({ lead, tier, cells: { chat: { state: "standard" }, [lead]: { state: tier } } });
const hw = { budgetGb: 80, marginGb: 2, peakGb: { picture: { boost: 30, standard: 10 }, video: { boost: 30, standard: 10 } }, residentGb: { chat: { standard: 1 } } };
let freeGb = 60;
function configure(lowerWithoutAsking: Record<string, boolean> = {}) {
  setProfileSource({ table: [row("picture", "boost"), row("picture", "standard"), row("video", "boost"), row("video", "standard")], hw, pins: {}, priorityWeight: {}, lowerWithoutAsking });
  setBudgetReader(async () => ({ freeMemoryBytes: freeGb * 1e9, loaded: [] }));
}
async function signedIn() {
  const client = new TestClient();
  await client.post("/api/auth/setup", { displayName: "Sage", secret: "correcthorse" });
  const actor = db.select().from(peopleTable).where(eq(peopleTable.displayName, "Sage")).get()!;
  return { client, actor };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 120));
afterEach(() => { setProfileSource(null); setBudgetReader(null); setFitAskTimeoutForTests(null); resetFitAsksForTests(); resetFitMemoryForTests(); resetTierStateForTests(); });

describe("live-fit runs for picture and video Boost jobs", () => {
  test("a Boost picture that fits is fitted (the profile is saved on the job) and reaches the Stack", async () => {
    freeGb = 60; configure();
    const { actor } = await signedIn();
    const value = await turn(actor, "generate_image", { tier: "boost" });
    const job = getPictureJob(actor, value.picture!.id)!;
    await until(() => image.submitted.length === 1);
    expect((job.request as { profile?: unknown }).profile).toEqual({ lowered: 0, queued: 0, off: 0, closed_apps: 0, closed_bytes: 0 });
  });
  test("a Standard video is never fitted", async () => {
    freeGb = 60; configure();
    const { actor } = await signedIn();
    const plain = await turn(actor, "generate_video", {});
    await until(() => video.submitted.length === 1);
    expect((getVideoJobFor(actor, plain.video!.id)!.request as { profile?: unknown }).profile).toBeUndefined();
  });
  test("a Boost video that fits is fitted and reaches the Stack", async () => {
    freeGb = 60; configure();
    const { actor } = await signedIn();
    const boosted = await turn(actor, "generate_video", { tier: "boost" });
    await until(() => video.submitted.length === 1);
    expect((getVideoJobFor(actor, boosted.video!.id)!.request as { profile?: unknown }).profile).toBeDefined();
  });
  test("a Boost picture that does not fit even lowered waits and never reaches the Stack", async () => {
    freeGb = 5; configure();
    const { actor } = await signedIn();
    await turn(actor, "generate_image", { tier: "boost" });
    await settle();
    expect(image.submitted.length).toBe(0);
  });
});

describe("a job that would fall below its pick asks, and the answer is wired", () => {
  test("the card asks, Allow runs it lower and the Stack gets it", async () => {
    freeGb = 20; configure();
    const { client, actor } = await signedIn();
    const value = await turn(actor, "generate_image", { tier: "boost" });
    const job = getPictureJob(actor, value.picture!.id)!;
    await settle();
    expect(image.submitted.length).toBe(0);
    expect(phaseLabel(job)).toContain("Wait for Boost instead?");
    const answered = await client.post(`/api/ai/jobs/${job.id}/fit-answer`, { answer: "allow" });
    expect(answered.status).toBe(200);
    expect(await answered.json()).toEqual({ answered: true });
    await until(() => image.submitted.length === 1);
    expect(await (await client.post(`/api/ai/jobs/${job.id}/fit-answer`, { answer: "allow" })).json()).toEqual({ answered: false });
  });
  test("Wait keeps it queued, and it starts at the tier picked once there is room", async () => {
    freeGb = 20; configure();
    const { client, actor } = await signedIn();
    const value = await turn(actor, "generate_image", { tier: "boost" });
    const job = getPictureJob(actor, value.picture!.id)!;
    await settle();
    expect(await (await client.post(`/api/ai/jobs/${job.id}/fit-answer`, { answer: "wait" })).json()).toEqual({ answered: true });
    await settle();
    expect(image.submitted.length).toBe(0);
    expect(phaseLabel(job)).toBe("Waiting for room for a bigger job.");
    freeGb = 60; await releaseHouseholdQueue();
    await until(() => image.submitted.length === 1);
  });
  test("no answer turns into Wait after the timeout, so the job is not stuck on a question", async () => {
    freeGb = 20; configure(); setFitAskTimeoutForTests(150);
    const { actor } = await signedIn();
    const value = await turn(actor, "generate_image", { tier: "boost" });
    const job = getPictureJob(actor, value.picture!.id)!;
    await settle();
    expect(phaseLabel(job)).toContain("Wait for Boost instead?");
    await until(() => phaseLabel(job) === "Waiting for room for a bigger job.", 4_000);
    expect(image.submitted.length).toBe(0);
  });
  test("a person who did not make the job cannot answer it, and 'lower without asking' skips the question", async () => {
    freeGb = 20; configure();
    const { client, actor } = await signedIn();
    const other = new TestClient();
    const value = await turn(actor, "generate_image", { tier: "boost" });
    const job = getPictureJob(actor, value.picture!.id)!;
    await settle();
    expect((await other.post(`/api/ai/jobs/${job.id}/fit-answer`, { answer: "allow" })).status).toBe(401);
    expect(image.submitted.length).toBe(0);
    await client.post(`/api/ai/jobs/${job.id}/fit-answer`, { answer: "wait" });
    resetFitAsksForTests(); resetFitMemoryForTests(); configure({ picture: true });
    await releaseHouseholdQueue();
    await until(() => image.submitted.length === 1);
  });
});
