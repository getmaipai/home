import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DashboardPage } from "@/shell/pages/DashboardPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { Dashboard, Roster, SetupChecklistItem } from "@/lib/api";

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

function mockDashboardFetch(body: Dashboard, setupChecklist: SetupChecklistItem[] = []) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/dashboard")) return Promise.resolve(Response.json(body));
    if (url.includes("/api/setup-checklist")) return Promise.resolve(Response.json(setupChecklist));
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

describe("DashboardPage", () => {
  test("the home count line matches open checklist items and links to General", async () => {
    const restore = mockDashboardFetch({ people_count: 1, updates_available: false, recent_activity: [], turns_per_day: [] }, [
      { id: "family", title: "Add your family", reason: "Home works best when everyone has their own account.", done: false, open: { label: "Open People", href: "/settings/home/people" } },
      { id: "backup-target", title: "Choose where backups go", reason: "A second place keeps a copy if this computer fails.", done: true, open: { label: "Open Storage", href: "/settings/home/storage" } },
    ]);
    try {
      const view = renderWithQueryClient(<MemoryRouter><DashboardPage person={makePerson()} /></MemoryRouter>);
      const line = await view.findByRole("link", { name: "1 thing left to finish setting up" });
      expect(line.getAttribute("href")).toBe("/settings/home/general");
    } finally {
      restore();
    }
  });

  test("nothing open means there is no home count line", async () => {
    const restore = mockDashboardFetch({ people_count: 1, updates_available: false, recent_activity: [], turns_per_day: [] }, [
      { id: "family", title: "Add your family", reason: "Home works best when everyone has their own account.", done: true, open: { label: "Open People", href: "/settings/home/people" } },
    ]);
    try {
      const view = renderWithQueryClient(<MemoryRouter><DashboardPage person={makePerson()} /></MemoryRouter>);
      await waitFor(() => expect(document.body.textContent).toContain("Nova"));
      expect(view.queryByRole("link", { name: /left to finish setting up/ })).toBeNull();
    } finally {
      restore();
    }
  });

  test("a regular adult sees no checklist line and makes no checklist request", async () => {
    const restore = mockDashboardFetch({ people_count: 1, updates_available: false, recent_activity: [], turns_per_day: [] }, [
      { id: "family", title: "Add your family", reason: "Home works best when everyone has their own account.", done: false, open: { label: "Open People", href: "/settings/home/people" } },
    ]);
    try {
      const person = { ...makePerson(), role: "adult" as const };
      const view = renderWithQueryClient(<MemoryRouter><DashboardPage person={person} /></MemoryRouter>);
      await waitFor(() => expect(document.body.textContent).toContain("Nova"));
      expect(view.queryByRole("link", { name: /left to finish setting up/ })).toBeNull();
      const requested = (globalThis.fetch as unknown as ReturnType<typeof mock>).mock.calls
        .map(([input]) => typeof input === "string" ? input : String(input));
      expect(requested.some((url) => url.includes("/api/setup-checklist"))).toBe(false);
    } finally {
      restore();
    }
  });

  // A review finding: the first cut checked only `isLoading`, so a
  // failed fetch left the loading skeleton showing forever - AsyncState
  // (the kit's own shared triad) is what actually surfaces the error
  // and a retry button.
  test("a failed fetch shows an error and a retry button, never a stuck loading state", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({ error: "Something broke" }), { status: 500 }))) as unknown as typeof fetch;
    try {
      renderWithQueryClient(
        <MemoryRouter>
          <DashboardPage person={makePerson()} />
        </MemoryRouter>,
      );
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
      renderWithQueryClient(
        <MemoryRouter>
          <DashboardPage person={makePerson()} />
        </MemoryRouter>,
      );
      await waitFor(() => expect(document.body.textContent).toContain("Nova"));
      expect(document.body.textContent).toContain("Here is your household today.");
      expect(document.body.textContent).toContain("4"); // people_count
      expect(document.body.textContent).toContain("Up to date"); // updates_available: false
    } finally {
      restore();
    }
  });

  test("owner/admin: repairs render when the wire carries them, while operator words stay off Home", async () => {
    const restore = mockDashboardFetch({
      people_count: 2,
      updates_available: true,
      recent_activity: [],
      turns_per_day: Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, count: 0 })),
      repairs_open: 3,
      engines: { critical: 1, error: 0, warning: 2, total: 3 },
    });
    try {
      renderWithQueryClient(
        <MemoryRouter>
          <DashboardPage person={makePerson()} />
        </MemoryRouter>,
      );
      await waitFor(() => expect(document.body.textContent).toContain("Repairs"));
      expect(document.body.textContent).toContain("3"); // repairs_open
      expect(document.body.textContent).not.toMatch(/\b(Turns|Engines|Stack)\b/);
      expect(document.body.textContent).toContain("Available"); // updates_available: true
      // ui-v0.5.23's rail restructuring dropped these three routes'
      // permanent nav entry - the stat cards are now their real way
      // back, not just a status glance.
      for (const [label, href] of [
        ["Updates", "/updates"],
        ["Repairs", "/repairs"],
      ] as const) {
        const card = Array.from(document.querySelectorAll("a")).find((a) => a.textContent?.includes(label));
        expect(card).toBeDefined();
        expect(card!.getAttribute("href")).toBe(href);
      }
    } finally {
      restore();
    }
  });

  // The wire itself omits repairs_open/engines for anyone but owner/
  // admin (backend/src/lib/dashboard.ts's own header). All roles still
  // keep the chart and Engines card off Home.
  test("non-admin: no repairs or operator words when the wire omits admin fields", async () => {
    const restore = mockDashboardFetch({
      people_count: 2,
      updates_available: false,
      recent_activity: [],
      turns_per_day: Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, count: 0 })),
    });
    try {
      renderWithQueryClient(
        <MemoryRouter>
          <DashboardPage person={makePerson()} />
        </MemoryRouter>,
      );
      await waitFor(() => expect(document.body.textContent).toContain("People"));
      expect(document.body.textContent).not.toContain("Repairs");
      expect(document.body.textContent).not.toMatch(/\b(Turns|Engines|Stack)\b/);
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
      renderWithQueryClient(
        <MemoryRouter>
          <DashboardPage person={makePerson()} />
        </MemoryRouter>,
      );
      await waitFor(() => expect(document.body.textContent).toContain("Recent activity"));
      expect(document.querySelector('[data-slot="timeline"]')).not.toBeNull();
      expect(document.querySelector("table")).toBeNull();
      expect(document.body.textContent).toContain("chat");
      expect(document.body.textContent).toContain("Nova");
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
      renderWithQueryClient(
        <MemoryRouter>
          <DashboardPage person={makePerson()} />
        </MemoryRouter>,
      );
      await waitFor(() => expect(document.body.textContent).toContain("Nothing yet"));
      expect(document.querySelector('[data-slot="timeline"]')).not.toBeNull();
      expect(document.querySelector("table")).toBeNull();
    } finally {
      restore();
    }
  });

  test("operator words stay off Home even when the admin wire carries an empty engine state", async () => {
    const restore = mockDashboardFetch({
      people_count: 1,
      updates_available: false,
      recent_activity: [],
      turns_per_day: Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, "0")}`, count: 0 })),
      repairs_open: 0,
      engines: null,
    });
    try {
      renderWithQueryClient(
        <MemoryRouter>
          <DashboardPage person={makePerson()} />
        </MemoryRouter>,
      );
      await waitFor(() => expect(document.body.textContent).toContain("People"));
      expect(document.body.textContent).not.toMatch(/\b(Turns|Engines|Stack)\b/);
    } finally {
      restore();
    }
  });
});
