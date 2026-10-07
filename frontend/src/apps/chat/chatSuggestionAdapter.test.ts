import { afterEach, describe, expect, test, mock, spyOn } from "bun:test";
import type { ThreadMessage } from "@assistant-ui/react";
import { createChatSuggestionAdapter } from "@/apps/chat/chatSuggestionAdapter";
import { api } from "@/lib/api";

afterEach(() => mock.restore());

function reply(turnId: string, status: "complete" | "running" = "complete"): ThreadMessage {
  return {
    id: `${turnId}-reply`,
    createdAt: new Date(),
    role: "assistant",
    content: [{ type: "text", text: "Here is the answer." }],
    status: status === "complete" ? { type: "complete", reason: "stop" } : { type: "running" },
    metadata: { unstable_state: null, unstable_annotations: [], unstable_data: [], steps: [], custom: { turnId } },
  } as unknown as ThreadMessage;
}

describe("createChatSuggestionAdapter", () => {
  test("loads prompts for the final completed persisted assistant turn", async () => {
    const fetch = spyOn(api, "followUpSuggestions").mockResolvedValue({ suggestions: [{ prompt: "What would change in winter?" }] });
    const suggestions = await createChatSuggestionAdapter().generate({ messages: [reply("turn-a")], signal: undefined });
    expect(fetch).toHaveBeenCalledWith("turn-a", undefined);
    expect(suggestions).toEqual([{ prompt: "What would change in winter?" }]);
  });

  test("does not request suggestions in Incognito", async () => {
    const fetch = spyOn(api, "followUpSuggestions");
    const suggestions = await createChatSuggestionAdapter(() => true).generate({ messages: [reply("turn-incognito")], signal: undefined });
    expect(fetch).not.toHaveBeenCalled();
    expect(suggestions).toEqual([]);
  });

  test("does not generate from an unfinished or non-final assistant message", async () => {
    const fetch = spyOn(api, "followUpSuggestions");
    const adapter = createChatSuggestionAdapter();
    expect(await adapter.generate({ messages: [reply("turn-live", "running")], signal: undefined })).toEqual([]);
    expect(await adapter.generate({ messages: [reply("turn-old"), { id: "user-next", role: "user", createdAt: new Date(), content: [], attachments: [], metadata: { unstable_state: null, unstable_annotations: [], unstable_data: [], steps: [], custom: {} } } as unknown as ThreadMessage], signal: undefined })).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  test("returns no suggestions when the endpoint fails", async () => {
    spyOn(api, "followUpSuggestions").mockRejectedValue(new Error("network error"));
    const suggestions = await createChatSuggestionAdapter().generate({ messages: [reply("turn-failed")], signal: undefined });
    expect(suggestions).toEqual([]);
  });
});
