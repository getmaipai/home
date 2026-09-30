import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextStatusPage } from "@/next/pages/NextStatusPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { Roster } from "@/lib/api";

afterEach(cleanup);

function makePerson(role: Roster["role"]): Roster {
  return {
    id: "person-abc123", display_name: "Nova", nickname: null, role,
    avatar_seed: "person-abc123", source: "hub", local_only: false,
    created_at: "2026-09-04T00:00:00.000Z", updated_at: "2026-09-04T00:00:00.000Z",
    deleted_at: null, enabled: true, guest_expires_at: null, memorialized_at: null,
    hlc: "1788000000000:0:test", hasSecret: true,
  } as Roster;
}

function mockHealth() {
  const originalFetch = globalThis.fetch;
  const paths: string[] = [];
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    paths.push(url.split("?")[0] ?? "");
    if (url.includes("/api/health")) return Promise.resolve(Response.json({
      brain: "selection", voice: "spawned", ok: true, uptimeSeconds: 60,
      engines: {
        chat: { kind: "selection", pid: null, alive: true },
        embed: { kind: "spawned", pid: null, alive: true },
        background: { kind: "spawned", pid: null, alive: true },
        voice: { kind: "spawned", pid: null, alive: true },
      },
      sidecars: [],
    }));
    return Promise.resolve(Response.json({ note: null, maintenance: [] }));
  }) as unknown as typeof fetch;
  return { paths, restore: () => { globalThis.fetch = originalFetch; } };
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    brain: "selection", voice: "spawned", ok: true, uptimeSeconds: 60,
    engines: {
      chat: { kind: "selection", pid: null, alive: true },
      embed: { kind: "spawned", pid: null, alive: true },
      background: { kind: "spawned", pid: null, alive: true },
      voice: { kind: "spawned", pid: null, alive: true },
    }, sidecars: [], ...overrides,
  };
}

