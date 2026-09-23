import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { NextPerformancePage } from "@/next/pages/NextPerformancePage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { Performance } from "@/lib/api";

afterEach(() => {
  cleanup();
});

function makePerformance(overrides: Partial<Performance> = {}): Performance {
  return {
    turns: { window_days: 30, by_day: [{ date: "2026-09-22", count: 0, median_ttft_ms: null, p95_ttft_ms: null, median_total_ms: null, p95_total_ms: null, median_tokens_per_second: null }], by_engine: [], by_route: [] },
    queues: { judge: { pending: 0, oldest_created_at: null }, embedding: { pending: 0 }, ingestion: { pending: 0, by_reason: [] } },
    labels: { window_days: 30, turns: 0, guard_hits: [], rule_hits: [], rungs: [], retire_eligible: [] },
    layers: { window_days: 30, turns_with_trace: 0, nodes: [] },
    engines: { configured: false, roles: [], engines: [], budget: null, recent_issues: [] },
    hardware: { configured: false, hardware: null },
    disk: { total_bytes: 100, free_bytes: 50, areas: [] },
    retention_days: 90,
    ...overrides,
  } as Performance;
}

function mockPerformanceFetch(data: Performance | { status: number }) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(() => {
    if ("status" in data) return Promise.resolve(new Response(JSON.stringify({ error: "Something broke" }), { status: data.status }));
    return Promise.resolve(Response.json(data));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

describe("NextPerformancePage", () => {
  test("no traced turns yet: the Layers panel's own honest empty state", async () => {
    const restore = mockPerformanceFetch(makePerformance());
    try {
      renderWithQueryClient(<NextPerformancePage />);
      await waitFor(() => expect(document.body.textContent).toContain("No traced turns yet"));
      expect(document.body.textContent).toContain("No Stack configured");
    } finally {
      restore();
    }
  });

  test("a traced turn: the Layers panel shows the per-node medians", async () => {
    const restore = mockPerformanceFetch(
      makePerformance({
        layers: { window_days: 30, turns_with_trace: 4, nodes: [{ node: "model", count: 4, median_ms: 210, p95_ms: 400 }] },
      }),
    );
    try {
      renderWithQueryClient(<NextPerformancePage />);
      await waitFor(() => expect(document.body.textContent).toContain("4 traced turn"));
      expect(document.body.textContent).toContain("model");
      expect(document.body.textContent).not.toContain("No traced turns yet");
    } finally {
      restore();
    }
  });

  test("real turn stats render in the engine table and route breakdown", async () => {
    const restore = mockPerformanceFetch(
      makePerformance({
        turns: {
          window_days: 30,
          by_day: [{ date: "2026-09-22", count: 3, median_ttft_ms: 400, p95_ttft_ms: 600, median_total_ms: 2000, p95_total_ms: 3000, median_tokens_per_second: 25 }],
          by_engine: [{ engine: "local b1 qwen3-8b-instruct-q4-k-m", count: 3, median_ttft_ms: 400, p95_ttft_ms: 600, median_total_ms: 2000, p95_total_ms: 3000, median_tokens_per_second: 25 }],
          by_route: [{ route: "model", count: 3 }],
        },
      }),
    );
    try {
      renderWithQueryClient(<NextPerformancePage />);
      await waitFor(() => expect(document.body.textContent).toContain("qwen3-8b-instruct-q4-k-m"));
      expect(document.body.textContent).toContain("model");
    } finally {
      restore();
    }
  });

  test("a failed fetch shows an error and a retry button, never a stuck loading state", async () => {
    const restore = mockPerformanceFetch({ status: 500 });
    try {
      renderWithQueryClient(<NextPerformancePage />);
      await waitFor(() => expect(document.body.textContent).toContain("Something broke"));
      expect(document.body.textContent).toContain("Try again");
    } finally {
      restore();
    }
  });
});
