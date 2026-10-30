import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent } from "@testing-library/react";
import { StopwatchTab } from "@/apps/clock/StopwatchTab";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

afterEach(cleanup);

describe("StopwatchTab", () => {
  test("starts, records laps, stops, and resets from performance.now", () => {
    let now = 0;
    const originalNow = performance.now;
    performance.now = () => now;
    try {
      const view = renderWithQueryClient(<StopwatchTab />);
      fireEvent.click(view.getByRole("button", { name: "Start" }));
      now = 10_000;
      fireEvent.click(view.getByRole("button", { name: "Lap" }));
      now = 16_500;
      fireEvent.click(view.getByRole("button", { name: "Lap" }));
      expect(view.getByText("Lap 1")).toBeInTheDocument();
      expect(view.getByText("Lap 2")).toBeInTheDocument();
      expect(view.getAllByText("00:10.00")).toHaveLength(2);
      expect(view.getByText("00:06.50")).toBeInTheDocument();
      fireEvent.click(view.getByRole("button", { name: "Stop" }));
      now = 20_000;
      fireEvent.click(view.getByRole("button", { name: "Reset" }));
      expect(view.getByText("00:00.00")).toBeInTheDocument();
      expect(view.queryByText("Lap 1")).toBeNull();
    } finally { performance.now = originalNow; }
  });
});
