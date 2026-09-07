import { describe, test, expect, mock, afterEach } from "bun:test";
import { cleanup } from "@testing-library/react";
import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useLocalRuntime,
  type ChatModelAdapter,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { ChatSourceCaption } from "@/apps/chat/chatSourceCaption";

afterEach(cleanup);

// Same fetch-stub approach as ModelsSection.test.tsx/ChangeSecretSection.test.tsx
// (a static import of the component under test means Bun's module cache
// won't reliably re-bind a mock.module()-registered "@/lib/api" mock).
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function stubFetch(byPath: Record<string, unknown>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const match = Object.entries(byPath).find(([path]) => url.includes(path));
    if (!match) throw new Error(`unstubbed fetch: ${url}`);
    return Promise.resolve(jsonResponse(match[1]));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

const NEVER_RUNS: ChatModelAdapter = {
  async *run() {
    /* never invoked - the message under test is seeded via initialMessages */
  },
};

function replyMessage(custom: Record<string, unknown>): ThreadMessageLike {
  return { id: "reply-1", role: "assistant", content: "MaiPai's reply", metadata: { custom } };
}

function CaptionUnderTest({ message }: { message: ThreadMessageLike }) {
  const runtime = useLocalRuntime(NEVER_RUNS, { initialMessages: [message] });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root>
        <ThreadPrimitive.Viewport>
          <ThreadPrimitive.Messages>{() => <ChatSourceCaption />}</ThreadPrimitive.Messages>
        </ThreadPrimitive.Viewport>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

function renderCaption(message: ThreadMessageLike) {
  return renderWithQueryClient(<CaptionUnderTest message={message} />);
}

const MUSIC_MANIFEST = { id: "music", display: "Music Lookup" };
const COMMAND_ROW = { id: "cmd-1", trigger: "good night house" };

describe("ChatSourceCaption (Fix B4)", () => {
  test("a plugin reply shows the package's own display name, never the bare id", async () => {
    const restore = stubFetch({ "/api/plugins": [MUSIC_MANIFEST] });
    const { findByText } = renderCaption(replyMessage({ source: "plugin", pluginId: "music" }));
    await findByText("via Music Lookup");
    restore();
  });

  test("a plugin_error reply still shows the package's own display name", async () => {
    const restore = stubFetch({ "/api/plugins": [MUSIC_MANIFEST] });
    const { findByText } = renderCaption(replyMessage({ source: "plugin_error", pluginId: "music" }));
    await findByText("via Music Lookup");
    restore();
  });

  // A code review (2026-09-07) found a Tier 2 multi-tool turn's own
  // pluginId ("currency+weather", turnEngine.ts's attemptTier2Tools())
  // resolved against nothing (no manifest's id is ever a "+"-joined
  // string), silently dropping the whole caption for exactly the
  // multi-tool case Tier 2 exists to produce.
  test("a Tier 2 multi-tool reply (\"a+b\") shows each package's own display name, joined", async () => {
    const restore = stubFetch({
      "/api/plugins": [
        { id: "currency", display: "Currency" },
        { id: "weather", display: "Weather" },
      ],
    });
    const { findByText } = renderCaption(replyMessage({ source: "plugin", pluginId: "currency+weather" }));
    await findByText("via Currency + Weather");
    restore();
  });

  test("a command reply shows the command's own trigger phrase", async () => {
    const restore = stubFetch({ "/api/commands": [COMMAND_ROW] });
    const { findByText } = renderCaption(replyMessage({ source: "command", commandId: "cmd-1" }));
    await findByText("via good night house");
    restore();
  });

  test("a model reply shows no caption at all", async () => {
    const { queryByText } = renderCaption(replyMessage({ source: "model" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(queryByText(/^via /)).toBeNull();
  });

  test("a safety_refuse reply shows no caption (only plugin/plugin_error/command are captioned)", async () => {
    const { queryByText } = renderCaption(replyMessage({ source: "safety_refuse" }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(queryByText(/^via /)).toBeNull();
  });
});
