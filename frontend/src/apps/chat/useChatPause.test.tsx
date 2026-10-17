import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { useState } from "react";
import { ChatThread } from "@/apps/chat/ChatThread";
import { ChatTurnError } from "@/apps/chat/chatTurnError";
import { __resetAutoRetriedForTests, RESTARTED_LINE } from "@/apps/chat/chatErrorSlot";
import { ChatAvailabilityContext, chatPollInterval, useChatAvailability, useChatComposerNotice } from "@/apps/chat/useChatAvailability";
import { createQueryClient } from "@/lib/queryClient";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { FakeAudioContext } from "../../../tests/fakeAudioContext";

const realFetch = globalThis.fetch;
const originalAudioContext = globalThis.AudioContext;
beforeEach(() => {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  __resetAutoRetriedForTests();
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = originalAudioContext;
});

describe("chat polling rule", () => {
  test("15 s when ready, 2 s while not ready, easing to 5 s then 10 s", () => {
    expect(chatPollInterval(false, false)).toBe(15_000);
    const t0 = 1_000_000;
    expect(chatPollInterval(true, false, t0)).toBe(2_000);
    expect(chatPollInterval(true, false, t0 + 29_000)).toBe(2_000);
    expect(chatPollInterval(true, false, t0 + 31_000)).toBe(5_000);
    expect(chatPollInterval(true, false, t0 + 121_000)).toBe(10_000);
    expect(chatPollInterval(false, false)).toBe(15_000);
  });

  test("a hidden tab stops polling in every state", () => {
    expect(chatPollInterval(false, true)).toBe(false);
    expect(chatPollInterval(true, true)).toBe(false);
  });
});

