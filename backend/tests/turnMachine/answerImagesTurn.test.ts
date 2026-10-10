// ANSWER-IMG-02 on the live turn path (design: data-scratch/research/
// chat-images-in-answers.md sections 4.3 and 5; rules 0, 1, 6, 8, 9).
// `show_images` is offered only where pictures may show, answers the model at
// once with a fixed line, fetches beside the answer, and the picture set is an
// `image_gallery` answer block (GENUI-05: it superseded the `images` event and
// the stored `answer_images`) that the one placer lands at a paragraph boundary
// of released text (never above it); the stored turn carries the same block; a
// failed fetch places nothing and the answer is whole; a turn stored before
// GENUI-05 (the `answer_images` column) is read as the same block. The manifest offer policy currently keeps the tool off after its
// measured recall remained below the offering bar; pipeline tests inject it.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { AssistantStream, DataStreamDecoder, type AssistantStreamChunk } from "assistant-stream";
import { resetDb } from "../reset-db";
import { __resetThrottleForTests } from "@/lib/secretThrottle";
import { __resetLlmSupervisorForTests } from "@/lib/llmSupervisor";
import { __resetRateLimiterForTests } from "@/lib/rateLimiter";
import { __resetPortOwnershipForTests } from "@/lib/sidecars";
import { setHouseholdSettingValue, setValue } from "@/lib/settings";
import { runTurnNext, runTurnNextStream } from "@/lib/turnMachine/turnNext";
import { __setToolOfferOverridesForTests } from "@/lib/turnMachine/budget";
import { streamTurnEvents } from "@/routes/turn";
import { listConversationTurns } from "@/lib/conversationHistory";
import { SHOW_IMAGES_UNAVAILABLE_LINE } from "@/lib/answerImages/turn";
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
import { filterAnswerBlocks } from "@/lib/answerBlocks";
import { galleryBlockFor, galleryProps, legacyGalleryBlock } from "@/lib/answerImages/gallery";

const TOWER: FixtureSubject = { id: "Q243", label: "Eiffel Tower", category: "Eiffel Tower", image: "Tower lead.jpg", files: ["Tower lead.jpg", "Tower night.jpg", "Tower river.jpg"], description: "tower in Paris" };
const CALL = { id: "call-img", name: "show_images", args: JSON.stringify({ subject: "Eiffel Tower" }) };
const TWO_PARAGRAPHS = "The Eiffel Tower is an iron tower in Paris.\n\nIt was finished in 1889 for a world fair.";

const ITEM = (name: string): AnswerImageSet["items"][number] => {
  const id = `ai_${name.charCodeAt(0).toString(16).padStart(2, "0").repeat(16)}`;
  return { id, src: `/api/answer-image/${id}?v=tile`, full: `/api/answer-image/${id}?v=full`, width: 640, height: 480, alt: "a tower", caption: "a tower", license: { short: "CC BY-SA 4.0", artist: "Pat" }, source: { title: "Tower", site: "commons.wikimedia.org", url: "https://commons.wikimedia.org/wiki/File:Tower.jpg" } } as never;
};
const SET = { visible: 1, items: [ITEM("a")] };

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

