// GENUI-13c: Home places answer blocks at their paragraph, by the one placer the pictures use. A ready block goes at
// the first paragraph boundary after it is ready (before any text when ready in time), never above text already
// released, never inside a code fence, and after the reply when the answer ends first. The hub stamps
// `after_paragraph` on the block before the `block` event and the stored turn's `blocks`; a package never sets it.
import { describe, expect, test } from "bun:test";
import { AssistantStream, DataStreamDecoder, type AssistantStreamChunk } from "assistant-stream";
import { AnswerBlock } from "@maipai/spec/gen/ts/answer-block.js";
import { filterAnswerBlocks } from "@/lib/answerBlocks";
import { createAssistantStreamSink } from "@/lib/assistantStreamWire";
import { AnswerImagePlacer, settleAnswerBlocks } from "@/lib/answerImages/turn";
import type { TurnState } from "@/lib/turnMachine/contract";

// Block ids are `blk-` and six or more of a-z0-9.
const bid = (id: string): string => `blk-${id.padEnd(6, "0")}`;
const block = (id: string) => ({
  id: bid(id),
  kind: "spec_sheet" as const,
  schema_version: 1 as const,
  producer: "sample-package",
  alt: "A short facts sheet.",
  provenance: "sample-package result",
  created_at: "2026-10-08T12:00:00.000Z",
  hlc: "1791478099338:0:abcdef",
  props: { title: "Facts", rows: [{ label: "Status", value: "Ready" }] },
});
const event = (id: string) => ({ t: "block" as const, call_id: "call-1", block: block(id) });
const result = { layout: "row" as const, visible: 1, items: [] };

type BlockEvent = ReturnType<typeof event>;
type Stamped = BlockEvent["block"] & { after_paragraph?: number };

// A turn state with only what the placer reads: the turn's tool events and the picture pipeline entry.
function stateWith(events: BlockEvent[], images?: typeof result): TurnState {
  return {
    toolEvents: [...events],
    ...(images ? { answerImages: { subject: "x", done: Promise.resolve(), result: images } } : {}),
  } as unknown as TurnState;
}
const stampOf = (state: TurnState, id: string): number | undefined => {
  const found = state.toolEvents.find((e) => e.t === "block" && e.block.id === bid(id));
  return found && found.t === "block" ? (found.block as Stamped).after_paragraph : undefined;
};