describe("the hub not answering (a restart)", () => {
  // The hub answered once (the page loaded from it), then stops answering.
  async function view(person: { role: string; age_band: string }) {
    let answered = false;
    globalThis.fetch = mock((url: string | URL | Request) => {
      if (String(url).includes("/api/status/apps")) return Promise.resolve(Response.json([]));
      if (!answered) { answered = true; return Promise.resolve(Response.json({ engines: { chat: { kind: "url", pid: null, alive: true, availability: "ready" } } })); }
      return Promise.reject(new TypeError("Failed to fetch"));
    }) as unknown as typeof fetch;
    const client = createQueryClient();
    const rendered = renderHook(() => ({ availability: useChatAvailability(), notice: useChatComposerNotice(person as never) }), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
    await waitFor(() => expect(answered).toBe(true));
    await waitFor(() => expect(client.getQueryState(["health"])?.status).toBe("success"));
    await act(async () => { await client.invalidateQueries({ queryKey: ["health"] }); });
    return rendered;
  }

  test("reads as starting with the restart line, no Repairs link yet", async () => {
    const v = await view({ role: "owner", age_band: "adult" });
    await waitFor(() => expect(v.result.current.availability).toBe("starting"));
    expect(v.result.current.notice).toEqual({ text: "The AI is restarting. Chat will start again by itself in a minute.", repairsLink: null });
  });

  test("a child gets the child words", async () => {
    const v = await view({ role: "child", age_band: "child" });
    await waitFor(() => expect(v.result.current.notice?.text).toBe("I'm waking up. Try again in a minute."));
  });

  test("after a minute it is unavailable and an owner is sent to Repairs", async () => {
    const realNow = Date.now;
    const v = await view({ role: "owner", age_band: "adult" });
    await waitFor(() => expect(v.result.current.availability).toBe("starting"));
    Date.now = () => realNow() + 61_000;
    try {
      v.rerender();
      expect(v.result.current.availability).toBe("unavailable");
      expect(v.result.current.notice).toEqual({ text: "The AI isn't answering.", repairsLink: "Check Repairs" });
    } finally { Date.now = realNow; }
  });
});

describe("a reply cut off while chat was not ready", () => {
  let runs = 0;
  let succeed = false;
  const adapter: ChatModelAdapter = {
    async *run() {
      runs += 1;
      if (succeed) { yield { content: [{ type: "text", text: "Sunny." }] }; return; }
      throw new ChatTurnError("Something went wrong while writing that. Send it again, or check Repairs.", "unavailable");
    },
  };
  let setState: (value: "ready" | "starting" | "unavailable") => void = () => {};
  function Harness() {
    const runtime = useLocalRuntime(adapter);
    const [state, set] = useState<"ready" | "starting" | "unavailable">("ready");
    setState = set;
    return (
      <MemoryRouter>
        <AssistantRuntimeProvider runtime={runtime}>
          <ChatAvailabilityContext.Provider value={state}><ChatThread /></ChatAvailabilityContext.Provider>
        </AssistantRuntimeProvider>
      </MemoryRouter>
    );
  }
  async function send(view: ReturnType<typeof renderWithQueryClient>) {
    fireEvent.change(view.getByRole("textbox", { name: "Message input" }), { target: { value: "weather?" } });
    fireEvent.click(view.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(runs).toBe(1));
  }
  beforeEach(() => { runs = 0; succeed = false; });

  test("while not ready it draws no failure line; when chat is back it retries once, and the retry answers", async () => {
    const view = renderWithQueryClient(<Harness />);
    await send(view);
    act(() => setState("starting"));
    await waitFor(() => expect(view.container.textContent).not.toContain("Something went wrong"));
    expect(runs).toBe(1);
    succeed = true;
    act(() => setState("ready"));
    await waitFor(() => expect(view.container.textContent).toContain("Sunny."));
    expect(runs).toBe(2);
    expect(view.container.textContent).not.toContain("Something went wrong");
  });

  test("later readiness changes never send that reply a second time", async () => {
    const view = renderWithQueryClient(<Harness />);
    await send(view);
    succeed = true;
    act(() => setState("unavailable"));
    act(() => setState("ready"));
    await waitFor(() => expect(view.container.textContent).toContain("Sunny."));
    for (let i = 0; i < 3; i++) {
      act(() => setState("starting"));
      act(() => setState("ready"));
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(runs).toBe(2);
  });

  test("an error with chat ready and no recent pause keeps the plain failure line and does not retry", async () => {
    const view = renderWithQueryClient(<Harness />);
    await send(view);
    await waitFor(() => expect(view.container.textContent).toContain("Something went wrong"));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(runs).toBe(1);
    expect(view.container.textContent).not.toContain(RESTARTED_LINE);
  });
});

describe("the hub itself did not answer", () => {
  let runs = 0;
  let hubUp = false;
  const adapter: ChatModelAdapter = {
    async *run() {
      runs += 1;
      if (!hubUp) throw new ChatTurnError("Home is restarting or updating. It will be back in a minute.", "hub_unreachable");
      yield { content: [{ type: "text", text: "Sunny." }] };
    },
  };
  function Harness() {
    const runtime = useLocalRuntime(adapter);
    return (<MemoryRouter><AssistantRuntimeProvider runtime={runtime}><ChatThread /></AssistantRuntimeProvider></MemoryRouter>);
  }
  beforeEach(() => { runs = 0; hubUp = false; });

  test("the message says Home is restarting; when the hub answers the request is sent once more, and only once", async () => {
    let probes = 0;
    globalThis.fetch = mock((url: string | URL | Request) => {
      if (String(url).includes("/api/health")) {
        probes += 1;
        if (!hubUp) return Promise.reject(new TypeError("Failed to fetch"));
      }
      return Promise.resolve(Response.json({}));
    }) as unknown as typeof fetch;
    const view = renderWithQueryClient(<Harness />);
    fireEvent.change(view.getByRole("textbox", { name: "Message input" }), { target: { value: "make it a video" } });
    fireEvent.click(view.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(view.container.textContent).toContain("Home is restarting or updating. It will be back in a minute."));
    expect(view.container.textContent).not.toContain("Could not reach the hub");
    expect(runs).toBe(1);
    hubUp = true;
    // The wait asks every 3 s: allow the next ask to come.
    await waitFor(() => expect(view.container.textContent).toContain("Sunny."), { timeout: 6_000 });
    expect(runs).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(runs).toBe(2);
    expect(probes).toBeGreaterThan(0);
  }, 15_000);
});
