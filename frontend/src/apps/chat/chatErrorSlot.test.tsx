import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react";
import { ChatThread } from "@/apps/chat/ChatThread";
import { AdminContext } from "@/apps/chat/chatThreadContexts";
import { ChatAvailabilityContext } from "@/apps/chat/useChatAvailability";
import { act } from "@testing-library/react";
import { useState } from "react";
import { ChatTurnError } from "@/apps/chat/chatTurnError";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { TurnErrorDetail } from "@/lib/api";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { FakeAudioContext } from "../../../tests/fakeAudioContext";

const originalAudioContext = globalThis.AudioContext;

beforeEach(() => {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
});

afterEach(() => {
  cleanup();
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = originalAudioContext;
});

function Harness({ adapter, admin = false }: { adapter: ChatModelAdapter; admin?: boolean }) {
  const runtime = useLocalRuntime(adapter);
  return (
    <MemoryRouter>
      <AssistantRuntimeProvider runtime={runtime}>
        <AdminContext.Provider value={admin}>
          <ChatThread />
        </AdminContext.Provider>
      </AssistantRuntimeProvider>
    </MemoryRouter>
  );
}

// CHAT-CALM-ERRORS-01c: the detail the hub sends an admin with the stopped
// engine's error event (backend tests/chatCalmErrors.test.ts proves the hub side).
const STOPPED_DETAIL: TurnErrorDetail = {
  turn_id: "turn-stopped1",
  found: true,
  advice: { cause: "The chat engine was stopped, so the reply never started.", next_step: "Start the chat engine in Repairs.", repairs: true },
  tools: [],
  generations: [{
    reason: "model",
    error: "No engine is ready for role 'chat'.",
    request_sent_ms: 41,
    offline_reason: "The chat engine was stopped.",
    http_status: 503,
    state: "installed",
    raw_body: '{"error":"No engine is ready for role \'chat\'.","role":"chat","state":"installed","offline_reason":"The chat engine was stopped."}',
    engine_id: "local b10797",
    model_id: "qwen3-8b-instruct-q4_k_m.gguf",
    failed_ms: 44,
    failed_at: "2026-10-06T06:00:00.000Z",
  }],
};

/** The live adapter's shape for an admin's failed turn: the detail lands in
 * the message metadata, then the error is thrown. */
function detailThenErrorAdapter(): ChatModelAdapter {
  return {
    async *run() {
      yield { metadata: { custom: { turnId: "turn-stopped1", failureDetail: STOPPED_DETAIL } } };
      throw new ChatTurnError("The AI was stopped, so that reply didn't finish. Send it again once chat is back.", "engine_unavailable", "turn-stopped1");
    },
  };
}

function failingAdapter(error: Error, onRun = () => {}): ChatModelAdapter {
  return {
    async *run() {
      onRun();
      throw error;
    },
  };
}

function failedDoneAdapter(): ChatModelAdapter {
  return {
    async *run() {
      yield {
        content: [{ type: "text", text: "That was too much text for me to read in one go. Try a shorter question." }],
        metadata: { custom: { failedGeneration: true, turnId: "turn-failed-live" } },
      };
    },
  };
}

async function sendFailingMessage(view: ReturnType<typeof renderWithQueryClient>) {
  fireEvent.change(view.getByRole("textbox", { name: "Message input" }), { target: { value: "hi" } });
  fireEvent.click(view.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(view.getByRole("alert")).toBeTruthy());
}

async function sendRefusedMessage(view: ReturnType<typeof renderWithQueryClient>) {
  fireEvent.change(view.getByRole("textbox", { name: "Message input" }), { target: { value: "hi" } });
  fireEvent.click(view.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(view.container.querySelector('[data-slot="guardrail-notice"]')).toBeTruthy());
}

