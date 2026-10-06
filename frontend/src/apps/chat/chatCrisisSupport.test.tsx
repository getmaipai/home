import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter, type ThreadMessageLike } from "@assistant-ui/react";
import { ChatThread } from "@/apps/chat/ChatThread";
import { ChatAgeBandContext } from "@/apps/chat/chatThreadContexts";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { FakeAudioContext } from "../../../tests/fakeAudioContext";

// SAFETY-NOTICE-01, "offer, never block": a finished reply that carried
// crisis resources keeps its whole text, and the resources sit beside it as
// the kit GuardrailNotice in its support tone, for every band that sees them.
const NOOP: ChatModelAdapter = { run: async function* () { /* seeded */ } };
const SUPPORT = {
  title: "Support is available",
  text: "If you're in crisis, the 988 Suicide & Crisis Lifeline is free and available 24/7: call or text 988.",
  actions: [
    { label: "Call 988", href: "tel:988" },
    { label: "Text 988", href: "sms:988" },
    { label: "Chat with 988", href: "https://988lifeline.org/chat/" },
  ],
};
const REPLY = "I'm really glad you told me. You deserve support from someone who can be with you right now.";

function Harness({ band }: { band: "child" | "teen" | "adult" }) {
  const messages: ThreadMessageLike[] = [
    { role: "user", content: [{ type: "text", text: "I feel awful" }] },
    { role: "assistant", content: [{ type: "text", text: REPLY }], status: { type: "complete", reason: "stop" }, metadata: { custom: { turnId: "turn-crisis01", crisisSupport: SUPPORT } } },
  ];
  const runtime = useLocalRuntime(NOOP, { initialMessages: messages });
  return <AssistantRuntimeProvider runtime={runtime}><ChatAgeBandContext.Provider value={band}><ChatThread /></ChatAgeBandContext.Provider></AssistantRuntimeProvider>;
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

describe("crisis support beside a finished reply", () => {
  for (const band of ["adult", "teen", "child"] as const) {
    test(`${band}: the reply stays whole and the support notice sits beside it with its links`, async () => {
      const view = renderWithQueryClient(<MemoryRouter><Harness band={band} /></MemoryRouter>);
      expect(await view.findByText(REPLY)).toBeTruthy();
      await waitFor(() => expect(view.container.querySelector('[data-slot="guardrail-notice"]')).not.toBeNull());
      const notice = view.container.querySelector('[data-slot="guardrail-notice"]')!;
      expect(notice.getAttribute("data-tone")).toBe("support");
      expect(notice.textContent).toContain(SUPPORT.text);
      expect(notice.textContent).not.toContain("can't help");
      expect(notice.querySelector(".font-mono")).toBeNull();
      expect(view.getByRole("link", { name: "Call 988" }).getAttribute("href")).toBe("tel:988");
    });
  }
});
