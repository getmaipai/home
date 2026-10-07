// CHAT-CALM-ERRORS-01d (design data-scratch/research/chat-calm-errors.md
// sections 2, 7 and 8; RULES.md rules 0, 6 and 9): one cause, one visual.
// While the engine is down the chat shows one quiet line under the composer
// and nothing else: no banner, no red reply card, no red class anywhere in
// the chat column. A reply that fails while the engine is up gets one muted
// inline line with Retry, and no composer line. A person can keep typing
// while chat is paused; Send waits until the engine is ready. Each band gets
// its own words, and only an owner or admin gets the Repairs link.
// Same scripted-stream structure as ChatPage.errorDetail.test.tsx.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ReactElement } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { composerNotice, failureLine } from "@maipai/home-backend/src/lib/failureCopy";
import { ChatPage } from "@/shell/pages/ChatPage";
import { IncognitoProvider } from "@/shell/incognitoContext";
import type { Roster } from "@/lib/api";
import { FakeAudioContext } from "../../../tests/fakeAudioContext";
import { assistantStreamBody as ndjsonStream, ASSISTANT_STREAM_HEADERS } from "../../../tests/assistantStreamBody";
import { paintsRed } from "../../../tests/paintsRed";

const ORIGINAL_MATCH_MEDIA = window.matchMedia;
beforeEach(() => {
  window.matchMedia = mock((query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  window.matchMedia = ORIGINAL_MATCH_MEDIA;
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = undefined;
});

const PAUSED = composerNotice("unavailable")!;
const SAFETY = { flagged: false, categories: [], action: "allow" as const, notify_parent: false, matched_signals: [], checked_at: "2026-10-06T00:00:00.000Z" };
const READY = { engines: { chat: { kind: "none", pid: null, alive: null, availability: "ready" } } };
const DOWN = { engines: { chat: { kind: "failed", pid: null, alive: false, availability: "unavailable", reason: "failed_start", notice: PAUSED } } };

function makePerson(role: Roster["role"]): Roster {
  const age_band = role === "child" ? "child" : role === "teen" ? "teen" : "adult";
  return { id: "person-abc123", display_name: "Nova", nickname: null, role, age_band, avatar_seed: "person-abc123", source: "hub", local_only: false, created_at: "2026-09-04T00:00:00.000Z", updated_at: "2026-09-04T00:00:00.000Z", deleted_at: null, enabled: true, guest_expires_at: null, memorialized_at: null, hlc: "1788000000000:0:test", hasSecret: true };
}

type Scenario = { health: () => unknown; apps?: () => unknown; stream?: () => unknown[]; onStream?: () => void };

function stub(scenario: Scenario): { restore: () => void; turns: () => number } {
  const original = globalThis.fetch;
  let turns = 0;
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/api/status/apps")) return Promise.resolve(Response.json(scenario.apps?.() ?? []));
    if (url.endsWith("/api/health")) return Promise.resolve(Response.json(scenario.health()));
    if (url.includes("/api/conversations") && init?.method === "POST") return Promise.resolve(Response.json({ id: "conv-calm123", status: "open", surface: "chat" }));
    if (url.includes("/api/conversations")) return Promise.resolve(Response.json([]));
    if (url.includes("/api/turn/stream")) {
      turns += 1;
      scenario.onStream?.();
      return Promise.resolve(new Response(ndjsonStream(scenario.stream?.() ?? []), { status: 200, headers: ASSISTANT_STREAM_HEADERS }));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  return { restore: () => { globalThis.fetch = original; }, turns: () => turns };
}

function renderPage(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { ...render(<QueryClientProvider client={client}><IncognitoProvider><TooltipProvider>{ui}</TooltipProvider></IncognitoProvider></QueryClientProvider>), client };
}

function openChat(role: Roster["role"]) {
  return renderPage(<MemoryRouter initialEntries={["/chat"]}><ChatPage person={makePerson(role)} /></MemoryRouter>);
}

const notice = (root: ParentNode) => root.querySelector("[data-chat-notice]");
const inlineFailure = (root: ParentNode) => root.querySelector('[data-slot="error-state"]');

async function send(view: ReturnType<typeof openChat>, text: string) {
  fireEvent.change(await view.findByLabelText("Message input"), { target: { value: text } });
  const button = (await view.findByLabelText("Send message")) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
}

describe("(a) one cause, one visual", () => {
  test("engine paused, nothing sent: one composer line, no banner, no inline failure, nothing red", async () => {
    const stubbed = stub({ health: () => DOWN });
    try {
      const view = openChat("owner");
      await waitFor(() => expect(notice(view.container)?.textContent).toContain(PAUSED.adult));
      // CHAT-NOTICE-LED-01: a status dot (the kit's degraded dot, no ping) then the sentence.
      const dot = notice(view.container)?.querySelector('[data-slot="chat-notice-dot"]');
      expect(dot?.innerHTML).toContain("tint-attention-fg");
      expect(dot?.innerHTML).not.toContain("animate-ping");
      expect(dot?.className).toContain("inline-flex");
      const repairs = view.getByRole("link", { name: "Open Repairs" });
      expect(repairs.getAttribute("data-slot")).toBe("button");
      expect(repairs.getAttribute("data-size")).toBe("xs");
      expect(repairs.getAttribute("data-variant")).toBe("quiet-link");
      expect(repairs.className).toContain("before:-inset-3");
      expect(repairs.className).toContain("focus-visible:ring-[3px]");
      repairs.focus();
      expect(document.activeElement).toBe(repairs);
      expect(notice(view.container)?.querySelector("[data-chat-notice-text]")?.textContent).toBe(PAUSED.adult);
      expect([...notice(view.container)!.children].map((node) => (node as HTMLElement).dataset.slot ?? node.tagName)).toEqual([
        "chat-notice-dot",
        "SPAN",
        "button",
      ]);
      expect(inlineFailure(view.container)).toBeNull();
      expect(view.queryByText("MaiPai's AI isn't running right now")).toBeNull();
      expect(view.container.querySelector('[data-slot="alert"]')).toBeNull();
      expect(paintsRed(view.container)).toBeNull();
    } finally {
      stubbed.restore();
    }
  });

  test("Chat down on the status board: the notice dot is the kit's offline (red) dot, still no ping", async () => {
    const stubbed = stub({ health: () => DOWN, apps: () => [{ id: "chat", name: "Chat", state: "down", reason: null, paused: false }] });
    try {
      const view = openChat("owner");
      await waitFor(() => expect(notice(view.container)?.getAttribute("data-level")).toBe("red"));
      const dot = notice(view.container)?.querySelector('[data-slot="chat-notice-dot"]');
      expect(dot?.innerHTML).toContain("bg-destructive");
      expect(dot?.innerHTML).not.toContain("animate-ping");
    } finally {
      stubbed.restore();
    }
  });

  test("engine died mid-reply: the partial text stays, the composer line owns the cause, no inline failure", async () => {
    let down = false;
    const stubbed = stub({
      health: () => (down ? DOWN : READY),
      onStream: () => { down = true; },
      stream: () => [
        { type: "turn_meta", conversation_id: "conv-calm123", turn_id: "turn-calm123" },
        { type: "delta", text: "The recipe starts with two cups of flour" },
        { type: "error", error: failureLine("stopped", false), code: "engine_unavailable" },
      ],
    });
    try {
      const view = openChat("owner");
      await send(view, "a recipe please");
      expect(await view.findByText(/The recipe starts with two cups of flour/)).toBeTruthy();
      await waitFor(() => expect(notice(view.container)?.textContent).toContain(PAUSED.adult));
      expect(inlineFailure(view.container)).toBeNull();
      expect(view.container.querySelector('[data-slot="alert"]')).toBeNull();
      expect(paintsRed(view.container)).toBeNull();
    } finally {
      stubbed.restore();
    }
  });

  // The thin path words a failed generation as a finished reply (done with
  // the hub's line), so the inline line is for an error event: here the
  // engine refused this one reply but health still reads ready.
  test("a reply failed while the engine stayed up: one muted inline line with Retry, no composer line", async () => {
    const line = failureLine("busy", false);
    const stubbed = stub({
      health: () => READY,
      stream: () => [
        { type: "turn_meta", conversation_id: "conv-calm123", turn_id: "turn-calm123" },
        { type: "error", error: line, code: "engine_unavailable" },
      ],
    });
    try {
      const view = openChat("owner");
      await send(view, "tell me a story");
      const failure = await waitFor(() => { const found = inlineFailure(view.container); expect(found).toBeTruthy(); return found!; });
      expect(failure.textContent).toContain(line);
      expect(failure.textContent).not.toContain("Couldn't finish that reply");
      expect(view.getByRole("button", { name: "Retry" })).toBeTruthy();
      expect(notice(view.container)).toBeNull();
      expect(paintsRed(view.container)).toBeNull();
    } finally {
      stubbed.restore();
    }
  });
});

describe("(b) a person can type while chat is paused; Send waits for the engine", () => {
  test("the input takes text, Send and Enter do nothing, and Send comes back when the engine is ready", async () => {
    let ready = false;
    const stubbed = stub({
      health: () => (ready ? READY : DOWN),
      stream: () => [
        { type: "turn_meta", conversation_id: "conv-calm123", turn_id: "turn-calm123" },
        { type: "delta", text: "Here it is." },
        { type: "done", value: { turn_id: "turn-calm123", reply: { text: "Here it is." }, source: "model", safety: SAFETY } },
      ],
    });
    try {
      const view = openChat("owner");
      await waitFor(() => expect(notice(view.container)).toBeTruthy());
      const input = (await view.findByLabelText("Message input")) as HTMLTextAreaElement;
      expect(input.disabled).toBe(false);
      expect(input.placeholder).toBe("Send a message...");
      fireEvent.change(input, { target: { value: "hold this thought" } });
      expect(input.value).toBe("hold this thought");
      const button = (await view.findByLabelText("Send message")) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
      fireEvent.keyDown(input, { key: "Enter" });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
      expect(stubbed.turns()).toBe(0);
      expect(input.value).toBe("hold this thought");

      ready = true;
      await act(async () => { await view.client.invalidateQueries({ queryKey: ["health"] }); });
      await waitFor(() => expect(notice(view.container)).toBeNull(), { timeout: 5_000 });
      const live = (await view.findByLabelText("Send message")) as HTMLButtonElement;
      await waitFor(() => expect(live.disabled).toBe(false), { timeout: 5_000 });
      fireEvent.click(live);
      expect(await view.findByText("Here it is.", {}, { timeout: 5_000 })).toBeTruthy();
      expect(stubbed.turns()).toBe(1);
    } finally {
      stubbed.restore();
    }
  }, 15_000);
});

describe("(e) each band gets its own words; only an owner or admin gets the Repairs link", () => {
  test.each([
    ["owner", PAUSED.adult, true],
    ["admin", PAUSED.adult, true],
    ["adult", PAUSED.adult, false],
    ["teen", PAUSED.teen, false],
    ["child", PAUSED.child, false],
  ] as const)("%s", async (role, line, link) => {
    const stubbed = stub({ health: () => DOWN });
    try {
      const view = openChat(role);
      const shown = await waitFor(() => { const found = notice(view.container); expect(found?.textContent).toContain(line); return found!; });
      const repairs = shown.querySelector('a[href="/repairs"]');
      if (link) expect(repairs?.textContent).toBe(PAUSED.repairs_link!);
      else expect(repairs).toBeNull();
      expect(view.queryByRole("button", { name: "Error details" })).toBeNull();
    } finally {
      stubbed.restore();
    }
  });
});
