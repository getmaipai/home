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
  test("the shipped stub lists the kit's elements, none implemented", () => {
    expect(ELEMENTS.length).toBeGreaterThan(100);
    expect(ELEMENTS.every((i) => i.status === "not yet")).toBe(true);
  });
});

describe("ElementsAdoptionPanel", () => {
  const items = normalizeAdoption([
    { file: "math-block.tsx", name: "math-block", group: "math", verdict: "wire now", implemented: true },
    { file: "chart.tsx", name: "chart", group: "chart", verdict: "later" },
  ]);
  test("playground-only is counted apart from implemented and not yet, and never as done", () => {
    const list = normalizeAdoption([
      { file: "math-block.tsx", name: "math-block", implemented: true },
      { file: "data-table.tsx", name: "data-table" },
      { file: "chart.tsx", name: "chart" },
    ]);
    const view = render(<ElementsAdoptionPanel items={list} scenarioIds={new Set(["math", "table"])} liveByScenario={{ math: "yes", table: "needs: a real table result" }} onPlay={() => {}} />);
    expect(view.container.querySelector("[data-slot=elements-adoption-total]")!.textContent).toBe("1 / 3 implemented");
    expect(view.container.querySelector("[data-slot=elements-adoption-split]")!.textContent).toBe("in playground only: 1 · not yet: 1");
  });

  test("shows N / total, the verdict counts, and a Play button only for an Element with a scenario", () => {
    const onPlay = mock(() => {});
    const view = render(<ElementsAdoptionPanel items={items} scenarioIds={new Set(["math"])} onPlay={onPlay} />);
    expect(view.container.querySelector("[data-slot=elements-adoption-total]")!.textContent).toBe("1 / 2 implemented");
    expect(view.getByText("wire now: 1")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Show every Element" }));
    fireEvent.click(view.getByRole("button", { name: /^math/ }));
    fireEvent.click(view.getByRole("button", { name: "Play the scenario for math-block" }));
    expect(onPlay).toHaveBeenCalledWith("math");
    expect(view.queryByRole("button", { name: "Play the scenario for chart" })).toBeNull();
  });
});
