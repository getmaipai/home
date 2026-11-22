// CODE-UX-01: the sessions column's row menu and states on a page: rename, pin, archive, delete with Undo, the unread dot, "Needs you" and the archived toggle.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

const toasts: { text: string; action?: { label: string; onClick: () => void } }[] = [];
const errors: string[] = [];
mock.module("sonner", () => ({
  toast: Object.assign((text: string, options?: { action?: { label: string; onClick: () => void } }) => { toasts.push({ text, ...(options?.action ? { action: options.action } : {}) }); }, { error: (text: string) => { errors.push(text); } }),
  Toaster: () => null,
}));
const { CodePage } = await import("./CodePage");

const realFetch = globalThis.fetch;
const base = { repo: { kind: "none", base_branch: "main", work_branch: "w" }, mode: "ask", state: "idle", tier: "standard", changes: { files: 0, additions: 0, deletions: 0 }, pinned_at: null, archived_at: null, unread: false };
let rows: Record<string, unknown>[]; let calls: string[]; let failNext: string | null;
const at = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

beforeEach(() => {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1400 });
  localStorage.setItem("maipai.chat.rail-collapsed", "0"); // the column starts open, as on a desktop that kept it open
  toasts.length = 0; errors.length = 0; calls = []; failNext = null;
  rows = [
    { ...base, id: "csess-aaaaaa", title: "Fix the thermostat", last_activity_at: at(1) },
    { ...base, id: "csess-bbbbbb", title: "Wire the lamp", last_activity_at: at(2), unread: true },
    { ...base, id: "csess-cccccc", title: "Ship the release", last_activity_at: at(3), state: "needs_you" },
    { ...base, id: "csess-dddddd", title: "Old experiment", last_activity_at: at(4), archived_at: at(5) },
  ];
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input); const method = init?.method ?? "GET"; calls.push(`${method} ${path}${init?.body ? ` ${String(init.body)}` : ""}`);
    if (failNext && path.includes(failNext)) { failNext = null; return Promise.resolve(Response.json({ error: "The hub could not do that." }, { status: 500 })); }
    const id = /csess-[a-z]+/.exec(path)?.[0]; const row = rows.find((r) => r.id === id);
    if (path.endsWith("/messages") && method === "GET") return Promise.resolve(Response.json([]));
    if (path.endsWith("/context")) return Promise.resolve(Response.json({ used_tokens: 0, window_tokens: null, source: "estimate" }));
    if (path.endsWith("/files")) return Promise.resolve(Response.json({ entries: [], truncated: false }));
    if (path.endsWith("/title") && row) { row.title = JSON.parse(String(init!.body)).title; return Promise.resolve(Response.json(row)); }
    if (path.endsWith("/pin") && row) { row.pinned_at = JSON.parse(String(init!.body)).pinned ? at(0) : null; return Promise.resolve(Response.json(row)); }
    if (path.endsWith("/archive") && row) { row.archived_at = JSON.parse(String(init!.body)).archived ? at(0) : null; return Promise.resolve(Response.json(row)); }
    if (path.endsWith("/opened") && row) { row.unread = false; return Promise.resolve(Response.json(row)); }
    if (method === "DELETE" && row) { rows = rows.filter((r) => r.id !== id); return Promise.resolve(Response.json({ ok: true })); }
    if (path.includes("/api/trash/coding_session/")) return Promise.resolve(Response.json({ success: true }));
    if (path.endsWith("/api/code/sessions")) return Promise.resolve(Response.json(rows));
    if (id && row && method === "GET" && path.endsWith(id)) return Promise.resolve(Response.json({ session: row, coding_notice: null, waiting: null, requests: [], queued_messages: [] }));
    if (path.endsWith("/tiers")) return Promise.resolve(Response.json({ tiers: ["standard"], last: "standard" }));
    return Promise.resolve(Response.json({}));
  }) as unknown as typeof fetch;
});
afterEach(() => { cleanup(); globalThis.fetch = realFetch; localStorage.removeItem("maipai.chat.rail-collapsed"); });

const open = (at = "/apps/code") => renderWithQueryClient(<MemoryRouter initialEntries={[at]}><CodePage /></MemoryRouter>);
const pinnedGroup = () => Boolean(document.querySelector('[data-slot="code-session-group"][data-group="pinned"]'));
const absent = (title: string) => within(document.body).queryByText(title) === null;
const findRow = (title: string) => [...document.querySelectorAll('[data-slot="code-session-row"]')].find((el) => el.textContent?.includes(title)) as HTMLElement | undefined;
const rowOf = async (title: string) => { await waitFor(() => expect(findRow(title) !== undefined).toBe(true)); return findRow(title)!; };
async function choose(title: string, item: string) {
  const row = await rowOf(title);
  fireEvent.click(row.querySelector('[data-slot="code-session-more"]')!);
  fireEvent.click(await within(document.body).findByText(item, { selector: '[role="menuitem"]' }));
}

