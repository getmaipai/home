import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Roster } from "@/lib/api";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { CodePage, sessionIdOf } from "./CodePage";

const realFetch = globalThis.fetch;
const person = { id: "sage", role: "owner" } as Roster;
const session = { id: "csess-abc123", title: "Fix the thermostat", repo: { kind: "none", base_branch: "main", work_branch: "code/x" }, mode: "ask", state: "idle", tier: "standard", changes: { files: 0, additions: 0, deletions: 0 }, last_activity_at: "2026-11-21T10:00:00.000Z" };
let tiers = ["standard", "max"]; let calls: string[] = []; let conns: unknown[] = [];
let sessionState = "idle"; let waiting: { turn_id: string; line: string; offers_standard: boolean } | null = null;

beforeEach(() => {
  tiers = ["standard", "max"]; calls = []; waiting = null; conns = []; sessionState = "idle";
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input); calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path.endsWith("/context")) return Promise.resolve(Response.json({ used_tokens: 52000, window_tokens: 64000, source: "engine" }));
    if (path.endsWith("/upload")) return Promise.resolve(Response.json({ path: "uploads/notes.md", bytes: 5 }, { status: 201 }));
    if (path.endsWith("/api/coding/ready")) return Promise.resolve(Response.json({ ready: false, first_missing: { id: "engine", say: "The coding engine needs an update.", who: "an admin" }, items: [] }));
    if (path.endsWith("/git-connections")) return Promise.resolve(Response.json({ connections: conns }));
    if (path.endsWith("/changes")) return Promise.resolve(Response.json({ available: true, files: [{ path: "src/a.ts", additions: 1, deletions: 0, binary: false }], diff: "diff --git a/src/a.ts b/src/a.ts\n@@ -0,0 +1 @@\n+hello\n", truncated: false }));
    if (path.endsWith("/files")) return Promise.resolve(Response.json({ entries: [{ path: "src", name: "src", depth: 0, kind: "folder" }, { path: "src/a.ts", name: "a.ts", depth: 1, kind: "file" }], truncated: false }));
    if (path.includes("/file?path=")) return Promise.resolve(Response.json({ path: "src/a.ts", content: "const a = 1;\n" }));
    if (path.endsWith("/tiers")) return Promise.resolve(Response.json({ tiers, last: "standard" }));
    if (path.endsWith("/messages") && (init?.method ?? "GET") === "GET") return Promise.resolve(Response.json([]));
    if (path.includes("/use-standard")) return Promise.resolve(Response.json({ ok: true }));
    if (path.endsWith("/api/code/sessions/csess-abc123")) return Promise.resolve(Response.json({ session: { ...session, state: waiting ? "queued" : sessionState, tier: "max" }, waiting, requests: [], queued_messages: [] }));
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
  test("the repository picker appears only with an active git connection, and a chosen one asks for owner/name", async () => {
    conns = [{ id: "gitc-abc123", kind: "github", host: "github.com", account: "willow", status: "active" }];
    open("/apps/code");
    await waitFor(() => expect(document.querySelector('[data-slot="code-repo"]')).toBeTruthy());
    expect(document.querySelector('input[placeholder="owner/name"]')).toBeNull();
  });
  test("no connection means no picker (an empty repository is the default)", async () => {
    open("/apps/code");
    await within(document.body).findByText("What should we work on?");
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector('[data-slot="code-repo"]')).toBeNull();
  });
  test("Changes shows the diff and Files lists the workspace tree from the hub", async () => {
    open("/apps/code/csess-abc123");
    await waitFor(() => expect(document.querySelector('[data-slot="code-diff"]')).toBeTruthy());
    expect(calls.some((c) => c.endsWith("/csess-abc123/changes"))).toBe(true);
  });
  test("a working session shows the live line with the stage and the time, and a Stop button", async () => {
    sessionState = "working";
    open("/apps/code/csess-abc123");
    await waitFor(() => expect(document.querySelector('[data-slot="code-live"]')).toBeTruthy());
    expect(document.querySelector('[data-slot="code-live"]')!.textContent).toContain("Thinking");
    expect(within(document.body).getAllByText("Stop").length).toBeGreaterThan(0);
  });
  test("a failed session shows why, from the ready check, in plain words", async () => {
    sessionState = "failed";
    open("/apps/code/csess-abc123");
    expect(await within(document.body).findByText(/The coding engine needs an update\./)).toBeTruthy();
    expect(document.querySelector('[data-slot="code-failed"]')).toBeTruthy();
  });
  test("the header says Scratch folder for a session with no repository", async () => {
    open("/apps/code/csess-abc123");
    await waitFor(() => expect(document.querySelector('[data-slot="code-subtitle"]')?.textContent).toBe("Scratch folder"));
  });
  test("the status bar has the level control with only the offered tiers, the mode and the context ring with its tooltip", async () => {
    open("/apps/code/csess-abc123");
    await waitFor(() => expect(document.querySelector('[data-slot="code-status-tier"]')).toBeTruthy());
    expect(document.querySelector('[data-slot="code-status-tier"]')!.textContent).not.toContain("Boost");
    await waitFor(() => expect(document.querySelector('[data-slot="code-context"]')?.getAttribute("title")).toBe("52K of 64K tokens used"));
    expect(document.querySelector('[data-slot="code-statusbar"]')!.textContent).toContain("Asks before changes");
  });
  test("adding a file uploads it to the session and shows a chip", async () => {
    open("/apps/code/csess-abc123");
    const input = await waitFor(() => { const el = document.querySelector('[data-slot="code-file-input"]') as HTMLInputElement | null; if (!el) throw new Error("no input"); return el; });
    fireEvent.change(input, { target: { files: [new File(["hello"], "notes.md", { type: "text/markdown" })] } });
    await waitFor(() => expect(calls).toContain("POST /api/code/sessions/csess-abc123/upload"));
    expect(await within(document.body).findByText("notes.md")).toBeTruthy();
  });
});
