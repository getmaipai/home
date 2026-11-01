// TIER-HOME-05: the composer's Max chat control against a fake Home over fetch. A grant holder gets the lease through the confirm line,
// a teen, a child and an adult without a grant never see the control, a missing self-test shows the existing notice line with the action
// that runs it, and the chip ends the session.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react";
import { ComposerTrailingWithThinkingMode } from "@/apps/chat/chatThreadSlots";
import { ChatAgeBandContext, ThinkingModeCapabilityContext, ThinkingModeContext } from "@/apps/chat/chatThreadContexts";
import { MAX_CONFIRM_LINE, MAX_SELF_TEST_LINE, MAX_RUNNING_LONG_LINE, __setSelfTestPollMsForTests, maxProgressLine, useMaxChatNotice } from "@/apps/chat/maxChat";
import { Button } from "@maipai/ui/src/ui/button";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

const NOOP: ChatModelAdapter = { async *run() { yield { content: [] }; } };
const realFetch = globalThis.fetch;

function NoticeProbe({ admin }: { admin: boolean }) {
  const notice = useMaxChatNotice(admin);
  if (!notice) return null;
  return <div role="status"><span>{notice.text}</span>{notice.actionLabel ? <Button type="button" onClick={notice.onAction}>{notice.actionLabel}</Button> : null}</div>;
}
function Harness({ band, admin = false }: { band: "child" | "teen" | "adult"; admin?: boolean }) {
  const runtime = useLocalRuntime(NOOP, { initialMessages: [] });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatAgeBandContext.Provider value={band}>
        <ThinkingModeContext.Provider value={{ mode: "instant", setMode: () => {} }}>
          <ThinkingModeCapabilityContext.Provider value="none">
            <ComposerTrailingWithThinkingMode />
          </ThinkingModeCapabilityContext.Provider>
        </ThinkingModeContext.Provider>
        <NoticeProbe admin={admin} />
      </ChatAgeBandContext.Provider>
    </AssistantRuntimeProvider>
  );
}

type Lease = { state: "off" | "starting" | "held" | "releasing"; held_by_you: boolean; pinned: boolean; can_use: boolean; releases_in_seconds: number | null };
const lease = (over: Partial<Lease> = {}): Lease => ({ state: "off", held_by_you: false, pinned: false, can_use: true, releases_in_seconds: null, ...over });
let calls: string[] = [];
let current: Lease;
let takeAnswer: () => Promise<Response>;
let selfTestDone = false;

beforeEach(() => {
  calls = []; current = lease(); selfTestDone = false; __setSelfTestPollMsForTests(5);
  takeAnswer = async () => { current = lease({ state: "held", held_by_you: true, releases_in_seconds: 1800 }); return Response.json(current); };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    calls.push(key);
    if (key === "GET /api/ai/chat-lease") return Response.json(current);
    if (key === "POST /api/ai/chat-lease") return takeAnswer();
    if (key === "DELETE /api/ai/chat-lease") { current = lease(); return Response.json(current); }
    if (key === "POST /api/coding/mode/self-test") { selfTestDone = true; return Response.json({ accepted: true }, { status: 202 }); }
    if (key === "GET /api/coding/mode") return Response.json({ readiness: { ready: selfTestDone, first_unmet: null, items: [{ id: "self_test", state: selfTestDone ? "done" : "can_do", reason_key: "self_test", doc_anchor: "x" }] }, mode: "normal", state: "stable", reason: null });
    return Response.json({}, { status: 404 });
  }) as unknown as typeof fetch;
});
afterEach(() => { cleanup(); globalThis.fetch = realFetch; });

