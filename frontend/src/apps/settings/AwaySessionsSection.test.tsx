import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { AwaySessionsSection } from "@/apps/settings/AwaySessionsSection";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

afterEach(cleanup);

function stubFetch(sessions: Array<Record<string, unknown>> = [], onRevoke: (id: string) => void = () => {}) {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const revoke = url.match(/\/api\/auth\/sessions\/([^/?]+)$/);
    if (revoke && init?.method === "DELETE") {
      onRevoke(revoke[1]!);
      return Promise.resolve(Response.json({ success: true }));
    }
    if (url.endsWith("/api/auth/sessions/away")) return Promise.resolve(Response.json(sessions));
    throw new Error(`unstubbed fetch: ${url}`);
  }) as unknown as typeof fetch;
  return () => { globalThis.fetch = original; };
}

describe("Account away sessions", () => {
  test("shows a plain empty message when there are no away sessions", async () => {
    const restore = stubFetch();
    try {
      const { findByText } = renderWithQueryClient(<AwaySessionsSection />);
      await findByText("No devices have signed in away from home.");
    } finally { restore(); }
  });

  test("shows the browser and sign-in time and revokes only the chosen session", async () => {
    const actions: string[] = [];
    const restore = stubFetch([{ id: "session-away-1", userAgent: "Safari on iPhone", createdAt: "2026-10-13T12:00:00.000Z", expiresAt: "2026-10-20T12:00:00.000Z", isCurrent: false }], (id) => actions.push(id));
    try {
      const { findByText, findByRole, getByRole } = renderWithQueryClient(<AwaySessionsSection />);
      await findByText("Safari on iPhone");
      await findByText(/Last signed in/);
      fireEvent.click(await findByRole("button", { name: "Sign out Safari on iPhone" }));
      fireEvent.click(getByRole("button", { name: "Sign out" }));
      await waitFor(() => expect(actions).toEqual(["session-away-1"]));
    } finally { restore(); }
  });
});
