import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Roster } from "@/lib/api";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { CodePage, sessionIdOf } from "./CodePage";

const realFetch = globalThis.fetch;
const person = { id: "sage", role: "owner" } as Roster;
const session = { id: "csess-abc123", title: "Fix the thermostat", repo: { kind: "none", base_branch: "main", work_branch: "code/x" }, mode: "ask", state: "idle", tier: "standard", changes: { files: 0, additions: 0, deletions: 0 }, last_activity_at: "2026-11-21T10:00:00.000Z" };
let tiers = ["standard", "max"]; let calls: string[] = [];
let waiting: { turn_id: string; line: string; offers_standard: boolean } | null = null;

beforeEach(() => {
  tiers = ["standard", "max"]; calls = []; waiting = null;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input); calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path.endsWith("/tiers")) return Promise.resolve(Response.json({ tiers, last: "standard" }));
    if (path.endsWith("/messages") && (init?.method ?? "GET") === "GET") return Promise.resolve(Response.json([]));
    if (path.includes("/use-standard")) return Promise.resolve(Response.json({ ok: true }));
    if (path.endsWith("/api/code/sessions/csess-abc123")) return Promise.resolve(Response.json({ session: { ...session, state: waiting ? "queued" : "idle", tier: "max" }, waiting, requests: [], queued_messages: [] }));
    if (path.endsWith("/api/code/sessions")) return Promise.resolve(Response.json([session]));
    return Promise.resolve(Response.json({}));
  }) as unknown as typeof fetch;
});
afterEach(() => { cleanup(); globalThis.fetch = realFetch; });

const open = (at: string) => renderWithQueryClient(<MemoryRouter initialEntries={[at]}><CodePage person={person} /></MemoryRouter>);

describe("the Code app page", () => {
  test("the session id is read from the address", () => {
    expect(sessionIdOf("/apps/code/csess-abc123")).toBe("csess-abc123");
    expect(sessionIdOf("/apps/code")).toBeUndefined();
  });
  test("the new session row shows the tier control with only the tiers the hub offers", async () => {
    open("/apps/code");
    expect(await within(document.body).findByText("What should we work on?")).toBeTruthy();
    await waitFor(() => expect(document.querySelector('[data-slot="code-tier"]')).toBeTruthy());
    expect(within(document.body).queryByText("Boost")).toBeNull();
  });
  test("one tier on offer draws no tier control", async () => {
    tiers = ["standard"];
    open("/apps/code");
    await within(document.body).findByText("What should we work on?");
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector('[data-slot="code-tier"]')).toBeNull();
  });
  test("a held Max message offers Use Standard for this message, and the click calls the hub", async () => {
    waiting = { turn_id: "ctrn-x1", line: "Waiting for Max, 2 ahead", offers_standard: true };
    open("/apps/code/csess-abc123");
    const button = await within(document.body).findByText("Use Standard for this message");
    fireEvent.click(button);
    await waitFor(() => expect(calls).toContain("POST /api/code/sessions/csess-abc123/turns/ctrn-x1/use-standard"));
    expect((await within(document.body).findAllByText("Waiting for Max, 2 ahead")).length).toBeGreaterThan(0);
  });
  test("the session view has Changes, Files, Terminal and Plan tabs", async () => {
    open("/apps/code/csess-abc123");
    for (const name of ["Changes", "Files", "Terminal", "Plan"]) expect((await within(document.body).findAllByText(name)).length).toBeGreaterThan(0);
  });
});
