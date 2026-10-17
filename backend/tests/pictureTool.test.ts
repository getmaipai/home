// IMGGEN-HOME-01 on the live turn path (rules 0, 1, 6, 9; docs/design/image-generation-2026-10-17.md): the picture tool
// is offered only where a picture may be made, the call starts one Stack job and answers at once, the finished picture is
// the person's own file, and a failed job never fails the answer.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { resetDb } from "./reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { setHouseholdSettingValue } from "@/lib/settings";
import { runTurnNext, runTurnNextStream } from "@/lib/turnMachine/turnNext";
import { streamTurnEvents } from "@/routes/turn";
import { listConversationTurns } from "@/lib/conversationHistory";
import { createBenchPeople, type BenchPeople } from "../scripts/bench/conversationRunner";
import { useDefaultScriptedStack } from "./stackFixture";
import { withStub } from "./turnMachine/toolHarness";
import { db } from "@/db";
import { attachments, people as peopleTable } from "@/db/schema";
import { cancelPictureJob, getPictureJob, startPictureJob } from "@/lib/pictures/jobs";
import { deleteAttachmentsForTurns } from "@/lib/attachments";
import { pictureJobs } from "@/db/schema";
import { saveJob, type PictureJob } from "@/lib/pictures/jobStore";
import { cardView } from "@/routes/pictures";
import { __setPictureStatusForTests } from "@/lib/pictures/ready";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import type { TurnStreamEvent, TurnValue } from "@/wire";
import { installFakeImageStack, until, type FakeImageStack } from "./pictureFixture";

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

const toolNames = (request: ChatCompletionRequest | undefined) => (request?.tools ?? []).map((t) => (t as { function: { name: string } }).function.name);
const isPhrasing = (request: ChatCompletionRequest) => request.messages.some((m) => m.role === "tool");
const FOX = { id: "call-pic", name: "generate_image", args: JSON.stringify({ prompt: "a red fox in the snow, soft morning light" }) };

function script(call: typeof FOX | undefined, reply = "On its way.") {
  return {
    calls: (request: ChatCompletionRequest) => (!call || request.tool_choice === "none" || isPhrasing(request) ? undefined : [call]),
    reply: () => reply,
  };
}

async function streamValue(actor: typeof people.owner, text: string, surface: "chat" | "overlay" | "tv" = "chat", opts: Record<string, unknown> = {}): Promise<{ events: TurnStreamEvent[]; value: TurnValue }> {
  const result = await runTurnNextStream(actor, surface, text, opts as never);
  if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
  const events: TurnStreamEvent[] = [];
  for await (const event of streamTurnEvents(result, actor.id)) events.push(event as TurnStreamEvent);
  const done = events.find((e) => e.type === "done") as { value: TurnValue } | undefined;
  if (!done) throw new Error("no done event");
  return { events, value: done.value };
}

function asRole(id: string, role: "teen" | "guest" | "adult") {
  db.update(peopleTable).set({ role }).where(eq(peopleTable.id, id)).run();
  return db.select().from(peopleTable).where(eq(peopleTable.id, id)).get()!;
}

async function toolsSeen(run: () => Promise<unknown>): Promise<string[]> {
  let names: string[] = [];
  await withStub({ calls: () => undefined, reply: () => "Fine." }, async (seen) => {
    await run();
    names = toolNames(seen.find((r) => (r.tools?.length ?? 0) > 0));
  });
  return names;
}

describe("IMGGEN-HOME-01: where generate_image is offered (rule 0)", () => {
  test("an adult's written chat turn is offered it when the engine has a picture model", async () => {
    expect(await toolsSeen(() => runTurnNext(people.owner, "chat", "hello there"))).toContain("generate_image");
  });

  test("not offered when the Stack has no picture model", async () => {
    __setPictureStatusForTests(null);
    expect(await toolsSeen(() => runTurnNext(people.owner, "chat", "hello there"))).not.toContain("generate_image");
  });

  test("not offered on a spoken turn, a glance surface or a TV", async () => {
    expect(await toolsSeen(() => runTurnNext(people.owner, "chat", "hello", { spoken: true }))).not.toContain("generate_image");
    expect(await toolsSeen(() => runTurnNext(people.owner, "overlay", "hello"))).not.toContain("generate_image");
    expect(await toolsSeen(() => runTurnNext(people.owner, "tv", "hello"))).not.toContain("generate_image");
  });

  test("never offered to a child, a teen or a guest", async () => {
    expect(await toolsSeen(() => runTurnNext(people.child, "chat", "hello"))).not.toContain("generate_image");
    const teen = asRole(people.child.id, "teen");
    expect(await toolsSeen(() => runTurnNext(teen, "chat", "hello"))).not.toContain("generate_image");
    const guest = asRole(people.child.id, "guest");
    expect(await toolsSeen(() => runTurnNext(guest, "chat", "hello"))).not.toContain("generate_image");
  });

  test("not offered when an admin switched pictures off for adults", async () => {
    setHouseholdSettingValue("generation.adults", false);
    expect(await toolsSeen(() => runTurnNext(people.owner, "chat", "hello"))).not.toContain("generate_image");
  });
});