/** Makes the normally-off candidate available for the answer-image pipeline tests. */
function offerShowImages(): void {
  __setToolOfferOverridesForTests(["show_images"]);
  restore.push({ mockRestore: () => __setToolOfferOverridesForTests(null) });
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
type Gallery = { t: "block"; call_id: string; block: { kind: string; after_paragraph?: number; props: { maxVisible: number; images: Array<{ id: string; src: string; alt: string; caption?: string; source?: { label: string; url: string } }> } } };
const imagesEvents = (events: Timed[]) => events.filter((e) => (e.event as { t?: string }).t === "block" && (e.event as unknown as Gallery).block.kind === "image_gallery");
const galleryOf = (timed: Timed) => (timed.event as unknown as Gallery).block;
const storedBlocks = (turnId: string) => JSON.parse(db.select().from(conversationTurns).where(eq(conversationTurns.id, turnId)).get()!.blocks ?? "[]") as Gallery["block"][];
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

  test("IMG-OFFER-01: an adult's written chat turn is offered it by the manifest alone", async () => {
    expect(await toolsSeen(people.owner, (a) => runTurnNext(a, "chat", "what does the Eiffel Tower look like"))).toContain("show_images");
  });

  test("never offered on a spoken turn, a glance surface or a temporary chat", async () => {
    expect(await toolsSeen(people.owner, (a) => runTurnNext(a, "chat", "who is the president of chile", { spoken: true }))).not.toContain("show_images");
    expect(await toolsSeen(people.owner, (a) => runTurnNext(a, "overlay", "who is the president of chile"))).not.toContain("show_images");
    expect(await toolsSeen(people.owner, (a) => runTurnNext(a, "chat", "who is the president of chile", { temporary: true }))).not.toContain("show_images");
  });

  test("a child's preference can be parent-set but never gets the child the tool (adults only)", async () => {
    expect(await toolsSeen(people.child, (a) => runTurnNext(a, "chat", "what does a koala look like"))).not.toContain("show_images");
    expect(setValue(people.child, `person:${people.child.id}`, "reference.images", true).ok).toBe(false);
    expect(setValue(people.owner, `person:${people.child.id}`, "reference.images", true).ok).toBe(true);
    expect(await toolsSeen(people.child, (a) => runTurnNext(a, "chat", "what does a koala look like"))).not.toContain("show_images");
  });

  test("an adult who turned pictures off is not offered the tool", async () => {
    expect(setValue(people.owner, `person:${people.owner.id}`, "reference.images", false).ok).toBe(true);
    expect(await toolsSeen(people.owner, (a) => runTurnNext(a, "chat", "what does the Eiffel Tower look like"))).not.toContain("show_images");
  });

  test("a teen is never offered it, whatever their picture preference", async () => {
    db.update(peopleTable).set({ role: "teen" }).where(eq(peopleTable.id, people.child.id)).run();
    const teen = db.select().from(peopleTable).where(eq(peopleTable.id, people.child.id)).get()!;
    expect(await toolsSeen(teen, (a) => runTurnNext(a, "chat", "what does a red panda look like"))).not.toContain("show_images");
    // A teen controls their own setting; an adult cannot change it (owner ruling 2026-09-30).
    expect(setValue(people.owner, `person:${teen.id}`, "reference.images", false).ok).toBe(false);
    expect(setValue(teen, `person:${teen.id}`, "reference.images", false).ok).toBe(true);
  });
});

