import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { AnswerBlockDataRender } from "@/apps/chat/chatAnswerBlocks";

afterEach(cleanup);

const block = {
  id: "blk-aaaaaaaaaaaa",
  kind: "spec_sheet",
  schema_version: 1,
  producer: "weather",
  alt: "Weather in a place now: 57.3 degrees.",
  provenance: "weather result in turn t1",
  created_at: "2026-10-10T01:30:34.117Z",
  hlc: "1791595834117:0:abcdef",
  props: { title: "Place", rows: [{ label: "Temperature", value: "57.3°F" }] },
};

describe("the answer_block part draws the kit Element, not the alt sentence", () => {
  test("a block the hub placed (after_paragraph set) still renders its Element", () => {
    const Render = AnswerBlockDataRender as unknown as (props: { data: unknown }) => React.ReactElement;
    const { container } = render(<Render data={{ ...block, after_paragraph: 0 }} />);
    expect(container.querySelector('[data-slot="spec-sheet"]')).not.toBeNull();
    expect(container.querySelector("[data-fallback]")).toBeNull();
  });
});
