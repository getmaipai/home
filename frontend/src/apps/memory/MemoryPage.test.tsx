import { describe, expect, test, mock, afterEach } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MemoryPage } from "@/apps/memory/MemoryPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { MemoryRecord, Roster } from "@/lib/api";

afterEach(cleanup);

// "adult", not "owner"/"admin": the person picker (session E step 5)
// only queries GET /api/people for someone who can view another
// person's memories - every test here except the picker's own tests
// below wants that fetch to simply never happen.
function defaultPerson(overrides: Partial<Roster> = {}): Roster {
  return {
    id: "person-sage",
    display_name: "Sage",
    nickname: null,
    role: "adult",
    avatar_seed: "person-sage",
    source: "hub",
    local_only: false,
    created_at: "2026-09-05T00:00:00.000Z",
    updated_at: "2026-09-05T00:00:00.000Z",
    deleted_at: null,
    enabled: true,
    guest_expires_at: null,
    memorialized_at: null,
    hlc: "1788000000000:0:test",
    hasSecret: true,
    ...overrides,
  };
}

// A Router wrapper (PhoneNav.test.tsx's own convention): MemoryPage reads
// ?ids= via useSearchParams (the "memory updated" chip's deep link,
// docs/plans/session-b-ui.md step 4).
function renderMemoryPage(path = "/memory", person: Roster = defaultPerson()) {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={[path]}>
      <MemoryPage person={person} />
    </MemoryRouter>,
  );
}

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
    hlc: "1788000000000:0:test",
    deleted_at: null,
    ...overrides,
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
  test("shows the empty state for a household with nothing remembered yet", async () => {
    const restore = stubFetch({ "/api/memory": [] });
    try {
      const { findByText } = renderMemoryPage();
      expect(await findByText("Nothing remembered yet.")).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  // The schema page (spec/ui/pages/memory.json) shows the raw scope/
  // category value, not a name resolved against the people roster - the
  // hand-rolled version this replaced joined against a second `/api/people`
  // fetch, which the generic interpreter has no join mechanism for
  // (MemoryPage.tsx's own comment has the full reasoning); this is the
  // one documented behavior change from that version.
  test("renders a memory with its raw category and scope", async () => {
    const restore = stubFetch({ "/api/memory": [record()] });
    try {
      const { findByText } = renderMemoryPage();
      expect(await findByText("Likes dinosaurs")).toBeInTheDocument();
      expect(await findByText("preference · person")).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  test("offers a retry rather than a blank page when the fetch fails", async () => {
    const restore = stubFetch({ "/api/memory": 500 });
    try {
      const { findByRole } = renderMemoryPage();
      expect(await findByRole("button", { name: "Try again" })).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  test("archiving a memory removes it from the list", async () => {
    // Stateful, not a fixed fixture: the row_action's call invalidates
    // every schema-bound query (kit/schema/actions.ts), so a stub that
    // always returns the same array regardless of the archive call would
    // never actually prove removal.
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
      throw new Error(`unstubbed fetch: ${url}`);
    }) as unknown as typeof fetch;
    try {
      const { findByRole, queryByText } = renderMemoryPage();
      const archiveButton = await findByRole("button", { name: 'Archive "Likes dinosaurs"' });
      fireEvent.click(archiveButton);
      // Issue #21: observed flaky only under the full suite's real CPU
      // contention (never in isolation, never reproduced across several
      // dozen local full-suite runs while investigating) - the archive
      // POST, the schema-binding invalidation, and the refetch are three
      // real async hops for waitFor's default 1000ms window to land
      // inside every time. No leaked timer, retry, or poll was found
      // anywhere in this path (queryClient.ts disables retries
      // everywhere; MemoryPage.tsx has no interval/poll of its own) - a
      // wider window is the correct response to genuine scheduling
      // contention, not a guess at an unconfirmed root cause.
      await waitFor(() => expect(queryByText("Likes dinosaurs")).toBeNull(), { timeout: 5_000 });
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
    });
    try {
      const { findByText, queryByText } = renderMemoryPage("/memory?ids=mem1-abc123");
      await findByText("Likes dinosaurs");
      expect(queryByText("Allergic to peanuts")).toBeNull();
      await findByText("Show all");
      await findByText("Showing 1 memory update");
    } finally {
      restore();
    }
  });

  test("a non-admin never sees a person picker", async () => {
    const restore = stubFetch({ "/api/memory": [] });
    try {
      const { queryByRole } = renderMemoryPage("/memory", defaultPerson({ role: "adult" }));
      await waitFor(() => expect(queryByRole("combobox")).toBeNull());
    } finally {
      restore();
    }
  });

  test("an owner picking a child sees that child's memories, with forget/export instead of the schema page's own list", async () => {
    const restore = stubFetch({
      "/api/memory?person=person-bramble": [record({ id: "mem2-def456", text: "Loves dinosaurs", person: "person-bramble" })],
      "/api/memory": [record({ id: "mem1-abc123", text: "My own memory" })],
      "/api/people": [
        { id: "person-sage", display_name: "Sage", role: "owner" },
        { id: "person-bramble", display_name: "Bramble", role: "child" },
      ],
    });
    try {
      const { findByRole, findByText, queryByText } = renderMemoryPage("/memory", defaultPerson({ role: "owner" }));
      const picker = await findByRole("combobox", { name: "Viewing whose memories" });
      fireEvent.click(picker);
      fireEvent.click(await findByRole("option", { name: "Bramble" }));
      await findByText("Loves dinosaurs");
      expect(queryByText("My own memory")).toBeNull();
      await findByRole("button", { name: "Export Bramble's memories" });
      await findByRole("button", { name: "Forget everything about Bramble" });
    } finally {
      restore();
    }
  });

  test("once viewing a child, the viewer's own unscoped memory query is disabled", async () => {
    // The regression this guards: an earlier version's own-memory query
    // (GET /api/memory, no `person`) had no `enabled` guard at all, so
    // it stayed live (and its result always discarded) even while
    // viewing someone else - a wasted request and DB read for data
    // nothing on screen uses (a code review, 2026-09-06). Checked
    // directly against the query's own state, not by trying to provoke
    // a real refetch (window refocus, a remount) inside a test.
    const ownListCalls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/memory")) {
        ownListCalls.push(url);
        return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      }
      if (url.includes("person=person-bramble")) {
        return Promise.resolve(new Response(JSON.stringify([record({ person: "person-bramble" })]), { status: 200 }));
      }
      if (url.endsWith("/api/people")) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              { id: "person-sage", display_name: "Sage", role: "owner" },
              { id: "person-bramble", display_name: "Bramble", role: "child" },
            ]),
            { status: 200 },
          ),
        );
      }
      throw new Error(`unstubbed fetch: ${url}`);
    }) as unknown as typeof fetch;
    try {
      const { findByRole, queryClient } = renderMemoryPage("/memory", defaultPerson({ role: "owner" }));
      await waitFor(() => expect(ownListCalls.length).toBeGreaterThan(0)); // the legitimate self-view mount fetch
      fireEvent.click(await findByRole("combobox", { name: "Viewing whose memories" }));
      fireEvent.click(await findByRole("option", { name: "Bramble" }));
      await findByRole("button", { name: "Forget everything about Bramble" });
      const state = queryClient.getQueryState(["schema-binding", "/api/memory"]);
      const observers = queryClient.getQueryCache().find({ queryKey: ["schema-binding", "/api/memory"] })?.observers ?? [];
      expect(observers.every((o) => !o.options.enabled)).toBe(true);
      expect(state).toBeDefined(); // still cached from the earlier self-view mount, just no longer active
    } finally {
      globalThis.fetch = original;
    }
  });

  test("forgetting a child's memories asks first, then calls the real forget route", async () => {
    let forgetCalled = false;
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/api/memory/forget") && init?.method === "POST") {
        forgetCalled = true;
        return Promise.resolve(new Response(JSON.stringify({ deleted: 1 }), { status: 200 }));
      }
      if (url.includes("person=person-bramble")) {
        return Promise.resolve(
          new Response(JSON.stringify([record({ id: "mem2-def456", text: "Loves dinosaurs", person: "person-bramble" })]), {
            status: 200,
          }),
        );
      }
      if (url.endsWith("/api/memory")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
      if (url.endsWith("/api/people")) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              { id: "person-sage", display_name: "Sage", role: "owner" },
              { id: "person-bramble", display_name: "Bramble", role: "child" },
            ]),
            { status: 200 },
          ),
        );
      }
      throw new Error(`unstubbed fetch: ${url}`);
    }) as unknown as typeof fetch;
    try {
      const { findByRole, findByText } = renderMemoryPage("/memory", defaultPerson({ role: "owner" }));
      fireEvent.click(await findByRole("combobox", { name: "Viewing whose memories" }));
      fireEvent.click(await findByRole("option", { name: "Bramble" }));
      fireEvent.click(await findByRole("button", { name: "Forget everything about Bramble" }));
      await findByText("Forget everything MaiPai remembers about Bramble?");
      fireEvent.click(await findByRole("button", { name: "Yes, forget everything" }));
      await waitFor(() => expect(forgetCalled).toBe(true));
    } finally {
      globalThis.fetch = original;
    }
  });
});