describe("ChatMessageError", () => {
  test("engine failure refreshes the pill status immediately with composer health", async () => {
    const view = renderWithQueryClient(<Harness adapter={failingAdapter(new ChatTurnError("down", "engine_unavailable"))} />);
    const queryClient = view.queryClient;
    const invalidate = mock(queryClient.invalidateQueries.bind(queryClient));
    queryClient.invalidateQueries = invalidate;
    await sendFailingMessage(view);
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ["health"] }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["status-apps"] });
  });

  test("a completed failed-generation reply shows a muted error-details control in its action bar only for admins", async () => {
    const adminView = renderWithQueryClient(<Harness adapter={failedDoneAdapter()} admin />);
    fireEvent.change(adminView.getByRole("textbox", { name: "Message input" }), { target: { value: "find all of these" } });
    fireEvent.click(adminView.getByRole("button", { name: "Send message" }));
    const control = await adminView.findByRole("button", { name: "Error details" });
    expect(control).toBeTruthy();
    // CHAT-CALM-ERRORS-01c: muted, never red.
    expect(control.className).toContain("text-muted-foreground");
    expect(control.className).not.toContain("text-destructive");
    expect(control.closest(".aui-assistant-action-bar-root")).toBeTruthy();
    expect(control.parentElement?.closest('[data-slot="aui-assistant-message-footer-extra"]')).toBeNull();
    adminView.unmount();

    const memberView = renderWithQueryClient(<Harness adapter={failedDoneAdapter()} />);
    fireEvent.change(memberView.getByRole("textbox", { name: "Message input" }), { target: { value: "find all of these" } });
    fireEvent.click(memberView.getByRole("button", { name: "Send message" }));
    await waitFor(() => expect(memberView.container.textContent).toContain("too much text"));
    expect(memberView.queryByRole("button", { name: "Error details" })).toBeNull();
  });

  // CHAT-CALM-ERRORS-01d: the person's line is the whole message, with no
  // "Couldn't finish that reply" title above it, in the kit's muted panel.
  test("a failed reply renders the plain line, and only that line, in the kit error panel", async () => {
    const message = "The AI is busy starting up. Try again in a moment.";
    const view = renderWithQueryClient(<Harness adapter={failingAdapter(new ChatTurnError(message, "unavailable"))} />);
    await sendFailingMessage(view);

    expect(view.getByRole("alert").textContent).toBe(`${message}Retry`);
    expect(view.getByRole("alert").textContent).not.toContain("Couldn't finish that reply");
    expect(view.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  test("a safety refusal renders the guardrail notice with the server's safe copy", async () => {
    const message = "I can't continue with that reply.";
    const view = renderWithQueryClient(<Harness adapter={failingAdapter(new ChatTurnError(message, "safety_refused"))} admin />);
    await sendRefusedMessage(view);

    expect(view.container.textContent).toContain("I can't help with that");
    expect(view.container.textContent).toContain(message);
    expect(view.container.textContent).toContain("safety");
    expect(view.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(view.queryByRole("button", { name: "Error details" })).toBeNull();
  });

  test("a safety refusal does not render the generic error panel", async () => {
    const view = renderWithQueryClient(<Harness adapter={failingAdapter(new ChatTurnError("Safe refusal copy.", "safety_refused"))} />);
    await sendRefusedMessage(view);

    expect(view.container.querySelector('[data-slot="error-state"]')).toBeNull();
  });

  test("a refusal notice shows no alternatives block and no raw category text", async () => {
    const view = renderWithQueryClient(<Harness adapter={failingAdapter(new ChatTurnError("I can't continue with that reply.", "safety_refused"))} />);
    await sendRefusedMessage(view);

    expect(view.container.textContent).not.toContain("try instead");
    expect(view.container.textContent).not.toContain("self_harm");
    expect(view.container.textContent).not.toContain("safety_refused");
  });

  // ENGINE-DOWN-UI-01: a failed reply's Retry needs the engine like any other control.
  test("Retry is disabled, with the reason in its name, while chat is paused, and enabled again when it is back", async () => {
    let setAvailability!: (value: "ready" | "unavailable") => void;
    function AvailabilityHarness() {
      const [availability, set] = useState<"ready" | "unavailable">("ready");
      setAvailability = set;
      return <ChatAvailabilityContext.Provider value={availability}><Harness adapter={failingAdapter(new ChatTurnError("Try again.", "unavailable"))} /></ChatAvailabilityContext.Provider>;
    }
    const view = renderWithQueryClient(<AvailabilityHarness />);
    await sendFailingMessage(view);
    const retry = () => view.getByRole("alert").querySelector("button") as HTMLButtonElement;
    expect(retry().disabled).toBe(false);
    act(() => setAvailability("unavailable"));
    await waitFor(() => expect(retry().disabled).toBe(true));
    expect(retry().textContent).toContain("Chat is paused");
    act(() => setAvailability("ready"));
    await waitFor(() => expect(retry().disabled).toBe(false));
  });

  test("Retry reruns the failed reply", async () => {
    const run = mock(() => {});
    let attempts = 0;
    const adapter: ChatModelAdapter = {
      async *run() {
        run();
        attempts++;
        if (attempts === 1) throw new ChatTurnError("Try again.", "unavailable");
        yield { content: [{ type: "text", text: "Recovered." }] };
      },
    };
    const view = renderWithQueryClient(<Harness adapter={adapter} />);
    await sendFailingMessage(view);
    expect(run).toHaveBeenCalledTimes(1);

    fireEvent.click(view.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(view.container.textContent).toContain("Recovered."));
  });

  test("an admin sees one error-details control for an error that carried detail, and a non-admin sees none", async () => {
    const adminView = renderWithQueryClient(<Harness adapter={detailThenErrorAdapter()} admin />);
    await sendFailingMessage(adminView);
    await waitFor(() => expect(adminView.getAllByRole("button", { name: "Error details" })).toHaveLength(1));
    adminView.unmount();

    const memberView = renderWithQueryClient(<Harness adapter={detailThenErrorAdapter()} />);
    await sendFailingMessage(memberView);
    expect(memberView.queryByRole("button", { name: "Error details" })).toBeNull();
  });

  function stubDetailRoute(body: unknown): { urls: string[]; restore: () => void } {
    const original = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      urls.push(url);
      return Promise.resolve(Response.json(body));
    }) as unknown as typeof fetch;
    return { urls, restore: () => { globalThis.fetch = original; } };
  }

  test("an error with nothing to show draws no details control", async () => {
    const stub = stubDetailRoute({ turn_id: "turn-test123", found: false, tools: [], generations: [] });
    try {
      const view = renderWithQueryClient(<Harness adapter={failingAdapter(new ChatTurnError("The reply failed.", "engine_unavailable", "turn-test123"))} admin />);
      await sendFailingMessage(view);
      await waitFor(() => expect(stub.urls.some((u) => u.includes("/api/turn-error-detail/turn-test123"))).toBe(true));
      expect(view.queryByRole("button", { name: "Error details" })).toBeNull();
    } finally {
      stub.restore();
    }
  });

  test("an error with no streamed detail still gets the control when the stored row has facts; a non-admin never asks", async () => {
    const stub = stubDetailRoute(STOPPED_DETAIL);
    try {
      const adminView = renderWithQueryClient(<Harness adapter={failingAdapter(new ChatTurnError("The reply failed.", "unavailable", "turn-stopped1"))} admin />);
      await sendFailingMessage(adminView);
      expect(await adminView.findAllByRole("button", { name: "Error details" })).toHaveLength(1);
      adminView.unmount();
      stub.urls.length = 0;
      const memberView = renderWithQueryClient(<Harness adapter={failingAdapter(new ChatTurnError("The reply failed.", "unavailable", "turn-stopped1"))} />);
      await sendFailingMessage(memberView);
      expect(memberView.queryByRole("button", { name: "Error details" })).toBeNull();
      expect(stub.urls.some((u) => u.includes("/api/turn-error-detail/"))).toBe(false);
    } finally {
      stub.restore();
    }
  });

  test("no details box renders until the control is clicked; then it shows the cause, the next step and the raw facts, and Copy takes every row", async () => {
    const written: string[] = [];
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (text: string) => { written.push(text); return Promise.resolve(); } } });
    try {
      const view = renderWithQueryClient(<Harness adapter={detailThenErrorAdapter()} admin />);
      await sendFailingMessage(view);
      const control = await view.findByRole("button", { name: "Error details" });
      expect(view.queryByText("Stack said")).toBeNull();
      expect(view.queryByText("The chat engine was stopped, so the reply never started.")).toBeNull();
      fireEvent.click(control);
      expect(await view.findByText("The chat engine was stopped, so the reply never started.")).toBeTruthy();
      expect(view.getByRole("link", { name: "Start the chat engine in Repairs." }).getAttribute("href")).toBe("/repairs");
      const row = (label: string) => view.getByText(label).parentElement?.textContent;
      expect(row("Stack said")).toContain("No engine is ready for role 'chat'.");
      expect(row("Stack state")).toContain("installed");
      expect(row("Stack reason")).toContain("The chat engine was stopped.");
      expect(row("HTTP status")).toContain("503");
      expect(row("Timing")).toContain("+41 ms");
      expect(row("Timing")).toContain("+44 ms");
      expect(row("Model and engine")).toContain("qwen3-8b-instruct-q4_k_m.gguf on local b10797");
      expect(row("Raw body")).toContain('"state":"installed"');
      fireEvent.click(view.getByRole("button", { name: "Copy details" }));
      await waitFor(() => expect(written).toHaveLength(1));
      for (const line of [
        "Cause: The chat engine was stopped, so the reply never started.",
        "Next step: Start the chat engine in Repairs.",
        "What failed: engine",
        "Stack said: No engine is ready for role 'chat'.",
        "Stack state: installed",
        "Stack reason: The chat engine was stopped.",
        "HTTP status: 503",
        "Timing: request sent at +41 ms, failed at +44 ms, 2026-10-06T06:00:00.000Z",
        "Model and engine: qwen3-8b-instruct-q4_k_m.gguf on local b10797",
      ]) expect(written[0]).toContain(line);
      expect(written[0]).toContain("Raw body: {");
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
      else delete (navigator as unknown as { clipboard?: unknown }).clipboard;
    }
  });

  test("the old 'could not be read' strings are gone from the frontend", () => {
    const root = join(import.meta.dir, "../..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name) && !name.includes(".test.")) {
          const text = readFileSync(path, "utf8");
          if (text.includes("could not be read")) hits.push(path);
        }
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });

  test("the error panel never shows the code or the engine's raw text", async () => {
    const view = renderWithQueryClient(<Harness adapter={failingAdapter(new ChatTurnError("The chat engine is unavailable. Try again soon.", "engine_unavailable"))} />);
    await sendFailingMessage(view);

    expect(view.getByRole("alert").textContent).toContain("The chat engine is unavailable.");
    expect(view.container.textContent).not.toContain("engine_unavailable");
    expect(view.container.textContent).not.toContain("llama-server");
  });

  test("a generic Error renders its message without an admin detail control", async () => {
    const view = renderWithQueryClient(<Harness adapter={failingAdapter(new Error("Could not reach the hub. Try again."))} admin />);
    await sendFailingMessage(view);

    expect(view.getByRole("alert").textContent).toContain("Could not reach the hub. Try again.");
    expect(view.queryByRole("button", { name: "Error details" })).toBeNull();
  });
});
