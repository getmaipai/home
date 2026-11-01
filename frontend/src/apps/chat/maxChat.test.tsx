// TIER-HOME-05: the composer's Max chat control against a fake Home over fetch. A grant holder gets the lease through the confirm line,
// a teen, a child and an adult without a grant never see the control, a missing self-test shows the existing notice line with the action
// that runs it, and the chip ends the session.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react";
import { ComposerTrailingWithThinkingMode } from "@/apps/chat/chatThreadSlots";
import { ChatAgeBandContext, ThinkingModeCapabilityContext, ThinkingModeContext } from "@/apps/chat/chatThreadContexts";
import { MAX_SELF_TEST_LINE, MAX_RUNNING_LONG_LINE, MAX_READY_LINE, MAX_BACK_LINE, composerNoticeFor, __setSelfTestPollMsForTests, consumeMaxPick, dropMaxPick, maxProgressLine, useMaxChatNotice, useMaxSendHold } from "@/apps/chat/maxChat";
import { MAX_DIALOG_BODY, MAX_DIALOG_TITLE, MODE_CHOICES } from "@/apps/chat/composerModeLines";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

const NOOP: ChatModelAdapter = { async *run() { yield { content: [] }; } };
const realFetch = globalThis.fetch;

function NoticeProbe({ admin }: { admin: boolean }) {
  const notice = useMaxChatNotice(admin);
  if (!notice) return null;
  return <div role="status"><span>{notice.text}</span>{notice.actionLabel ? <Button type="button" onClick={notice.onAction}>{notice.actionLabel}</Button> : null}</div>;
}
let qcRef: ReturnType<typeof useQueryClient>;
function SendProbe() { qcRef = useQueryClient(); return <span data-testid="send-hold">{useMaxSendHold() ? "held" : "open"}</span>; }
function Harness({ band, admin = false, capability = "switchable" }: { band: "child" | "teen" | "adult"; admin?: boolean; capability?: "switchable" | "none" | "always" }) {
  const runtime = useLocalRuntime(NOOP, { initialMessages: [] });
  const [mode, setMode] = useState<"instant" | "thinking">("instant");
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatAgeBandContext.Provider value={band}>
        <ThinkingModeContext.Provider value={{ mode, setMode }}>
          <ThinkingModeCapabilityContext.Provider value={capability}>
            <ComposerTrailingWithThinkingMode />
          </ThinkingModeCapabilityContext.Provider>
        </ThinkingModeContext.Provider>
        <NoticeProbe admin={admin} />
        <SendProbe />
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

const trigger = (view: ReturnType<typeof renderWithQueryClient>) => view.findByRole("combobox", { name: /^Answer style: /, hidden: true });
const openMenu = async (view: ReturnType<typeof renderWithQueryClient>) => { fireEvent.keyDown(await trigger(view), { key: "ArrowDown" }); return view.findByRole("menu"); };
const choose = async (view: ReturnType<typeof renderWithQueryClient>, word: string) => { const menu = await openMenu(view); fireEvent.click(within(menu).getByRole("menuitemradio", { name: new RegExp(`^${word}`) })); };
const pickMax = async (view: ReturnType<typeof renderWithQueryClient>) => { await choose(view, "Max"); fireEvent.click(await view.findByRole("button", { name: "Use Max" })); };
const held = () => screen_hold();
function screen_hold() { return document.querySelector("[data-testid=send-hold]")?.textContent; }

describe("one answer-style control", () => {
  test("the closed control is icon-only with the word in its accessible name", async () => {
    const view = renderWithQueryClient(<Harness band="adult" />);
    const control = await trigger(view);
    expect(control.getAttribute("aria-label")).toBe("Answer style: Instant");
    expect(control.textContent).toBe("");
  });

  test("the closed control is quiet on Instant and wears the filled on-look on Thinking and on an armed Max", async () => {
    const view = renderWithQueryClient(<Harness band="adult" />);
    await waitFor(() => expect(calls).toContain("GET /api/ai/chat-lease"));
    expect((await trigger(view)).getAttribute("data-on")).toBe("false");
    expect((await trigger(view)).getAttribute("data-variant")).toBe("ghost");
    await choose(view, "Thinking");
    expect((await trigger(view)).getAttribute("data-on")).toBe("true");
    expect((await trigger(view)).getAttribute("data-variant")).toBe("default");
    await choose(view, "Instant");
    expect((await trigger(view)).getAttribute("data-on")).toBe("false");
    await pickMax(view);
    await waitFor(() => expect((document.querySelector("[data-slot=answer-style-select-trigger]") as HTMLElement).getAttribute("data-on")).toBe("true"));
  });

  test("the open menu shows icon, word and one plain line per choice", async () => {
    const view = renderWithQueryClient(<Harness band="adult" />);
    await waitFor(() => expect(calls).toContain("GET /api/ai/chat-lease"));
    const menu = await openMenu(view);
    for (const choice of MODE_CHOICES) {
      const item = within(menu).getByRole("menuitemradio", { name: new RegExp(`^${choice.word}`) });
      expect(item.textContent).toContain(choice.line);
      expect(item.querySelector("svg")).toBeTruthy();
    }
  });

  test("an adult with the grant picks Max, confirms in the dialog, and Send waits until the lease is ready", async () => {
    let finish!: () => void;
    takeAnswer = () => new Promise((resolve) => { finish = () => { current = lease({ state: "held", held_by_you: true }); resolve(Response.json(current)); }; });
    const view = renderWithQueryClient(<Harness band="adult" />);
    await waitFor(() => expect(calls).toContain("GET /api/ai/chat-lease"));
    await choose(view, "Max");
    expect(await view.findByText(MAX_DIALOG_TITLE)).toBeTruthy();
    expect(view.getByText(new RegExp(`${MAX_DIALOG_BODY} It takes about a minute to start\\.`))).toBeTruthy();
    expect(calls).not.toContain("POST /api/ai/chat-lease");
    expect((await trigger(view)).getAttribute("aria-label")).toBe("Answer style: Instant");
    fireEvent.click(view.getByRole("button", { name: "Use Max" }));
    expect(await view.findByText("Switching to Max. About a minute.")).toBeTruthy();
    expect(held()).toBe("held");
    expect((await trigger(view)).getAttribute("aria-label")).toBe("Answer style: Max");
    finish();
    await waitFor(() => expect(held()).toBe("open"));
    expect(await view.findByText(MAX_READY_LINE)).toBeTruthy();
    expect(view.queryByText(/Switching to Max/)).toBeNull();
  });

  test("when Max is being handed back the person who had it reads Back to Instant", async () => {
    current = lease({ state: "releasing", held_by_you: true });
    const view = renderWithQueryClient(<Harness band="adult" />);
    expect(await view.findByText(MAX_BACK_LINE)).toBeTruthy();
  });

  test("someone else's Max lease never shows these lines", async () => {
    current = lease({ state: "held", held_by_you: false });
    const view = renderWithQueryClient(<Harness band="adult" />);
    await waitFor(() => expect(calls).toContain("GET /api/ai/chat-lease"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(view.queryByText(MAX_READY_LINE)).toBeNull();
    expect(view.queryByText(MAX_BACK_LINE)).toBeNull();
  });

  test("the Max line wins over the general chat-starting notice, which still shows when Max has nothing to say", () => {
    const general = { text: "Chat is starting. Back in a moment.", repairsLink: null };
    const max = { text: "Switching to Max. About a minute.", repairsLink: null };
    expect(composerNoticeFor(max, general)).toBe(max);
    expect(composerNoticeFor(null, general)).toBe(general);
    expect(composerNoticeFor(null, null)).toBeNull();
  });

  test("Cancel leaves the control on what it was and asks nothing of the lease", async () => {
    const view = renderWithQueryClient(<Harness band="adult" />);
    await waitFor(() => expect(calls).toContain("GET /api/ai/chat-lease"));
    await choose(view, "Thinking");
    await choose(view, "Max");
    fireEvent.click(await view.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(view.queryByText(MAX_DIALOG_TITLE)).toBeNull());
    expect((await trigger(view)).getAttribute("aria-label")).toBe("Answer style: Thinking");
    expect(calls).not.toContain("POST /api/ai/chat-lease");
  });

  test("Max is one message: after the send it is Instant again and must be picked again, with a confirm each time", async () => {
    const view = renderWithQueryClient(<Harness band="adult" />);
    await waitFor(() => expect(calls).toContain("GET /api/ai/chat-lease"));
    await pickMax(view);
    await waitFor(() => expect(held()).toBe("open"));
    consumeMaxPick(qcRef);
    await waitFor(() => expect(view.getByRole("combobox", { name: "Answer style: Instant" })).toBeTruthy());
    expect(calls).not.toContain("DELETE /api/ai/chat-lease");
    await choose(view, "Max");
    expect(await view.findByText(MAX_DIALOG_TITLE)).toBeTruthy();
    const posts = calls.filter((call) => call === "POST /api/ai/chat-lease").length;
    fireEvent.click(view.getByRole("button", { name: "Use Max" }));
    await waitFor(() => expect(view.getByRole("combobox", { name: "Answer style: Max" })).toBeTruthy());
    expect(calls.filter((call) => call === "POST /api/ai/chat-lease").length).toBe(posts);
  });

  test("leaving Max unused hands the lease back at once", async () => {
    const view = renderWithQueryClient(<Harness band="adult" />);
    await waitFor(() => expect(calls).toContain("GET /api/ai/chat-lease"));
    await pickMax(view);
    await waitFor(() => expect(held()).toBe("open"));
    await choose(view, "Instant");
    await waitFor(() => expect(calls).toContain("DELETE /api/ai/chat-lease"));
    expect(view.getByRole("combobox", { name: "Answer style: Instant" })).toBeTruthy();
  });

  test("a new conversation drops an armed Max and hands the lease back", async () => {
    const view = renderWithQueryClient(<Harness band="adult" />);
    await waitFor(() => expect(calls).toContain("GET /api/ai/chat-lease"));
    await pickMax(view);
    await waitFor(() => expect(held()).toBe("open"));
    dropMaxPick(qcRef);
    await waitFor(() => expect(calls).toContain("DELETE /api/ai/chat-lease"));
    await waitFor(() => expect(view.getByRole("combobox", { name: "Answer style: Instant" })).toBeTruthy());
  });

  test("Thinking stays selected across sends and Max is never the default", async () => {
    const view = renderWithQueryClient(<Harness band="adult" />);
    await waitFor(() => expect(calls).toContain("GET /api/ai/chat-lease"));
    await choose(view, "Thinking");
    consumeMaxPick(qcRef);
    consumeMaxPick(qcRef);
    expect((await trigger(view)).getAttribute("aria-label")).toBe("Answer style: Thinking");
    cleanup();
    const fresh = renderWithQueryClient(<Harness band="adult" />);
    expect((await trigger(fresh)).getAttribute("aria-label")).toBe("Answer style: Instant");
  });

  test("an adult without the grant sees Instant and Thinking only", async () => {
    current = lease({ can_use: false });
    const view = renderWithQueryClient(<Harness band="adult" />);
    await waitFor(() => expect(calls).toContain("GET /api/ai/chat-lease"));
    const menu = await openMenu(view);
    expect(within(menu).getAllByRole("menuitemradio").map((item) => item.textContent?.slice(0, 7))).toEqual(["Instant", "Thinkin"]);
  });

  test("a teen and a child see no control at all and the page never asks the route", async () => {
    for (const band of ["teen", "child"] as const) {
      calls = [];
      const view = renderWithQueryClient(<Harness band={band} />);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(view.queryByRole("combobox")).toBeNull();
      expect(view.queryByRole("button", { name: /Max|Answer style/ })).toBeNull();
      expect(calls).toEqual([]);
      cleanup();
    }
  });

  test("someone else holding the lease leaves Max in the menu but not selectable", async () => {
    current = lease({ state: "held", held_by_you: false });
    const view = renderWithQueryClient(<Harness band="adult" />);
    await waitFor(() => expect(calls).toContain("GET /api/ai/chat-lease"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    const menu = await openMenu(view);
    expect(within(menu).getByRole("menuitemradio", { name: /^Max/ }).getAttribute("aria-disabled")).toBe("true");
  });

  test("the loading and testing lines carry the measured time, and give way to taking-longer past 1.5 times it", () => {
    expect(maxProgressLine("Switching to", 60, 0)).toBe("Switching to Max. About a minute.");
    expect(maxProgressLine("Testing", 35, 0)).toBe("Testing Max. About 35 seconds.");
    expect(maxProgressLine("Testing", 35, 52_000)).toBe("Testing Max. About 35 seconds.");
    expect(maxProgressLine("Testing", 35, 53_000)).toBe(MAX_RUNNING_LONG_LINE);
    for (const line of [maxProgressLine("Switching to", 60, 0), MAX_SELF_TEST_LINE, MAX_RUNNING_LONG_LINE]) { expect(line.length).toBeLessThanOrEqual(42); expect(line).not.toContain("\u2014"); }
  });

  const needsSelfTest = async () => Response.json({ error: MAX_SELF_TEST_LINE, code: "not_ready", first_unmet: "self_test" }, { status: 409 });

  test("a missing self-test shows the notice with Run self-test for an admin, runs it, and returns to the confirm dialog", async () => {
    takeAnswer = needsSelfTest;
    const view = renderWithQueryClient(<Harness band="adult" admin />);
    await waitFor(() => expect(calls).toContain("GET /api/ai/chat-lease"));
    await pickMax(view);
    expect(await view.findByText(MAX_SELF_TEST_LINE)).toBeTruthy();
    takeAnswer = async () => { current = lease({ state: "held", held_by_you: true }); return Response.json(current); };
    fireEvent.click(view.getByRole("button", { name: "Run self-test" }));
    expect(await view.findByText(MAX_DIALOG_TITLE)).toBeTruthy();
    expect(calls).toContain("POST /api/coding/mode/self-test");
    fireEvent.click(view.getByRole("button", { name: "Use Max" }));
    await waitFor(() => expect(held()).toBe("open"));
  });

  test("a non-admin with a missing self-test is told to ask an admin and gets no Run button", async () => {
    takeAnswer = needsSelfTest;
    const view = renderWithQueryClient(<Harness band="adult" />);
    await waitFor(() => expect(calls).toContain("GET /api/ai/chat-lease"));
    await pickMax(view);
    expect(await view.findByText(/Ask an admin/)).toBeTruthy();
    expect(view.queryByRole("button", { name: "Run self-test" })).toBeNull();
  });

  test("another refusal shows its plain line, can be dismissed, and Max is not armed", async () => {
    takeAnswer = async () => Response.json({ error: "A Max job is running. Try when it ends.", code: "max_window" }, { status: 409 });
    const view = renderWithQueryClient(<Harness band="adult" />);
    await waitFor(() => expect(calls).toContain("GET /api/ai/chat-lease"));
    await pickMax(view);
    expect(await view.findByText(/A Max job is running/)).toBeTruthy();
    expect(view.getByRole("combobox", { name: "Answer style: Instant" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(view.queryByText(/A Max job is running/)).toBeNull());
  });
});
