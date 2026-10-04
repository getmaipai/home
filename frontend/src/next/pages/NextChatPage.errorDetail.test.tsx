// THIN-1E (rule 6): an admin sees a quiet details control on a reply whose
// tool call failed; nobody else does, and nobody else's browser ever asks
// for the raw detail. Same scripted-stream structure as NextChatPage.test.tsx.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { NextChatPage } from "@/next/pages/NextChatPage";
import { IncognitoProvider } from "@/next/incognitoContext";
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
  tools: [{ tool_id: "websearch", call_id: "call-1", kind: "unavailable", error_code: "search_unavailable", error_text: "SearXNG answered 502", at: "2026-10-04T10:00:00.000Z", duration_ms: 812 }],
  generations: [{ reason: "answer", error: "chat model unavailable: slot crashed", request_sent_ms: 40, offline_reason: "The chat engine waited 15 s for memory and gave up." }],
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
        { t: "tool_call", package_id: "websearch", args: { query: "weather" }, call_id: "call-1" },
        failed ? { t: "tool_error", call_id: "call-1", package_id: "websearch", error: "unavailable" } : { t: "tool_result", call_id: "call-1", package_id: "websearch", outcome: { text: "3 results" } },
        { type: "delta", text: "I could not look that up." },
        { type: "done", value: { turn_id: "turn-failed123", reply: { text: "I could not look that up." }, source: "model", safety: SAFETY } },
      ]), { status: 200, headers: ASSISTANT_STREAM_HEADERS }));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  return { urls, restore: () => { globalThis.fetch = original; } };
}

async function runTurn(role: Roster["role"], failed = true) {
  const stub = stubFailedTurn(failed);
  const view = renderPage(<MemoryRouter initialEntries={["/chat"]}><NextChatPage person={makePerson(role)} /></MemoryRouter>);
  fireEvent.change(await view.findByLabelText("Message input"), { target: { value: "weather in Lantern Bay" } });
  const send = (await view.findByLabelText("Send message")) as HTMLButtonElement;
  await waitFor(() => expect(send.disabled).toBe(false));
  fireEvent.click(send);
  await view.findByText("I could not look that up.");
  return { view, ...stub };
}

describe("the admin error detail on a failed tool call", () => {
  test("an admin opens the quiet indicator and reads the tool, kind, raw error, timing and the Stack's reason", async () => {
    const { view, restore } = await runTurn("owner");
    try {
      const open = await view.findByRole("button", { name: "Error details" });
      fireEvent.click(open);
      expect(await view.findByText("SearXNG answered 502")).toBeVisible();
      expect(view.getByText("websearch", { selector: "[data-slot=popover-content] *" })).toBeVisible();
      expect(view.getByText("unavailable (search_unavailable)")).toBeVisible();
      expect(view.getByText(/812 ms/)).toBeVisible();
      expect(view.getByText("The chat engine waited 15 s for memory and gave up.")).toBeVisible();
    } finally {
      restore();
    }
  });

  test("the detail is not fetched until the indicator is opened", async () => {
    const { view, urls, restore } = await runTurn("owner");
    try {
      await view.findByRole("button", { name: "Error details" });
      expect(urls.some((u) => u.includes("/api/turn-error-detail/"))).toBe(false);
    } finally {
      restore();
    }
  });

  test("no indicator on a reply whose tool succeeded", async () => {
    const { view, restore } = await runTurn("owner", false);
    try {
      expect(view.queryByRole("button", { name: "Error details" })).toBeNull();
    } finally {
      restore();
    }
  });

  test("a teen, a child and an adult see no indicator and the page never asks for the detail", async () => {
    for (const role of ["teen", "child", "adult"] as const) {
      const { view, urls, restore } = await runTurn(role);
      try {
        expect(view.queryByRole("button", { name: "Error details" })).toBeNull();
        expect(urls.some((u) => u.includes("/api/turn-error-detail/"))).toBe(false);
      } finally {
        restore();
        cleanup();
      }
    }
  });
});