describe("IMGGEN-HOME-01: the call, the job and the stored picture", () => {
  test("a request starts one Stack job at once; the done value names it; the finished picture is the person's file; history carries it", async () => {
    await withStub(script(FOX), async (seen) => {
      const { value } = await streamValue(people.owner, "make me a picture of a red fox in the snow");
      // One job, submitted for an id at once (timeout_ms 1), with the model's description and the defaults.
      expect(fake.submitted).toHaveLength(1);
      const sent = fake.submitted[0]!;
      expect(sent.prompt).toBe("a red fox in the snow, soft morning light");
      expect(sent.timeout_ms).toBe(1);
      expect(sent.size).toBe("1024x1024");
      expect(sent.n).toBe(1);
      expect(sent.audience).toBe("adult");
      expect(value.picture?.id).toMatch(/^pic-/);
      // The model's tool result says the picture is on its way and never describes it.
      const tool = seen.find(isPhrasing)!.messages.find((m) => m.role === "tool")!.content!.toString();
      expect(tool).toContain("on its way");
      expect(tool).toContain("do not describe how it looks");
      // The job finishes and stores the picture as the person's own file.
      await until(() => getPictureJob(people.owner, value.picture!.id)?.state === "done");
      const job = getPictureJob(people.owner, value.picture!.id)!;
      expect(job.files).toHaveLength(1);
      const row = db.select().from(attachments).where(eq(attachments.id, job.files[0]!.id)).get()!;
      expect(row.ownerPersonId).toBe(people.owner.id);
      expect(row.mediaType).toBe("image/png");
      expect(row.provenance.startsWith("picture-gen:")).toBe(true);
      expect(row.provenance).not.toContain("fox");
      // The Stack's copy is deleted once Home stored it.
      await until(() => fake.jobs[0]!.deleted);
      // The card the chat draws.
      const card = cardView(people.owner, job, true);
      expect(card.state).toBe("done");
      expect(card.files[0]!.url).toContain("/api/image-edit/pictures/");
      expect(card.files[0]!.alt).toContain("red fox");
      // A reload of the thread carries the same job id.
      const turns = listConversationTurns(people.owner, value.conversation_id);
      expect(turns.ok && turns.value.some((t) => t.picture?.id === value.picture!.id)).toBe(true);
    });
  });

  test("size and count map to the Stack's shapes", async () => {
    const call = { id: "c", name: "generate_image", args: JSON.stringify({ prompt: "a tall poster of a lighthouse", size: "tall", count: 3 }) };
    await withStub(script(call), async () => {
      await streamValue(people.owner, "three tall poster ideas of a lighthouse");
      expect(fake.submitted[0]!.size).toBe("768x1344");
      expect(fake.submitted[0]!.n).toBe(3);
    });
  });

  test("a style the person named is matched in the library, with its trigger word added by Home", async () => {
    const call = { id: "c", name: "generate_image", args: JSON.stringify({ prompt: "a castle on a hill", style: "my pixel style" }) };
    await withStub(script(call), async () => {
      await streamValue(people.owner, "a castle on a hill in my pixel style");
      const sent = fake.submitted[0]!;
      expect(sent.prompt).toBe("a castle on a hill, pixelart");
      expect(sent.loras).toEqual([{ id: "lora-aaaaaaaaaaaaaaaa", scale: 0.8 }]);
    });
  });

  test("a style that is not in the library is dropped and the model is told to say so", async () => {
    const call = { id: "c", name: "generate_image", args: JSON.stringify({ prompt: "a castle", style: "watercolor dreams" }) };
    await withStub(script(call), async (seen) => {
      await streamValue(people.owner, "a castle in watercolor dreams");
      expect(fake.submitted[0]!.loras).toBeUndefined();
      expect(seen.find(isPhrasing)!.messages.find((m) => m.role === "tool")!.content!.toString()).toContain("not in the library");
    });
  });

  test("a failed job never fails the answer: the reply stands and the card holds the honest line", async () => {
    fake.failWith = { code: "failed", error: "The picture model ran out of memory." };
    await withStub(script(FOX, "I started it for you."), async () => {
      const { value } = await streamValue(people.owner, "make me a picture of a red fox");
      expect(value.reply.text).toBe("I started it for you.");
      await until(() => getPictureJob(people.owner, value.picture!.id)?.state === "failed");
      const job = getPictureJob(people.owner, value.picture!.id)!;
      expect(job.error).toBe("I couldn't make that picture. The picture model ran out of memory. Try again or change the request.");
      expect(cardView(people.owner, job, true).files).toHaveLength(0);
    });
  });

  test("a Stack that refuses the submit is a failed tool, not a failed answer (rule 6)", async () => {
    fake.refuseSubmit = { status: 429, code: "queue_full", error: "The queue is full." };
    await withStub({ calls: (r) => (isPhrasing(r) || r.tool_choice === "none" ? undefined : [FOX]), reply: () => "I couldn't start that one just now; try again in a minute." }, async () => {
      const { value } = await streamValue(people.owner, "make me a picture of a red fox");
      expect(value.reply.text).toContain("couldn't start");
      expect(value.picture).toBeUndefined();
    });
  });

  test("a temporary chat keeps the job and the picture in memory: no job row, no file row", async () => {
    await withStub(script(FOX), async () => {
      const { value } = await streamValue(people.owner, "make me a picture of a red fox", "chat", { temporary: true });
      expect(value.picture?.id).toMatch(/^pic-/);
      await until(() => getPictureJob(people.owner, value.picture!.id)?.state === "done");
      expect(db.select().from(attachments).all()).toHaveLength(0);
      expect(getPictureJob(people.owner, value.picture!.id)!.files).toHaveLength(1);
    });
  });
});

