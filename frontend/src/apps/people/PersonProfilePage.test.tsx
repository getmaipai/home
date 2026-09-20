import { describe, expect, test, mock, afterEach } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { PersonProfilePage } from "@/apps/people/PersonProfilePage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { MemoryRecord, Roster } from "@/lib/api";

afterEach(cleanup);

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
    companion_id: null,
    subject_id: null,
    source: "chat",
    importance: 0.5,
    pinned: false,
    sensitive: false,
    child_disclosure: null,
    child_disclosure_set_by: null,
    child_disclosure_set_at: null,
    fact_confidence: 0.95,
    confidence_evidence: [],
    conflicts_with: [],
    uses: 0,
    retrieval_feedback: { corrections: 0, last_corrected_at: null },
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

const ROSTER = [
  { id: "person-sage", display_name: "Sage", role: "owner" },
  { id: "person-bramble", display_name: "Bramble", role: "child" },
];

function renderProfile(path: string, person: Roster = defaultPerson()) {
  return renderWithQueryClient(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/people/:id" element={<PersonProfilePage person={person} />} />
      </Routes>
    </MemoryRouter>,
  );
}

// Memories moved off the rail and onto a person's own profile (owner
// ruling, "Navigation, corrected," 2026-09-20): the Memories tab reuses
// `OwnMemories`/`OtherPersonMemories` unchanged from the retired
// household-wide MemoryPage.tsx - these cases carry over its own
// coverage of that shared behavior, now reached by URL (`/people/:id`)
// instead of a person-picker dropdown.
describe("PersonProfilePage", () => {
  test("shows the empty state for a household with nothing remembered yet", async () => {
    const restore = stubFetch({ "/api/people": ROSTER, "/api/memory": [] });
    try {
      const { findByText } = renderProfile("/people/person-sage?tab=memories");
      expect(await findByText("Nothing remembered yet.")).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  test("renders a memory with its raw category and scope", async () => {
    const restore = stubFetch({ "/api/people": ROSTER, "/api/memory": [record()] });
    try {
      const { findByText } = renderProfile("/people/person-sage?tab=memories");
      expect(await findByText("Likes dinosaurs")).toBeInTheDocument();
      expect(await findByText("preference · person")).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  test("offers a retry rather than a blank page when the memory fetch fails", async () => {
    const restore = stubFetch({ "/api/people": ROSTER, "/api/memory": 500 });
    try {
      const { findByRole } = renderProfile("/people/person-sage?tab=memories");
      expect(await findByRole("button", { name: "Try again" })).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  test("?ids= filters the list to just those memories, with a way back to the full list", async () => {
    const restore = stubFetch({
      "/api/people": ROSTER,
      "/api/memory": [record({ id: "mem1-abc123", text: "Likes dinosaurs" }), record({ id: "mem2-def456", text: "Allergic to peanuts" })],
    });
    try {
      const { findByText, queryByText } = renderProfile("/people/person-sage?tab=memories&ids=mem1-abc123");
      await findByText("Likes dinosaurs");
      expect(queryByText("Allergic to peanuts")).toBeNull();
    } finally {
      restore();
    }
  });

  test("an owner opening a child's profile sees that child's memories, with forget/export instead of the own list", async () => {
    const restore = stubFetch({
      "/api/people": ROSTER,
      "/api/memory?person=person-bramble": [record({ id: "mem2-def456", text: "Loves dinosaurs", person: "person-bramble" })],
    });
    try {
      const { findByRole, findByText, queryByText } = renderProfile("/people/person-bramble?tab=memories", defaultPerson({ id: "person-sage", role: "owner" }));
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

  test("a non-admin cannot open another person's Memories tab at all", async () => {
    const restore = stubFetch({ "/api/people": ROSTER });
    try {
      const { queryByRole } = renderProfile("/people/person-bramble?tab=memories", defaultPerson({ id: "person-sage", role: "adult" }));
      await waitFor(() => expect(queryByRole("tab", { name: "Memories" })).toBeNull());
    } finally {
      restore();
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
          new Response(JSON.stringify([record({ id: "mem2-def456", text: "Loves dinosaurs", person: "person-bramble" })]), { status: 200 }),
        );
      }
      if (url.endsWith("/api/people")) return Promise.resolve(new Response(JSON.stringify(ROSTER), { status: 200 }));
      throw new Error(`unstubbed fetch: ${url}`);
    }) as unknown as typeof fetch;
    try {
      const { findByRole, findByText } = renderProfile("/people/person-bramble?tab=memories", defaultPerson({ id: "person-sage", role: "owner" }));
      fireEvent.click(await findByRole("button", { name: "Forget everything about Bramble" }));
      await findByText("Forget everything MaiPai remembers about Bramble?");
      fireEvent.click(await findByRole("button", { name: "Yes, forget everything" }));
      await waitFor(() => expect(forgetCalled).toBe(true));
    } finally {
      globalThis.fetch = original;
    }
  });

  describe("batch select and clear-all (own memories only)", () => {
    function twoRecords() {
      return [
        record({ id: "mem1-abc123", text: "Likes dinosaurs" }),
        record({ id: "mem2-def456", text: "Allergic to peanuts" }),
      ];
    }

    test("select mode shows the count as rows are checked", async () => {
      const restore = stubFetch({ "/api/people": ROSTER, "/api/memory": twoRecords() });
      try {
        const { findByRole, findByText } = renderProfile("/people/person-sage?tab=memories");
        fireEvent.click(await findByRole("button", { name: "Select memories" }));
        expect(await findByText("0 selected")).toBeInTheDocument();
        fireEvent.click(await findByRole("checkbox", { name: "Select Likes dinosaurs" }));
        expect(await findByText("1 selected")).toBeInTheDocument();
      } finally {
        restore();
      }
    });

    test("clear all asks, names the real count, then empties the list", async () => {
      let forgottenIds: string[] | null = null;
      const original = globalThis.fetch;
      globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.endsWith("/api/memory/batch-forget") && init?.method === "POST") {
          forgottenIds = (JSON.parse(init.body as string) as { ids: string[] }).ids;
          return Promise.resolve(new Response(JSON.stringify({ outcomes: forgottenIds.map((id) => ({ id, deleted: true })) }), { status: 200 }));
        }
        if (url.endsWith("/api/memory")) {
          return Promise.resolve(new Response(JSON.stringify(forgottenIds ? [] : twoRecords()), { status: 200 }));
        }
        if (url.endsWith("/api/people")) return Promise.resolve(new Response(JSON.stringify(ROSTER), { status: 200 }));
        throw new Error(`unstubbed fetch: ${url}`);
      }) as unknown as typeof fetch;
      try {
        const { findByRole, findByText, queryByText } = renderProfile("/people/person-sage?tab=memories");
        await findByText("Likes dinosaurs");
        fireEvent.click(await findByRole("button", { name: "Clear all" }));
        await findByText("Forget every one of your 2 memories? This cannot be undone.");
        fireEvent.click(await findByRole("button", { name: "Yes, forget all" }));
        await waitFor(() => expect(forgottenIds).toEqual(["mem1-abc123", "mem2-def456"]));
        await waitFor(() => expect(queryByText("Likes dinosaurs")).toBeNull());
      } finally {
        globalThis.fetch = original;
      }
    });
  });

  describe("who may hear a household memory (audience control)", () => {
    function householdRecord(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
      return record({ scope: "household", person: null, ...overrides });
    }

    test("an adult sees the control on a household row and changing it calls the real route", async () => {
      let audienceBody: unknown = null;
      const original = globalThis.fetch;
      globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.endsWith("/api/memory/mem1-abc123/audience") && init?.method === "POST") {
          audienceBody = JSON.parse(init.body as string);
          return Promise.resolve(new Response(JSON.stringify({ ...householdRecord(), child_disclosure: "adult_only" }), { status: 200 }));
        }
        if (url.endsWith("/api/memory")) return Promise.resolve(new Response(JSON.stringify([householdRecord()]), { status: 200 }));
        if (url.endsWith("/api/people")) return Promise.resolve(new Response(JSON.stringify(ROSTER), { status: 200 }));
        throw new Error(`unstubbed fetch: ${url}`);
      }) as unknown as typeof fetch;
      try {
        const { findByRole, findByText } = renderProfile("/people/person-sage?tab=memories");
        await findByText("Likes dinosaurs");
        fireEvent.click(await findByRole("combobox", { name: "Who may hear this" }));
        fireEvent.click(await findByRole("option", { name: "Adults only" }));
        await waitFor(() => expect(audienceBody).toEqual({ child_disclosure: "adult_only" }));
      } finally {
        globalThis.fetch = original;
      }
    });

    test("a child sees no audience control and an adult-only memory still renders", async () => {
      const restore = stubFetch({ "/api/people": ROSTER, "/api/memory": [householdRecord({ child_disclosure: "adult_only" })] });
      try {
        const { findByText, queryByRole } = renderProfile("/people/person-sage?tab=memories", defaultPerson({ role: "child" }));
        await findByText("Likes dinosaurs");
        expect(queryByRole("combobox", { name: "Who may hear this" })).toBeNull();
      } finally {
        restore();
      }
    });
  });

  test("the Overview tab shows the person's name and role", async () => {
    const restore = stubFetch({ "/api/people": ROSTER });
    try {
      const { findByText } = renderProfile("/people/person-bramble", defaultPerson({ id: "person-sage", role: "owner" }));
      expect(await findByText("Bramble")).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  test("an unknown person id shows a plain not-found message, not a crash", async () => {
    const restore = stubFetch({ "/api/people": ROSTER });
    try {
      const { findByText } = renderProfile("/people/person-does-not-exist", defaultPerson({ id: "person-sage", role: "owner" }));
      expect(await findByText("No one in this household has that profile.")).toBeInTheDocument();
    } finally {
      restore();
    }
  });
});
