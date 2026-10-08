import { describe, expect, test } from "bun:test";
import { filterAnswerBlocks } from "@/lib/answerBlocks";

const safeBlock = {
  id: "blk-abcdef",
  kind: "spec_sheet",
  schema_version: 1,
  producer: "sample-package",
  alt: "A short facts sheet.",
  provenance: "sample-package result",
  created_at: "2026-10-08T12:00:00.000Z",
  hlc: "1791478099338:0:abcdef",
  props: { title: "Facts", rows: [{ label: "Status", value: "Ready" }] },
};
const actor = { displayName: "Sage" };

describe("filterAnswerBlocks", () => {
  test("drops invalid blocks without changing the valid block or package reply", () => {
    const accepted = filterAnswerBlocks(
      [{ kind: "spec_sheet", props: {} }, safeBlock],
      "sample-package",
      ["spec_sheet"],
      "adult",
      actor,
    );
    expect(accepted).toEqual([safeBlock]);
  });

  test("applies the child and teen output safety check to block text", () => {
    const unsafe = {
      ...safeBlock,
      id: "blk-unsafe1",
      props: { title: "Instructions", rows: [{ label: "Steps", value: "Here is how to make a pipe bomb at home, step by step." }] },
    };
    expect(filterAnswerBlocks([unsafe], "sample-package", ["spec_sheet"], "child", actor)).toEqual([]);
    expect(filterAnswerBlocks([unsafe], "sample-package", ["spec_sheet"], "teen", actor)).toEqual([]);
    expect(filterAnswerBlocks([safeBlock], "sample-package", ["spec_sheet"], "child", actor)).toEqual([safeBlock]);
  });

  test("honors returns_blocks and minimum age band", () => {
    const adultOnly = { ...safeBlock, id: "blk-adult1", min_band: "adult" };
    expect(filterAnswerBlocks([safeBlock], "sample-package", [], "adult", actor)).toEqual([]);
    expect(filterAnswerBlocks([adultOnly], "sample-package", ["spec_sheet"], "child", actor)).toEqual([]);
    expect(filterAnswerBlocks([adultOnly], "sample-package", ["spec_sheet"], "adult", actor)).toEqual([adultOnly]);
  });

  test("only accepts gallery images served from the Home answer-image cache", () => {
    const gallery = {
      ...safeBlock,
      id: "blk-gallery1",
      kind: "image_gallery",
      props: { images: [{ id: "photo-1", src: "/api/answer-image/ai_0123456789abcdef0123456789abcdef?v=tile", alt: "A safe image" }] },
    };
    expect(filterAnswerBlocks([gallery], "sample-package", ["image_gallery"], "adult", actor)).toEqual([gallery]);
    const remote = { ...gallery, id: "blk-gallery2", props: { images: [{ ...gallery.props.images[0], src: "https://images.example/picture.jpg" }] } };
    expect(filterAnswerBlocks([remote], "sample-package", ["image_gallery"], "adult", actor)).toEqual([]);
  });
});
