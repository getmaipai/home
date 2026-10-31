import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { AnswerBlockDataRender, drawableBlocks } from "@/apps/chat/chatAnswerBlocks";
import * as api from "@/lib/api";
import newsFeedFixture from "@maipai/spec/fixtures/answer-block/valid-story_feed.json";

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

  test("Undo posts the block id to the undo route", async () => {
    const request = spyOn(api, "request").mockResolvedValue({ ok: true });
    const Render = AnswerBlockDataRender as unknown as (props: { data: unknown }) => React.ReactElement;
    const confirmation = {
      ...block,
      id: "blk-undo12345",
      kind: "confirmation",
      producer: "remind",
      props: {
        icon: "clock",
        sentence: "Reminder set.",
        undo: { label: "Undo", action: "undo" },
      },
    };
    const { getByText } = render(<Render data={confirmation} />);

    await act(async () => {
      fireEvent.click(getByText("Undo"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(request).toHaveBeenCalledWith("/api/tool-undo/blk-undo12345", { method: "POST" });
    request.mockRestore();
  });

  test("confirmation without undo does not show an Undo button", () => {
    const Render = AnswerBlockDataRender as unknown as (props: { data: unknown }) => React.ReactElement;
    const confirmation = {
      ...block,
      kind: "confirmation",
      props: { icon: "clock", sentence: "Reminder set." },
    };
    const { queryByText } = render(<Render data={confirmation} />);
    expect(queryByText("Undo")).toBeNull();
  });

  test("the pinned UI validator keeps News stories with sourceIconUrl", () => {
    const storyFeed = structuredClone(newsFeedFixture);
    storyFeed.props.rows[0] = { ...storyFeed.props.rows[0]!, sourceIconUrl: "/api/favicon?domain=example.com" } as typeof storyFeed.props.rows[0];
    const [accepted] = drawableBlocks([storyFeed]);
    expect(accepted?.kind).toBe("story_feed");

    const Render = AnswerBlockDataRender as unknown as (props: { data: unknown }) => React.ReactElement;
    const { container, getByText } = render(<Render data={accepted} />);
    expect(container.querySelector('[data-slot="story-feed"]')).not.toBeNull();
    expect(getByText("Headline 5")).toBeTruthy();
  });
});
