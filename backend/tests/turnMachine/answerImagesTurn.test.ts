// ANSWER-IMG-02 on the live turn path (design: data-scratch/research/
// chat-images-in-answers.md sections 4.3 and 5; rules 0, 1, 6, 8, 9).
// `show_images` is offered only where pictures may show, answers the model at
// once with a fixed line, fetches beside the answer, and the `images` event
// lands at a paragraph boundary of released text (never above it); the stored
// turn carries the same set; a failed fetch places nothing and the answer is
// whole. The model's own catalog record still leaves the tool out
// (ANSWER-IMG-05 turns it on), so these tests offer it the way the record will.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { eq } from "drizzle-orm";
import { AssistantStream, DataStreamDecoder, type AssistantStreamChunk } from "assistant-stream";
import { resetDb } from "../reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { setHouseholdSettingValue, setValue } from "@/lib/settings";
import { runTurnNext, runTurnNextStream } from "@/lib/turnMachine/turnNext";
import * as budgetModule from "@/lib/turnMachine/budget";
import { streamTurnEvents } from "@/routes/turn";
import { listConversationTurns } from "@/lib/conversationHistory";
import { __resetAnswerImageFetchForTests } from "@/lib/answerImages/fetch";
import { __setAnswerImageDepsForTests } from "@/lib/answerImages/select";
import { createAssistantStreamSink } from "@/lib/assistantStreamWire";
import { groundedIn } from "@/lib/composer";
import { createBenchPeople, type BenchPeople } from "../../scripts/bench/conversationRunner";
import { useDefaultScriptedStack } from "../stackFixture";
import { withStub, lastText } from "./toolHarness";
import { fixtureWorld, type FixtureSubject } from "../answerImagesFixture";
import { db } from "@/db";
import { conversationTurns, people as peopleTable } from "@/db/schema";
import type { ChatCompletionRequest } from "@maipai/spec/llm/ts/types.js";
import type { AnswerImageSet, TurnStreamEvent, TurnValue } from "@/wire";

const TOWER: FixtureSubject = { id: "Q243", label: "Eiffel Tower", category: "Eiffel Tower", image: "Tower lead.jpg", files: ["Tower lead.jpg", "Tower night.jpg", "Tower river.jpg"], description: "tower in Paris" };
const CALL = { id: "call-img", name: "show_images", args: JSON.stringify({ subject: "Eiffel Tower" }) };
const TWO_PARAGRAPHS = "The Eiffel Tower is an iron tower in Paris.\n\nIt was finished in 1889 for a world fair.";

let people: BenchPeople;
const restore: Array<{ mockRestore(): void }> = [];

beforeEach(() => {
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
  for (const r of restore.splice(0)) r.mockRestore();
  __setAnswerImageDepsForTests(null);
  __resetLlmSupervisorForTests();
  __resetPortOwnershipForTests();
  delete process.env.MAIPAI_LLAMA_SERVER_URL;
});

/** The model's record offering show_images, as ANSWER-IMG-05 will make it. */
function offerShowImages(): void {
  const original = budgetModule.resolveTurnBudgetWithStack;
  restore.push(spyOn(budgetModule, "resolveTurnBudgetWithStack").mockImplementation(async (...args) => {
    const budget = await original(...args);
    return { ...budget, tools_offered: [...budget.tools_offered, "show_images"] };
  }));
}

const toolNames = (request: ChatCompletionRequest | undefined) => (request?.tools ?? []).map((t) => (t as { function: { name: string } }).function.name);
const isPhrasing = (request: ChatCompletionRequest) => request.messages.some((m) => m.role === "tool");
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** First round: call show_images (or nothing); phrasing round: `reply`, after `replyDelayMs`. */
function script(reply: string, opts: { replyDelayMs?: number; call?: boolean } = {}) {
  return {
    calls: (request: ChatCompletionRequest) => (opts.call === false || request.tool_choice === "none" || isPhrasing(request) ? undefined : [CALL]),
    reply: (request: ChatCompletionRequest) => (isPhrasing(request) && opts.replyDelayMs ? (delay(opts.replyDelayMs).then(() => reply) as unknown as string) : reply),
  };
}

