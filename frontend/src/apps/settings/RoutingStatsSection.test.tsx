import { describe, expect, test, mock, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/react";
import { RoutingStatsSection } from "@/apps/settings/RoutingStatsSection";

// `@testing-library/dom`'s global `screen` singleton is computed once at
// module-load time, before Bun's test preload finishes registering
// happy-dom's globals - it permanently falls back to a stub that throws.
// Every query here comes from render()'s own returned queries instead
// (ChatPage.test.tsx's own header comment already documents this).

afterEach(cleanup);

function stubFetch(body: unknown) {
  return mock(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))) as unknown as typeof fetch;
}

describe("RoutingStatsSection", () => {
  test("shows the fall-through rate as a percentage and per-skill counts", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch({
      total: 3,
      skill: 2,
      skillError: 0,
      model: 1,
      safetyRefuse: 0,
      fallthroughRate: 1 / 3,
      bySkill: [
        { skillId: "remember", count: 1 },
        { skillId: "recall", count: 1 },
      ],
    });
    try {
      const { findByText } = render(<RoutingStatsSection />);
      await findByText("33%");
      await findByText("remember");
      await findByText("recall");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("shows a dash, not '0%' or NaN, when the rate is null", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch({
      total: 1,
      skill: 0,
      skillError: 0,
      model: 0,
      safetyRefuse: 1,
      fallthroughRate: null,
      bySkill: [],
    });
    try {
      const { findByText, queryByText } = render(<RoutingStatsSection />);
      await findByText("—");
      expect(queryByText("0%")).toBeNull();
      expect(queryByText("NaN%")).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("shows a plain empty state before any chat turns exist", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch({
      total: 0,
      skill: 0,
      skillError: 0,
      model: 0,
      safetyRefuse: 0,
      fallthroughRate: null,
      bySkill: [],
    });
    try {
      const { findByText } = render(<RoutingStatsSection />);
      await findByText("No chat turns yet.");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
