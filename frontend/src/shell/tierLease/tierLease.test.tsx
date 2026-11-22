// TIER-LEASE-04: the shared notice line and its hook against a fake Home over fetch. Every line (holder idle, holder with a waiter, paused, released while idle, waiter, waiter behind a pin),
// the adult and the child form, holder versus waiter, the action links calling the routes, and the 10 second touch cadence. The words come from the backend copy file itself.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { AssistantRuntimeProvider, useAui, useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react";
import { holderNotice, pausedNotice, releasedNotice, waiterNotice, type TierLeaseNotice as CopyNotice } from "@maipai/home-backend/src/lib/tierLeaseCopy";
import type { TierLeaseKey, TierLeaseView } from "@/shell/tierLease/tierLeaseApi";
import { useTierLease, type TierLeaseOptions } from "@/shell/tierLease/useTierLease";
import { TierLeaseNotice } from "@/shell/tierLease/TierLeaseNotice";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

const realFetch = globalThis.fetch;
const wire = (n: CopyNotice, child = false) => ({ code: n.code, text: child ? n.child : n.adult, more: n.more, actions: n.actions });
type Waiters = { count: number; kinds: string[] };
function viewOf(key: TierLeaseKey, over: { mine?: boolean; state?: TierLeaseView["state"]; waiters?: Waiters; child?: boolean; etaSeconds?: number; pinnedWaitMinutes?: number } = {}): TierLeaseView {
  const waiters = over.waiters ?? { count: 0, kinds: [] };
  const mine = over.mine ?? true; const state = over.state ?? "held"; const child = over.child ?? false;
  const notice = state !== "held" ? null : mine ? wire(holderNotice({ key, waiters, etaSeconds: over.etaSeconds }), child) : waiters.count > 0 ? wire(waiterNotice({ blocker: key, etaSeconds: over.etaSeconds, pinnedWaitMinutes: over.pinnedWaitMinutes }), child) : null;
  return { key, state, held_by_you: mine && state === "held", pinned: false, releases_in_seconds: null, waiters, holder_jobs: 0, decision: null, pause_max_minutes: 30, notice, released_notice: wire(releasedNotice(waiters), child), paused_notice: wire(pausedNotice(waiters), child) };
}

let calls: { key: string; body: unknown }[] = [];
let current: TierLeaseView;
beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    calls.push({ key, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (key.startsWith("GET /api/tier-leases/")) return Response.json(current);
    if (key.endsWith("/touch")) return Response.json(current);
    if (key.endsWith("/pause")) return Response.json({ state: "paused", pause_max_minutes: 30 });
    if (key.endsWith("/resume")) return Response.json({ turn_id: "t1", tier: "max" });
    if (key.endsWith("/lower")) return Response.json({ tier: "standard" });
    return Response.json({}, { status: 404 });
  }) as unknown as typeof fetch;
});
afterEach(() => { cleanup(); globalThis.fetch = realFetch; });

const NOOP: ChatModelAdapter = { async *run() { yield { content: [] }; } };
function Typer() { const aui = useAui(); return <button type="button" data-testid="type" onClick={() => aui.composer().setText(`a${Math.random()}`)}>type</button>; }
function Probe({ leaseKey, options }: { leaseKey: TierLeaseKey; options?: TierLeaseOptions }) {
  const runtime = useLocalRuntime(NOOP, { initialMessages: [] });
  const lease = useTierLease(leaseKey, { refetchMs: 40, ...options });
  return <AssistantRuntimeProvider runtime={runtime}><div><TierLeaseNotice notice={lease.notice} /><button type="button" data-testid="touch" onClick={lease.touch}>touch</button><Typer /></div></AssistantRuntimeProvider>;
}
const posts = () => calls.filter((c) => c.key.startsWith("POST"));
const text = () => document.querySelector("[data-chat-notice-text]")?.textContent;
type View = ReturnType<typeof renderWithQueryClient>;
const link = (view: View, name: string) => view.findByRole("button", { name });

describe("holder lines", () => {
  test("idle holder in chat: Max switches off when you stop; Code hides it (its own status line stays)", async () => {
    current = viewOf("chat");
    const view = renderWithQueryClient(<Probe leaseKey="chat" />);
    await view.findByText("Max switches off when you stop. It comes back when you type, about 40 seconds.");
    cleanup();
    current = viewOf("coding");
    renderWithQueryClient(<Probe leaseKey="coding" options={{ showIdle: false, sessionId: "s1" }} />);
    await waitFor(() => expect(calls.some((c) => c.key === "GET /api/tier-leases/coding")).toBe(true));
    expect(document.querySelector("[data-chat-notice]")).toBeNull();
  });
  test("a waiting picture: the sentence with the three choices; Keep going renews and hides the offer", async () => {
    current = viewOf("coding", { waiters: { count: 1, kinds: ["picture"] }, etaSeconds: 120 });
    const view = renderWithQueryClient(<Probe leaseKey="coding" options={{ sessionId: "s1" }} />);
    await view.findByText("1 picture is waiting. It runs after this step, about 2 min.");
    for (const name of ["Keep going", "Use a lower tier", "Pause"]) expect(await link(view, name)).toBeTruthy();
    fireEvent.click(await link(view, "Keep going"));
    await waitFor(() => expect(posts().map((c) => c.key)).toContain("POST /api/tier-leases/coding/touch"));
    await waitFor(() => expect(view.queryByRole("button", { name: "Pause" })).toBeNull());
    expect(text()).toContain("1 picture is waiting.");
  });
  test("Use a lower tier and Pause call their routes with the session", async () => {
    current = viewOf("coding", { waiters: { count: 1, kinds: ["video"] } });
    let changed = 0;
    const view = renderWithQueryClient(<Probe leaseKey="coding" options={{ sessionId: "s1", onChanged: () => { changed += 1; } }} />);
    fireEvent.click(await link(view, "Use a lower tier"));
    await waitFor(() => expect(posts().find((c) => c.key === "POST /api/tier-leases/coding/lower")?.body).toEqual({ to: "standard", session_id: "s1" }));
    fireEvent.click(await link(view, "Pause"));
    await waitFor(() => expect(posts().find((c) => c.key === "POST /api/tier-leases/coding/pause")?.body).toEqual({ session_id: "s1" }));
    await waitFor(() => expect(changed).toBe(2));
  });
  test("chat offers Keep going and a lower tier but no Pause; lowering goes through the chat key", async () => {
    current = viewOf("chat", { waiters: { count: 2, kinds: ["picture", "picture"] } });
    const view = renderWithQueryClient(<Probe leaseKey="chat" />);
    await view.findByText("2 pictures are waiting. They run after this step.");
    expect(view.queryByRole("button", { name: "Pause" })).toBeNull();
    fireEvent.click(await link(view, "Use a lower tier"));
    await waitFor(() => expect(posts().find((c) => c.key === "POST /api/tier-leases/chat/lower")?.body).toEqual({ to: "standard" }));
  });
});