type Timed = { event: TurnStreamEvent; at: number };
async function streamEvents(actor = people.owner, text = "what does the Eiffel Tower look like"): Promise<{ events: Timed[]; startedAt: number }> {
  const startedAt = Date.now();
  const result = await runTurnNextStream(actor, "chat", text);
  if (!result.ok || result.kind !== "stream") throw new Error("expected a stream result");
  const events: Timed[] = [];
  for await (const event of streamTurnEvents(result, actor.id)) events.push({ event: event as TurnStreamEvent, at: Date.now() });
  return { events, startedAt };
}
const deltas = (events: Timed[]) => events.filter((e) => e.event.type === "delta");
const imagesEvents = (events: Timed[]) => events.filter((e) => e.event.type === "images");
const doneValue = (events: Timed[]) => (events.find((e) => e.event.type === "done")!.event as { value: TurnValue }).value;

describe("ANSWER-IMG-02: where show_images is offered (rule 0's gates)", () => {
  async function toolsSeen(actor: typeof people.owner, run: (actor: typeof people.owner) => Promise<unknown>): Promise<string[]> {
    let names: string[] = [];
    await withStub({ calls: () => undefined, reply: () => "Fine." }, async (seen) => {
      await run(actor);
      names = toolNames(seen.find((r) => (r.tools?.length ?? 0) > 0));
    });
    return names;
  }

  test("offered on an adult's written chat when the model's record offers it", async () => {
    offerShowImages();
    expect(await toolsSeen(people.owner, (a) => runTurnNext(a, "chat", "what does the Eiffel Tower look like"))).toContain("show_images");
  });

  test("the record leaves it out until ANSWER-IMG-05: not offered by default", async () => {
    expect(await toolsSeen(people.owner, (a) => runTurnNext(a, "chat", "what does the Eiffel Tower look like"))).not.toContain("show_images");
  });

  test("never offered on a spoken turn, a glance surface or a temporary chat", async () => {
    offerShowImages();
    expect(await toolsSeen(people.owner, (a) => runTurnNext(a, "chat", "who is the president of chile", { spoken: true }))).not.toContain("show_images");
    expect(await toolsSeen(people.owner, (a) => runTurnNext(a, "overlay", "who is the president of chile"))).not.toContain("show_images");
    expect(await toolsSeen(people.owner, (a) => runTurnNext(a, "chat", "who is the president of chile", { temporary: true }))).not.toContain("show_images");
  });

  test("a child is off by default, a parent turns it on, and the child cannot turn it on themselves", async () => {
    offerShowImages();
    expect(await toolsSeen(people.child, (a) => runTurnNext(a, "chat", "what does a koala look like"))).not.toContain("show_images");
    expect(setValue(people.child, `person:${people.child.id}`, "reference.images", true).ok).toBe(false);
    expect(setValue(people.owner, `person:${people.child.id}`, "reference.images", true).ok).toBe(true);
    expect(await toolsSeen(people.child, (a) => runTurnNext(a, "chat", "what does a koala look like"))).toContain("show_images");
  });

  test("an adult who turned pictures off is not offered the tool", async () => {
    offerShowImages();
    expect(setValue(people.owner, `person:${people.owner.id}`, "reference.images", false).ok).toBe(true);
    expect(await toolsSeen(people.owner, (a) => runTurnNext(a, "chat", "what does the Eiffel Tower look like"))).not.toContain("show_images");
  });

  test("a teen is on by default", async () => {
    offerShowImages();
    db.update(peopleTable).set({ role: "teen" }).where(eq(peopleTable.id, people.child.id)).run();
    const teen = db.select().from(peopleTable).where(eq(peopleTable.id, people.child.id)).get()!;
    expect(await toolsSeen(teen, (a) => runTurnNext(a, "chat", "what does a red panda look like"))).toContain("show_images");
    // A teen controls their own setting; an adult cannot change it (owner ruling 2026-09-30).
    expect(setValue(people.owner, `person:${teen.id}`, "reference.images", false).ok).toBe(false);
    expect(setValue(teen, `person:${teen.id}`, "reference.images", false).ok).toBe(true);
  });
});

