import { JOB_QUEUE_COPY } from "@/lib/jobQueueCopy";
// VIDEO-GEN-05 on the live turn path (rules 0, 1, 6, 9; docs/design/video-generation-2026-10-17.md): the video tool
// is offered only where a video may be made, the call starts one Stack job and answers at once, the finished clip and
// its poster are the person's own files, a picture reference is sent unchanged and only when the Stack made it, and
// a failed job never fails the answer.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import sharp from "sharp";
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
import { createAttachment } from "@/lib/attachments";
import { getVideoJobFor, readVideoFile } from "@/lib/videos/jobs";
import { videoCardView } from "@/routes/videos";
import { __setVideoStatusForTests } from "@/lib/videos/ready";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import type { TurnStreamEvent, TurnValue } from "@/wire";
import { installFakeVideoStack, type FakeVideoStack } from "./videoFixture";
import { until } from "./pictureFixture";

let people: BenchPeople;
let fake: FakeVideoStack;

beforeEach(() => {
  resetDb();
  useDefaultScriptedStack();
  __resetThrottleForTests();
  __resetLlmSupervisorForTests();
  __resetRateLimiterForTests();
  people = createBenchPeople();
  setHouseholdSettingValue("chat.model_id", "qwen3-8b-instruct-q4-k-m");
  fake = installFakeVideoStack();
});
afterEach(() => {
  fake.restore();
  __resetLlmSupervisorForTests();
  __resetPortOwnershipForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

const toolNames = (request: ChatCompletionRequest | undefined) => (request?.tools ?? []).map((t) => (t as { function: { name: string } }).function.name);
const isPhrasing = (request: ChatCompletionRequest) => request.messages.some((m) => m.role === "tool");
const BOAT = { id: "call-vid", name: "generate_video", args: JSON.stringify({ prompt: "a paper boat floating down a rainy street, soft light" }) };

function script(call: { id: string; name: string; args: string } | undefined, reply = "On its way.") {
  return { calls: (request: ChatCompletionRequest) => (!call || request.tool_choice === "none" || isPhrasing(request) ? undefined : [call]), reply: () => reply };
}

async function streamValue(actor: typeof people.owner, text: string, opts: Record<string, unknown> = {}): Promise<{ events: TurnStreamEvent[]; value: TurnValue }> {
  const result = await runTurnNextStream(actor, "chat", text, opts as never);
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

describe("VIDEO-GEN-05: where generate_video is offered (rule 0)", () => {
  test("an adult's written chat turn is offered it when the engine has a video model", async () => {
    expect(await toolsSeen(() => runTurnNext(people.owner, "chat", "hello there"))).toContain("generate_video");
  });
  test("not offered when the Stack has no video model or this tier cannot run video", async () => {
    __setVideoStatusForTests(null);
    expect(await toolsSeen(() => runTurnNext(people.owner, "chat", "hello there"))).not.toContain("generate_video");
    __setVideoStatusForTests({ state: "off", phase: null, available: false, code: "not_available_on_this_computer", reason: "Video needs a computer with 128 GB of memory; this one has 64 GB.", tier: "p64", limits: {}, loras_supported: false, lora_count: 0, audio: false });
    expect(await toolsSeen(() => runTurnNext(people.owner, "chat", "hello there"))).not.toContain("generate_video");
  });
  test("not offered on a spoken turn, a glance surface or a TV", async () => {
    expect(await toolsSeen(() => runTurnNext(people.owner, "chat", "hello", { spoken: true }))).not.toContain("generate_video");
    expect(await toolsSeen(() => runTurnNext(people.owner, "overlay", "hello"))).not.toContain("generate_video");
    expect(await toolsSeen(() => runTurnNext(people.owner, "tv", "hello"))).not.toContain("generate_video");
  });
  test("not offered to a guest or to a child while the home switch is off; offered to a teen and to a child (cartoon lane) on their own screen", async () => {
    expect(await toolsSeen(() => runTurnNext(people.child, "chat", "hello"))).toContain("generate_video");
    setHouseholdSettingValue("generation.kids", false);
    expect(await toolsSeen(() => runTurnNext(people.child, "chat", "hello"))).not.toContain("generate_video");
    setHouseholdSettingValue("generation.kids", true);
    const teen = asRole(people.child.id, "teen");
    expect(await toolsSeen(() => runTurnNext(teen, "chat", "hello"))).toContain("generate_video");
    const guest = asRole(people.child.id, "guest");
    expect(await toolsSeen(() => runTurnNext(guest, "chat", "hello"))).not.toContain("generate_video");
  });
  test("not offered when an admin switched video off for adults", async () => {
    setHouseholdSettingValue("generation.video.enabled", false);
    expect(await toolsSeen(() => runTurnNext(people.owner, "chat", "hello"))).not.toContain("generate_video");
  });
});

describe("VIDEO-GEN-05: the call, the job and the stored clip", () => {
  test("a request starts one Stack job at once; the done value names it; the finished clip and poster are the person's files; history carries it", async () => {
    await withStub(script(BOAT), async (seen) => {
      const { value } = await streamValue(people.owner, "make a short video of a paper boat in the rain");
      expect(fake.submitted).toHaveLength(1);
      const sent = fake.submitted[0]!;
      expect(sent.prompt).toBe("a paper boat floating down a rainy street, soft light");
      expect(sent.timeout_ms).toBe(1);
      expect(sent.size).toBe("832x480");
      expect(sent.seconds).toBe(5);
      expect(sent.audience).toBe("adult");
      expect(sent.image).toBeUndefined();
      expect(value.video?.id).toMatch(/^vid-/);
      const tool = seen.find(isPhrasing)!.messages.find((m) => m.role === "tool")!.content!.toString();
      expect(tool).toContain("about two minutes");
      expect(tool).toContain("do not describe how it looks");
      await until(() => getVideoJobFor(people.owner, value.video!.id)?.state === "done");
      const job = getVideoJobFor(people.owner, value.video!.id)!;
      expect(job.files).toHaveLength(1);
      const clip = db.select().from(attachments).where(eq(attachments.id, job.files[0]!.id)).get()!;
      const poster = db.select().from(attachments).where(eq(attachments.id, job.files[0]!.poster_id)).get()!;
      expect(clip.ownerPersonId).toBe(people.owner.id);
      expect(clip.mediaType).toBe("video/mp4");
      expect(clip.retention).toBe("conversation");
      expect(poster.retention).toBe("conversation");
      expect(clip.provenance.startsWith("video-gen:")).toBe(true);
      expect(clip.provenance).not.toContain("paper boat");
      expect(poster.mediaType).toBe("image/jpeg");
      expect(poster.provenance.startsWith("video-poster:")).toBe(true);
      await until(() => fake.jobs[0]!.deleted);
      const card = videoCardView(people.owner, job, true);
      expect(card.items[0]!.state).toBe("done");
      expect(card.items[0]!.clip!.url).toContain("/api/videos/jobs/");
      expect(card.can_make_another).toBe(true);
      const turns = listConversationTurns(people.owner, value.conversation_id);
      expect(turns.ok && turns.value.some((t) => t.video?.id === value.video!.id)).toBe(true);
    });
  });

  test("the card shows the busy line while the Stack makes another picture or video, with the place in line", async () => {
    // Held in the queue until read: with one queued poll a fast poller could pass the phase between checks (issue 245).
    fake.queuedPolls = Number.POSITIVE_INFINITY;
    fake.pollsToFinish = Number.POSITIVE_INFINITY;
    await withStub(script(BOAT), async () => {
      const { value } = await streamValue(people.owner, "make a short video of a paper boat in the rain");
      await until(() => getVideoJobFor(people.owner, value.video!.id)?.phase === "waiting for memory");
      const card = videoCardView(people.owner, getVideoJobFor(people.owner, value.video!.id)!, true);
      // A job the Stack holds for memory says so (and never "You are next", which read as a line of other people when nothing was ahead); no place in line is shown.
      expect(card.items[0]!.label).toBe(JOB_QUEUE_COPY.memory_elsewhere.adult);
      expect(card.items[0]!.label).not.toContain("in line");
      fake.queuedPolls = 1;
      fake.pollsToFinish = 3;
      await until(() => getVideoJobFor(people.owner, value.video!.id)?.state === "done");
    });
  });

  test("orientation, seconds and a named style map to the Stack's shapes, with the trigger words added by Home", async () => {
    const call = { id: "c", name: "generate_video", args: JSON.stringify({ prompt: "a street fair", orientation: "portrait", seconds: 3, style: "old colour film" }) };
    await withStub(script(call), async () => {
      await streamValue(people.owner, "a phone-shaped 3 second clip of a street fair in old colour film");
      const sent = fake.submitted[0]!;
      expect(sent.size).toBe("480x832");
      expect(sent.seconds).toBe(3);
      expect(sent.prompt).toBe("a street fair, HST style");
      expect(sent.loras).toEqual([{ id: "lora-1111111111111111", strength: 1 }]);
    });
  });

  test("a style that is not in the library is dropped and the model is told to say so", async () => {
    const call = { id: "c", name: "generate_video", args: JSON.stringify({ prompt: "a castle", style: "watercolor dreams" }) };
    await withStub(script(call), async (seen) => {
      await streamValue(people.owner, "a castle clip in watercolor dreams");
      expect(fake.submitted[0]!.loras).toBeUndefined();
      expect(seen.find(isPhrasing)!.messages.find((m) => m.role === "tool")!.content!.toString()).toContain("not in the library");
    });
  });

  test("a clip cancelled by the memory watchdog is retried twice, then fails with the memory line", async () => {
    fake.pausedForMemory = true;
    await withStub(script(BOAT, "I started it for you."), async () => {
      const { value } = await streamValue(people.owner, "make a short video of a paper boat");
      expect(value.reply.text).toBe("I started it for you.");
      const createdAt = getVideoJobFor(people.owner, value.video!.id)!.createdAt;
      await until(() => getVideoJobFor(people.owner, value.video!.id)?.state === "failed");
      expect(fake.submitted).toHaveLength(3);
      expect(getVideoJobFor(people.owner, value.video!.id)!.createdAt).toBe(createdAt);
      expect(getVideoJobFor(people.owner, value.video!.id)!.error).toContain("The computer ran low on memory, so the job stopped. Try again when there is room.");
    });
  });

  test("a failed job never fails the answer: the reply stands and the card holds the honest line", async () => {
    fake.failWith = { code: "failed", error: "The video model stopped. Try again." };
    await withStub(script(BOAT, "I started it for you."), async () => {
      const { value } = await streamValue(people.owner, "make a short video of a paper boat");
      expect(value.reply.text).toBe("I started it for you.");
      await until(() => getVideoJobFor(people.owner, value.video!.id)?.state === "failed");
      const job = getVideoJobFor(people.owner, value.video!.id)!;
      expect(job.error).toBe("I couldn't make that video. The video model stopped. Try again. Try again or change the request.");
      expect(videoCardView(people.owner, job, true).items[0]!.clip).toBeNull();
    });
  });

  test("a Stack refusal is stored on the queued card after Home submits it (rule 6)", async () => {
    fake.refuseSubmit = { status: 503, code: "no_memory", error: "Not enough free memory for video right now." };
    await withStub({ calls: (r) => (isPhrasing(r) || r.tool_choice === "none" ? undefined : [BOAT]), reply: () => "I couldn't start that one just now; try again in a few minutes." }, async () => {
      const { value } = await streamValue(people.owner, "make a short video of a paper boat");
      expect(value.video).toBeDefined();
      await until(() => getVideoJobFor(people.owner, value.video!.id)?.state === "failed");
      expect(getVideoJobFor(people.owner, value.video!.id)?.error).toContain("low on memory");
    });
  });

  test("a temporary chat keeps the job and the clip in memory: no job row, no file row, and the owner can still read it", async () => {
    await withStub(script(BOAT), async () => {
      const { value } = await streamValue(people.owner, "make a short video of a paper boat", { temporary: true });
      expect(value.video?.id).toMatch(/^vid-/);
      await until(() => getVideoJobFor(people.owner, value.video!.id)?.state === "done");
      expect(db.select().from(attachments).all()).toHaveLength(0);
      const job = getVideoJobFor(people.owner, value.video!.id)!;
      const clip = readVideoFile(people.owner, job, job.files[0]!.id);
      expect(clip?.mediaType).toBe("video/mp4");
      expect(readVideoFile(people.child, job, job.files[0]!.id)).toBeNull();
    });
  });
});

describe("VIDEO-GEN-05: animating a picture the Stack made", () => {
  async function conversationWithPicture(provenance: string, bytes?: Uint8Array): Promise<{ conversationId: string; pictureId: string; png: Uint8Array }> {
    let conversationId = "";
    let turnId = "";
    await withStub(script(undefined, "Hi."), async () => {
      const { value } = await streamValue(people.owner, "hello");
      conversationId = value.conversation_id;
      turnId = value.turn_id;
    });
    const png = bytes ?? new Uint8Array(await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 10, g: 120, b: 200 } } }).png().toBuffer());
    const made = createAttachment(people.owner, { conversationId, turnId, mediaType: "image/png", bytes: png, provenance, deduplicate: false });
    if (!made.ok) throw new Error("attachment");
    return { conversationId, pictureId: made.value.id, png };
  }

  test("'latest' sends the stored bytes unchanged with image_source generated", async () => {
    const { conversationId, png } = await conversationWithPicture(`picture-gen:${JSON.stringify({ v: 1, width: 64, height: 64 })}`);
    const call = { id: "c", name: "generate_video", args: JSON.stringify({ prompt: "the fox turns its head", from_picture: "latest" }) };
    await withStub(script(call), async () => {
      const { value } = await streamValue(people.owner, "animate that picture", { conversationId });
      expect(value.video?.id).toMatch(/^vid-/);
      const sent = fake.submitted[0]!;
      expect(sent.image_source).toBe("generated");
      expect(Buffer.from(sent.image as string, "base64").equals(Buffer.from(png))).toBe(true);
      expect(getVideoJobFor(people.owner, value.video!.id)!.kind).toBe("animate");
    });
  });

  test("an uploaded picture (or any file the Stack did not make) is refused before the Stack is asked", async () => {
    const { conversationId, pictureId } = await conversationWithPicture("composer:upload");
    const call = { id: "c", name: "generate_video", args: JSON.stringify({ prompt: "make my photo move", from_picture: pictureId }) };
    await withStub(script(call), async (seen) => {
      const { value } = await streamValue(people.owner, "animate my photo", { conversationId });
      expect(value.video).toBeUndefined();
      expect(fake.submitted).toHaveLength(0);
      expect(seen.find(isPhrasing)!.messages.find((m) => m.role === "tool")!.content!.toString()).toContain("made here in this home");
    });
  });

  test("in a temporary chat a picture only named like a generated one is still refused: the mark is Home's, not a file name", async () => {
    const { storeTemporaryChatImage } = await import("@/lib/attachments");
    let conversationId = "";
    await withStub(script(undefined, "Hi."), async () => {
      const { value } = await streamValue(people.owner, "hello", { temporary: true });
      conversationId = value.conversation_id;
    });
    storeTemporaryChatImage({ id: "file-fakeone", turnId: "turn-1", conversationId, ownerPersonId: people.owner.id, name: "Generated picture", mediaType: "image/png", width: 8, height: 8, bytes: new Uint8Array([1, 2, 3]) });
    const call = { id: "c", name: "generate_video", args: JSON.stringify({ prompt: "make my photo move", from_picture: "file-fakeone" }) };
    await withStub(script(call), async () => {
      const { value } = await streamValue(people.owner, "animate it", { conversationId, temporary: true });
      expect(value.video).toBeUndefined();
      expect(fake.submitted).toHaveLength(0);
    });
  });

  test("in a temporary chat a picture Home marked generated is animated, and 'latest' finds it", async () => {
    const { storeTemporaryChatImage } = await import("@/lib/attachments");
    let conversationId = "";
    await withStub(script(undefined, "Hi."), async () => {
      const { value } = await streamValue(people.owner, "hello", { temporary: true });
      conversationId = value.conversation_id;
    });
    const bytes = new Uint8Array([9, 8, 7, 6]);
    storeTemporaryChatImage({ id: "file-realone", turnId: "turn-1", conversationId, ownerPersonId: people.owner.id, name: "Generated picture", mediaType: "image/png", width: 64, height: 64, bytes, generated: true });
    const call = { id: "c", name: "generate_video", args: JSON.stringify({ prompt: "make it move", from_picture: "latest" }) };
    await withStub(script(call), async () => {
      const { value } = await streamValue(people.owner, "animate it", { conversationId, temporary: true });
      expect(value.video?.id).toMatch(/^vid-/);
      expect(Buffer.from(fake.submitted[0]!.image as string, "base64").equals(Buffer.from(bytes))).toBe(true);
      expect(fake.submitted[0]!.image_source).toBe("generated");
    });
  });

  test("with no generated picture in the chat, 'latest' is refused and nothing is sent", async () => {
    const { conversationId } = await conversationWithPicture("composer:upload");
    const call = { id: "c", name: "generate_video", args: JSON.stringify({ prompt: "make it move", from_picture: "latest" }) };
    await withStub(script(call), async () => {
      const { value } = await streamValue(people.owner, "animate the last picture", { conversationId });
      expect(value.video).toBeUndefined();
      expect(fake.submitted).toHaveLength(0);
    });
  });
});