describe("ANSWER-IMG-02: the turn with pictures", () => {
  test("pictures ready before the answer starts lead it as an image_gallery block; the stored turn and the done value carry it", async () => {
    offerShowImages();
    __setAnswerImageDepsForTests(fixtureWorld([TOWER]).deps);
    await withStub(script(TWO_PARAGRAPHS, { replyDelayMs: 1_500 }), async (seen) => {
      const { events } = await streamEvents();
      const imgs = imagesEvents(events);
      expect(imgs).toHaveLength(1);
      const block = galleryOf(imgs[0]!);
      expect(block.after_paragraph).toBe(0);
      expect(block.props.images).toHaveLength(3);
      expect(block.props.maxVisible).toBe(3);
      for (const image of block.props.images) expect(image.src).toMatch(/^\/api\/answer-image\/ai_[0-9a-f]{32}\?v=tile$/);
      expect(events.indexOf(imgs[0]!)).toBeLessThan(events.indexOf(deltas(events)[0]!));
      // The retired shapes are gone from the wire.
      expect(events.some((e) => (e.event as { type?: string }).type === "images")).toBe(false);
      const value = doneValue(events);
      expect(value.reply.text).toBe(TWO_PARAGRAPHS);
      expect("answer_images" in value).toBe(false);
      expect((value.blocks ?? []).filter((b) => b.kind === "image_gallery")).toHaveLength(1);
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
      expect(row.answerImages).toBeNull();
      expect(storedBlocks(value.turn_id).filter((b) => b.kind === "image_gallery")).toEqual([block]);
      const listed = listConversationTurns(people.owner, value.conversation_id);
      if (!listed.ok) throw new Error("list failed");
      const turn = listed.value.find((t) => t.id === value.turn_id)!;
      expect((turn.blocks ?? []).filter((b) => b.kind === "image_gallery")).toEqual([block as never]);
      expect("answer_images" in turn).toBe(false);
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
      expect(galleryOf(imgs[0]!).after_paragraph).toBe(1);
      expect(storedBlocks(doneValue(events).turn_id).find((b) => b.kind === "image_gallery")?.after_paragraph).toBe(1);
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
      expect(storedBlocks(value.turn_id).filter((b) => b.kind === "image_gallery")).toEqual([]);
      const row = db.select().from(conversationTurns).where(eq(conversationTurns.id, value.turn_id)).get()!;
      expect(row.answerImages).toBeNull();
    });
  });

  test("a gallery with a picture from outside the Home picture proxy never reaches the wire", () => {
    const raw = galleryBlockFor({ visible: 1, items: [{ id: "ai_0123456789abcdef0123456789abcdef", src: "https://images.example/p.jpg", full: "https://images.example/p.jpg", width: 4, height: 3, alt: "a", caption: "a", source: { title: "t", site: "example.com", url: "https://example.com/t" } }] }, "Tower", "show_images test", "1:0:testnode")!;
    expect(filterAnswerBlocks([raw], "show_images", ["image_gallery"], "adult", { displayName: "Sage" })).toEqual([]);
  });

  test("a non-visual turn with no call has no pictures and no images event", async () => {
    offerShowImages();
    const world = fixtureWorld([TOWER]);
    __setAnswerImageDepsForTests(world.deps);
    await withStub(script("A mortgage is a loan for a home.", { call: false }), async () => {
      const { events } = await streamEvents(people.owner, "what is a mortgage");
      expect(imagesEvents(events)).toHaveLength(0);
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
      expect((result.value.blocks ?? []).filter((b) => b.kind === "image_gallery")).toEqual([]);
      expect(world.log.wikimedia).toEqual([]);
      const phrasing = seen.find(isPhrasing);
      if (phrasing) expect(lastText(phrasing).length).toBeGreaterThan(0);
    });
  });
});

describe("IMG-OFFER-01: a forged call from a non-adult", () => {
  async function forged(actor: typeof people.owner, text: string) {
    offerShowImages(); // forces the tool into the list, as a forged or buggy proposal would
    const world = fixtureWorld([TOWER]);
    __setAnswerImageDepsForTests(world.deps);
    let result: Awaited<ReturnType<typeof runTurnNext>> | undefined;
    let toolText = "";
    await withStub(script("A koala is a marsupial."), async (seen) => {
      result = await runTurnNext(actor, "chat", text);
      toolText = JSON.stringify(seen.flatMap((r) => r.messages.filter((m) => m.role === "tool")));
    });
    // The call is refused before any tool round runs (the minor's tool list lacks it), or, if it ever
    // reaches the tool node, answers with the fixed unavailable line; never a picture line.
    if (toolText !== "[]") expect(toolText).toContain(SHOW_IMAGES_UNAVAILABLE_LINE);
    expect(toolText).not.toContain("are on their screen");
    if (!result || !result.ok || result.kind !== "immediate") throw new Error("expected an immediate result");
    expect(result.value.answer_images).toBeUndefined();
    expect(world.log.wikimedia).toEqual([]);
    expect(JSON.stringify(db.select().from(conversationTurns).all())).not.toContain("image_gallery");
    return result.value;
  }

  test("a child with the picture setting on: the call is refused, no pictures and no gallery block", async () => {
    expect(setValue(people.owner, `person:${people.child.id}`, "reference.images", true).ok).toBe(true);
    const value = await forged(people.child, "what does a koala look like");
    expect(JSON.stringify(value)).not.toContain("image_gallery");
  });

  test("a teen: the call is refused, no pictures and no gallery block", async () => {
    db.update(peopleTable).set({ role: "teen" }).where(eq(peopleTable.id, people.child.id)).run();
    const teen = db.select().from(peopleTable).where(eq(peopleTable.id, people.child.id)).get()!;
    const value = await forged(teen, "what does a red panda look like");
    expect(JSON.stringify(value)).not.toContain("image_gallery");
  });
});

