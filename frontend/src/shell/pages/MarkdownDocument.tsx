import { MessageProvider, PartByIndexProvider } from "@assistant-ui/react";
import type { ThreadAssistantMessage } from "@assistant-ui/react";
import { MarkdownText } from "@maipai/ui/src/elements/markdown-text";
import { useMemo } from "react";

// The kit's MarkdownText reads its text from a message part, and its code
// and diagram slots also read the enclosing message's status (to skip
// highlighting mid-stream). A bare TextMessagePartProvider supplies only the
// part, so any fenced block in a canvas document threw "The current scope does
// not have a message property". MessageProvider + PartByIndexProvider are
// assistant-ui's own way to give a fixed text the message around it; nothing
// here renders anything itself.
export function MarkdownDocument({ text }: { text: string }) {
  const message = useMemo<ThreadAssistantMessage>(
    () => ({
      id: "canvas-document",
      role: "assistant",
      createdAt: new Date(0),
      content: [{ type: "text", text }],
      status: { type: "complete", reason: "stop" },
      metadata: { unstable_state: null, unstable_annotations: [], unstable_data: [], steps: [], custom: {} },
    }),
    [text],
  );
  return (
    <MessageProvider message={message} index={0}>
      <PartByIndexProvider index={0}>
        <MarkdownText />
      </PartByIndexProvider>
    </MessageProvider>
  );
}
