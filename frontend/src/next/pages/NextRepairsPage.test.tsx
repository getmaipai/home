import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { NextRepairsPage } from "@/next/pages/NextRepairsPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { expectHomeTablesWithoutDemoOrActions } from "@/tests/expectHomeTables";
import type { Issue, Roster } from "@/lib/api";

afterEach(() => {
  cleanup();
});

function makePerson(overrides: Partial<Roster> = {}): Roster {
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
    ...overrides,
  } as Roster;
}

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-abc123",
    source: "backup",
    key: "backup.failed",
    severity: "error",
    title: "A backup failed",
    detail: "The last scheduled backup could not finish.",
    fix: { label: "Retry now", action: "retry_backup" },
    learn_more: null,
    created_at: "2026-09-21T00:00:00.000Z",
    ...overrides,
  } as Issue;
}

function mockRepairsFetch(issues: Issue[]) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/repairs")) return Promise.resolve(Response.json(issues));
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

describe("NextRepairsPage", () => {
  test("a non-admin sees the denied message, never a fetch", async () => {
    const restore = mockRepairsFetch([makeIssue()]);
    try {
      renderWithQueryClient(<NextRepairsPage person={makePerson({ role: "adult" })} />);
      await waitFor(() => expect(document.body.textContent).toContain("Only an owner or admin can manage repairs."));
    } finally {
      restore();
    }
  });

  test("real issues: title, severity and the fix's own label, not demo data", async () => {
    const restore = mockRepairsFetch([
      makeIssue({ title: "A backup failed", severity: "error", detail: "The last scheduled backup could not finish.", fix: { label: "Retry now", action: "retry_backup" } }),
      makeIssue({ id: "issue-xyz789", title: "Storage is nearly full", severity: "warning", detail: "Free up space soon.", fix: null }),
    ]);
    try {
      renderWithQueryClient(<NextRepairsPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("A backup failed"));
      expect(document.body.textContent).toContain("Error");
      expect(document.body.textContent).toContain("Retry now");
      expect(document.body.textContent).toContain("Storage is nearly full");
      expect(document.body.textContent).toContain("Warning");
      expectHomeTablesWithoutDemoOrActions();
    } finally {
      restore();
    }
  });

  test("no open issues: the shared table's empty message", async () => {
    const restore = mockRepairsFetch([]);
    try {
      renderWithQueryClient(<NextRepairsPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("No data available."));
    } finally {
      restore();
    }
  });

  test("a failed fetch shows an error and a retry button, never a stuck loading state", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({ error: "Something broke" }), { status: 500 }))) as unknown as typeof fetch;
    try {
      renderWithQueryClient(<NextRepairsPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Something broke"));
      expect(document.body.textContent).toContain("Try again");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