describe("GENUI-13c: the placer puts a ready block at a paragraph boundary", () => {
  test("ready before any text: it leads (after_paragraph 0, offset 0), and the text is unaltered", () => {
    const state = stateWith([event("a")]);
    const out: string[] = [];
    const placer = new AnswerImagePlacer(state, (t) => out.push(t));
    placer.push("The tower ");
    expect(stampOf(state, "a")).toBe(0);
    expect(state.placedBlocks?.map((p) => p.offset)).toEqual([0]);
    expect(out.join("")).toBe("The tower ");
  });

  test("ready mid-reply: placed at the next paragraph break, the piece split there and nothing altered", () => {
    const state = stateWith([]);
    const out: string[] = [];
    const placer = new AnswerImagePlacer(state, (t) => out.push(t));
    placer.push("First para");
    state.toolEvents.push(event("b"));
    placer.push("graph ends.");
    // Not ready to place: still inside the paragraph, so nothing moved and nothing is above released text.
    expect(state.placedBlocks).toBeUndefined();
    expect(stampOf(state, "b")).toBeUndefined();
    placer.push(" Done.\n\nSecond");
    placer.push(" paragraph.");
    expect(out.join("")).toBe("First paragraph ends. Done.\n\nSecond paragraph.");
    expect(stampOf(state, "b")).toBe(1);
    const placed = state.placedBlocks!;
    expect(placed).toHaveLength(1);
    expect(out.join("").slice(0, placed[0]!.offset)).toBe("First paragraph ends. Done.\n\n");
    // The stamped event is the one in the turn's own list, which is what the stored `blocks` are built from.
    expect(Object.is(state.toolEvents[0], placed[0]!.event)).toBe(true);
    expect(AnswerBlock.safeParse(placed[0]!.event.block).success).toBe(true);
  });

  test("a blank line inside a code block is not a boundary: the block waits for the fence to close", () => {
    const state = stateWith([]);
    const out: string[] = [];
    const placer = new AnswerImagePlacer(state, (t) => out.push(t));
    placer.push("Code:\n\n```\na = 1\n");
    state.toolEvents.push(event("c"));
    placer.push("\nb = 2\n```\n\nAfter.");
    const placed = state.placedBlocks![0]!;
    expect(out.join("").slice(0, placed.offset)).toBe("Code:\n\n```\na = 1\n\nb = 2\n```\n\n");
    expect(out.join("")).toBe("Code:\n\n```\na = 1\n\nb = 2\n```\n\nAfter.");
    // The fence's own blank line is not a paragraph: the count is Code, the fenced block.
    expect(stampOf(state, "c")).toBe(2);
  });

  test("an answer that ends first: the block goes after the whole reply, stamped with its paragraph count", () => {
    const state = stateWith([event("d")]);
    settleAnswerBlocks(state, "One.\n\nTwo.\n\nThree.");
    expect(stampOf(state, "d")).toBe(3);
    expect(state.placedBlocks?.map((p) => p.offset)).toEqual([Number.POSITIVE_INFINITY]);
    // A turn with no text at all (a command answered with a visual alone): paragraph 0.
    const bare = stateWith([event("e")]);
    settleAnswerBlocks(bare, "");
    expect(stampOf(bare, "e")).toBe(0);
  });

  test("a block placed mid-stream is not placed again by the settle", () => {
    const state = stateWith([event("f")]);
    const placer = new AnswerImagePlacer(state, () => {});
    placer.push("Hello.\n\n");
    expect(stampOf(state, "f")).toBe(0);
    settleAnswerBlocks(state, "Hello.\n\nMore.");
    expect(stampOf(state, "f")).toBe(0);
    expect(state.placedBlocks).toHaveLength(1);
  });

  test("two blocks ready together keep their order; a picture set ready with them follows them at the same spot", () => {
    const state = stateWith([event("g"), event("h")], result);
    const out: string[] = [];
    const placer = new AnswerImagePlacer(state, (t) => out.push(t));
    placer.push("Intro.\n\nMore.");
    expect(state.placedBlocks?.map((p) => p.event.block.id)).toEqual([bid("g"), bid("h")]);
    expect(state.placedBlocks?.map((p) => p.offset)).toEqual([0, 0]);
    expect(state.answerImages?.placed).toEqual({ set: { ...result, after_paragraph: 0 }, offset: 0 });
  });

  test("a block and a picture set ready at different times are placed at their own boundaries", () => {
    const state = stateWith([event("i")]);
    const placer = new AnswerImagePlacer(state, () => {});
    placer.push("One.\n\nTwo");
    // The block was ready first (paragraph 0); the pictures become ready mid-paragraph two.
    state.answerImages = { subject: "x", done: Promise.resolve(), result };
    placer.push(" ends.\n\nThree.");
    expect(stampOf(state, "i")).toBe(0);
    expect(state.answerImages?.placed?.set.after_paragraph).toBe(2);
  });

  test("no block ready: the text passes through untouched and nothing is placed", () => {
    const state = stateWith([]);
    const out: string[] = [];
    new AnswerImagePlacer(state, (t) => out.push(t)).push("One.\n\nTwo.");
    expect(out).toEqual(["One.\n\nTwo."]);
    expect(state.placedBlocks).toBeUndefined();
  });
});

describe("GENUI-13a at the host: a package never sets after_paragraph", () => {
  test("a value a package sends is dropped before the block is accepted", () => {
    const sent = { ...block("pk"), after_paragraph: 5 };
    const [accepted] = filterAnswerBlocks([sent], "sample-package", ["spec_sheet"], "adult", { displayName: "Sage" });
    expect(accepted).toBeDefined();
    expect(accepted).toEqual(block("pk"));
    expect("after_paragraph" in accepted!).toBe(false);
  });
});

describe("GENUI-13c on the assistant-stream wire: the block is a data part in place", () => {
  test("the open text part ends, the block is one answer_block part, the next delta opens a new text part", async () => {
    const sink = createAssistantStreamSink();
    const stamped = { ...block("w"), after_paragraph: 1 };
    sink.write({ type: "delta", text: "First paragraph.\n\n", sequence: 1 } as never);
    sink.write({ t: "block", call_id: "call-1", block: stamped } as never);
    sink.write({ type: "delta", text: "Second paragraph.", sequence: 2 } as never);
    sink.write({ type: "done", value: { reply: { text: "First paragraph.\n\nSecond paragraph." }, turn_id: "t1" } } as never);
    const chunks: AssistantStreamChunk[] = [];
    const reader = AssistantStream.fromResponse(new Response(sink.readable, { headers: sink.headers }), new DataStreamDecoder()).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const starts = chunks.flatMap((c) => (c.type === "part-start" ? [c.part] : []));
    expect(starts.map((p) => (p.type === "data" ? `data:${(p as { name: string }).name}` : p.type))).toEqual(["text", "data:answer_block", "text"]);
    const part = starts[1] as unknown as { data: { id: string; after_paragraph: number } };
    expect(part.data.id).toBe(bid("w"));
    expect(part.data.after_paragraph).toBe(1);
    // The released text is intact: the reply is the concatenation of the text parts.
    const text = chunks.flatMap((c) => (c.type === "text-delta" ? [c.textDelta] : [])).join("");
    expect(text).toBe("First paragraph.\n\nSecond paragraph.");
  });
});
