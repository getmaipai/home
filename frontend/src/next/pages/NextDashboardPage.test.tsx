import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { NextDashboardPage } from "@/next/pages/NextDashboardPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { Dashboard, Roster } from "@/lib/api";

afterEach(() => {
  cleanup();
});

function makePerson(): Roster {
  return {
    id: "person-abc123",
    display_name: "Nova",
    nickname: null,
    role: "owner",
    avatar_seed: "person-abc123",
    source: "hub",
    local_only: false,
    created_at: "2026-09-04T00:00:00.000Z",
    updated_at: "2026-09-04T00:00:00.000Z",
    deleted_at: null,
    enabled: true,
    guest_expires_at: null,
    memorialized_at: null,
    hlc: "1788000000000:0:test",
    hasSecret: true,
  };
}

function mockDashboardFetch(body: Dashboard) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/dashboard")) return Promise.resolve(Response.json(body));
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

describe("NextDashboardPage", () => {
  // A review finding: the first cut checked only `isLoading`, so a
  // failed fetch left the loading skeleton showing forever - AsyncState
  // (the kit's own shared triad) is what actually surfaces the error
  // and a retry button.
  test("a failed fetch shows an error and a retry button, never a stuck loading state", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({ error: "Something broke" }), { status: 500 }))) as unknown as typeof fetch;
    try {
      renderWithQueryClient(<NextDashboardPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Something broke"));
      expect(document.body.textContent).toContain("Try again");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });


  test("shows the greeting with the signed-in person's own name, and the household counts", async () => {
    const restore = mockDashboardFetch({
      people_count: 4,
      updates_available: false,
      recent_activity: [],
      turns_per_day: Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, count: 0 })),
    });
    try {
      renderWithQueryClient(<NextDashboardPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Nova"));
      expect(document.body.textContent).toContain("4"); // people_count
      expect(document.body.textContent).toContain("Up to date"); // updates_available: false
    } finally {
      restore();
    }
  });

  test("owner/admin: repairs and engines cards render when the wire carries them", async () => {
    const restore = mockDashboardFetch({
      people_count: 2,
      updates_available: true,
      recent_activity: [],
      turns_per_day: Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, count: 0 })),
      repairs_open: 3,
      engines: { critical: 1, error: 0, warning: 2, total: 3 },
    });
    try {
      renderWithQueryClient(<NextDashboardPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Repairs"));
      expect(document.body.textContent).toContain("3"); // repairs_open
      expect(document.body.textContent).toContain("Engines");
      expect(document.body.textContent).toContain("3 issues"); // 1 critical + 0 error + 2 warning
      expect(document.body.textContent).toContain("Available"); // updates_available: true
    } finally {
      restore();
    }
  });

  // The wire itself omits repairs_open/engines for anyone but owner/
  // admin (backend/src/lib/dashboard.ts's own header) - the page must
  // never render these cards with a faked zero when they're simply
  // absent from the response.
  test("non-admin: no repairs or engines card at all when the wire omits them", async () => {
    const restore = mockDashboardFetch({
      people_count: 2,
      updates_available: false,
      recent_activity: [],
      turns_per_day: Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, count: 0 })),
    });
    try {
      renderWithQueryClient(<NextDashboardPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("People"));
      expect(document.body.textContent).not.toContain("Repairs");
      expect(document.body.textContent).not.toContain("Engines");
    } finally {
      restore();
    }
  });

  test("recent activity: renders real rows, and the empty state when there are none", async () => {
    const restore = mockDashboardFetch({
      people_count: 1,
      updates_available: false,
      recent_activity: [{ turn_id: "turn-1", person_id: "person-abc123", display_name: "Nova", created_at: "2026-09-21T12:00:00.000Z", surface: "chat", source: "model" }],
      turns_per_day: Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, count: 0 })),
    });
    try {
      renderWithQueryClient(<NextDashboardPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Recent activity"));
      expect(document.body.textContent).toContain("chat");
      expect(document.body.textContent).not.toContain("Nothing yet");
    } finally {
      restore();
    }
  });

  test("recent activity: the empty state, not a blank table, when the wire carries no rows", async () => {
    const restore = mockDashboardFetch({
      people_count: 1,
      updates_available: false,
      recent_activity: [],
      turns_per_day: Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, count: 0 })),
    });
    try {
      renderWithQueryClient(<NextDashboardPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Nothing yet"));
    } finally {
      restore();
    }
  });

  test("engines card: the Stack-not-configured empty state, never a faked count", async () => {
    const restore = mockDashboardFetch({
      people_count: 1,
      updates_available: false,
      recent_activity: [],
      turns_per_day: Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, count: 0 })),
      repairs_open: 0,
      engines: null,
    });
    try {
      renderWithQueryClient(<NextDashboardPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Engines"));
      expect(document.body.textContent).toContain("No Stack");
    } finally {
      restore();
    }
  });
});
