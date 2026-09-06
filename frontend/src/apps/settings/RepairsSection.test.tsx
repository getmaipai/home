import { describe, expect, test, mock, afterEach } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { RepairsSection } from "@/apps/settings/RepairsSection";
import { ToastProvider } from "@/kit/primitives/Toast";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { Issue } from "@/lib/api";

afterEach(cleanup);

function renderSection() {
  return renderWithQueryClient(
    <MemoryRouter>
      <ToastProvider>
        <RepairsSection />
      </ToastProvider>
    </MemoryRouter>,
  );
}

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "issue-abc123",
    source: "backup",
    key: "stale",
    severity: "warning",
    title: "Backups haven't run in 9 days",
    detail: "The last successful backup was 9 days ago.",
    fix: null,
    learn_more: null,
    created_at: "2026-09-01T00:00:00.000Z",
    resolved_at: null,
    dismissed_at: null,
    hlc: "1000:0:test01",
    ...overrides,
  };
}

function stubFetch(
  initial: Issue[],
  onAction: (id: string, action: "fix" | "dismiss") => void = () => {},
): () => void {
  // A mutable list, not a fixed response: GET /api/repairs only lists
  // still-open issues by default (Issue's own `dismissed_at` comment),
  // so a real dismiss/fix removes the row from every later GET - the
  // same "a mock reacts to the write it just made" shape CommandsSection's
  // own test stub uses.
  let issues = initial;
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    const actionMatch = url.match(/\/api\/repairs\/([^/]+)\/(fix|dismiss)$/);
    if (actionMatch && method === "POST") {
      const [, id, action] = actionMatch as [string, string, "fix" | "dismiss"];
      onAction(id, action);
      issues = issues.filter((i) => i.id !== id);
      // dismiss really returns only `{id}` (backend/src/lib/issues.ts's
      // dismissIssue()), fix the full updated Issue (its own fixIssue())
      // - a code review, 2026-09-06, found an earlier version of this
      // stub returning a full Issue for both, which couldn't have caught
      // api.ts originally typing dismissIssue's response as `Issue` too.
      const body = action === "dismiss" ? { id } : issue({ id });
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }
    if (url.endsWith("/api/repairs")) {
      return Promise.resolve(new Response(JSON.stringify(issues), { status: 200 }));
    }
    throw new Error(`unstubbed fetch: ${url}`);
  }) as unknown as typeof fetch;
  return () => (globalThis.fetch = original);
}

describe("RepairsSection", () => {
  test("an empty repairs list says the hub is healthy, not a blank page", async () => {
    const restore = stubFetch([]);
    try {
      const { findByText } = renderSection();
      await findByText("Everything looks good. No repairs needed.");
    } finally {
      restore();
    }
  });

  test("shows severity, title and detail for each open issue", async () => {
    const restore = stubFetch([issue({ severity: "error", title: "Search sidecar is down" })]);
    try {
      const { findByText } = renderSection();
      await findByText("Search sidecar is down");
      await findByText("The last successful backup was 9 days ago.");
      await findByText("error");
    } finally {
      restore();
    }
  });

  test("an issue with a fix offers its own button; one with none offers only Dismiss", async () => {
    const restore = stubFetch([
      issue({ id: "issue-fixable", fix: { label: "Restart the search sidecar", action: "restart" } }),
      issue({ id: "issue-info-only", title: "Informational only" }),
    ]);
    try {
      const { findByRole, findAllByRole } = renderSection();
      await findByRole("button", { name: "Restart the search sidecar" });
      const dismissButtons = await findAllByRole("button", { name: "Dismiss" });
      expect(dismissButtons).toHaveLength(2);
    } finally {
      restore();
    }
  });

  test("a nullable learn_more renders no link, a real one does", async () => {
    const restore = stubFetch([issue({ id: "issue-with-link", learn_more: "/docs/user/repairs.md" })]);
    try {
      const { findByRole } = renderSection();
      const link = await findByRole("link", { name: "Learn more" });
      expect(link.getAttribute("href")).toBe("/docs/user/repairs.md");
    } finally {
      restore();
    }
  });

  test("a slow action on one row doesn't re-enable a different row's buttons", async () => {
    // The regression this guards: an earlier version tracked only the
    // single most-recently-clicked row id, so starting an action on row
    // B while row A's own action was still in flight silently re-enabled
    // row A's buttons - a second click on A while its first call was
    // still pending could fire a real duplicate (a code review,
    // 2026-09-06).
    let resolveA: (() => void) | undefined;
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      if (url.endsWith("/api/repairs/issue-a/dismiss") && method === "POST") {
        return new Promise((resolve) => {
          resolveA = () => resolve(new Response(JSON.stringify({ id: "issue-a" }), { status: 200 }));
        });
      }
      if (url.endsWith("/api/repairs/issue-b/dismiss") && method === "POST") {
        return Promise.resolve(new Response(JSON.stringify({ id: "issue-b" }), { status: 200 }));
      }
      if (url.endsWith("/api/repairs")) {
        return Promise.resolve(
          new Response(JSON.stringify([issue({ id: "issue-a", title: "Issue A" }), issue({ id: "issue-b", title: "Issue B" })]), {
            status: 200,
          }),
        );
      }
      throw new Error(`unstubbed fetch: ${url}`);
    }) as unknown as typeof fetch;
    try {
      const { findAllByRole } = renderSection();
      const [dismissA, dismissB] = await findAllByRole("button", { name: "Dismiss" });
      fireEvent.click(dismissA!);
      await waitFor(() => expect(dismissA).toBeDisabled());
      fireEvent.click(dismissB!);
      await waitFor(() => expect(dismissB).toBeDisabled());
      // Row B's own dismiss has already resolved by now; row A's is
      // still pending (resolveA hasn't been called) and must stay
      // disabled regardless.
      expect(dismissA).toBeDisabled();
      resolveA?.();
      await waitFor(() => expect(dismissA).not.toBeDisabled());
    } finally {
      globalThis.fetch = original;
    }
  });

  test("dismissing an issue removes it from the list", async () => {
    const dismissed: string[] = [];
    const restore = stubFetch([issue({ id: "issue-to-dismiss" })], (id, action) => {
      if (action === "dismiss") dismissed.push(id);
    });
    try {
      const { findByText, findByRole, queryByText } = renderSection();
      await findByText("Backups haven't run in 9 days");
      fireEvent.click(await findByRole("button", { name: "Dismiss" }));
      await waitFor(() => expect(dismissed).toEqual(["issue-to-dismiss"]));
      await findByText("Everything looks good. No repairs needed.");
      expect(queryByText("Backups haven't run in 9 days")).toBeNull();
    } finally {
      restore();
    }
  });
});
