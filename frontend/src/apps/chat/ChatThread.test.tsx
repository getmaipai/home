import { afterEach, beforeEach, describe, expect, jest, mock, test } from "bun:test";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter, type ThreadHistoryAdapter, type ThreadMessageLike } from "@assistant-ui/react";
import { ChatThread } from "@/apps/chat/ChatThread";
import { THREAD_SLOTS, TOOL_BINDINGS } from "@/apps/chat/elementBindings";
import { AdminContext, ChatAgeBandContext, ConnectionStateContext, TemporaryChatContext, type ConnectionState } from "@/apps/chat/chatThreadContexts";
import { ChatAvailabilityContext } from "@/apps/chat/useChatAvailability";
import { EngineStartingLoader } from "@/apps/chat/chatThreadSlots";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { FakeAudioContext } from "../../../tests/fakeAudioContext";

// SHARED-THREAD-01: one assistant message carrying the native source part alongside tool parts and text
// renders through ChatThread alone, the same component both pages mount.
const NOOP: ChatModelAdapter = { run: async function* () { /* the message is seeded */ } };
const MESSAGES: ThreadMessageLike[] = [
  { role: "user", content: [{ type: "text", text: "Show me the forecast" }] },
  {
    role: "assistant",
    content: [
      { type: "reasoning", text: "Considering the forecast." },
      { type: "tool-call", toolCallId: "w1", toolName: "weather", args: {}, result: { title: "Weather in Springfield", subtitle: "Today", rows: [{ label: "High", value: "21 C" }] } },
      { type: "text", text: "It will be mild." },
      { type: "source", sourceType: "url", id: "s1", title: "Forecast", url: "https://example.com/f" },
    ],
    status: { type: "complete", reason: "stop" },
  },
];

function Harness({ admin, band = "child", connection = { phase: "online" }, adapter = NOOP, messages = MESSAGES }: { admin: boolean; band?: "child" | "teen" | "adult"; connection?: ConnectionState; adapter?: ChatModelAdapter; messages?: ThreadMessageLike[] }) {
  const runtime = useLocalRuntime(adapter, { initialMessages: messages });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AdminContext.Provider value={admin}>
        <ConnectionStateContext.Provider value={connection}>
          <ChatAgeBandContext.Provider value={band}><ChatThread /></ChatAgeBandContext.Provider>
        </ConnectionStateContext.Provider>
      </AdminContext.Provider>
    </AssistantRuntimeProvider>
  );
}

function WelcomeHarness({ availability }: { availability: "ready" | "starting" | "unavailable" }) {
  const runtime = useLocalRuntime(NOOP, { initialMessages: [] });
  return <AssistantRuntimeProvider runtime={runtime}><ChatAvailabilityContext.Provider value={availability}><ChatThread /></ChatAvailabilityContext.Provider></AssistantRuntimeProvider>;
}

let queuedRuntime: { thread: { composer: { setText(text: string): void; send(): void; getState(): { text: string; queue: readonly { id: string; prompt: string; parts: readonly { type: string; text?: string }[] }[] } } } } | undefined;
function QueuedHarness({ adapter, history, temporary = false, band = "child" }: { adapter: ChatModelAdapter; history?: ThreadHistoryAdapter; temporary?: boolean; band?: "child" | "teen" | "adult" }) {
  const runtime = useLocalRuntime(adapter, { initialMessages: [], ...(history ? { adapters: { history } } : {}), unstable_enableMessageQueue: true, unstable_queueClearOnCancel: false });
  queuedRuntime = runtime;
  return <AssistantRuntimeProvider runtime={runtime}><ChatAgeBandContext.Provider value={band}><TemporaryChatContext.Provider value={{ on: temporary }}><ChatThread /></TemporaryChatContext.Provider></ChatAgeBandContext.Provider></AssistantRuntimeProvider>;
}