describe("paused, released and waiter lines", () => {
  test("a paused session reads the paused line with Resume, which calls resume for that session", async () => {
    current = viewOf("coding", { mine: false, state: "off", waiters: { count: 1, kinds: ["picture"] } });
    const view = renderWithQueryClient(<Probe leaseKey="coding" options={{ sessionId: "s1", paused: true }} />);
    await view.findByText("Paused so a picture can run.");
    fireEvent.click(await link(view, "Resume"));
    await waitFor(() => expect(posts().find((c) => c.key === "POST /api/tier-leases/coding/resume")?.body).toEqual({ session_id: "s1" }));
  });
  test("released while idle: the line appears when the lease leaves with something waiting", async () => {
    current = viewOf("chat", { waiters: { count: 1, kinds: ["picture"] } });
    const view = renderWithQueryClient(<Probe leaseKey="chat" />);
    await view.findByText(/1 picture is waiting/);
    current = viewOf("chat", { mine: false, state: "off", waiters: { count: 1, kinds: ["picture"] } });
    await view.findByText("Max was released for a picture. It switches back when you type.");
  });
  test("a lease that ends with nobody waiting says nothing", async () => {
    current = viewOf("chat");
    const view = renderWithQueryClient(<Probe leaseKey="chat" />);
    await view.findByText(/Max switches off/);
    current = viewOf("chat", { mine: false, state: "off" });
    await waitFor(() => expect(document.querySelector("[data-chat-notice]")).toBeNull());
  });
  test("a waiter sees the wait only when the page says it has a job waiting", async () => {
    current = viewOf("coding", { mine: false, waiters: { count: 1, kinds: ["picture"] }, etaSeconds: 120 });
    renderWithQueryClient(<Probe leaseKey="coding" />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(document.querySelector("[data-chat-notice]")).toBeNull();
    cleanup();
    const view = renderWithQueryClient(<Probe leaseKey="coding" options={{ waiting: true }} />);
    await view.findByText("Waiting for a coding job to finish, about 2 minutes.");
    expect(view.queryByRole("button", { name: "Use Standard now" })).toBeNull();
  });
  test("behind a pin for 10 minutes the waiter is offered Standard now", async () => {
    current = viewOf("coding", { mine: false, waiters: { count: 1, kinds: ["picture"] }, etaSeconds: 600, pinnedWaitMinutes: 10 });
    const view = renderWithQueryClient(<Probe leaseKey="coding" options={{ waiting: true, sessionId: "s2" }} />);
    fireEvent.click(await link(view, "Use Standard now"));
    await waitFor(() => expect(posts().find((c) => c.key === "POST /api/tier-leases/coding/lower")?.body).toEqual({ to: "standard", session_id: "s2" }));
  });
});

describe("child form and touch", () => {
  test("a child reads the child form, which names no tier", async () => {
    current = viewOf("coding", { mine: false, waiters: { count: 1, kinds: ["picture"] }, child: true });
    const view = renderWithQueryClient(<Probe leaseKey="coding" options={{ waiting: true }} />);
    await view.findByText("Waiting for a turn. Back soon.");
  });
  test("touch goes out at most once every 10 seconds and only for the holder", async () => {
    current = viewOf("chat");
    const view = renderWithQueryClient(<Probe leaseKey="chat" />);
    await view.findByText(/Max switches off/);
    const button = await view.findByTestId("touch");
    fireEvent.click(button); fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(posts().length).toBe(1));
    cleanup();
    calls = [];
    current = viewOf("chat", { mine: false });
    const other = renderWithQueryClient(<Probe leaseKey="chat" />);
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    fireEvent.click(await other.findByTestId("touch"));
    expect(posts().length).toBe(0);
  });
  test("typing in the composer renews the holder's lease, once per 10 seconds", async () => {
    current = viewOf("chat");
    const view = renderWithQueryClient(<Probe leaseKey="chat" />);
    await view.findByText(/Max switches off/);
    const type = await view.findByTestId("type");
    fireEvent.click(type); fireEvent.click(type); fireEvent.click(type);
    await waitFor(() => expect(posts().map((c) => c.key)).toEqual(["POST /api/tier-leases/chat/touch"]));
  });
  test("a person who may not use it reads nothing", async () => {
    current = viewOf("chat");
    renderWithQueryClient(<Probe leaseKey="chat" options={{ enabled: false }} />);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(calls.length).toBe(0);
  });
});
