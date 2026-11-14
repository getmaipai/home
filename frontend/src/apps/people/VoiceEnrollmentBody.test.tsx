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
function setup(viewer: Roster, profile: Roster, initial: { id: string; created_at: string }[] = [], initialMatch = false, failMatchSave = false) {
  const oldFetch = globalThis.fetch;
  let prints = initial;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let matchValue = initialMatch;
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); calls.push({ url, init });
    if (url.startsWith("/api/settings?scope=")) return Response.json([{ key: "person.voice.match", value: matchValue, source: "user", label: "Match my voice when I talk to Home", level: "basic", secret: false, locked: false }]);
    if (url === "/api/settings" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { scope: string; key: string; value: boolean };
      if (failMatchSave) return Response.json({ error: "secret raw error" }, { status: 500 });
      matchValue = body.value;
      return Response.json({ key: body.key, value: body.value, source: "user", label: "Match my voice when I talk to Home", level: "basic", secret: false });
    }
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
  test("switch reflects the saved value and writes the person setting once", async () => {
    const s = setup(adult, adult, [{ id: "sample-1", created_at: "2026-10-01T00:00:00Z" }], true);
    try {
      const toggle = await s.findByRole("switch", { name: "Match my voice when I talk to Home" });
      expect(toggle.getAttribute("aria-checked")).toBe("true");
      fireEvent.click(toggle);
      await waitFor(() => expect(s.calls.filter((call) => call.url === "/api/settings" && call.init?.method === "PUT")).toHaveLength(1));
      const body = JSON.parse(String(s.calls.find((call) => call.url === "/api/settings" && call.init?.method === "PUT")?.init?.body));
      expect(body).toEqual({ scope: "person:person-adult", key: "person.voice.match", value: false });
    } finally { s.restore(); }
  });
  test("switch is disabled without samples and enabled when samples exist", async () => {
    const none = setup(adult, adult);
    try { expect((await none.findByRole("switch", { name: "Match my voice when I talk to Home" })).getAttribute("aria-disabled")).toBe("true"); expect(none.getByText("Record a few samples first.")).toBeTruthy(); }
    finally { none.restore(); }
    const some = setup(adult, adult, [{ id: "sample-1", created_at: "2026-10-01T00:00:00Z" }]);
    try { await some.findByText("1 voice sample saved"); expect(some.calls.map((call) => call.url)).toContain("/api/settings?scope=person%3Aperson-adult"); }
    finally { some.restore(); }
  });
  test("failed setting save shows standard error status without raw error", async () => {
    const s = setup(adult, adult, [{ id: "sample-1", created_at: "2026-10-01T00:00:00Z" }], false, true);
    try {
      fireEvent.click(await s.findByRole("switch", { name: "Match my voice when I talk to Home" }));
      expect(await s.findByText("That did not work")).toBeTruthy();
      expect(s.container.textContent).toContain("Could not save the voice matching setting. Try again.");
      expect(s.container.textContent).not.toContain("secret raw error");
    } finally { s.restore(); }
  });
});
