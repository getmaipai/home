import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { SafetyChangesSection } from "./SafetyChangesSection";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

afterEach(cleanup);

const change = (id: string, over: Record<string, unknown> = {}) => ({
  id, key: "search.web.child_mode", scope: "household", actor_role: "owner", value: "on", direction: "widens",
  changed_at: "2026-11-16T10:00:00.000Z", hlc: "1788000000000:0:test", ...over,
});

function withFetch(changes: unknown[]) {
  const original = globalThis.fetch;
  const fetchMock = mock((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/settings/changes")) return Promise.resolve(Response.json({ changes }));
    if (url.includes("/api/settings/registry")) return Promise.resolve(Response.json([]));
    return Promise.resolve(Response.json({}));
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, restore: () => { globalThis.fetch = original; } };
}

describe("SafetyChangesSection", () => {
  test("an owner sees the rows by role and layer", async () => {
    const f = withFetch([change("schg-aaaaaaaa"), change("schg-bbbbbbbb", { actor_role: "admin", scope: "person", direction: "narrows", value: false })]);
    try {
      const view = renderWithQueryClient(<SafetyChangesSection viewerRole="owner" />);
      await waitFor(() => expect(view.getByTestId("safety-changes")).toBeTruthy());
      expect(view.getByText("Recent safety changes")).toBeTruthy();
      expect(view.getByText("Owner")).toBeTruthy();
      expect(view.getByText("Admin")).toBeTruthy();
      expect(view.getByText("One person")).toBeTruthy();
      expect(view.getByText(/Widened/)).toBeTruthy();
      expect(view.getByText(/Narrowed/)).toBeTruthy();
    } finally { f.restore(); }
  });

  test("an admin with no changes sees the empty line", async () => {
    const f = withFetch([]);
    try {
      const view = renderWithQueryClient(<SafetyChangesSection viewerRole="admin" />);
      await waitFor(() => expect(view.getByText("No safety setting changes yet.")).toBeTruthy());
    } finally { f.restore(); }
  });

  test("a teen sees nothing and nothing is fetched", async () => {
    const f = withFetch([change("schg-aaaaaaaa")]);
    try {
      const view = renderWithQueryClient(<SafetyChangesSection viewerRole="teen" />);
      expect(view.container.textContent).toBe("");
      expect(f.fetchMock).not.toHaveBeenCalled();
    } finally { f.restore(); }
  });
});
