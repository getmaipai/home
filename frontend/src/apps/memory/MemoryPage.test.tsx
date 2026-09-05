import { describe, expect, test, mock, afterEach } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MemoryPage } from "@/apps/memory/MemoryPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { MemoryRecord, PersonRosterEntry } from "@/lib/api";

afterEach(cleanup);

// A Router wrapper (PhoneNav.test.tsx's own convention): MemoryPage now
// reads ?ids= via useSearchParams (the "memory updated" chip's deep link,
// docs/plans/session-b-ui.md step 4).
function renderMemoryPage(path = "/memory") {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={[path]}>
      <MemoryPage />
    </MemoryRouter>,
  );
}

// Matching memoryLabels.test.ts's own fixture builder exactly.
function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "mem1-abc123",
    record_kind: "memory",
    text: "Likes dinosaurs",
    category: "preference",
    tier: "durable",
    status: "active",
    scope: "person",
    person: "person-abc123",
    source: "chat",
    importance: 0.5,
    pinned: false,
    sensitive: false,
    uses: 0,
    created_at: "2026-09-04T00:00:00.000Z",
    last_used_at: "2026-09-04T00:00:00.000Z",
    valid_from: null,
    valid_to: null,
    expired_at: null,
    superseded_by: null,
    embedding_space: null,
    ...overrides,
  };
}

function person(id: string, name: string): PersonRosterEntry {
  return {
    id,
    display_name: name,
    nickname: null,
    role: "child",
    avatar_seed: id,
    source: "hub",
    local_only: false,
    created_at: "2026-09-04T00:00:00.000Z",
    updated_at: "2026-09-04T00:00:00.000Z",
    deleted_at: null,
  };
}

function stubFetch(byPath: Record<string, unknown>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    // The longest matching path wins, not the first declared: "/api/memory"
    // and "/mem1-abc123/archive" both match the real archive URL
    // ("/api/memory/mem1-abc123/archive"), and the archive-specific
    // response has to win over the generic list one.
    const candidates = Object.entries(byPath).filter(([path]) => url.includes(path));
    const match = candidates.sort((a, b) => b[0].length - a[0].length)[0];
    if (!match) throw new Error(`unstubbed fetch: ${url}`);
    const value = match[1];
    if (typeof value === "number") return Promise.resolve(new Response("", { status: value }));
    return Promise.resolve(new Response(JSON.stringify(value), { status: 200 }));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

describe("MemoryPage", () => {
  test("is readable while it loads, not a blank page", async () => {
    const restore = stubFetch({ "/api/memory": [], "/api/people": [] });
    try {
      const { getByRole } = renderMemoryPage();
      expect(getByRole("status", { name: "Loading memory" })).toBeInTheDocument();
      await waitFor(() => {});
    } finally {
      restore();
    }
  });

  test("shows the empty state for a household with nothing remembered yet", async () => {
    const restore = stubFetch({ "/api/memory": [], "/api/people": [] });
    try {
      const { findByText } = renderMemoryPage();
      expect(await findByText("Nothing remembered yet.")).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  test("renders a memory with its scope resolved against the roster", async () => {
    const restore = stubFetch({
      "/api/memory": [record()],
      "/api/people": [person("person-abc123", "Nova")],
    });
    try {
      const { findByText } = renderMemoryPage();
      expect(await findByText("Likes dinosaurs")).toBeInTheDocument();
      expect(await findByText(/Nova · Preference/)).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  test("offers a retry rather than a blank page when the fetch fails", async () => {
    const restore = stubFetch({ "/api/memory": 500, "/api/people": 500 });
    try {
      const { findByRole } = renderMemoryPage();
      expect(await findByRole("button", { name: "Try again" })).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  test("archiving a memory removes it from the list", async () => {
    // Stateful, not a fixed fixture: the mutation invalidates and
    // refetches the list (kit's own "mutations with invalidation"
    // pattern), so a stub that always returns the same array regardless
    // of the archive call would never actually prove removal - it would
    // just leave the memory on screen and the test waiting forever for
    // an assertion that can never come true.
    let archived = false;
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/mem1-abc123/archive")) {
        archived = true;
        return Promise.resolve(new Response(JSON.stringify({ ...record(), status: "archived" }), { status: 200 }));
      }
      if (url.includes("/api/memory")) {
        return Promise.resolve(new Response(JSON.stringify(archived ? [] : [record()]), { status: 200 }));
      }
      if (url.includes("/api/people")) {
        return Promise.resolve(new Response(JSON.stringify([person("person-abc123", "Nova")]), { status: 200 }));
      }
      throw new Error(`unstubbed fetch: ${url}`);
    }) as unknown as typeof fetch;
    try {
      const { findByRole, queryByText } = renderMemoryPage();
      const archiveButton = await findByRole("button", { name: 'Archive "Likes dinosaurs"' });
      fireEvent.click(archiveButton);
      await waitFor(() => expect(queryByText("Likes dinosaurs")).toBeNull());
    } finally {
      globalThis.fetch = original;
    }
  });

  // Chat's "memory updated" chip (chatMemoryChip.tsx, step 4) deep-links
  // here with ?ids= - a client-side filter over the same list, not a new
  // backend query.
  test("?ids= filters the list to just those memories, with a way back to the full list", async () => {
    const restore = stubFetch({
      "/api/memory": [record({ id: "mem1-abc123", text: "Likes dinosaurs" }), record({ id: "mem2-def456", text: "Allergic to peanuts" })],
      "/api/people": [person("person-abc123", "Nova")],
    });
    try {
      const { findByText, queryByText } = renderMemoryPage("/memory?ids=mem1-abc123");
      await findByText("Likes dinosaurs");
      expect(queryByText("Allergic to peanuts")).toBeNull();
      await findByText("Show all");
    } finally {
      restore();
    }
  });
});
