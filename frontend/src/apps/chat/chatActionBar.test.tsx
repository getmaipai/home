import { afterEach, describe, expect, spyOn, test } from "bun:test";
import type { ThreadMessage } from "@assistant-ui/react";
import { createChatFeedbackAdapter } from "@/apps/chat/chatActionBar";
import { api } from "@/lib/api";

afterEach(() => {
  /* spies are restored inline */
});

function message(turnId?: string): ThreadMessage {
  return { id: "m1", role: "assistant", metadata: { custom: turnId ? { turnId } : {} } } as unknown as ThreadMessage;
}

describe("createChatFeedbackAdapter", () => {
  test("positive and negative ratings go to the turn's feedback endpoint as up and down", () => {
    const submit = spyOn(api, "submitConversationFeedback").mockResolvedValue({} as never);
    try {
      const adapter = createChatFeedbackAdapter();
      adapter.submit({ message: message("turn-abc123"), type: "positive" });
      adapter.submit({ message: message("turn-abc123"), type: "negative" });
      expect(submit).toHaveBeenNthCalledWith(1, "turn-abc123", "up");
      expect(submit).toHaveBeenNthCalledWith(2, "turn-abc123", "down");
    } finally {
      submit.mockRestore();
    }
  });

  test("a message without a turn id sends nothing", () => {
    const submit = spyOn(api, "submitConversationFeedback").mockResolvedValue({} as never);
    try {
      createChatFeedbackAdapter().submit({ message: message(), type: "positive" });
      expect(submit).not.toHaveBeenCalled();
    } finally {
      submit.mockRestore();
    }
  });
});
