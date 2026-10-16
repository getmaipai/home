import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { VoiceEnrollmentBody } from "@/apps/people/VoiceEnrollmentBody";
import type { Roster } from "@/lib/api";

afterEach(cleanup);
const adult = { id: "person-adult", role: "adult" } as Roster;
const teen = { id: "person-teen", role: "teen" } as Roster;
const child = { id: "person-child", role: "child" } as Roster;
const guest = { id: "person-guest", role: "guest" } as Roster;
function setup(viewer: Roster, profile: Roster, initial: { id: string; created_at: string }[] = []) {
  const oldFetch = globalThis.fetch;
  let prints = initial;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); calls.push({ url, init });
    if (url.startsWith("/api/voice-prints?") && init?.method !== "DELETE") return Response.json(prints);
    if (init?.method === "DELETE") { prints = url.includes("person_id=") ? [] : prints.filter((row) => !url.endsWith(row.id)); return new Response(null, { status: 204 }); }
    if (url === "/api/voice-prints/enroll") return Response.json({ sample_id: "sample-new", samples_count: 1 }, { status: 201 });
    return Response.json([]);
  }) as unknown as typeof fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><VoiceEnrollmentBody viewer={viewer} profile={profile} /></QueryClientProvider>);
  return { ...view, calls, restore: () => { client.clear(); globalThis.fetch = oldFetch; } };
}

describe("VoiceEnrollmentBody", () => {
  test("loads sample count and deletes a sample with the fixed route", async () => {
    const s = setup(adult, adult, [{ id: "sample-1", created_at: "2026-10-01T00:00:00Z" }]);
    try {
      expect(await s.findByText("1 voice sample saved")).toBeTruthy();
      fireEvent.click(s.getByRole("button", { name: "Delete" }));
      await waitFor(() => expect(s.calls.some((call) => call.url === "/api/voice-prints/sample-1" && call.init?.method === "DELETE")).toBe(true));
      expect(await s.findByText("0 voice samples saved")).toBeTruthy();
    } finally { s.restore(); }
  });
  test("a child cannot enroll themself and guests cannot enroll", () => {
    const childView = setup(child, child); expect(childView.container.textContent).toBe(""); childView.restore();
    const guestView = setup(guest, guest); expect(guestView.container.textContent).toBe(""); guestView.restore();
  });
  test("a teen can enroll themself but an adult cannot enroll a teen", () => {
    const own = setup(teen, teen); expect(own.getByRole("button", { name: "Record a sample" })).toBeTruthy(); own.restore();
    const other = setup(adult, teen); expect(other.container.textContent).toBe(""); other.restore();
  });
});
