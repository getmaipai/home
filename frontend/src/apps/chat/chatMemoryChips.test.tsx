import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter, type ThreadMessageLike } from "@assistant-ui/react";
import { ChatThread } from "@/apps/chat/ChatThread";
import { ChatActorContext } from "@/apps/chat/chatMemoryActions";
import { ChatAgeBandContext, TemporaryChatContext } from "@/apps/chat/chatThreadContexts";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { FakeAudioContext } from "../../../tests/fakeAudioContext";

// ELEMENTS-ADOPT-02 slice 2: the kit memory-chips under a reply, showing the
// memories filed under that turn, with forget; and "Remember this" in the
// reply's More menu filing the reply under its turn.
const NOOP: ChatModelAdapter = { run: async function* () { /* seeded */ } };

function messages(turnId: string, memoryIds: string[]): ThreadMessageLike[] {
  return [
    { role: "user", content: [{ type: "text", text: "We are going to Boston in July." }] },
    {
      role: "assistant",
      content: [{ type: "text", text: "Boston in July sounds lovely." }],
      status: { type: "complete", reason: "stop" },
      metadata: { custom: { turnId, conversationId: "conv-chips1", source: "model", judgeStatus: "done", memoryIds } },
    },
  ];
}

function Harness({ band, temporary = false, turnId, memoryIds }: { band: "child" | "teen" | "adult"; temporary?: boolean; turnId: string; memoryIds: string[] }) {
  const runtime = useLocalRuntime(NOOP, { initialMessages: messages(turnId, memoryIds) });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatAgeBandContext.Provider value={band}>
        <ChatActorContext.Provider value="person-sage001">
          <TemporaryChatContext.Provider value={{ on: temporary }}>
            <ChatThread />
          </TemporaryChatContext.Provider>
        </ChatActorContext.Provider>
      </ChatAgeBandContext.Provider>
    </AssistantRuntimeProvider>
  );
}

const realFetch = globalThis.fetch;
let calls: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
beforeEach(() => {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  calls = [];
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined });
    if (url.endsWith("/api/memory") && method === "GET") {
      return Promise.resolve(Response.json([{ id: "mem-trip01", text: "Going to Boston in July", category: "fact", tier: "durable", scope: "person" }]));
    }
    if (url.endsWith("/api/memory") && method === "POST") return Promise.resolve(Response.json({ id: "mem-new001" }, { status: 201 }));
    return Promise.resolve(Response.json({}));
  }) as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

describe("memory chips on a reply", () => {
  for (const band of ["adult", "teen"] as const) {
    test(`${band}: a reply that saved a memory shows it as a chip, and its forget archives it through the memory area's route`, async () => {
      const view = renderWithQueryClient(<MemoryRouter><Harness band={band} turnId={`turn-chips${band}`} memoryIds={["mem-trip01"]} /></MemoryRouter>);
      await waitFor(() => expect(view.container.querySelector('[data-slot="memory-chips"]')).not.toBeNull());
      expect(view.getByText("Going to Boston in July")).toBeTruthy();
      fireEvent.click(view.getByRole("button", { name: 'Forget "Going to Boston in July"' }));
      await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/api/memory/mem-trip01/archive"))).toBe(true));
      await waitFor(() => expect(view.container.querySelector('[data-slot="memory-chips"]')).toBeNull());
    });
  }

  test("child: no chips are drawn and the memory list is never fetched", async () => {
    const view = renderWithQueryClient(<MemoryRouter><Harness band="child" turnId="turn-chipschild" memoryIds={["mem-trip01"]} /></MemoryRouter>);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(view.container.querySelector('[data-slot="memory-chips"]')).toBeNull();
    expect(calls.some((c) => c.url.endsWith("/api/memory"))).toBe(false);
  });

  test("Incognito: no chips are drawn", async () => {
    const view = renderWithQueryClient(<MemoryRouter><Harness band="adult" temporary turnId="turn-chipsincog" memoryIds={["mem-trip01"]} /></MemoryRouter>);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(view.container.querySelector('[data-slot="memory-chips"]')).toBeNull();
  });

  test("a reply that saved nothing draws no chips", async () => {
    const view = renderWithQueryClient(<MemoryRouter><Harness band="adult" turnId="turn-chipsnone" memoryIds={[]} /></MemoryRouter>);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(view.container.querySelector('[data-slot="memory-chips"]')).toBeNull();
  });
});

describe("Remember this in the reply's More menu", () => {
  async function openMore(view: ReturnType<typeof renderWithQueryClient>) {
    const more = view.getAllByRole("button", { name: "More" }).at(-1)!;
    fireEvent.pointerDown(more, { button: 0, pointerType: "mouse" });
    fireEvent.click(more);
  }

  test("adult: files the reply under its own turn", async () => {
    const view = renderWithQueryClient(<MemoryRouter><Harness band="adult" turnId="turn-rememberui" memoryIds={[]} /></MemoryRouter>);
    await openMore(view);
    const item = await view.findByRole("menuitem", { name: "Remember this" });
    fireEvent.click(item);
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/api/memory"))).toBe(true));
    const post = calls.find((c) => c.method === "POST" && c.url.endsWith("/api/memory"))!;
    expect(post.body).toMatchObject({ text: "Boston in July sounds lovely.", scope: "person", person: "person-sage001", turn_id: "turn-rememberui" });
  });

  test("a reply the judge already saved a fact from still offers Remember this", async () => {
    const view = renderWithQueryClient(<MemoryRouter><Harness band="adult" turnId="turn-judgesaved" memoryIds={["mem-trip01"]} /></MemoryRouter>);
    await openMore(view);
    const item = await view.findByRole("menuitem", { name: "Remember this" });
    expect(item.getAttribute("aria-disabled")).not.toBe("true");
  });

  for (const [label, props] of [["child", { band: "child" as const }], ["Incognito", { band: "adult" as const, temporary: true }]] as const) {
    test(`${label}: the More menu has no Remember this`, async () => {
      const view = renderWithQueryClient(<MemoryRouter><Harness {...props} turnId={`turn-noremember${label.toLowerCase()}`} memoryIds={[]} /></MemoryRouter>);
      await openMore(view);
      await view.findAllByRole("menuitem");
      expect(view.queryByRole("menuitem", { name: "Remember this" })).toBeNull();
    });
  }
});