const realFetch = globalThis.fetch;
beforeEach(() => {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  globalThis.fetch = mock(() => Promise.resolve(Response.json({}))) as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

describe("ChatThread", () => {
  test("does not render a queue row for an empty queue, including while a reply is running", async () => {
    const idle = renderWithQueryClient(<MemoryRouter><QueuedHarness adapter={NOOP} /></MemoryRouter>);
    expect(idle.container.querySelector('[data-slot="message-queue"]')).toBeNull();
    idle.unmount();

    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    const adapter: ChatModelAdapter = { run: async function* () {
      await waiting;
      yield { content: [{ type: "text", text: "Reply finished." }] };
    } };
    const running = renderWithQueryClient(<MemoryRouter><QueuedHarness adapter={adapter} /></MemoryRouter>);
    act(() => queuedRuntime!.thread.composer.setText("start a reply"));
    act(() => queuedRuntime!.thread.composer.send());
    await waitFor(() => expect(running.getByRole("button", { name: "Stop generating" })).toBeTruthy());
    expect(queuedRuntime!.thread.composer.getState().queue).toHaveLength(0);
    expect(running.container.querySelector('[data-slot="message-queue"]')).toBeNull();
    release();
  });

  test("renders the runtime queue above the composer and sends queued turns in order", async () => {
    let releaseFirst!: () => void;
    const firstRun = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const sent: string[] = [];
    let runs = 0;
    const adapter: ChatModelAdapter = { run: async function* ({ messages }) {
      const last = messages.at(-1);
      const text = last?.content.find((part) => part.type === "text");
      sent.push(text?.type === "text" ? text.text : "");
      if (runs++ === 0) await firstRun;
      yield { content: [{ type: "text", text: "Reply finished." }] };
    } };
    const view = renderWithQueryClient(<MemoryRouter><QueuedHarness adapter={adapter} /></MemoryRouter>);
    expect(queuedRuntime).toBeDefined();
    queuedRuntime!.thread.composer.setText("first message");
    act(() => queuedRuntime!.thread.composer.send());
    await waitFor(() => expect(sent).toEqual(["first message"]));
    act(() => queuedRuntime!.thread.composer.setText("second message"));
    act(() => fireEvent.click(view.getByRole("button", { name: "Queue message" })));
    await waitFor(() => expect(JSON.stringify(queuedRuntime!.thread.composer.getState().queue.map((item) => item.parts.map((part) => part.type === "text" ? part.text : "").join("")))).toBe(JSON.stringify(["second message"])));
    act(() => queuedRuntime!.thread.composer.setText("third message"));
    act(() => fireEvent.click(view.getByRole("button", { name: "Queue message" })));
    await waitFor(() => expect(JSON.stringify(queuedRuntime!.thread.composer.getState().queue.map((item) => item.parts.map((part) => part.type === "text" ? part.text : "").join("")))).toBe(JSON.stringify(["second message", "third message"])));
    expect(view.container.querySelector('[data-slot="message-queue"]')?.textContent).toContain("second message");
    expect(view.container.querySelector('[data-slot="message-queue"]')?.textContent).toContain("third message");
    releaseFirst();
    await waitFor(() => expect(sent).toEqual(["first message", "second message", "third message"]));
    expect(view.container.querySelector('[data-slot="message-queue"]')).toBeNull();
  });

  test("removing a queued message restores it for editing, while removal drops another", async () => {
    let releaseFirst!: () => void;
    const firstRun = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const sent: string[] = [];
    let runs = 0;
    const adapter: ChatModelAdapter = { run: async function* ({ messages }) {
      const last = messages.at(-1);
      const part = last?.content.find((entry) => entry.type === "text");
      sent.push(part?.type === "text" ? part.text : "");
      if (runs++ === 0) await firstRun;
      yield { content: [{ type: "text", text: "Reply finished." }] };
    } };
    const view = renderWithQueryClient(<MemoryRouter><QueuedHarness adapter={adapter} /></MemoryRouter>);
    act(() => queuedRuntime!.thread.composer.setText("first message"));
    act(() => queuedRuntime!.thread.composer.send());
    await waitFor(() => expect(sent).toEqual(["first message"]));
    act(() => queuedRuntime!.thread.composer.setText("keep and edit"));
    act(() => fireEvent.click(view.getByRole("button", { name: "Queue message" })));
    await waitFor(() => expect(view.container.textContent).toContain("keep and edit"));
    act(() => queuedRuntime!.thread.composer.setText("remove me"));
    act(() => fireEvent.click(view.getByRole("button", { name: "Queue message" })));
    await waitFor(() => expect(view.container.textContent).toContain("remove me"));

    act(() => fireEvent.click(view.getByRole("button", { name: 'Remove "remove me" from the queue' })));
    expect(queuedRuntime!.thread.composer.getState().text).toBe("remove me");
    act(() => queuedRuntime!.thread.composer.setText("edited message"));
    act(() => fireEvent.click(view.getByRole("button", { name: "Queue message" })));
    await waitFor(() => expect(view.container.textContent).toContain("edited message"));

    act(() => fireEvent.click(view.getByRole("button", { name: 'Remove "keep and edit" from the queue' })));
    expect(queuedRuntime!.thread.composer.getState().text).toBe("keep and edit");
    releaseFirst();
    await waitFor(() => expect(sent).toEqual(["first message", "edited message"]));
    expect(sent).not.toContain("remove me");
    expect(sent).not.toContain("keep and edit");
  });

  test("Stop keeps queued turns in the runtime", async () => {
    let releaseFirst!: () => void;
    const firstRun = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let runs = 0;
    const adapter: ChatModelAdapter = { run: async function* () {
      if (runs++ === 0) await firstRun;
      yield { content: [{ type: "text", text: "Reply finished." }] };
    } };
    const view = renderWithQueryClient(<MemoryRouter><QueuedHarness adapter={adapter} /></MemoryRouter>);
    act(() => queuedRuntime!.thread.composer.setText("first message"));
    act(() => queuedRuntime!.thread.composer.send());
    await waitFor(() => expect(view.getByRole("button", { name: "Stop generating" })).toBeTruthy());
    act(() => queuedRuntime!.thread.composer.setText("keep after stop"));
    act(() => fireEvent.click(view.getByRole("button", { name: "Queue message" })));
    act(() => fireEvent.click(view.getByRole("button", { name: "Stop generating" })));
    await waitFor(() => expect(queuedRuntime!.thread.composer.getState().queue.map((item) => item.prompt)).toEqual(["keep after stop"]));
    expect(view.container.textContent).toContain("keep after stop");
    releaseFirst();
  });

  test("running thinking elapsed ticks for adults and stays hidden from children and teens", async () => {
    for (const band of ["child", "teen", "adult"] as const) {
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => { release = resolve; });
      const adapter: ChatModelAdapter = { run: async function* () {
        await waiting;
        yield { content: [{ type: "text", text: "Finished." }] };
      } };
      jest.useFakeTimers();
      let view: ReturnType<typeof renderWithQueryClient> | undefined;
      try {
        view = renderWithQueryClient(<MemoryRouter><QueuedHarness adapter={adapter} band={band} /></MemoryRouter>);
        act(() => queuedRuntime!.thread.composer.setText("Please think about this"));
        act(() => queuedRuntime!.thread.composer.send());
        await waitFor(() => expect(view!.getByRole("button", { name: "Stop generating" })).toBeTruthy());

        const indicator = view.container.querySelector('[data-slot="thinking-indicator"]');
        if (band === "adult") {
          expect(indicator).not.toBeNull();
          expect(indicator?.textContent).toContain("Thinking…");
          expect(indicator?.textContent).toContain("0s");
          act(() => jest.advanceTimersByTime(1_000));
          expect(view.container.querySelector('[data-slot="thinking-indicator"]')?.textContent).toContain("1s");
        } else {
          expect(indicator).toBeNull();
          expect(view.container.textContent).not.toContain("Thinking…");
          expect(view.container.textContent).not.toMatch(/\b\d+s\b/);
        }
      } finally {
        release();
        view?.unmount();
        jest.useRealTimers();
      }
    }
  });

  test("a temporary chat does not persist a message while it is queued", async () => {
    let releaseFirst!: () => void;
    const firstRun = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let runs = 0;
    const adapter: ChatModelAdapter = { run: async function* () {
      if (runs++ === 0) await firstRun;
      yield { content: [{ type: "text", text: "Reply finished." }] };
    } };
    const persisted: string[] = [];
    const history: ThreadHistoryAdapter = {
      load: async () => ({ messages: [] }),
      append: async ({ message }) => { persisted.push(JSON.stringify(message)); },
    };
    const view = renderWithQueryClient(<MemoryRouter><QueuedHarness adapter={adapter} history={history} temporary /></MemoryRouter>);
    act(() => queuedRuntime!.thread.composer.setText("first message"));
    act(() => queuedRuntime!.thread.composer.send());
    await waitFor(() => expect(runs).toBe(1));
    act(() => queuedRuntime!.thread.composer.setText("temporary queued secret"));
    act(() => fireEvent.click(view.getByRole("button", { name: "Queue message" })));
    await waitFor(() => expect(view.container.textContent).toContain("temporary queued secret"));
    expect(persisted.join("\n")).not.toContain("temporary queued secret");
    expect(runs).toBe(1);
    releaseFirst();
  });

  test("binds every tool id once, each to a renderer", () => {
    const ids = TOOL_BINDINGS.map((binding) => binding.toolName);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["weather", "almanac-date", "write_document", "confirm", "project", "tool_timeline"]) expect(ids).toContain(id);
    for (const id of ["almanac-time", "almanac-moon", "almanac-holiday", "almanac-onthisday", "media-lookup", "music", "currency", "convert", "define", "math"]) expect(ids).toContain(id);
    for (const binding of TOOL_BINDINGS) expect(typeof binding.render).toBe("function");
    expect(TOOL_BINDINGS.find((binding) => binding.toolName === "tool_timeline")?.display).toBe("inline");
    expect(TOOL_BINDINGS.filter((binding) => binding.toolName !== "tool_timeline").every((binding) => binding.display === undefined || binding.display === "standalone")).toBe(true);
    for (const [name, slot] of Object.entries(THREAD_SLOTS)) {
      if (name === "markdown") {
        const markdown = slot as typeof THREAD_SLOTS.markdown;
        expect(typeof markdown).toBe("object");
        expect(typeof markdown.preprocess).toBe("function");
        expect(typeof markdown.components?.a).toBe("function");
      } else if (name === "composerDensity") {
        expect(slot).toBe("compact");
      } else {
        const marker = typeof slot === "object" && slot !== null ? (slot as { $$typeof?: unknown }).$$typeof : undefined;
        const isValidComponentType = typeof slot === "function" || [
          Symbol.for("react.memo"),
          Symbol.for("react.forward_ref"),
          Symbol.for("react.lazy"),
        ].includes(marker as symbol);
        expect(isValidComponentType).toBe(true);
      }
    }
  });

  test("the tool timeline uses Thread's shipped tool-group disclosure", async () => {
    const message: ThreadMessageLike[] = [{
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "timeline-3", toolName: "tool_timeline", args: {}, result: [
        { callId: "call-1", packageId: "websearch", state: "ok", sites: [{ host: "example.com", url: "https://example.com" }] },
        { callId: "call-2", packageId: "weather", state: "ok" },
        { callId: "call-3", packageId: "almanac-date", state: "ok" },
      ] }],
      status: { type: "complete", reason: "stop" },
    }];
    const view = renderWithQueryClient(<MemoryRouter><Harness admin={false} messages={message} /></MemoryRouter>);
    await waitFor(() => expect(view.container.querySelector('[data-slot="tool-group-root"]')).not.toBeNull());
    await view.getByRole("button", { name: /1 tool call/ }).click();
    expect(view.container.querySelector('[data-slot="tool-timeline"]')).not.toBeNull();
  });

  async function expectFailedToolPrivacy(band: "child" | "teen" | "adult") {
    const message: ThreadMessageLike[] = [{
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: `timeline-${band}`, toolName: "tool_timeline", args: {}, result: [
        { callId: "failed-call", packageId: "websearch", state: "error", failureKind: "private raw failure text" },
      ] }],
      metadata: { custom: { turnId: "turn-failed-tool", failedTool: true } },
      status: { type: "complete", reason: "stop" },
    }];
    const view = renderWithQueryClient(<MemoryRouter><Harness admin={false} messages={message} /></MemoryRouter>);
    await waitFor(() => expect(view.container.querySelector('[data-slot="tool-group-root"]')).not.toBeNull());
    await view.getByRole("button", { name: /1 tool call/ }).click();
    const timeline = view.container.querySelector('[data-slot="tool-timeline"]');
    expect(timeline).not.toBeNull();
    await within(timeline as HTMLElement).getByRole("button").click();
    expect(view.container.textContent).toContain("Failed");
    expect(view.container.textContent).not.toContain("private raw failure text");
  }

  test("a child sees failed-tool status without raw error text", async () => expectFailedToolPrivacy("child"));
  test("a teen sees failed-tool status without raw error text", async () => expectFailedToolPrivacy("teen"));
  test("an adult sees failed-tool status without raw error text", async () => expectFailedToolPrivacy("adult"));

  test("an admin sees the failed-tool error indicator", async () => {
    const message: ThreadMessageLike[] = [{
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "timeline-admin", toolName: "tool_timeline", args: {}, result: [
        { callId: "failed-call", packageId: "websearch", state: "error", failureKind: "timeout" },
      ] }],
      metadata: { custom: { turnId: "turn-failed-tool", failedTool: true } },
      status: { type: "complete", reason: "stop" },
    }];
    const view = renderWithQueryClient(<MemoryRouter><Harness admin messages={message} /></MemoryRouter>);
    await waitFor(() => expect(view.getByRole("button", { name: "Error details" })).toBeTruthy());
  });

  async function expectUnknownToolHidden(band: "child" | "teen" | "adult") {
    const message: ThreadMessageLike[] = [{
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: `unknown-${band}`, toolName: "unbound_tool", args: {}, result: { private: "raw private tool JSON" } }],
      status: { type: "complete", reason: "stop" },
    }];
    const view = renderWithQueryClient(<MemoryRouter><Harness admin={false} band={band} messages={message} /></MemoryRouter>);
    await waitFor(() => expect(view.container.querySelector('[data-slot="aui_assistant-message-root"]')).not.toBeNull());
    expect(view.container.querySelector('[data-slot="tool-fallback-root"]')).toBeNull();
    expect(view.container.textContent).not.toContain("raw private tool JSON");
  }

  test("a child does not see an unbound tool result as raw JSON", async () => expectUnknownToolHidden("child"));
  test("a teen does not see an unbound tool result as raw JSON", async () => expectUnknownToolHidden("teen"));
  test("an adult does not see an unbound tool result as raw JSON", async () => expectUnknownToolHidden("adult"));

  test("an admin keeps the kit fallback for an unbound tool result", async () => {
    const message: ThreadMessageLike[] = [{
      role: "assistant",
      content: [{ type: "tool-call", toolCallId: "unknown-admin", toolName: "unbound_tool", args: {}, result: { private: "admin raw result" }, mcp: { app: { resourceUri: "ui://unknown/tool" } } }],
      status: { type: "complete", reason: "stop" },
    }];
    const view = renderWithQueryClient(<MemoryRouter><Harness admin messages={[{ role: "assistant", content: [{ type: "text", text: "Admin sees fallback." }] }, ...message]} /></MemoryRouter>);
    await waitFor(() => expect(view.container.querySelector('[data-slot="tool-fallback-root"]')).not.toBeNull());
    expect(view.container.querySelector('[data-slot="tool-fallback-root"]')).not.toBeNull();
  });

  test("a message with every bound part type renders its Elements", async () => {
    const view = renderWithQueryClient(<MemoryRouter><Harness admin /></MemoryRouter>);
    await waitFor(() => expect(view.container.textContent).toContain("It will be mild."));
    // spec-sheet tool binding
    expect(view.container.textContent).toContain("Weather in Springfield");
    expect(view.container.textContent).toContain("21 C");
    // reasoning group slot (ReasoningGroup)
    expect(view.container.textContent?.toLowerCase()).toContain("reasoning");
    // Native sources render in the message footer without a synthetic tool card.
    expect(view.container.querySelector('[data-slot="tool-fallback-root"]')).toBeNull();
  });

  test("three newly bound spec-sheet producers render their recorded result rows", async () => {
    const message: ThreadMessageLike[] = [{
      role: "assistant",
      content: [
        { type: "tool-call", toolCallId: "sheet-time", toolName: "almanac-time", args: {}, result: { kind: "spec_sheet", tool_id: "almanac-time", title: "Current time", rows: [{ label: "Time", value: "3:15 PM" }] } },
        { type: "tool-call", toolCallId: "sheet-media", toolName: "media-lookup", args: {}, result: { kind: "spec_sheet", tool_id: "media-lookup", title: "Marsh Lantern", rows: [{ label: "Director", value: "A. Director" }] } },
        { type: "tool-call", toolCallId: "sheet-music", toolName: "music", args: {}, result: { kind: "spec_sheet", tool_id: "music", title: "North Lights", rows: [{ label: "Area", value: "Canada" }] } },
        { type: "text", text: "Here are three results." },
      ],
      status: { type: "complete", reason: "stop" },
    }];
    const view = renderWithQueryClient(<MemoryRouter><Harness admin={false} messages={message} /></MemoryRouter>);
    await waitFor(() => expect(view.container.textContent).toContain("Here are three results."));
    for (const value of ["Current time", "3:15 PM", "Marsh Lantern", "A. Director", "North Lights", "Canada"]) expect(view.container.textContent).toContain(value);
    expect(view.container.querySelector('[data-slot="tool-fallback-root"]')).toBeNull();
  });

  test("while the engine is loading the empty thread shows the generation loader", () => {
    const view = renderWithQueryClient(<MemoryRouter><WelcomeHarness availability="starting" /></MemoryRouter>);
    expect(view.container.querySelector('[data-slot="generation-loader"]')).not.toBeNull();
    expect(view.container.textContent).toContain("Starting your AI");
  });

  test("once the engine is ready the loader is gone", () => {
    const view = renderWithQueryClient(<MemoryRouter><WelcomeHarness availability="ready" /></MemoryRouter>);
    expect(view.container.querySelector('[data-slot="generation-loader"]')).toBeNull();
  });

  test("the loader ticks once a second and stops on unmount (no timer leak)", () => {
    const realSetInterval = globalThis.setInterval;
    const realClearInterval = globalThis.clearInterval;
    const cleared: unknown[] = [];
    let callback: (() => void) | undefined;
    let delay: number | undefined;
    globalThis.setInterval = ((fn: TimerHandler, ms?: number) => { callback = fn as () => void; delay = ms; return 42 as unknown as ReturnType<typeof setInterval>; }) as unknown as typeof setInterval;
    globalThis.clearInterval = ((timer: ReturnType<typeof setInterval>) => { cleared.push(timer); }) as typeof clearInterval;
    try {
      const ticks: number[] = [];
      function TickProbe({ tick }: { tick: number }) { ticks.push(tick); return <span>{tick}</span>; }
      const view = renderWithQueryClient(<ChatAvailabilityContext.Provider value="starting"><EngineStartingLoader Loader={TickProbe as typeof import("@maipai/ui/src/elements/loading-state").GenerationLoader} /></ChatAvailabilityContext.Provider>);
      expect(callback).toBeDefined();
      expect(delay).toBe(1_000);
      expect(ticks.at(-1)).toBe(0);
      act(() => callback?.());
      expect(ticks.at(-1)).toBe(1);
      view.unmount();
      expect(cleared).toContain(42 as unknown as ReturnType<typeof setInterval>);
    } finally {
      globalThis.setInterval = realSetInterval;
      globalThis.clearInterval = realClearInterval;
    }
  });

  test("a normal in-message wait still uses the thinking indicator", () => {
    expect(THREAD_SLOTS.Indicator.name).toBe("ChatThinkingIndicator");
  });

  test("the loader does not appear when the engine is unavailable", () => {
    const view = renderWithQueryClient(<MemoryRouter><WelcomeHarness availability="unavailable" /></MemoryRouter>);
    expect(view.container.querySelector('[data-slot="generation-loader"]')).toBeNull();
  });

  test("the banner shows nothing when online", () => {
    const view = renderWithQueryClient(<MemoryRouter><Harness admin /></MemoryRouter>);
    expect(view.container.querySelector('[data-slot="connection-state"]')).toBeNull();
  });

  test("the connection banner takes space in the layout and does not overlap the thread", () => {
    const view = renderWithQueryClient(<MemoryRouter><Harness admin connection={{ phase: "reconnecting", attempt: 1 }} /></MemoryRouter>);
    const banner = view.container.querySelector('[data-slot="connection-state"]');
    expect(banner).not.toBeNull();
    const bannerRow = banner!.parentElement!;
    const thread = view.container.querySelector(".aui-thread-root");
    expect(bannerRow.className).toContain("flex");
    expect(bannerRow.className).not.toContain("absolute");
    expect(bannerRow.nextElementSibling).toBe(thread);
  });

  test("no banner element or height when online", () => {
    const view = renderWithQueryClient(<MemoryRouter><Harness admin /></MemoryRouter>);
    expect(view.container.querySelector('[data-slot="connection-state"]')).toBeNull();
    const bannerRow = Array.from(view.container.querySelectorAll("div")).find((element) => element.className === "flex justify-center");
    expect(bannerRow?.children).toHaveLength(0);
    expect(bannerRow?.getBoundingClientRect().height ?? 0).toBe(0);
  });

  test("the connection banner shows Reconnecting with the attempt number", () => {
    const view = renderWithQueryClient(<MemoryRouter><Harness admin connection={{ phase: "reconnecting", attempt: 2 }} /></MemoryRouter>);
    expect(view.container.textContent).toContain("Reconnecting");
    expect(view.container.textContent).toContain("attempt 2");
  });

  test("Reconnect on a dropped banner reruns the reply", async () => {
    let runs = 0;
    const adapter: ChatModelAdapter = { run: async function* () { runs++; yield { content: [{ type: "text", text: "Reconnected." }] }; } };
    const view = renderWithQueryClient(<MemoryRouter><Harness admin adapter={adapter} connection={{ phase: "dropped" }} /></MemoryRouter>);
    fireEvent.click(view.getByRole("button", { name: "Reconnect" }));
    await waitFor(() => expect(runs).toBe(1));
  });
});
