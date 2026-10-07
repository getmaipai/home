import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TurnTracePage } from "@/shell/pages/TurnTracePage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

afterEach(cleanup);

describe("TurnTracePage", () => {
  test("renders the shipped TraceWaterfall from its timing-only response", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(Response.json({
      spans: [{ id: "node-0", name: "model · model-node v1", depth: 0, startMs: 10, durationMs: 20, status: "completed" }],
      totalMs: 30,
      visibleCount: 1,
    }))) as unknown as typeof fetch;
    try {
      renderWithQueryClient(<MemoryRouter initialEntries={["/trace/turn-1"]}><Routes><Route path="/trace/:turnId" element={<TurnTracePage />} /></Routes></MemoryRouter>);
      await waitFor(() => expect(document.querySelector("[data-slot='trace-waterfall']")).toBeTruthy());
      expect(document.body.textContent).toContain("model · model-node v1");
      expect(document.body.textContent).toContain("30ms");
      expect(document.body.textContent).not.toContain("turn-1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