describe("NextStatusPage", () => {
  test("an admin sees the overall line, four engine rows, and Restart controls", async () => {
    const { restore } = mockHealth();
    try {
      const view = renderWithQueryClient(<NextStatusPage person={makePerson("admin")} />);
      await view.findByText("Brain");
      expect(await view.findByText("Everything is running. Up for 1 minute.")).toBeTruthy();
      for (const label of ["Brain", "Understanding", "Memory", "Voice"]) expect(view.getByText(label)).toBeTruthy();
      expect(view.getAllByRole("button", { name: "Restart" })).toHaveLength(4);
      expect(view.getByText("Online")).toBeTruthy();
    } finally {
      restore();
    }
  });

  test("a member sees the same rows and overall line without admin routes or buttons", async () => {
    const { paths, restore } = mockHealth();
    try {
      const view = renderWithQueryClient(<NextStatusPage person={makePerson("child")} />);
      await view.findByText("Brain");
      expect(await view.findByText("Everything is running. Up for 1 minute.")).toBeTruthy();
      for (const label of ["Brain", "Understanding", "Memory", "Voice"]) expect(view.getByText(label)).toBeTruthy();
      expect(view.queryByRole("button", { name: "Restart" })).toBeNull();
      expect(view.queryByText(/pid|port|process|engine|sidecar/i)).toBeNull();
      expect(paths[0]).toBe("/api/health");
    } finally {
      restore();
    }
  });

  test("offline banner joins problem names and uses singular grammar", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(Response.json(body({ ok: false, engines: {
      chat: { kind: "stopped", pid: 2, alive: null }, embed: { kind: "stopped", pid: null, alive: null },
      background: { kind: "spawned", pid: null, alive: true }, voice: { kind: "spawned", pid: null, alive: true },
    } })))) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<NextStatusPage person={makePerson("child")} />);
      expect(await view.findByText("Brain and Understanding aren't running.")).toBeTruthy();
    } finally { globalThis.fetch = original; }
  });

  test("degraded banner copy is plain and Library is conditional", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(Response.json(body({ engines: { ...body().engines, voice: { kind: "starting", pid: null, alive: null } }, sidecars: [{ id: "kiwix-serve", status: "running", baseUrl: "http://127.0.0.1" }] })))) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<NextStatusPage person={makePerson("adult")} />);
      expect(await view.findByText("Something is starting up or slow.")).toBeTruthy();
      expect(view.getByText("Library")).toBeTruthy();
    } finally { globalThis.fetch = original; }
  });

  test("everyone sees the note and maintenance statuses; only admins get controls", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/health")) return Promise.resolve(Response.json(body()));
      if (url.includes("/api/status/board")) return Promise.resolve(Response.json({
        note: { id: "note-1", body: "Voice is getting an update.", posted_at: new Date(Date.now() - 20 * 60_000).toISOString(), posted_by_name: "Sage" },
        maintenance: ["scheduled", "in_progress", "completed", "cancelled"].map((status, i) => ({ id: `maint-${i}`, title: `Window ${i}`, description: "Planned work", components: ["voice", "library"], starts_at: "2026-09-30T21:00:00Z", ends_at: "2026-09-30T22:00:00Z", status })),
      }));
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as unknown as typeof fetch;
    try {
      const admin = renderWithQueryClient(<NextStatusPage person={makePerson("admin")} />);
      expect(await admin.findByText("Voice is getting an update.")).toBeTruthy();
      expect(admin.getByText(/Posted by Sage, 20 minutes ago/)).toBeTruthy();
      expect(admin.getByRole("button", { name: "Clear" })).toBeTruthy();
      expect(admin.getByRole("button", { name: "Post a note" })).toBeTruthy();
      expect(admin.getByRole("button", { name: "Schedule maintenance" })).toBeTruthy();
      for (const status of ["Upcoming", "In progress", "Done", "Cancelled"]) expect(admin.getByText(status)).toBeTruthy();
      cleanup();
      const member = renderWithQueryClient(<NextStatusPage person={makePerson("child")} />);
      expect(await member.findByText("Voice is getting an update.")).toBeTruthy();
      expect(member.queryByRole("button", { name: "Clear" })).toBeNull();
      expect(member.queryByRole("button", { name: "Post a note" })).toBeNull();
      expect(member.queryByRole("button", { name: "Schedule maintenance" })).toBeNull();
    } finally { globalThis.fetch = original; }
  });

  test("a member with an empty board gets no maintenance card or admin requests", async () => {
    const original = globalThis.fetch;
    const calls: string[] = [];
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString(); calls.push(url);
      if (url.includes("/api/health")) return Promise.resolve(Response.json(body()));
      if (url.includes("/api/status/board")) return Promise.resolve(Response.json({ note: null, maintenance: [] }));
      return Promise.reject(new Error(`Unexpected request ${url}`));
    }) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<NextStatusPage person={makePerson("child")} />);
      await view.findByText("Brain");
      expect(view.queryByText("Scheduled maintenance")).toBeNull();
      expect(calls.every((url) => url.includes("/api/health") || url.includes("/api/status/board"))).toBe(true);
    } finally { globalThis.fetch = original; }
  });

  test("posting a note sends the selected expiry and replaces the active note", async () => {
    const original = globalThis.fetch;
    let posted: { body: string; expires_at?: string } | undefined;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/health")) return Promise.resolve(Response.json(body()));
      if (url.includes("/api/status/board")) return Promise.resolve(Response.json({ note: null, maintenance: [] }));
      if (url.includes("/api/status/note") && init?.method === "POST") {
        posted = JSON.parse(String(init.body)) as { body: string; expires_at?: string };
        return Promise.resolve(Response.json({ id: "note-new" }, { status: 201 }));
      }
      return Promise.reject(new Error(`Unexpected request ${url}`));
    }) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<NextStatusPage person={makePerson("owner")} />);
      fireEvent.click(await view.findByRole("button", { name: "Post a note" }));
      const dialog = await view.findByRole("dialog");
      fireEvent.change(view.getByLabelText("Note"), { target: { value: "Library will pause soon." } });
      await act(async () => { fireEvent.click(view.getByRole("combobox")); });
      const hour = await view.findByRole("option", { name: "1 hour" });
      await act(async () => { fireEvent.pointerDown(hour, { pointerId: 1, pointerType: "mouse", button: 0 }); fireEvent.pointerUp(hour, { pointerId: 1, pointerType: "mouse", button: 0 }); fireEvent.click(hour); });
      await waitFor(() => expect(view.getByRole("combobox").textContent).toContain("1 hour"));
      fireEvent.click(within(dialog).getByRole("button", { name: "Post note" }));
      await waitFor(() => expect(posted).toBeDefined());
      expect(posted?.body).toBe("Library will pause soon.");
      expect(Date.parse(posted?.expires_at ?? "") - Date.now()).toBeGreaterThan(3_590_000);
      expect(Date.parse(posted?.expires_at ?? "") - Date.now()).toBeLessThanOrEqual(3_600_000);
    } finally { globalThis.fetch = original; }
  });

  test("clearing an active note uses the admin DELETE route and refreshes the board", async () => {
    const original = globalThis.fetch;
    const calls: Array<{ url: string; method: string }> = [];
    let cleared = false;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET"; calls.push({ url, method });
      if (url.includes("/api/health")) return Promise.resolve(Response.json(body()));
      if (url.includes("/api/status/board")) return Promise.resolve(Response.json({ note: cleared ? null : { id: "n1", body: "Quiet hours tonight.", posted_at: new Date().toISOString(), posted_by_name: "Sage" }, maintenance: [] }));
      if (url.includes("/api/status/note") && method === "DELETE") { cleared = true; return Promise.resolve(new Response(null, { status: 204 })); }
      return Promise.reject(new Error(`Unexpected request ${method} ${url}`));
    }) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<NextStatusPage person={makePerson("admin")} />);
      expect(await view.findByText("Quiet hours tonight.")).toBeTruthy();
      fireEvent.click(view.getByRole("button", { name: "Clear" }));
      await waitFor(() => expect(calls.some((call) => call.url.endsWith("/api/status/note") && call.method === "DELETE")).toBe(true));
      await waitFor(() => expect(view.queryByText("Quiet hours tonight.")).toBeNull());
    } finally { globalThis.fetch = original; }
  });

  test("maintenance validation and cancel confirmation guard admin actions", async () => {
    const original = globalThis.fetch;
    const writes: Array<{ url: string; body?: string }> = [];
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/health")) return Promise.resolve(Response.json(body()));
      if (url.includes("/api/status/board")) return Promise.resolve(Response.json({ note: null, maintenance: [{ id: "window-1", title: "Voice care", description: "", components: ["voice"], starts_at: "2026-10-01T13:00:00Z", ends_at: "2026-10-01T14:00:00Z", status: "scheduled" }] }));
      if (url.includes("/api/status/maintenance") && init?.method === "POST") { writes.push({ url, body: typeof init.body === "string" ? init.body : undefined }); return Promise.resolve(Response.json({ id: "window-1" })); }
      return Promise.reject(new Error(`Unexpected request ${url}`));
    }) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<NextStatusPage person={makePerson("admin")} />);
      fireEvent.click(await view.findByRole("button", { name: "Schedule maintenance" }));
      fireEvent.change(view.getByLabelText("Title"), { target: { value: "Night work" } });
      fireEvent.change(view.getByLabelText("Starts"), { target: { value: "2026-10-01T10:00" } });
      fireEvent.change(view.getByLabelText("Ends"), { target: { value: "2026-10-01T09:00" } });
      fireEvent.click(within(await view.findByRole("dialog")).getByRole("button", { name: "Schedule" }));
      expect(await view.findByText("The end time must be after the start time.")).toBeTruthy();
      fireEvent.change(view.getByLabelText("Ends"), { target: { value: "2026-10-01T11:00" } });
      fireEvent.click(within(view.getByRole("dialog")).getByRole("button", { name: "Schedule" }));
      expect(await view.findByText("Choose at least one part.")).toBeTruthy();
      fireEvent.click(within(view.getByRole("dialog")).getAllByRole("button", { name: "Close" })[1]!);

      fireEvent.click(view.getByRole("button", { name: "Cancel" }));
      const confirm = await view.findByRole("alertdialog");
      expect(confirm.textContent).toContain("Voice care will be marked as cancelled.");
      expect(writes).toHaveLength(0);
      fireEvent.click(within(confirm).getByRole("button", { name: "Cancel maintenance" }));
      await waitFor(() => expect(writes).toHaveLength(1));
      expect(writes[0]?.url).toContain("/api/status/maintenance/window-1/cancel");
    } finally { globalThis.fetch = original; }
  });

  test("maintenance status replaces a down state for the covered part", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/health")) return Promise.resolve(Response.json(body({ ok: false, engines: { ...body().engines, voice: { kind: "stopped", pid: null, alive: null } } })));
      if (url.includes("/api/status/board")) return Promise.resolve(Response.json({ note: null, maintenance: [{ id: "m1", title: "Voice update", description: "", components: ["voice"], starts_at: "2026-09-30T21:00:00Z", ends_at: "2026-09-30T22:00:00Z", status: "in_progress" }] }));
      return Promise.resolve(Response.json({}));
    }) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<NextStatusPage person={makePerson("child")} />);
      const voice = await view.findByText("Under maintenance");
      expect(voice.closest("[data-status]")?.getAttribute("data-status")).toBe("maintenance");
      await waitFor(() => expect(view.getByText("Some parts are under maintenance.")).toBeTruthy());
      expect(view.queryByText("Voice isn't running.")).toBeNull();
    } finally { globalThis.fetch = original; }
  });
});
