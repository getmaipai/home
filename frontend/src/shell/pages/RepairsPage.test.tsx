import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { RepairsPage } from "@/shell/pages/RepairsPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
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
  const fetchMock = mock((input: RequestInfo | URL, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
    if (url.includes("/api/repairs")) return Promise.resolve(Response.json(issues));
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, restore: () => { globalThis.fetch = originalFetch; } };
}

describe("RepairsPage", () => {
  test("a non-admin sees the denied message, never a fetch", async () => {
    const { restore } = mockRepairsFetch([makeIssue()]);
    try {
      renderWithQueryClient(<RepairsPage person={makePerson({ role: "adult" })} />);
      await waitFor(() => expect(document.body.textContent).toContain("Only an owner or admin can manage repairs."));
    } finally {
      restore();
    }
  });

  test("real issues: title, severity and the fix's own label, not demo data", async () => {
    const { restore } = mockRepairsFetch([
      makeIssue({ title: "A backup failed", severity: "error", detail: "The last scheduled backup could not finish.", fix: { label: "Retry now", action: "retry_backup" } }),
      makeIssue({ id: "issue-xyz789", title: "Storage is nearly full", severity: "warning", detail: "Free up space soon.", fix: null }),
    ]);
    try {
      renderWithQueryClient(<RepairsPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("A backup failed"));
      expect(document.body.textContent).toContain("Error");
      expect(document.body.textContent).toContain("Retry now");
      expect(document.body.textContent).toContain("Storage is nearly full");
      expect(document.body.textContent).toContain("Warning");
      expect(document.body.textContent).not.toContain("Employee Data Table");
      const issueRow = Array.from(document.querySelectorAll('[data-slot="data-table-row"]')).find((row) => row.textContent?.includes("A backup failed"))!;
      expect(within(issueRow as HTMLElement).getByRole("button", { name: "More actions" })).toBeTruthy();
    } finally {
      restore();
    }
  });

  test("the kit table sorts the exact repair rows by title", async () => {
    const { restore } = mockRepairsFetch([
      makeIssue({ id: "issue-z", title: "Storage is nearly full" }),
      makeIssue({ id: "issue-a", title: "A backup failed" }),
    ]);
    try {
      renderWithQueryClient(<RepairsPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("A backup failed"));
      const header = document.querySelector('[data-slot="data-table-header-row"] button[aria-label="Sort by Title"]')!;
      fireEvent.click(header);
      await waitFor(() => {
        const rows = Array.from(document.querySelectorAll('[data-slot="data-table-body"] [data-slot="data-table-row"]'));
        expect(rows[0]?.textContent).toContain("A backup failed");
        expect(rows[1]?.textContent).toContain("Storage is nearly full");
      });
    } finally {
      restore();
    }
  });

  test("no open issues: the shared table's empty message", async () => {
    const { restore } = mockRepairsFetch([]);
    try {
      renderWithQueryClient(<RepairsPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("No data available."));
    } finally {
      restore();
    }
  });

  test("a failed fetch shows an error and a retry button, never a stuck loading state", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({ error: "Something broke" }), { status: 500 }))) as unknown as typeof fetch;
    try {
      renderWithQueryClient(<RepairsPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Something broke"));
      expect(document.body.textContent).toContain("Try again");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("Fix calls the issue endpoint and invalidates the repairs query", async () => {
    const { fetchMock, restore } = mockRepairsFetch([makeIssue()]);
    try {
      const view = renderWithQueryClient(<RepairsPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("A backup failed"));
      const row = Array.from(document.querySelectorAll('[data-slot="data-table-row"]')).find((candidate) => candidate.textContent?.includes("A backup failed"))!;
      fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "More actions" }));
      fireEvent.click(await within(document.body).findByRole("menuitem", { name: "Retry now" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/repairs/issue-abc123/fix"),
        expect.objectContaining({ method: "POST" }),
      ));
      await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => {
        const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
        return url.includes("/api/repairs");
      })).toHaveLength(3));
      expect(view.queryClient.getQueryState(["repairs"])?.data).toBeTruthy();
    } finally {
      restore();
    }
  });

  test("Dismiss runs only after confirmation", async () => {
    const { fetchMock, restore } = mockRepairsFetch([makeIssue({ fix: null })]);
    try {
      renderWithQueryClient(<RepairsPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("A backup failed"));
      const row = Array.from(document.querySelectorAll('[data-slot="data-table-row"]')).find((candidate) => candidate.textContent?.includes("A backup failed"))!;
      fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "More actions" }));
      expect(await within(document.body).findByRole("menuitem", { name: "Dismiss" })).toBeTruthy();
      expect(within(document.body).queryByRole("menuitem", { name: "Retry now" })).toBeNull();
      fireEvent.click(within(document.body).getByRole("menuitem", { name: "Dismiss" }));
      expect(await within(document.body).findByRole("alertdialog")).toBeTruthy();
      expect(document.body.textContent).toContain('Dismiss "A backup failed"?');
      expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/repairs/issue-abc123/dismiss"), expect.anything());

      fireEvent.click(within(document.body).getByRole("button", { name: "Confirm" }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/repairs/issue-abc123/dismiss"),
        expect.objectContaining({ method: "POST" }),
      ));
    } finally {
      restore();
    }
  });
});
