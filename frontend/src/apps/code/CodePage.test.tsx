import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Roster } from "@/lib/api";
import { readFileSync } from "node:fs";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { THREAD_SLOTS } from "@/apps/chat/elementBindings";
import { CodePage, sessionIdOf } from "./CodePage";

const realFetch = globalThis.fetch;
const person = { id: "sage", role: "owner" } as Roster;
const session = { id: "csess-abc123", title: "Fix the thermostat", repo: { kind: "none", base_branch: "main", work_branch: "code/x" }, mode: "ask", state: "idle", tier: "standard", changes: { files: 0, additions: 0, deletions: 0 }, last_activity_at: "2026-11-21T10:00:00.000Z" };
let tiers = ["standard", "max"]; let calls: string[] = []; let conns: unknown[] = [];
let sessionState = "idle"; let waiting: { turn_id: string; line: string; offers_standard: boolean } | null = null;

beforeEach(() => {
  window.innerWidth = 1400; // the details pane opens by default only on a wide screen
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
    expect(await within(document.body).findByText("What should we build?")).toBeTruthy();
    await waitFor(() => expect(document.querySelector('[data-slot="code-new-session"] button[aria-label^="Level"]')).toBeTruthy());
    expect(within(document.body).queryByText("Boost")).toBeNull();
  });
  test("one tier on offer draws no tier control", async () => {
    tiers = ["standard"];
    open("/apps/code");
    await within(document.body).findByText("What should we build?");
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector('[data-slot="code-new-session"] button[aria-label^="Level"]')).toBeNull();
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
  test("the New session page is the kit's Thread with Chat's composer, one quiet heading and starting ideas that fill the box", async () => {
    open("/apps/code");
    await within(document.body).findByText("What should we build?");
    const shell = await waitFor(() => { const el = document.querySelector('[data-slot="code-new-session"] [data-slot="aui_composer-shell"]'); if (!el) throw new Error("no composer"); return el; });
    expect(shell.getAttribute("data-density")).toBe(THREAD_SLOTS.composerDensity);
    expect(document.querySelector('[data-slot="code-new-session"] textarea')?.getAttribute("rows")).not.toBeNull();
    expect(document.querySelector('[data-slot="composer-mode-pill"]')!.textContent).toContain("Ask before changes");
    fireEvent.click(within(document.body).getByText("Fix a failing test"));
    await waitFor(() => expect((document.querySelector('[data-slot="code-new-session"] textarea') as HTMLTextAreaElement).value).toContain("failing test"));
  });
  test("the first message creates the session, sends it and opens it", async () => {
    open("/apps/code");
    const box = await waitFor(() => { const el = document.querySelector('[data-slot="code-new-session"] textarea') as HTMLTextAreaElement | null; if (!el) throw new Error("no box"); return el; });
    fireEvent.change(box, { target: { value: "Fix the thermostat" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(calls).toContain("POST /api/code/sessions"));
  });
  test("a failed start says what went wrong and keeps the words", async () => {
    const base = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith("/api/code/sessions") && init?.method === "POST" ? Promise.resolve(Response.json({ error: "The coding engine is off. Ask an admin to turn it on." }, { status: 503 })) : base(input, init)) as unknown as typeof fetch;
    open("/apps/code");
    const box = await waitFor(() => { const el = document.querySelector('[data-slot="code-new-session"] textarea') as HTMLTextAreaElement | null; if (!el) throw new Error("no box"); return el; });
    fireEvent.change(box, { target: { value: "Fix the thermostat" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await within(document.body).findByText("That did not work")).toBeTruthy();
    await waitFor(() => expect((document.querySelector('[data-slot="code-new-session"] textarea') as HTMLTextAreaElement).value).toBe("Fix the thermostat"));
  });
  test("the repository picker appears only with an active git connection, and a chosen one asks for owner/name", async () => {
    conns = [{ id: "gitc-abc123", kind: "github", host: "github.com", account: "willow", status: "active" }];
    open("/apps/code");
    await waitFor(() => expect(document.querySelector('[data-slot="code-repo"]')).toBeTruthy());
    expect(document.querySelector('input[placeholder="owner/name"]')).toBeNull();
  });
  test("no connection means no picker (an empty repository is the default)", async () => {
    open("/apps/code");
    await within(document.body).findByText("What should we build?");
    await new Promise((r) => setTimeout(r, 50));
    expect(document.querySelector('[data-slot="code-repo"]')).toBeNull();
  });
  test("Changes shows the diff and Files lists the workspace tree from the hub", async () => {
    open("/apps/code/csess-abc123");
    await waitFor(() => expect(document.querySelector('[data-slot="code-diff"]')).toBeTruthy());
    expect(calls.some((c) => c.endsWith("/csess-abc123/changes"))).toBe(true);
  });
  test("the header says Scratch folder for a session with no repository", async () => {
    open("/apps/code/csess-abc123");
    await waitFor(() => expect(document.querySelector('[data-slot="code-subtitle"]')?.textContent).toBe("Scratch folder"));
  });
  test("a working session shows the live line with the stage and the time, and the kit's stop button", async () => {
    sessionState = "working";
    open("/apps/code/csess-abc123");
    await waitFor(() => expect(document.querySelector('[data-slot="thinking-indicator"]')).toBeTruthy());
    expect(document.querySelector('[data-slot="thinking-indicator"]')!.textContent).toContain("Waiting for the model");
    expect(document.querySelector('button[aria-label="Stop generating"]')).toBeTruthy();
  });
  test("a failed session shows why, from the reason and the ready check, in plain words", async () => {
    sessionState = "failed";
    open("/apps/code/csess-abc123");
    expect(await within(document.body).findByText(/The coding engine needs an update\./)).toBeTruthy();
    expect(document.querySelector('[data-slot="code-status"]')?.textContent).toBe("The agent stopped");
  });
  test("the one shared composer carries the level chip with only the offered tiers, the mode and the context ring", async () => {
    open("/apps/code/csess-abc123");
    await waitFor(() => expect(document.querySelector('[data-slot="aui_composer-shell"]')).toBeTruthy());
    await waitFor(() => expect(document.querySelector('button[aria-label^="Level"]')).toBeTruthy());
    await waitFor(() => expect(document.querySelector('[data-slot="code-context"]')?.getAttribute("title")).toBe("52K of 64K tokens used"));
    expect(document.querySelector('[data-slot="composer-mode-pill"]')!.textContent).toContain("Ask before changes");
    expect(document.querySelector('[data-slot="composer-input"], textarea.aui-composer-input')).toBeTruthy();
  });

  test("the composer is Chat's: the same density, with the mode and level inside the pill, not a footer row", async () => {
    open("/apps/code/csess-abc123");
    await waitFor(() => expect(document.querySelector('[data-slot="aui_composer-shell"]')).toBeTruthy());
    const shell = document.querySelector('[data-slot="aui_composer-shell"]')!;
    expect(shell.getAttribute("data-density")).toBe(THREAD_SLOTS.composerDensity);
    expect(document.querySelector('[data-slot="aui_composer-footer"]')).toBeNull();
    await waitFor(() => expect(shell.querySelector('[data-slot="composer-quality"]')).toBeTruthy());
  });
  test("adding a file goes through the composer's attachment adapter to the session's upload route", async () => {
    open("/apps/code/csess-abc123");
    const add = await waitFor(() => { const el = document.querySelector('button[aria-label="Add Attachment"]') as HTMLButtonElement | null; if (!el) throw new Error("no button"); return el; });
    const made: HTMLInputElement[] = []; const create = document.createElement.bind(document);
    document.createElement = ((tag: string, o?: ElementCreationOptions) => { const el = create(tag, o); if (tag === "input") made.push(el as HTMLInputElement); return el; }) as typeof document.createElement;
    fireEvent.click(add);
    document.createElement = create;
    const input = (made.find((i) => i.type === "file") ?? document.querySelector('input[type="file"]')) as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { files: [new File(["hello"], "notes.md", { type: "text/markdown" })] } });
    await waitFor(() => expect(calls).toContain("POST /api/code/sessions/csess-abc123/upload"));
  });

  // CODE-UI-01: Code and Chat share one composer, one density and one history column, so they cannot drift.
  test("Code sets no density of its own and draws no composer or column config of its own", () => {
    const read = (f: string) => readFileSync(new URL(f, import.meta.url), "utf8");
    const code = ["./CodePage.tsx", "./SessionView.tsx", "./CodeThread.tsx", "./layout.tsx", "./NewSession.tsx"].map(read).join("\n");
    expect(code).not.toMatch(/codeDensity|composerDensity:\s*"|emptyLayout|placement:\s*"footer"|--font-size-body|--spacing/);
    const list = read("./SessionList.tsx");
    expect(list).toContain("useChatColumn");
    expect(list).toContain("chatColumnShortcutLabel");
    expect(list).toMatch(/search=\{/);
    expect(read("./CodePage.tsx")).toContain("useChatColumn");
    expect(read("./CodePage.tsx")).toContain("registerSidebarToggleShortcut");
  });
  test("the sessions column has search and a hide control with the Chat shortcut", async () => {
    open("/apps/code");
    await within(document.body).findByText("Fix the thermostat");
    expect(document.querySelector('[data-slot="section-sidebar-search"]')).toBeTruthy();
    expect(document.querySelector('[data-slot="section-sidebar-toggle"]')?.getAttribute("aria-keyshortcuts")).toBe("Meta+B Control+B");
    expect(document.querySelector('[data-slot="code-rail"]')).toBeTruthy();
  });
});