describe("IMGGEN-HOME-01: jobs that are stopped, forgotten or broken", () => {
  test("Stop is not overwritten by a poll or the finish that was already in flight", async () => {
    fake.pollsToFinish = 3;
    const conv = (await import("@/lib/conversationHistory")).resolveOrCreateConversation(people.owner, "chat", undefined, {});
    if (!conv.ok) throw new Error("no conversation");
    const job = await startPictureJob({ actor: people.owner, conversationId: conv.value.id, turnId: null, temporary: true, kind: "generate", prompt: "a red fox", body: { prompt: "a red fox", n: 1, audience: "adult" } });
    const stopped = await cancelPictureJob(people.owner, job.id);
    expect(stopped?.state).toBe("cancelled");
    await new Promise((r) => setTimeout(r, 250));
    expect(getPictureJob(people.owner, job.id)?.state).toBe("cancelled");
    expect(fake.jobs[0]!.deleted).toBe(true);
  });

  test("forgetting a turn removes its picture job and the prompt with it", async () => {
    await withStub(script(FOX), async () => {
      const { value } = await streamValue(people.owner, "make me a picture of a red fox");
      await until(() => getPictureJob(people.owner, value.picture!.id)?.state === "done");
      const row = db.select().from(pictureJobs).where(eq(pictureJobs.id, value.picture!.id)).get()!;
      expect(row.prompt).toContain("red fox");
      deleteAttachmentsForTurns([row.turnId!]);
      expect(db.select().from(pictureJobs).where(eq(pictureJobs.id, value.picture!.id)).get()).toBeUndefined();
      expect(getPictureJob(people.owner, value.picture!.id)).toBeNull();
    });
  });

  test("a second picture on a card that is still being made is refused, not started", async () => {
    fake.pollsToFinish = 50;
    await withStub(script(FOX), async () => {
      const { value } = await streamValue(people.owner, "make me a picture of a red fox");
      const first = getPictureJob(people.owner, value.picture!.id)!;
      await expect(startPictureJob({ actor: people.owner, conversationId: first.conversationId, turnId: first.turnId, temporary: false, kind: "variation", prompt: "a red fox", body: { prompt: "a red fox", n: 1, audience: "adult" } })).rejects.toMatchObject({ code: "busy" });
      expect(fake.submitted).toHaveLength(1);
      await cancelPictureJob(people.owner, first.id);
    });
  });

  test("only changes are written: a save of the same state writes no row and bumps no hlc", () => {
    const job: PictureJob = { id: "pic-unit000001", personId: people.owner.id, conversationId: null, turnId: null, kind: "generate", state: "running", stackJob: "job-x", percent: 10, phase: "rendering", position: null, prompt: "a red fox", request: { size: "1024x1024", n: 1, seed: null, loras: [], source_file_id: null, audience: "adult" }, error: null, files: [], temporary: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    saveJob(job);
    const first = db.select().from(pictureJobs).where(eq(pictureJobs.id, job.id)).get()!;
    saveJob(job);
    expect(db.select().from(pictureJobs).where(eq(pictureJobs.id, job.id)).get()!.hlc).toBe(first.hlc);
    job.percent = 40;
    saveJob(job);
    expect(db.select().from(pictureJobs).where(eq(pictureJobs.id, job.id)).get()!.hlc).not.toBe(first.hlc);
  });
});

describe("what the tool says it is for", () => {
  test("the tool says it also changes a picture the person already has, through `change`, and keeps the model from describing a result it has not seen (a model once called it for 'remove the background' and claimed the edit)", async () => {
    const manifest = JSON.parse(await Bun.file(new URL("../packages/generate_image/manifest.json", import.meta.url)).text()) as { args: { properties: Record<string, { description: string; enum?: string[] }> } };
    expect(manifest.args.properties.change!.description).toContain("already have changed");
    expect(manifest.args.properties.kind!.enum).toEqual(["remove_people", "remove_background", "upscale", "change"]);
    expect(manifest.args.properties.prompt!.description).toContain("never describe a picture you did not make");
  });
});
