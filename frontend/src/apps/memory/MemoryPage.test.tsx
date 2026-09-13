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

  // Shows the raw scope/category value, not a name resolved against the
  // people roster - joining against a second `/api/people` fetch for
  // one subtitle line is exactly the kind of ahead-of-need primitive
  // docs/plans/session-b-ui.md step 5 says not to build for a single
  // page (MemoryPage.tsx's own comment has the full reasoning).
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
    // Stateful, not a fixed fixture: handleArchive() invalidates
    // ["memory-list", "me"], so a stub that always returns the same
    // array regardless of the archive call would never actually prove
    // removal.
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
      // Unlike the own-list's "{category} · {scope}" line: every one of
      // a child's own memories is scope=person already, so repeating
      // "person" on every row would be a redundant word, not new
      // information (MemoryRows' own `subtitle` override for this view).
      expect(await findByText("preference")).toBeInTheDocument();
      expect(queryByText("preference · person")).toBeNull();
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
    //
    // `OwnMemories` (lane 3 item 4, 2026-09-13) fully unmounts once
    // viewing someone else - the query key `["memory-list", "me"]` is
    // MemoryPage.tsx's OWN `enabled: viewingSelf` guard (kept for the
    // `?ids=` chip's `visibleCount`), the one still alive here.
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
      const state = queryClient.getQueryState(["memory-list", "me"]);
      const observers = queryClient.getQueryCache().find({ queryKey: ["memory-list", "me"] })?.observers ?? [];
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

  // Lane 3 item 4 (2026-09-13): the org's standing batch-actions rule
  // (docs/UI.md > Batch actions), applied to Memory's own list -
  // People/Conversations/Users already had it, Memory was the case
  // Jesse named specifically.
  describe("batch select and clear-all", () => {
    function twoRecords() {
      return [
        record({ id: "mem1-abc123", text: "Likes dinosaurs" }),
        record({ id: "mem2-def456", text: "Allergic to peanuts" }),
      ];
    }

    test("select mode shows the count as rows are checked", async () => {
      const restore = stubFetch({ "/api/memory": twoRecords() });
      try {
        const { findByRole, findByText } = renderMemoryPage();
        fireEvent.click(await findByRole("button", { name: "Select memories" }));
        expect(await findByText("0 selected")).toBeInTheDocument();
        fireEvent.click(await findByRole("checkbox", { name: "Select Likes dinosaurs" }));
        expect(await findByText("1 selected")).toBeInTheDocument();
        fireEvent.click(await findByRole("checkbox", { name: "Select Allergic to peanuts" }));
        expect(await findByText("2 selected")).toBeInTheDocument();
      } finally {
        restore();
      }
    });

    test("forgetting selected memories asks first, then removes exactly those rows", async () => {
      let forgottenIds: string[] | null = null;
      const original = globalThis.fetch;
      globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.endsWith("/api/memory/batch-forget") && init?.method === "POST") {
          forgottenIds = (JSON.parse(init.body as string) as { ids: string[] }).ids;
          return Promise.resolve(
            new Response(JSON.stringify({ outcomes: forgottenIds.map((id) => ({ id, deleted: true })) }), { status: 200 }),
          );
        }
        if (url.endsWith("/api/memory")) {
          return Promise.resolve(
            new Response(JSON.stringify(forgottenIds ? twoRecords().filter((r) => !forgottenIds!.includes(r.id)) : twoRecords()), {
              status: 200,
            }),
          );
        }
        throw new Error(`unstubbed fetch: ${url}`);
      }) as unknown as typeof fetch;
      try {
        const { findByRole, findByText, queryByText } = renderMemoryPage();
        await findByText("Likes dinosaurs");
        fireEvent.click(await findByRole("button", { name: "Select memories" }));
        fireEvent.click(await findByRole("checkbox", { name: "Select Likes dinosaurs" }));
        fireEvent.click(await findByRole("button", { name: "Forget selected" }));
        await findByText("Forget 1 memory? This cannot be undone.");
        fireEvent.click(await findByRole("button", { name: "Yes, forget 1" }));
        await waitFor(() => expect(forgottenIds).toEqual(["mem1-abc123"]));
        await waitFor(() => expect(queryByText("Likes dinosaurs")).toBeNull());
        expect(await findByText("Allergic to peanuts")).toBeInTheDocument();
      } finally {
        globalThis.fetch = original;
      }
    });

    test("clear all asks, names the real count, then empties the list", async () => {
      let forgottenIds: string[] | null = null;
      const original = globalThis.fetch;
      globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.endsWith("/api/memory/batch-forget") && init?.method === "POST") {
          forgottenIds = (JSON.parse(init.body as string) as { ids: string[] }).ids;
          return Promise.resolve(
            new Response(JSON.stringify({ outcomes: forgottenIds.map((id) => ({ id, deleted: true })) }), { status: 200 }),
          );
        }
        if (url.endsWith("/api/memory")) {
          return Promise.resolve(new Response(JSON.stringify(forgottenIds ? [] : twoRecords()), { status: 200 }));
        }
        throw new Error(`unstubbed fetch: ${url}`);
      }) as unknown as typeof fetch;
      try {
        const { findByRole, findByText, queryByText } = renderMemoryPage();
        await findByText("Likes dinosaurs");
        fireEvent.click(await findByRole("button", { name: "Clear all" }));
        await findByText("Forget every one of your 2 memories? This cannot be undone.");
        fireEvent.click(await findByRole("button", { name: "Yes, forget all" }));
        await waitFor(() => expect(forgottenIds).toEqual(["mem1-abc123", "mem2-def456"]));
        await waitFor(() => expect(queryByText("Likes dinosaurs")).toBeNull());
        expect(queryByText("Allergic to peanuts")).toBeNull();
      } finally {
        globalThis.fetch = original;
      }
    });

    // docs/UI.md > Batch actions: a partial failure is reported, never
    // swallowed - one refused (a pinned or entity record) has to say so.
    test("a partial batch-forget failure surfaces which memory could not be forgotten", async () => {
      const restore = stubFetch({
        "/api/memory": twoRecords(),
        "/api/memory/batch-forget": {
          outcomes: [
            { id: "mem1-abc123", deleted: false, reason: "only owner or admin may forget an entity or pinned memory" },
            { id: "mem2-def456", deleted: true },
          ],
        },
      });
      try {
        const { findByRole, findByText } = renderMemoryPage();
        await findByText("Likes dinosaurs");
        fireEvent.click(await findByRole("button", { name: "Clear all" }));
        fireEvent.click(await findByRole("button", { name: "Yes, forget all" }));
        expect(
          await findByText(/1 of 2 could not be forgotten: only owner or admin may forget an entity or pinned memory/),
        ).toBeInTheDocument();
      } finally {
        restore();
      }
    });
  });
});
