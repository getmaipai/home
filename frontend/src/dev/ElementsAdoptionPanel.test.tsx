import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { ElementsAdoptionPanel } from "@/dev/ElementsAdoptionPanel";
import { ELEMENTS, normalizeAdoption } from "@/dev/elementsAdoption";

afterEach(cleanup);

describe("normalizeAdoption", () => {
  test("accepts items[] or a bare array, derives status from implemented, verdict and status, and survives missing fields", () => {
    const items = normalizeAdoption({ items: [
      { file: "a.tsx", name: "a", group: "g", verdict: "wire-now", implemented: true },
      { file: "b.tsx", name: "b", group: "g", verdict: "no fit" },
      { file: "c.tsx", status: "in progress" },
      { file: "d.tsx", verdict: "later" },
      { name: "" },
    ] });
    expect(items.map((i) => [i.name, i.verdict, i.status])).toEqual([["a", "wire now", "implemented"], ["b", "no fit", "not for us"], ["c", "unassessed", "in progress"], ["d", "later", "not yet"]]);
    expect(normalizeAdoption([{ file: "x.tsx" }])).toHaveLength(1);
    expect(normalizeAdoption(null)).toEqual([]);
  });
  test("no item stays unassessed after a scan with the plan", () => {
    expect(ELEMENTS.length).toBeGreaterThan(100);
    expect(ELEMENTS.every((i) => i.verdict !== "unassessed")).toBe(true);
  });
});

describe("ElementsAdoptionPanel", () => {
  const items = normalizeAdoption([
    { file: "math-block.tsx", name: "math-block", group: "math", verdict: "wire now", implemented: true },
    { file: "chart.tsx", name: "chart", group: "chart", verdict: "later" },
  ]);
  test("the headline counts only wire-now and wire-after Elements", () => {
    const view = render(<ElementsAdoptionPanel items={normalizeAdoption([
      { file: "a.tsx", verdict: "wire-now", implemented: true },
      { file: "b.tsx", verdict: "wire-after", implemented: false },
      { file: "c.tsx", verdict: "support", implemented: true },
      { file: "d.tsx", verdict: "later", implemented: true },
      { file: "e.tsx", verdict: "no-fit", implemented: false },
    ])} scenarioIds={new Set()} onPlay={() => {}} />);
    expect(view.container.querySelector("[data-slot=elements-adoption-total]")!.textContent).toBe("1 / 2 in use in chat");
    expect(view.getByText("Not planned for chat: 1 no fit, 1 later, 1 supporting parts.")).toBeTruthy();
  });

  test("an Element imported by chat source counts as in use", () => {
    const onPlay = mock(() => {});
    const view = render(<ElementsAdoptionPanel items={items} scenarioIds={new Set(["math"])} onPlay={onPlay} />);
    expect(view.container.querySelector("[data-slot=elements-adoption-total]")!.textContent).toBe("1 / 1 in use in chat");
    expect(view.getByText("wire now: 1")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Show every Element" }));
    fireEvent.click(view.getByRole("button", { name: /^wire now/ }));
    fireEvent.click(view.getByRole("button", { name: "Play the scenario for math-block" }));
    expect(onPlay).toHaveBeenCalledWith("math");
    expect(view.queryByRole("button", { name: "Play the scenario for chart" })).toBeNull();
  });
});
