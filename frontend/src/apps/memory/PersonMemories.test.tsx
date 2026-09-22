import { describe, test, expect, mock, afterEach } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { OwnMemories } from "@/apps/memory/PersonMemories";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { MemoryRecord } from "@/lib/api";

afterEach(cleanup);

// getmaipai/home#123: this component (and its test coverage) used to be
// MemoryPage.tsx/MemoryPage.test.tsx. Commit 7fe8d9e7 (HOME-UI-02d)
// renamed the component to PersonMemories.tsx's OwnMemories but deleted
// the 559-line test file outright, with no replacement - a real,
// live archiveMemory() call site (below) has had zero coverage since.
// This is the minimal regression test asserting exactly what the
// deleted one did: archiving a memory removes it from the list. Not a
// wider rewrite of the retired file's other cases.
function record(overrides: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: "mem1042-a1b2c3",
    record_kind: "memory",
    text: "Riff prefers oat milk in coffee",
    category: "preference",
    tier: "durable",
    status: "active",
    scope: "person",
    person: "person-a1b2c3",
    companion_id: null,
    subject_id: null,
    source: "conversation-turn-8831",
    importance: 0.4,
    pinned: false,
    sensitive: false,
    child_disclosure: null,
    child_disclosure_set_by: null,
    child_disclosure_set_at: null,
    fact_confidence: 0.95,
    confidence_evidence: [],
    conflicts_with: [],
    uses: 3,
    retrieval_feedback: { corrections: 0, last_corrected_at: null },
    created_at: "2026-08-01T09:00:00Z",
    last_used_at: "2026-09-02T18:30:00Z",
    valid_from: null,
    valid_to: null,
    expired_at: null,
    superseded_by: null,
    embedding_space: "hub-bge-m3",
    hlc: "1756800000000:0:a1b2c3",
    deleted_at: null,
    ...overrides,
  };
}

describe("OwnMemories", () => {
  test("archiving a memory removes it from the list", async () => {
    // Stateful, not a fixed fixture (same convention PeopleAndThings.test.tsx's
    // "tapping Confirm..." test uses): handleArchive() invalidates
    // ["memory-list", "me"], so a stub that always returns the same
    // array regardless of the archive call would never actually prove
    // removal.
    let archived = false;
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (init?.method === "POST" && url.includes("/mem1042-a1b2c3/archive")) {
        archived = true;
        return Promise.resolve(new Response(JSON.stringify({ ...record(), status: "archived" }), { status: 200 }));
      }
      if (url.includes("/api/memory")) {
        return Promise.resolve(new Response(JSON.stringify(archived ? [] : [record()]), { status: 200 }));
      }
      throw new Error(`unstubbed fetch: ${url}`);
    }) as unknown as typeof fetch;
    try {
      const { findByRole, queryByText } = renderWithQueryClient(<OwnMemories filterIds={null} actorIsAdult={false} />);
      const archiveButton = await findByRole("button", { name: 'Archive "Riff prefers oat milk in coffee"' });
      fireEvent.click(archiveButton);
      await waitFor(() => expect(queryByText("Riff prefers oat milk in coffee")).toBeNull(), { timeout: 5_000 });
    } finally {
      globalThis.fetch = original;
    }
  });
});