describe("ANSWER-IMG-02: the wire shapes", () => {
  test("assistant-stream: the gallery is one answer_block data part between the two text parts", async () => {
    const sink = createAssistantStreamSink();
    const block = { ...galleryBlockFor(SET, "Tower", "show_images test", "1:0:testnode")!, after_paragraph: 1 };
    sink.write({ type: "delta", text: "One.\n\n", sequence: 1 });
    sink.write({ t: "block", call_id: "call-img", block } as never);
    sink.write({ type: "delta", text: "Two.", sequence: 2 });
    sink.write({ type: "done", value: { reply: { text: "One.\n\nTwo." } } as TurnValue });
    const chunks: AssistantStreamChunk[] = [];
    const reader = AssistantStream.fromResponse(new Response(sink.readable, { headers: sink.headers }), new DataStreamDecoder()).getReader();
    for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
    const starts = chunks.filter((c) => c.type === "part-start").map((c) => (c as { part: { type: string; name?: string; data?: unknown } }).part);
    expect(starts.map((p) => p.type)).toEqual(["text", "data", "text"]);
    expect(starts[1]!.name).toBe("answer_block");
    expect(starts[1]!.data).toEqual(block);
  });

  test("a reply that claims pictures is grounded by an image_gallery block, and caught without one", () => {
    const attached = { blocks: [galleryBlockFor(SET, "Tower", "show_images test", "1:0:testnode")] };
    expect(groundedIn("Here is a picture of it.", [], "")).toBe("Here is a picture");
    expect(groundedIn("Here is a picture of it.", [], "", attached)).toBeNull();
  });
});

describe("GENUI-05: the gallery builder and the turns stored before it", () => {
  test("a lone extra picture is dropped so the badge never reads +1; the caption carries the licence", () => {
    const four = { visible: 3, items: [ITEM("a"), ITEM("b"), ITEM("c"), ITEM("d")] };
    expect(galleryProps(four)!.images).toHaveLength(3);
    const five = { visible: 3, items: [ITEM("a"), ITEM("b"), ITEM("c"), ITEM("d"), ITEM("e")] };
    const props = galleryProps(five)!;
    expect(props.images).toHaveLength(5);
    expect(props.maxVisible).toBe(3);
    expect(props.images[0]!.caption).toBe("a tower · CC BY-SA 4.0, Pat");
    expect(galleryProps({ visible: 3, items: [] })).toBeNull();
  });

  test("the built block passes the one block filter for every age band", () => {
    const raw = galleryBlockFor(SET, "Eiffel Tower", "show_images test", "1:0:testnode")!;
    for (const band of ["adult", "teen", "child"] as const) {
      expect(filterAnswerBlocks([raw], "show_images", ["image_gallery"], band, { displayName: "Sage" })).toHaveLength(1);
    }
    expect(filterAnswerBlocks([raw], "show_images", [], "adult", { displayName: "Sage" })).toEqual([]);
  });

  test("a legacy answer_images turn is read back as a spec-valid image_gallery block in the same place", async () => {
    await withStub(script("Fine.", { call: false }), async () => {
      const result = await runTurnNext(people.owner, "chat", "hello there");
      if (!result.ok) throw new Error("turn failed");
      const turnId = result.value.turn_id;
      const stored = { layout: "row", after_paragraph: 2, visible: 3, items: SET.items };
      db.update(conversationTurns).set({ answerImages: JSON.stringify(stored), blocks: null }).where(eq(conversationTurns.id, turnId)).run();
      const read = () => {
        const listed = listConversationTurns(people.owner, result.value.conversation_id);
        if (!listed.ok) throw new Error("list failed");
        return listed.value.find((t) => t.id === turnId)!;
      };
      const turn = read();
      expect("answer_images" in turn).toBe(false);
      const gallery = (turn.blocks ?? []).filter((b) => b.kind === "image_gallery");
      expect(gallery).toHaveLength(1);
      expect(gallery[0]).toEqual(legacyGalleryBlock(stored, turnId, turn.createdAt)!);
      expect((gallery[0] as unknown as Gallery["block"]).after_paragraph).toBe(2);
      // A reload never changes it (no data debt: a stable id and the turn's own time).
      expect(read().blocks).toEqual(turn.blocks);
      expect(filterAnswerBlocks([gallery[0]], "show_images", ["image_gallery"], "adult", { displayName: "Sage" })).toHaveLength(1);
    });
  });
});
