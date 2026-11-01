// ANSWER-LABEL-01: a reply says which style answered it (Instant, Thinking or Max), so nobody wonders what ran
// (the ChatGPT auto-router lesson). Only an adult sees it, and only on a reply that carries stats.
import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter, type ThreadMessageLike } from "@assistant-ui/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "@maipai/ui/src/primitives/Toast";
import { ChatThread } from "@/apps/chat/ChatThread";
import { ChatAgeBandContext } from "@/apps/chat/chatThreadContexts";
import { answerStyleOf, ANSWER_STYLE_LINES, ANSWER_STYLE_WORDS } from "@/apps/chat/answerStyleLabel";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

afterEach(() => cleanup());

describe("answerStyleOf", () => {
  test("a reply with stats, no recorded style and no thinking was Instant", () => {
    expect(answerStyleOf({ thinking: false })).toBe("instant");
  });
  test("thinking with no recorded style (a model that always thinks) reads as Thinking", () => {
    expect(answerStyleOf({ thinking: true })).toBe("thinking");
  });
  test("a recorded style wins", () => {
    expect(answerStyleOf({ thinking: true, answer_style: "thinking" })).toBe("thinking");
    expect(answerStyleOf({ thinking: true, answer_style: "max" })).toBe("max");
  });
  test("a reply without stats has no label", () => {
    expect(answerStyleOf(undefined)).toBeUndefined();
  });
  test("each style has a word and a one-line hover", () => {
    for (const style of ["instant", "thinking", "max"] as const) {
      expect(ANSWER_STYLE_WORDS[style].length).toBeGreaterThan(0);
      expect(ANSWER_STYLE_LINES[style].length).toBeGreaterThan(0);
    }
  });
});

const NOOP: ChatModelAdapter = { run: async function* () {} };
const STATS = { time_to_first_token_ms: 100, total_time_ms: 900, tokens_per_second: 20, engine: null, thinking: false };

function reply(text: string, stats: Record<string, unknown> | undefined): ThreadMessageLike[] {
  return [
    { role: "user", content: [{ type: "text", text: "a question" }] },
    { role: "assistant", content: [{ type: "text", text }], metadata: { custom: { turnId: "t1", conversationId: "c1", ...(stats ? { stats } : {}) } } },
  ];
}

function Harness({ band, initial }: { band: "child" | "teen" | "adult"; initial: ThreadMessageLike[] }) {
  const runtime = useLocalRuntime(NOOP, { initialMessages: initial });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ChatAgeBandContext.Provider value={band}><ChatThread canUseIncognito={false} /></ChatAgeBandContext.Provider>
    </AssistantRuntimeProvider>
  );
}

function renderChat(band: "child" | "teen" | "adult", initial: ThreadMessageLike[]) {
  return renderWithQueryClient(<ToastProvider><MemoryRouter><Harness band={band} initial={initial} /></MemoryRouter></ToastProvider>);
}

describe("the label under a reply", () => {
  test("an adult sees Instant, Thinking and Max on replies that carry them", async () => {
    for (const [stats, word] of [[STATS, "Instant"], [{ ...STATS, thinking: true, answer_style: "thinking" }, "Thinking"], [{ ...STATS, thinking: true, answer_style: "max" }, "Max"]] as const) {
      const view = renderChat("adult", reply("the answer", stats));
      await waitFor(() => expect(view.container.querySelector('[data-slot="answer-style-label"]')?.textContent).toBe(word));
      view.unmount();
    }
  });
  test("a teen and a child see no label", async () => {
    for (const band of ["teen", "child"] as const) {
      const view = renderChat(band, reply("the answer", { ...STATS, answer_style: "max" }));
      await waitFor(() => expect(view.getByText("the answer")).not.toBeNull());
      expect(view.container.querySelector('[data-slot="answer-style-label"]')).toBeNull();
      view.unmount();
    }
  });
  test("a reply with no stats shows no label", async () => {
    const view = renderChat("adult", reply("the answer", undefined));
    await waitFor(() => expect(view.getByText("the answer")).not.toBeNull());
    expect(view.container.querySelector('[data-slot="answer-style-label"]')).toBeNull();
  });
});