describe("ANSWER-IMG-02: the turn with pictures", () => {
  test("pictures ready before the answer starts lead it; the stored turn and the done value carry the same set", async () => {
    offerShowImages();
    __setAnswerImageDepsForTests(fixtureWorld([TOWER]).deps);
    await withStub(script(TWO_PARAGRAPHS, { replyDelayMs: 1_500 }), async (seen) => {
      const { events } = await streamEvents();
      const imgs = imagesEvents(events);
      expect(imgs).toHaveLength(1);
      const set = imgs[0]!.event as unknown as AnswerImageSet & { turn_id: string };
      expect(set.after_paragraph).toBe(0);
      expect(set.items).toHaveLength(3);
      expect(events.indexOf(imgs[0]!)).toBeLessThan(events.indexOf(deltas(events)[0]!));
      const value = doneValue(events);
      expect(value.reply.text).toBe(TWO_PARAGRAPHS);
      expect(value.answer_images).toEqual({ layout: set.layout, after_paragraph: 0, visible: 3, items: set.items });
      expect(set.turn_id).toBe(value.turn_id);
      // The model's tool result: the fixed line, no bytes, no count, no address.
      const phrasing = seen.find(isPhrasing)!;
      const toolMessage = phrasing.messages.find((m) => m.role === "tool")!.content!.toString();
      expect(toolMessage).toContain("Photos of Eiffel Tower are on their screen. Answer from what you know, describing Eiffel Tower yourself if asked; never mention the photos.");
      // ANSWER-IMG-05b: the answering round after a pictures-only call gets
      // the short instruction, with no search lines.
      const instruction = phrasing.messages.at(-1)!.content!.toString();
      expect(instruction.startsWith("Answer this message of mine from what you know")).toBe(true);
      expect(instruction).not.toMatch(/results|cite/i);
      expect(toolMessage).not.toMatch(/answer-image|data:|\b3\b|ai_[a-f0-9]/);
      expect(phrasing.tool_choice).toBe("none");
      // Stored, and read back by the history list.
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, value.turn_id)).get()!;
      expect(JSON.parse(row.answerImages!)).toEqual(value.answer_images);
      const listed = listConversationTurns(people.owner, value.conversation_id);
      if (!listed.ok) throw new Error("list failed");
      expect(listed.value.find((t) => t.id === value.turn_id)?.answer_images).toEqual(value.answer_images);
    });
  });

  test("a slow picture host never delays the first text, and pictures that miss the answer go after it", async () => {
    offerShowImages();
    __setAnswerImageDepsForTests(fixtureWorld([TOWER], { pictureDelayMs: 800 }).deps);
    await withStub(script("The Eiffel Tower is an iron tower in Paris."), async () => {
      const { events, startedAt } = await streamEvents();
      const firstDelta = deltas(events)[0]!;
      const imgs = imagesEvents(events);
      expect(imgs).toHaveLength(1);
      expect(firstDelta.at - startedAt).toBeLessThan(800);
      expect(imgs[0]!.at).toBeGreaterThan(firstDelta.at);
      // After every released piece, before done: never above released text.
      expect(events.indexOf(imgs[0]!)).toBeGreaterThan(events.indexOf(deltas(events).at(-1)!));
      expect((imgs[0]!.event as unknown as AnswerImageSet).after_paragraph).toBe(1);
      expect(doneValue(events).answer_images?.after_paragraph).toBe(1);
    });
  });

  test("a failed fetch emits no pictures and the answer completes whole", async () => {
    offerShowImages();
    __setAnswerImageDepsForTests(fixtureWorld([TOWER], { failPictures: true }).deps);
    await withStub(script(TWO_PARAGRAPHS), async () => {
      const { events } = await streamEvents();
      expect(imagesEvents(events)).toHaveLength(0);
      const value = doneValue(events);
      expect(value.reply.text).toBe(TWO_PARAGRAPHS);
      expect(value.answer_images).toBeUndefined();
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, value.turn_id)).get()!;
      expect(row.answerImages).toBeNull();
    });
  });

  test("a non-visual turn with no call has no pictures and no images event", async () => {
    offerShowImages();
    const world = fixtureWorld([TOWER]);
    __setAnswerImageDepsForTests(world.deps);
    await withStub(script("A mortgage is a loan for a home.", { call: false }), async () => {
      const { events } = await streamEvents(people.owner, "what is a mortgage");
      expect(imagesEvents(events)).toHaveLength(0);
      expect(doneValue(events).answer_images).toBeUndefined();
      expect(world.log.wikimedia).toEqual([]);
    });
  });

  test("a call the turn may not make (pictures off) runs nothing and tells the model so", async () => {
    // The record offers it, but this adult turned pictures off; a model that
    // calls it anyway gets the plain line and nothing is fetched.
    offerShowImages();
    setValue(people.owner, `person:${people.owner.id}`, "reference.images", false);
    const world = fixtureWorld([TOWER]);
    __setAnswerImageDepsForTests(world.deps);
    await withStub(script("The Eiffel Tower is in Paris."), async (seen) => {
      const result = await runTurnNext(people.owner, "chat", "what does the Eiffel Tower look like");
      if (!result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
      expect(result.value.answer_images).toBeUndefined();
      expect(world.log.wikimedia).toEqual([]);
      const phrasing = seen.find(isPhrasing);
      if (phrasing) expect(lastText(phrasing).length).toBeGreaterThan(0);
    });
  });
});

