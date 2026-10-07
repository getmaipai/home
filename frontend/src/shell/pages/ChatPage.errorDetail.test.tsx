// THIN-1E (rule 6): an admin sees a quiet details control on a reply whose
// tool call failed; nobody else does, and nobody else's browser ever asks
// for the raw detail. Same scripted-stream structure as ChatPage.test.tsx.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { ChatPage } from "@/shell/pages/ChatPage";
import { IncognitoProvider } from "@/shell/incognitoContext";
import type { Roster } from "@/lib/api";
import { FakeAudioContext } from "../../../tests/fakeAudioContext";
import { assistantStreamBody as ndjsonStream, ASSISTANT_STREAM_HEADERS } from "../../../tests/assistantStreamBody";

const ORIGINAL_MATCH_MEDIA = window.matchMedia;
beforeEach(() => {
  window.matchMedia = mock((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  window.matchMedia = ORIGINAL_MATCH_MEDIA;
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = undefined;
});

const SAFETY = { flagged: false, categories: [], action: "allow" as const, notify_parent: false, matched_signals: [], checked_at: "2026-09-04T00:00:00.000Z" };
const DETAIL = {
  turn_id: "turn-failed123",
  found: true,
  advice: { cause: "The websearch tool could not reach its service.", next_step: "Retry once the service is back. If it stays down, check Repairs.", repairs: true },
  tools: [{ tool_id: "websearch", call_id: "call-1", kind: "unavailable", error_code: "search_unavailable", error_text: "SearXNG answered 502", at: "2026-10-04T10:00:00.000Z", duration_ms: 812 }],
  generations: [{ reason: "answer", error: "chat model unavailable: slot crashed", request_sent_ms: 40, offline_reason: "The chat engine waited 15 s for memory and gave up.", http_status: 503, state: "offline", engine_id: "local b10797", model_id: "qwen3-8b" }],
};

function renderPage(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><IncognitoProvider><TooltipProvider>{ui}</TooltipProvider></IncognitoProvider></QueryClientProvider>);
}

function makePerson(role: Roster["role"]): Roster {
  return { id: "person-abc123", display_name: "Nova", nickname: null, role, avatar_seed: "person-abc123", source: "hub", local_only: false, created_at: "2026-09-04T00:00:00.000Z", updated_at: "2026-09-04T00:00:00.000Z", deleted_at: null, enabled: true, guest_expires_at: null, memorialized_at: null, hlc: "1788000000000:0:test", hasSecret: true };
}

function stubFailedTurn(failed: boolean): { urls: string[]; restore: () => void } {
  const original = globalThis.fetch;
  const urls: string[] = [];
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    urls.push(url);
    if (url.includes("/api/turn-error-detail/")) return Promise.resolve(Response.json(DETAIL));
    if (url.includes("/api/conversations") && init?.method === "POST") return Promise.resolve(Response.json({ id: "conv-failed123", status: "open", surface: "chat" }));
    if (url.includes("/api/conversations")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    if (url.includes("/api/turn/stream")) {
      return Promise.resolve(new Response(ndjsonStream([
        { type: "turn_meta", conversation_id: "conv-failed123", turn_id: "turn-failed123", resume_token: "resume-failed123" },
        { t: "tool_call", package_id: "websearch", args: { query: "weather" }, call_id: "call-1" },
        failed ? { t: "tool_error", call_id: "call-1", package_id: "websearch", error: "unavailable" } : { t: "tool_result", call_id: "call-1", package_id: "websearch", outcome: { text: "3 results" } },
        { type: "delta", text: "I could not look that up." },
        { type: "done", value: { turn_id: "turn-failed123", reply: { text: "I could not look that up." }, source: "model", failed_generation: failed, safety: SAFETY } },
      ]), { status: 200, headers: ASSISTANT_STREAM_HEADERS }));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  return { urls, restore: () => { globalThis.fetch = original; } };
}

async function runTurn(role: Roster["role"], failed = true) {
  const stub = stubFailedTurn(failed);
  const view = renderPage(<MemoryRouter initialEntries={["/chat"]}><ChatPage person={makePerson(role)} /></MemoryRouter>);
  fireEvent.change(await view.findByLabelText("Message input"), { target: { value: "weather in Lantern Bay" } });
  const send = (await view.findByLabelText("Send message")) as HTMLButtonElement;
  await waitFor(() => expect(send.disabled).toBe(false));
  fireEvent.click(send);
  await view.findByText("I could not look that up.");
  return { view, ...stub };
}

describe("the admin tool error card on a failed tool call", () => {
  test("an admin sees the tool error card with the tool, kind and raw message from the stored row", async () => {
    const { view, restore } = await runTurn("owner");
    try {
      const details = await view.findByRole("button", { name: "Error details" });
      expect(details.closest(".aui-assistant-action-bar-root")).toBeTruthy();
      expect(view.container.querySelector('[data-slot="tool-error"]')).toBeNull();
      fireEvent.click(details);
      expect(await view.findByText("SearXNG answered 502")).toBeVisible();
      expect(view.getAllByText("What failed").map((label) => label.parentElement?.textContent)).toContain("What failedwebsearch");
      expect(view.getByText("unavailable (search_unavailable)")).toBeVisible();
      expect(await view.findByText("The chat engine waited 15 s for memory and gave up.")).toBeVisible();
      expect(view.getByText("HTTP status").parentElement?.textContent).toContain("503");
      expect(view.getByText("Model and engine").parentElement?.textContent).toContain("qwen3-8b on local b10797");
      expect(view.getByText("The websearch tool could not reach its service.")).toBeVisible();
      expect(view.getByRole("button", { name: "Copy details" })).toBeVisible();
    } finally {
      restore();
    }
  });

  test("a non-admin sees no tool error card and makes no detail request", async () => {
    const { view, urls, restore } = await runTurn("adult");
    try {
      await view.findByText("I could not look that up.");
      fireEvent.mouseEnter(view.container.querySelector('[data-role="assistant"]')!);
      expect(view.queryByText("SearXNG answered 502")).toBeNull();
      expect(view.container.querySelector('[data-slot="tool-error"]')).toBeNull();
      expect(urls.some((u) => u.includes("/api/turn-error-detail/"))).toBe(false);
    } finally {
      restore();
    }
  });

  test("a child-band thread with a failed tool shows only the timeline chip", async () => {
    const { view, urls, restore } = await runTurn("child");
    try {
      await view.findByText("I could not look that up.");
      expect(view.queryByText("SearXNG answered 502")).toBeNull();
      expect(view.container.querySelector('[data-slot="tool-error"]')).toBeNull();
      expect(urls.some((u) => u.includes("/api/turn-error-detail/"))).toBe(false);
    } finally {
      restore();
    }
  });

  test("no indicator on a reply whose tool succeeded", async () => {
    const { view, restore } = await runTurn("owner", false);
    try {
      expect(view.container.querySelector('[data-slot="tool-error"]')).toBeNull();
    } finally {
      restore();
    }
  });

  test("details control is available without duplicating an inline tool error card", async () => {
    const { view, restore } = await runTurn("owner");
    try {
      expect(await view.findByRole("button", { name: "Error details" })).toBeTruthy();
      expect(view.container.querySelector('[data-slot="tool-error"]')).toBeNull();
    } finally {
      restore();
    }
  });

  test("a teen sees no tool error card and the page never asks for the detail", async () => {
    for (const role of ["teen"] as const) {
      const { view, urls, restore } = await runTurn(role);
      try {
        expect(view.container.querySelector('[data-slot="tool-error"]')).toBeNull();
        expect(urls.some((u) => u.includes("/api/turn-error-detail/"))).toBe(false);
      } finally {
        restore();
        cleanup();
      }
    }
  });
});

// CHAT-CALM-ERRORS-01c: the stopped engine, end to end through the page's
// own stream adapter. The hub sends `detail` on the error event to an adult
// owner or admin only (backend tests/chatCalmErrors.test.ts), so the stubs
// below send it for the owner and leave it off for everyone else.
const STOPPED_DETAIL = {
  turn_id: "turn-stopped123",
  found: true,
  advice: { cause: "The chat engine was stopped, so the reply never started.", next_step: "Start the chat engine in Repairs.", repairs: true },
  tools: [],
  generations: [{ reason: "model", error: "No engine is ready for role 'chat'.", request_sent_ms: 41, offline_reason: "The chat engine was stopped.", http_status: 503, state: "installed", engine_id: "local b10797", model_id: "qwen3-8b", failed_ms: 44, failed_at: "2026-10-06T06:00:00.000Z" }],
};

async function runStoppedTurn(role: Roster["role"]) {
  const original = globalThis.fetch;
  const urls: string[] = [];
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    urls.push(url);
    if (url.includes("/api/conversations") && init?.method === "POST") return Promise.resolve(Response.json({ id: "conv-stopped123", status: "open", surface: "chat" }));
    if (url.includes("/api/conversations")) return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    if (url.includes("/api/turn/stream")) {
      const error = { type: "error", error: "The AI was stopped, so that reply didn't finish. Send it again once chat is back.", code: "engine_unavailable", ...(role === "owner" ? { detail: STOPPED_DETAIL } : {}) };
      return Promise.resolve(new Response(ndjsonStream([{ type: "turn_meta", conversation_id: "conv-stopped123", turn_id: "turn-stopped123", resume_token: "resume-stopped123" }, error]), { status: 200, headers: ASSISTANT_STREAM_HEADERS }));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  const view = renderPage(<MemoryRouter initialEntries={["/chat"]}><ChatPage person={makePerson(role)} /></MemoryRouter>);
  fireEvent.change(await view.findByLabelText("Message input"), { target: { value: "hi" } });
  const send = (await view.findByLabelText("Send message")) as HTMLButtonElement;
  await waitFor(() => expect(send.disabled).toBe(false));
  fireEvent.click(send);
  await view.findByText("The AI was stopped, so that reply didn't finish. Send it again once chat is back.");
  return { view, urls, restore: () => { globalThis.fetch = original; } };
}

describe("the details control on a reply the stopped engine never started", () => {
  test("an owner gets exactly one control, read from the error event without asking the hub, naming the stopped engine", async () => {
    const { view, urls, restore } = await runStoppedTurn("owner");
    try {
      const controls = await view.findAllByRole("button", { name: "Error details" });
      expect(controls).toHaveLength(1);
      expect(view.queryByText("Stack said")).toBeNull();
      fireEvent.click(controls[0]!);
      expect(await view.findByText("The chat engine was stopped, so the reply never started.")).toBeVisible();
      expect(view.getByText("Start the chat engine in Repairs.")).toBeVisible();
      expect(view.getByText("HTTP status").parentElement?.textContent).toContain("503");
      expect(view.getByText("Model and engine").parentElement?.textContent).toContain("qwen3-8b on local b10797");
      expect(urls.some((u) => u.includes("/api/turn-error-detail/"))).toBe(false);
      expect(view.queryByText(/could not be read/)).toBeNull();
    } finally {
      restore();
    }
  });

  test("a non-admin adult, a teen and a child see the line and no control", async () => {
    for (const role of ["adult", "teen", "child"] as const) {
      const { view, urls, restore } = await runStoppedTurn(role);
      try {
        fireEvent.mouseEnter(view.container.querySelector('[data-role="assistant"]') ?? view.container);
        expect(view.queryByRole("button", { name: "Error details" })).toBeNull();
        expect(urls.some((u) => u.includes("/api/turn-error-detail/"))).toBe(false);
      } finally {
        restore();
        cleanup();
      }
    }
  });
});
