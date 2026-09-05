import { describe, expect, test, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/react";
import { SplitView } from "@/kit/primitives/SplitView";

afterEach(cleanup);

function renderSplit(detailOpen: boolean) {
  return render(
    <SplitView
      detailOpen={detailOpen}
      listLabel="People"
      detailLabel="Person"
      list={<p>The list</p>}
      detail={<p>The detail</p>}
    />,
  );
}

describe("SplitView", () => {
  test("renders both halves, so tablet and desktop show them side by side", () => {
    const { getByText } = renderSplit(false);
    expect(getByText("The list")).toBeInTheDocument();
    expect(getByText("The detail")).toBeInTheDocument();
  });

  // docs/UI.md's density budget is one column on phone, so the two
  // halves take turns there instead of splitting a 375px screen in two.
  test("on phone, nothing selected shows the list and hides the detail", () => {
    const { getByLabelText } = renderSplit(false);
    expect(getByLabelText("People").className).not.toContain("max-sm:hidden");
    expect(getByLabelText("Person").className).toContain("max-sm:hidden");
  });

  test("on phone, a selection shows the detail and hides the list", () => {
    const { getByLabelText } = renderSplit(true);
    expect(getByLabelText("People").className).toContain("max-sm:hidden");
    expect(getByLabelText("Person").className).not.toContain("max-sm:hidden");
  });

  test("both halves stay in the tree at every surface, so a swap is not a remount", () => {
    const { getByText, rerender } = renderSplit(false);
    const list = getByText("The list");
    rerender(
      <SplitView
        detailOpen
        listLabel="People"
        detailLabel="Person"
        list={<p>The list</p>}
        detail={<p>The detail</p>}
      />,
    );
    expect(getByText("The list")).toBe(list);
  });

  test("a half is only announced as a region when it has a name", () => {
    const { queryAllByRole } = render(
      <SplitView list={<p>The list</p>} detail={<p>The detail</p>} />,
    );
    expect(queryAllByRole("region")).toHaveLength(0);
  });

  test("named halves are labelled regions", () => {
    const { getAllByRole } = renderSplit(false);
    expect(getAllByRole("region").map((r) => r.getAttribute("aria-label"))).toEqual(["People", "Person"]);
  });

  test("a keyboard can reach the scrolling list column", () => {
    const { getByLabelText } = renderSplit(false);
    expect(getByLabelText("People")).toHaveAttribute("tabindex", "0");
  });

  test("the split is fluid, never a fixed pixel width", () => {
    const { getByLabelText } = renderSplit(false);
    const list = getByLabelText("People").className;
    expect(list).toContain("sm:w-2/5");
    expect(list).toContain("lg:w-1/3");
    expect(list).not.toMatch(/\bw-\[\d+px\]/);
  });
});