describe("ANSWER-IMG-02: the wire shapes", () => {
  test("assistant-stream: the set is one answer-images data part between the two text parts", async () => {
    const sink = createAssistantStreamSink();
    const set: AnswerImageSet = { layout: "row", after_paragraph: 1, visible: 1, items: [{ id: "ai_00000000000000000000000000000000", src: "/api/answer-image/ai_00000000000000000000000000000000?v=tile", full: "/api/answer-image/ai_00000000000000000000000000000000?v=full", width: 640, height: 480, alt: "a tower", caption: "a tower", source: { title: "Tower", site: "commons.wikimedia.org", url: "https://commons.wikimedia.org/wiki/File:Tower.jpg" } }] };
    sink.write({ type: "delta", text: "One.\n\n", sequence: 1 });
    sink.write({ type: "images", turn_id: "t1", ...set });
    sink.write({ type: "delta", text: "Two.", sequence: 2 });
    sink.write({ type: "done", value: { reply: { text: "One.\n\nTwo." } } as TurnValue });
    const chunks: AssistantStreamChunk[] = [];
    const reader = AssistantStream.fromResponse(new Response(sink.readable, { headers: sink.headers }), new DataStreamDecoder()).getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
    const starts = chunks.filter((c) => c.type === "part-start").map((c) => (c as { part: { type: string; name?: string; data?: unknown } }).part);
    expect(starts.map((p) => p.type)).toEqual(["text", "data", "text"]);
    expect(starts[1]!.name).toBe("answer-images");
    expect(starts[1]!.data).toEqual(set);
  });

  test("a reply that claims pictures is grounded by the stored answer_images, and caught without them", () => {
    const set = { answer_images: { layout: "row", after_paragraph: 0, visible: 1, items: [{ src: "/api/answer-image/ai_1?v=tile" }] } };
    expect(groundedIn("Here is a picture of it.", [], "")).toBe("Here is a picture");
    expect(groundedIn("Here is a picture of it.", [], "", set)).toBeNull();
  });
});
