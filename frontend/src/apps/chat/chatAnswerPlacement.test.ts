// GENUI-13c: answer blocks (and the picture set) sit at their own paragraph of the reply text. The message part order
// is the layout: text, the block part, text. The count and the split are the spec's one helper, so these cases are the
// ones the hub's placer counts by.
import { describe, expect, test } from "bun:test";
import { SHOWCASE_BLOCKS } from "@maipai/home-backend/src/lib/uiFixtureBlocks";
import type { AnswerImageSet } from "@maipai/home-backend/src/wire";
import { splitAfterParagraph as specSplit } from "@maipai/spec/interpreters/ts/paragraphs.js";
import { splitAfterParagraph } from "@/apps/chat/chatAnswerImages";
import { textWithAnswerParts } from "@/apps/chat/chatAnswerBlocks";

const [sheet, table] = SHOWCASE_BLOCKS as [(typeof SHOWCASE_BLOCKS)[number], (typeof SHOWCASE_BLOCKS)[number]];
const at = (block: (typeof SHOWCASE_BLOCKS)[number], after_paragraph?: number) => (after_paragraph === undefined ? block : { ...block, after_paragraph });
const TEXT = "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.";
const shape = (parts: ReturnType<typeof textWithAnswerParts>): string[] =>
  parts.map((p) => (p.type === "text" ? `text:${p.text}` : p.type === "data" ? `data:${(p.data as { id: string }).id}` : p.type));

describe("GENUI-13c: one splitter, the spec's", () => {
  test("the frontend no longer keeps its own paragraph splitter", () => {
    expect(splitAfterParagraph).toBe(specSplit);
  });
});

describe("textWithAnswerParts: a block sits at its paragraph", () => {
  test("mid-reply: text, the block, text", () => {
    expect(shape(textWithAnswerParts(TEXT, { blocks: [at(sheet, 1)], imagesId: "t" }))).toEqual([
      "text:First paragraph.",
      `data:${sheet.id}`,
      "text:Second paragraph.\n\nThird paragraph.",
    ]);
    expect(shape(textWithAnswerParts(TEXT, { blocks: [at(sheet, 2)], imagesId: "t" }))).toEqual([
      "text:First paragraph.\n\nSecond paragraph.",
      `data:${sheet.id}`,
      "text:Third paragraph.",
    ]);
  });

  test("before text (0): the block leads", () => {
    expect(shape(textWithAnswerParts(TEXT, { blocks: [at(sheet, 0)], imagesId: "t" }))).toEqual([`data:${sheet.id}`, `text:${TEXT}`]);
  });

  test("after the reply: a count at or past the last paragraph, or no stamp at all (a record from before the field)", () => {
    for (const n of [3, 9, undefined]) {
      expect(shape(textWithAnswerParts(TEXT, { blocks: [at(sheet, n)], imagesId: "t" }))).toEqual([`text:${TEXT}`, `data:${sheet.id}`]);
    }
  });

  test("inside a code fence is never split: the fence's own blank line is not a paragraph", () => {
    const text = "Intro.\n\n```\na = 1\n\nb = 2\n```\n\nOutro.";
    // 1 is after Intro; 2 is after the whole fenced block, never inside it.
    expect(shape(textWithAnswerParts(text, { blocks: [at(sheet, 1)], imagesId: "t" }))).toEqual(["text:Intro.", `data:${sheet.id}`, "text:```\na = 1\n\nb = 2\n```\n\nOutro."]);
    expect(shape(textWithAnswerParts(text, { blocks: [at(sheet, 2)], imagesId: "t" }))).toEqual(["text:Intro.\n\n```\na = 1\n\nb = 2\n```", `data:${sheet.id}`, "text:Outro."]);
  });

  test("the text is whole: every split piece put back is the reply, whatever the stamp", () => {
    for (const n of [0, 1, 2, 3, 99]) {
      const parts = textWithAnswerParts(TEXT, { blocks: [at(sheet, n)], imagesId: "t" });
      const text = parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n\n");
      expect(text).toBe(TEXT);
    }
  });

  test("two blocks at different paragraphs keep their own places, in order; at one place they keep the order given", () => {
    expect(shape(textWithAnswerParts(TEXT, { blocks: [at(table, 2), at(sheet, 1)], imagesId: "t" }))).toEqual([
      "text:First paragraph.",
      `data:${sheet.id}`,
      "text:Second paragraph.",
      `data:${table.id}`,
      "text:Third paragraph.",
    ]);
    expect(shape(textWithAnswerParts(TEXT, { blocks: [at(table, 1), at(sheet, 1)], imagesId: "t" }))).toEqual([
      "text:First paragraph.",
      `data:${table.id}`,
      `data:${sheet.id}`,
      "text:Second paragraph.\n\nThird paragraph.",
    ]);
  });

  test("a picture set and a block share one placement: the block first at the same spot, each otherwise at its own", () => {
    const set: AnswerImageSet = { layout: "row", visible: 1, after_paragraph: 1, items: [{ id: "i1" } as never] };
    expect(shape(textWithAnswerParts(TEXT, { blocks: [at(sheet, 1)], images: set, imagesId: "t" }))).toEqual([
      "text:First paragraph.",
      `data:${sheet.id}`,
      "data:t",
      "text:Second paragraph.\n\nThird paragraph.",
    ]);
    expect(shape(textWithAnswerParts(TEXT, { blocks: [at(sheet, 2)], images: set, imagesId: "t" }))).toEqual([
      "text:First paragraph.",
      "data:t",
      "text:Second paragraph.",
      `data:${sheet.id}`,
      "text:Third paragraph.",
    ]);
  });

  test("no block and no picture set: the text as one part (even empty); an unreadable block is dropped, never fails the reply", () => {
    expect(textWithAnswerParts(TEXT, { blocks: [], imagesId: "t" })).toEqual([{ type: "text", text: TEXT }]);
    expect(textWithAnswerParts("", { blocks: undefined, imagesId: "t" })).toEqual([{ type: "text", text: "" }]);
    expect(shape(textWithAnswerParts(TEXT, { blocks: [{ id: "x", kind: "hologram" }, at(sheet, 1)], imagesId: "t" }))).toEqual([
      "text:First paragraph.",
      `data:${sheet.id}`,
      "text:Second paragraph.\n\nThird paragraph.",
    ]);
  });

  test("a block alone (no text): just the block", () => {
    expect(shape(textWithAnswerParts("", { blocks: [at(sheet, 0)], imagesId: "t" }))).toEqual([`data:${sheet.id}`]);
  });
});
