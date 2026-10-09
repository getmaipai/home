import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { TurnTracePage } from "@/next/pages/TurnTracePage";

afterEach(cleanup);

describe("TurnTracePage", () => {
  test("renders the kit waterfall using the one trace endpoint call", async () => {
    const originalFetch = globalThis.fetch;
    const requested: string[] = [];
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      requested.push(typeof input === "string" ? input : input.toString());
      return Response.json({
        totalMs: 20,
        spans: [{ id: "node-0", name: "model · runGeneration v1", depth: 0, startMs: 0, durationMs: 20, status: "completed" }],
      });
    }) as unknown as typeof fetch;
    try {
      renderWithQueryClient(<MemoryRouter initialEntries={["/next/trace/t-123"]}><Routes><Route path="/next/trace/:turnId" element={<TurnTracePage />} /></Routes></MemoryRouter>);
      await waitFor(() => expect(document.body.textContent).toContain("runGeneration"));
      expect(document.body.textContent).toContain("20ms");
      expect(requested).toEqual(["/api/admin/turns/t-123/trace"]);
    } finally { globalThis.fetch = originalFetch; }
  });
});