describe("Max chat control", () => {
  test("a grant holder asks, confirms, holds the lease, and gives it back", async () => {
    const view = renderWithQueryClient(<Harness band="adult" />);
    const chip = await view.findByRole("button", { name: "Max" });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(chip);
    expect(await view.findByText(MAX_CONFIRM_LINE)).toBeTruthy();
    expect(calls).not.toContain("POST /api/ai/chat-lease");
    fireEvent.click(view.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(view.getByRole("button", { name: "Max" }).getAttribute("aria-pressed")).toBe("true"));
    expect(view.queryByText(MAX_CONFIRM_LINE)).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Max" }));
    await waitFor(() => expect(view.getByRole("button", { name: "Max" }).getAttribute("aria-pressed")).toBe("false"));
    expect(calls).toContain("DELETE /api/ai/chat-lease");
  });

  test("the starting state shows while the big model loads", async () => {
    let finish!: () => void;
    takeAnswer = () => new Promise((resolve) => { finish = () => { current = lease({ state: "held", held_by_you: true }); resolve(Response.json(current)); }; });
    const view = renderWithQueryClient(<Harness band="adult" />);
    fireEvent.click(await view.findByRole("button", { name: "Max" }));
    fireEvent.click(await view.findByRole("button", { name: "Continue" }));
    const starting = await view.findByRole("button", { name: "Starting Max" });
    expect((starting as HTMLButtonElement).disabled).toBe(true);
    expect(view.getByText("Loading Max. About a minute.")).toBeTruthy();
    finish();
    await waitFor(() => expect(view.getByRole("button", { name: "Max" }).getAttribute("aria-pressed")).toBe("true"));
  });

  test("the loading and testing lines carry the measured time, and give way to taking-longer past 1.5 times it", () => {
    expect(maxProgressLine("Loading", 60, 0)).toBe("Loading Max. About a minute.");
    expect(maxProgressLine("Testing", 35, 0)).toBe("Testing Max. About 35 seconds.");
    expect(maxProgressLine("Testing", 35, 52_000)).toBe("Testing Max. About 35 seconds.");
    expect(maxProgressLine("Testing", 35, 53_000)).toBe(MAX_RUNNING_LONG_LINE);
    for (const line of [maxProgressLine("Loading", 60, 0), MAX_CONFIRM_LINE, MAX_SELF_TEST_LINE, MAX_RUNNING_LONG_LINE]) { expect(line.length).toBeLessThanOrEqual(42); expect(line).not.toContain("\u2014"); }
  });

  test("a teen and a child see no control and the page never asks the route", async () => {
    for (const band of ["teen", "child"] as const) {
      calls = [];
      const view = renderWithQueryClient(<Harness band={band} />);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(view.queryByRole("button", { name: /Max/ })).toBeNull();
      expect(calls).toEqual([]);
      cleanup();
    }
  });

  test("an adult without the grant sees no control", async () => {
    current = lease({ can_use: false });
    const view = renderWithQueryClient(<Harness band="adult" />);
    await waitFor(() => expect(calls).toContain("GET /api/ai/chat-lease"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(view.queryByRole("button", { name: /Max/ })).toBeNull();
  });

  test("someone else holding the lease reads Max in use and cannot be pressed", async () => {
    current = lease({ state: "held", held_by_you: false });
    const view = renderWithQueryClient(<Harness band="adult" />);
    const chip = await view.findByRole("button", { name: "Max in use" });
    expect((chip as HTMLButtonElement).disabled).toBe(true);
  });

  const needsSelfTest = async () => Response.json({ error: MAX_SELF_TEST_LINE, code: "not_ready", first_unmet: "self_test" }, { status: 409 });

  test("a missing self-test shows the notice with Run self-test for an admin, runs it, and returns to the confirm line", async () => {
    takeAnswer = needsSelfTest;
    const view = renderWithQueryClient(<Harness band="adult" admin />);
    fireEvent.click(await view.findByRole("button", { name: "Max" }));
    fireEvent.click(await view.findByRole("button", { name: "Continue" }));
    expect(await view.findByText(MAX_SELF_TEST_LINE)).toBeTruthy();
    takeAnswer = async () => { current = lease({ state: "held", held_by_you: true }); return Response.json(current); };
    fireEvent.click(view.getByRole("button", { name: "Run self-test" }));
    expect(await view.findByText(MAX_CONFIRM_LINE)).toBeTruthy();
    expect(calls).toContain("POST /api/coding/mode/self-test");
    fireEvent.click(view.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(view.getByRole("button", { name: "Max" }).getAttribute("aria-pressed")).toBe("true"));
  });

  test("a non-admin with a missing self-test is told to ask an admin and gets no Run button", async () => {
    takeAnswer = needsSelfTest;
    const view = renderWithQueryClient(<Harness band="adult" />);
    fireEvent.click(await view.findByRole("button", { name: "Max" }));
    fireEvent.click(await view.findByRole("button", { name: "Continue" }));
    expect(await view.findByText(/Ask an admin/)).toBeTruthy();
    expect(view.queryByRole("button", { name: "Run self-test" })).toBeNull();
  });

  test("another refusal shows its plain line and can be dismissed", async () => {
    takeAnswer = async () => Response.json({ error: "A Max job is running. Try when it ends.", code: "max_window" }, { status: 409 });
    const view = renderWithQueryClient(<Harness band="adult" />);
    fireEvent.click(await view.findByRole("button", { name: "Max" }));
    fireEvent.click(await view.findByRole("button", { name: "Continue" }));
    expect(await view.findByText(/A Max job is running/)).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(view.queryByText(/A Max job is running/)).toBeNull());
  });
});
