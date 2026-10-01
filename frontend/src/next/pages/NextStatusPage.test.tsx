import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { NextStatusPage } from "@/next/pages/NextStatusPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { Roster } from "@/lib/api";

afterEach(cleanup);

const statusAsyncTimeout = { timeout: 10_000 };

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
    if (url.includes("/api/status/history")) return Promise.resolve(Response.json({ generated_at: new Date().toISOString(), days: 90, components: [], incidents: [] }));
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
      expect(view.getByText("We're fully operational")).toBeTruthy();
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

  test("history failure keeps the banner and parts visible", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/health")) return Promise.resolve(Response.json(body()));
      if (url.includes("/api/status/history")) return Promise.resolve(new Response("failed", { status: 503 }));
      return Promise.resolve(Response.json({ note: null, maintenance: [] }));
    }) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<NextStatusPage person={makePerson("child")} />);
      expect(await view.findByText("We're fully operational")).toBeTruthy();
      expect(await view.findByText("Brain")).toBeTruthy();
      expect(view.queryByRole("img", { name: /Last 90 days:/i })).toBeNull();
    } finally { globalThis.fetch = original; }
  }, 30_000);

  test("members get the same 90 day bars, percentages, incident line, and recent problems", async () => {
    const original = globalThis.fetch;
    const history = {
      generated_at: "2026-09-30T14:10:00.000Z", days: 90,
      components: ["chat", "embed", "background", "voice", "library", "hub"].map((component) => ({ component, uptime_percent: component === "hub" ? null : 99.982, current: { state: "operational", since: null }, days: Array.from({ length: 90 }, (_, i) => ({ date: `2026-09-${String((i % 30) + 1).padStart(2, "0")}`, worst: "operational", minutes: { operational: 1440, degraded: 0, outage: 0, maintenance: 0 } })) })),
      incidents: [{ component: "voice", started_at: "2026-09-30T12:00:00.000Z", ended_at: null, minutes: 130, ongoing: true }, { component: "library", started_at: "2026-09-29T14:10:00.000Z", ended_at: "2026-09-29T15:40:00.000Z", minutes: 90, ongoing: false }],
    };
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/health")) return Promise.resolve(Response.json(body({ ok: false, engines: { ...body().engines, voice: { kind: "stopped", pid: null, alive: null } }, sidecars: [{ id: "kiwix-serve", status: "running", baseUrl: "http://127.0.0.1" }] })));
      if (url.includes("/api/status/history")) return Promise.resolve(Response.json(history));
      return Promise.resolve(Response.json({ note: null, maintenance: [] }));
    }) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<NextStatusPage person={makePerson("child")} />);
      expect((await view.findAllByText("99.982% uptime", undefined, statusAsyncTimeout)).length).toBeGreaterThan(0);
      const strips = view.getAllByRole("img", { name: /Last 90 days:/i });
      expect(strips).toHaveLength(6);
      expect(strips.some((strip) => strip.getAttribute("aria-label") === "Last 90 days: 99.982% uptime, 1 outage, 2 h 10 min down.")).toBe(true);
      expect(strips.some((strip) => strip.getAttribute("aria-label") === "Last 90 days: 99.982% uptime, 1 outage, 1 h 30 min down.")).toBe(true);
      expect(strips.some((strip) => strip.getAttribute("aria-label") === "Last 90 days: no data yet.")).toBe(true);
      expect(view.container.querySelectorAll("[data-status-strip] button")).toHaveLength(0);
      expect(view.getByText("No data yet")).toBeTruthy();
      for (const label of ["Last 90 days", "Fine", "Slow", "Down", "Maintenance"]) expect(view.getByText(label)).toBeTruthy();
      expect(view.getByText("Investigating · Ongoing for 2 h 10 min · Affects Voice")).toBeTruthy();
      expect(view.getByText("Recent problems")).toBeTruthy();
      const recentProblems = view.getByText("Recent problems").closest("[data-slot='card']");
      expect(recentProblems?.textContent).toContain("Ongoing since");
      expect(recentProblems?.textContent).toContain("Sep 29");
      expect(recentProblems?.textContent).toContain("1 h 30 min");
      expect(recentProblems?.textContent).toContain("Ended");
    } finally { globalThis.fetch = original; }
  }, 30_000);

  test("offline banner joins problem names and uses singular grammar", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(Response.json(body({ ok: false, engines: {
      chat: { kind: "stopped", pid: 2, alive: null }, embed: { kind: "stopped", pid: null, alive: null },
      background: { kind: "spawned", pid: null, alive: true }, voice: { kind: "spawned", pid: null, alive: true },
    } })))) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<NextStatusPage person={makePerson("child")} />);
      expect(await view.findByText("We're having problems")).toBeTruthy();
      expect(view.getAllByText("Brain").length).toBeGreaterThan(0);
      expect(view.getAllByText("Understanding").length).toBeGreaterThan(0);
      expect(view.getByText("Brain and Understanding aren't running")).toBeTruthy();
    } finally { globalThis.fetch = original; }
  });

  test("degraded banner copy is plain and Library is conditional", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(Response.json(body({ engines: { ...body().engines, voice: { kind: "starting", pid: null, alive: null } }, sidecars: [{ id: "kiwix-serve", status: "running", baseUrl: "http://127.0.0.1" }] })))) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<NextStatusPage person={makePerson("adult")} />);
      expect(await view.findByText("Some parts are starting up")).toBeTruthy();
      expect(view.getByText("Voice is starting up")).toBeTruthy();
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
      for (const status of ["Scheduled", "In maintenance", "Done", "Cancelled"]) expect(admin.getByText(status)).toBeTruthy();
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
      expect(calls.every((url) => url.includes("/api/health") || url.includes("/api/status/board") || url.includes("/api/status/history"))).toBe(true);
    } finally { globalThis.fetch = original; }
  });

  test("keeps note, banner, incident, maintenance and parts in order", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/health")) return Promise.resolve(Response.json(body({ ok: false, engines: { ...body().engines, chat: { kind: "stopped", pid: null, alive: null } } })));
      return Promise.resolve(Response.json({ note: { id: "n", body: "Notice text", posted_at: new Date().toISOString(), posted_by_name: "Sage" }, maintenance: [{ id: "m", title: "Work window", description: "", components: ["voice"], starts_at: new Date(Date.now() - 60_000).toISOString(), ends_at: new Date(Date.now() + 60_000).toISOString(), status: "in_progress" }] }));
    }) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<NextStatusPage person={makePerson("child")} />);
      await view.findByText("Brain isn't running");
      const note = view.getByText("Notice text").closest("[data-slot='alert']");
      const banner = view.container.querySelector("[data-status-banner]");
      const incident = view.getByText("Brain isn't running").closest("[data-slot='card']");
      const maintenance = view.getByText("Scheduled maintenance").closest("[data-slot='card']");
      const parts = view.getByText("Parts").closest("[data-slot='card']");
      const order = [note, banner, incident, maintenance, parts];
      expect(order.every(Boolean)).toBe(true);
      expect(order.map((node) => Array.from(node?.parentElement?.children ?? []).indexOf(node!))).toEqual([0, 1, 2, 3, 4]);
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
      fireEvent.click(await view.findByRole("button", { name: "Post a note" }, statusAsyncTimeout));
      const dialog = await view.findByRole("dialog", undefined, statusAsyncTimeout);
      fireEvent.change(view.getByLabelText("Note"), { target: { value: "Library will pause soon." } });
      await act(async () => { fireEvent.click(view.getByRole("combobox")); });
      const hour = await view.findByRole("option", { name: "1 hour" }, statusAsyncTimeout);
      await act(async () => { fireEvent.pointerDown(hour, { pointerId: 1, pointerType: "mouse", button: 0 }); fireEvent.pointerUp(hour, { pointerId: 1, pointerType: "mouse", button: 0 }); fireEvent.click(hour); });
      await waitFor(() => expect(view.getByRole("combobox").textContent).toContain("1 hour"), statusAsyncTimeout);
      fireEvent.click(within(dialog).getByRole("button", { name: "Post note" }));
      await waitFor(() => expect(posted).toBeDefined(), statusAsyncTimeout);
      expect(posted?.body).toBe("Library will pause soon.");
      expect(Date.parse(posted?.expires_at ?? "") - Date.now()).toBeGreaterThan(3_590_000);
      expect(Date.parse(posted?.expires_at ?? "") - Date.now()).toBeLessThanOrEqual(3_600_000);
    } finally { globalThis.fetch = original; }
  }, 30_000);

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
      expect(await view.findByText("Quiet hours tonight.", undefined, statusAsyncTimeout)).toBeTruthy();
      fireEvent.click(view.getByRole("button", { name: "Clear" }));
      await waitFor(() => expect(calls.some((call) => call.url.endsWith("/api/status/note") && call.method === "DELETE")).toBe(true), statusAsyncTimeout);
      await waitFor(() => expect(view.queryByText("Quiet hours tonight.")).toBeNull(), statusAsyncTimeout);
    } finally { globalThis.fetch = original; }
  }, 30_000);

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
      fireEvent.click(await view.findByRole("button", { name: "Schedule maintenance" }, statusAsyncTimeout));
      fireEvent.change(view.getByLabelText("Title"), { target: { value: "Night work" } });
      fireEvent.change(view.getByLabelText("Starts"), { target: { value: "2026-10-01T10:00" } });
      fireEvent.change(view.getByLabelText("Ends"), { target: { value: "2026-10-01T09:00" } });
      fireEvent.click(within(await view.findByRole("dialog", undefined, statusAsyncTimeout)).getByRole("button", { name: "Schedule" }));
      expect(await view.findByText("The end time must be after the start time.", undefined, statusAsyncTimeout)).toBeTruthy();
      fireEvent.change(view.getByLabelText("Ends"), { target: { value: "2026-10-01T11:00" } });
      fireEvent.click(within(view.getByRole("dialog")).getByRole("button", { name: "Schedule" }));
      expect(await view.findByText("Choose at least one part.", undefined, statusAsyncTimeout)).toBeTruthy();
      fireEvent.click(within(view.getByRole("dialog")).getAllByRole("button", { name: "Close" })[1]!);

      fireEvent.click(view.getByRole("button", { name: "Cancel" }));
      const confirm = await view.findByRole("alertdialog", undefined, statusAsyncTimeout);
      expect(confirm.textContent).toContain("Voice care will be marked as cancelled.");
      expect(writes).toHaveLength(0);
      fireEvent.click(within(confirm).getByRole("button", { name: "Cancel maintenance" }));
      await waitFor(() => expect(writes).toHaveLength(1), statusAsyncTimeout);
      expect(writes[0]?.url).toContain("/api/status/maintenance/window-1/cancel");
    } finally { globalThis.fetch = original; }
  }, 30_000);

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
      const voice = await view.findByText("Under maintenance", undefined, statusAsyncTimeout);
      expect(voice.closest("[data-status]")?.getAttribute("data-status")).toBe("maintenance");
      await waitFor(() => expect(view.getByText("Scheduled maintenance is in progress")).toBeTruthy(), statusAsyncTimeout);
      expect(view.queryByText("Voice isn't running")).toBeNull();
    } finally { globalThis.fetch = original; }
  }, 30_000);

  test("an admin can schedule daily recurring maintenance", async () => {
    const original = globalThis.fetch;
    let submitted: Record<string, unknown> | undefined;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/health")) return Promise.resolve(Response.json(body()));
      if (url.includes("/api/status/board")) return Promise.resolve(Response.json({ note: null, maintenance: [] }));
      if (url.endsWith("/api/status/maintenance") && init?.method === "POST") {
        submitted = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Promise.resolve(Response.json({ id: "window-weekly" }));
      }
      return Promise.reject(new Error(`Unexpected request ${url}`));
    }) as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<NextStatusPage person={makePerson("admin")} />);
      fireEvent.click(await view.findByRole("button", { name: "Schedule maintenance" }, statusAsyncTimeout));
      const dialog = await view.findByRole("dialog", undefined, statusAsyncTimeout);
      fireEvent.change(view.getByLabelText("Title"), { target: { value: "Weekly voice updates" } });
      fireEvent.change(view.getByLabelText("Starts"), { target: { value: "2026-10-02T10:00" } });
      fireEvent.change(view.getByLabelText("Ends"), { target: { value: "2026-10-02T11:00" } });
      fireEvent.click(within(dialog).getAllByRole("checkbox")[3]!);
      fireEvent.click(view.getByLabelText("Repeat"));
      const daily = await view.findByRole("option", { name: "Daily" }, statusAsyncTimeout);
      await act(async () => {
        fireEvent.pointerDown(daily, { pointerId: 1, pointerType: "mouse", button: 0 });
        fireEvent.pointerUp(daily, { pointerId: 1, pointerType: "mouse", button: 0 });
        fireEvent.click(daily);
      });
      fireEvent.click(within(dialog).getByRole("button", { name: "Schedule" }));
      await waitFor(() => expect(submitted).toBeDefined(), statusAsyncTimeout);
      expect(submitted).toMatchObject({ rrule: "FREQ=DAILY", components: ["voice"] });
      expect(submitted).not.toHaveProperty("until");
    } finally { globalThis.fetch = original; }
  }, 30_000);

  test("an admin can choose weekly days and an end date", async () => {
    const original = globalThis.fetch;
    let submitted: Record<string, unknown> | undefined;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/health")) return Promise.resolve(Response.json(body()));
      if (url.includes("/api/status/board")) return Promise.resolve(Response.json({ note: null, maintenance: [] }));
      if (url.endsWith("/api/status/maintenance") && init?.method === "POST") {
        submitted = JSON.parse(String(init.body)) as Record<string, unknown>;
        return Promise.resolve(Response.json({ id: "window-weekly" }));
      }
      return Promise.reject(new Error(`Unexpected request ${url}`));
    }) as unknown as typeof fetch;
    try {
      const start = new Date();
      start.setDate(start.getDate() + ((5 - start.getDay() + 7) % 7 || 7));
      start.setHours(10, 0, 0, 0);
      const end = new Date(start.getTime() + 60 * 60_000);
      const until = new Date(start.getTime() + 28 * 86_400_000);
      const localDateTime = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
      const untilString = [until.getFullYear(), String(until.getMonth() + 1).padStart(2, "0"), String(until.getDate()).padStart(2, "0")].join("-");
      const view = renderWithQueryClient(<NextStatusPage person={makePerson("admin")} />);
      fireEvent.click(await view.findByRole("button", { name: "Schedule maintenance" }, statusAsyncTimeout));
      const dialog = await view.findByRole("dialog", undefined, statusAsyncTimeout);
      fireEvent.change(view.getByLabelText("Title"), { target: { value: "Weekly voice updates" } });
      fireEvent.change(view.getByLabelText("Starts"), { target: { value: localDateTime(start) } });
      fireEvent.change(view.getByLabelText("Ends"), { target: { value: localDateTime(end) } });
      fireEvent.click(within(dialog).getAllByRole("checkbox")[3]!);
      async function chooseOption(label: string, name: string) {
        fireEvent.click(view.getByLabelText(label));
        const option = await view.findByRole("option", { name }, statusAsyncTimeout);
        await act(async () => {
          const pointer = { pointerId: 1, pointerType: "mouse", button: 0 };
          fireEvent.pointerDown(option, pointer);
          fireEvent.pointerUp(option, pointer);
          fireEvent.click(option);
        });
      }
      await chooseOption("Repeat", "Weekly");
      const weekdayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      fireEvent.click(within(dialog).getByText(weekdayLabels[new Date(localDateTime(start)).getDay()]!, { exact: true }));
      fireEvent.click(within(dialog).getByText("Wed", { exact: true }));
      await chooseOption("Repeat ends", "Until a date");
      const untilTrigger = dialog.querySelector<HTMLButtonElement>("#maintenance-repeat-until");
      if (!untilTrigger) throw new Error("Repeat-until calendar trigger is missing.");
      fireEvent.click(untilTrigger);
      const untilMonth = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(until);
      for (let month = 0; month < 12; month++) {
        const caption = document.querySelector("[data-slot='calendar'] .cn-calendar-caption-label");
        if (caption?.textContent?.includes(untilMonth)) break;
        const next = document.querySelector("[data-slot='calendar'] .rdp-button_next");
        if (!next) throw new Error("Calendar next-month control is missing.");
        fireEvent.click(next);
      }
      const monthName = untilMonth.split(" ")[0];
      fireEvent.click(await view.findByRole("button", { name: new RegExp(monthName + " " + until.getDate()) }, statusAsyncTimeout));
      fireEvent.click(within(dialog).getByRole("button", { name: "Schedule" }));
      await waitFor(() => expect(submitted).toBeDefined(), statusAsyncTimeout);
      expect(submitted).toMatchObject({ rrule: "FREQ=WEEKLY;BYDAY=WE", until: untilString, components: ["voice"] });
    } finally { globalThis.fetch = original; }
  }, 30_000);
});
