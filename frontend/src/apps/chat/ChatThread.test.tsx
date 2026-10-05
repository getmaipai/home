import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter, type ThreadMessageLike } from "@assistant-ui/react";
import { ChatThread } from "@/apps/chat/ChatThread";
import { THREAD_SLOTS, TOOL_BINDINGS } from "@/apps/chat/elementBindings";
import { AdminContext, ConnectionStateContext, type ConnectionState } from "@/apps/chat/chatThreadContexts";
import { ChatAvailabilityContext } from "@/apps/chat/useChatAvailability";
import { EngineStartingLoader } from "@/apps/chat/chatThreadSlots";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { FakeAudioContext } from "../../../tests/fakeAudioContext";

// SHARED-THREAD-01: one assistant message carrying every part type the
// registry binds (reasoning, text, a spec-sheet tool, a tool timeline, sources)
// renders through ChatThread alone, the same component both pages mount.
const NOOP: ChatModelAdapter = { run: async function* () { /* the message is seeded */ } };
const MESSAGES: ThreadMessageLike[] = [
  { role: "user", content: [{ type: "text", text: "Show me the forecast" }] },
  {
    role: "assistant",
    content: [
      { type: "reasoning", text: "Considering the forecast." },
      { type: "tool-call", toolCallId: "w1", toolName: "weather", args: {}, result: { title: "Weather in Springfield", subtitle: "Today", rows: [{ label: "High", value: "21 C" }] } },
      { type: "tool-call", toolCallId: "s1", toolName: "sources", args: {}, result: [{ title: "Forecast", url: "https://example.com/f", domain: "example.com" }] },
      { type: "text", text: "It will be mild." },
    ],
    status: { type: "complete", reason: "stop" },
  },
];

function Harness({ admin, connection = { phase: "online" }, adapter = NOOP }: { admin: boolean; connection?: ConnectionState; adapter?: ChatModelAdapter }) {
  const runtime = useLocalRuntime(adapter, { initialMessages: MESSAGES });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AdminContext.Provider value={admin}>
        <ConnectionStateContext.Provider value={connection}>
          <ChatThread />
        </ConnectionStateContext.Provider>
      </AdminContext.Provider>
    </AssistantRuntimeProvider>
  );
}

function WelcomeHarness({ availability }: { availability: "ready" | "starting" | "unavailable" }) {
  const runtime = useLocalRuntime(NOOP, { initialMessages: [] });
  return <AssistantRuntimeProvider runtime={runtime}><ChatAvailabilityContext.Provider value={availability}><ChatThread /></ChatAvailabilityContext.Provider></AssistantRuntimeProvider>;
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
  test("binds every tool id once, each to a renderer", () => {
    const ids = TOOL_BINDINGS.map((binding) => binding.toolName);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["weather", "almanac-date", "write_document", "confirm", "project", "tool_timeline", "sources"]) expect(ids).toContain(id);
    for (const binding of TOOL_BINDINGS) expect(typeof binding.render).toBe("function");
    for (const [name, slot] of Object.entries(THREAD_SLOTS)) {
      if (name === "markdown") {
        const markdown = slot as typeof THREAD_SLOTS.markdown;
        expect(typeof markdown).toBe("object");
        expect(typeof markdown.preprocess).toBe("function");
        expect(typeof markdown.components?.a).toBe("function");
      } else {
        expect(typeof slot).toBe("function");
      }
    }
  });

  test("a message with every bound part type renders its Elements", async () => {
    const view = renderWithQueryClient(<MemoryRouter><Harness admin /></MemoryRouter>);
    await waitFor(() => expect(view.container.textContent).toContain("It will be mild."));
    // spec-sheet tool binding
    expect(view.container.textContent).toContain("Weather in Springfield");
    expect(view.container.textContent).toContain("21 C");
    // reasoning group slot (NextReasoningGroup)
    expect(view.container.textContent?.toLowerCase()).toContain("reasoning");
    // The "sources" binding keeps the fallback tool card out of the message body.
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