describe("the sessions column manages sessions", () => {
  test("the rows show an unread dot and a Needs you state, and an archived session stays behind the toggle", async () => {
    open();
    const unread = await rowOf("Wire the lamp");
    expect(unread.querySelector('[data-marker="unread"]')).toBeTruthy();
    expect(unread.getAttribute("data-unread")).toBe("");
    const needs = await rowOf("Ship the release");
    expect(needs.querySelector('[data-marker="needs_you"]')).toBeTruthy();
    expect(needs.querySelector('[data-marker="needs_you"]')?.getAttribute("aria-label")).toBe("Needs you");
    expect((await rowOf("Fix the thermostat")).querySelector('[data-slot="code-row-marker"]')).toBeNull();
    expect(absent("Old experiment")).toBe(true);
    fireEvent.click(within(document.body).getByText("Show archived (1)"));
    expect(await within(document.body).findByText("Old experiment")).toBeTruthy();
    fireEvent.click(within(document.body).getByText("Hide archived"));
    await waitFor(() => expect(absent("Old experiment")).toBe(true));
  });
  test("opening an unread session tells the hub it was seen and the dot goes", async () => {
    open("/apps/code/csess-bbbbbb");
    await waitFor(() => expect(calls).toContain("POST /api/code/sessions/csess-bbbbbb/opened {}"));
    await waitFor(() => expect((document.querySelector('[data-slot="code-session-row"][data-active]') as HTMLElement).querySelector('[data-marker="unread"]')).toBeNull());
  });
  test("Rename edits in place: Enter saves through the hub and Escape cancels", async () => {
    open();
    await choose("Fix the thermostat", "Rename");
    const field = await within(document.body).findByLabelText("Rename session") as HTMLInputElement;
    fireEvent.change(field, { target: { value: "Fix the heater" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(calls).toContain('PUT /api/code/sessions/csess-aaaaaa/title {"title":"Fix the heater"}'));
    expect(await within(document.body).findByText("Fix the heater")).toBeTruthy();
    await choose("Wire the lamp", "Rename");
    fireEvent.keyDown(await within(document.body).findByLabelText("Rename session"), { key: "Escape" });
    await waitFor(() => expect(within(document.body).queryByLabelText("Rename session") === null).toBe(true));
    expect(calls.filter((c) => c.includes("/title")).length).toBe(1);
  });
  test("a rename the hub refuses toasts what to do and keeps the field open", async () => {
    open(); failNext = "/title";
    await choose("Fix the thermostat", "Rename");
    const field = await within(document.body).findByLabelText("Rename session");
    fireEvent.change(field, { target: { value: "Nope" } }); fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(errors.length).toBe(1));
    expect(errors[0]).toContain("hub could not do that");
    expect(within(document.body).getByLabelText("Rename session")).toBeTruthy();
  });
  test("Pin moves the session to a Pinned group and Unpin puts it back", async () => {
    open();
    await choose("Wire the lamp", "Pin");
    await waitFor(() => expect(document.querySelector('[data-slot="code-session-group"][data-group="pinned"]')?.textContent?.includes("Wire the lamp")).toBe(true));
    expect(calls).toContain('PUT /api/code/sessions/csess-bbbbbb/pin {"pinned":true}');
    await choose("Wire the lamp", "Unpin");
    await waitFor(() => expect(pinnedGroup()).toBe(false));
  });
  test("Archive hides the session, and Unarchive from the toggle brings it back", async () => {
    open();
    await choose("Fix the thermostat", "Archive");
    await waitFor(() => expect(absent("Fix the thermostat")).toBe(true));
    expect(calls).toContain('PUT /api/code/sessions/csess-aaaaaa/archive {"archived":true}');
    fireEvent.click(within(document.body).getByText(/Show archived/));
    await choose("Old experiment", "Unarchive");
    await waitFor(() => expect(calls).toContain('PUT /api/code/sessions/csess-dddddd/archive {"archived":false}'));
  });
  test("Delete removes the row, offers Undo, and Undo restores it from the Trash", async () => {
    open();
    await choose("Wire the lamp", "Delete");
    await waitFor(() => expect(absent("Wire the lamp")).toBe(true));
    expect(calls).toContain("DELETE /api/code/sessions/csess-bbbbbb");
    expect(toasts[0]!.text).toContain("Wire the lamp"); expect(toasts[0]!.action!.label).toBe("Undo");
    rows.push({ ...base, id: "csess-bbbbbb", title: "Wire the lamp", last_activity_at: at(2) });
    toasts[0]!.action!.onClick();
    await waitFor(() => expect(calls).toContain("POST /api/trash/coding_session/csess-bbbbbb/restore"));
    expect(await within(document.body).findByText("Wire the lamp")).toBeTruthy();
  });
  test("deleting the open session goes back to the new session page", async () => {
    open("/apps/code/csess-aaaaaa");
    await choose("Fix the thermostat", "Delete");
    expect(await within(document.body).findByText("What should we build?")).toBeTruthy();
  });
});
