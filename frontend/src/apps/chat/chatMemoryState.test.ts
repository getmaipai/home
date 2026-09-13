import { describe, expect, test, mock } from "bun:test";
import { renderHook, waitFor } from "@testing-library/react";
import { deriveMemoryStatus, useMemoryState, useMemoryStatusPoll } from "@/apps/chat/chatMemoryState";

describe("deriveMemoryStatus", () => {
  test("real memory ids always win, regardless of source or judge status", () => {
    expect(deriveMemoryStatus({ source: "plugin", judgeStatus: null, memoryIds: ["mem-1"] })).toBe("saved");
    expect(deriveMemoryStatus({ source: "model", judgeStatus: "failed", memoryIds: ["mem-1"] })).toBe("saved");
  });

  test("a failed judge, no memory ids, is 'failed'", () => {
    expect(deriveMemoryStatus({ source: "model", judgeStatus: "failed", memoryIds: [] })).toBe("failed");
  });

  test("a done judge with nothing worth remembering is 'not_saved'", () => {
    expect(deriveMemoryStatus({ source: "model", judgeStatus: "done", memoryIds: [] })).toBe("not_saved");
  });

  // The judge's own queue query (memoryJudge.ts) only ever selects
  // `source: "model"` turns - a plugin/command/safety-refusal turn's
  // judge_status stays null forever, which must read as "not_saved," not
  // an eternal "pending."
  test("a non-model turn (never queued for judging) is 'not_saved', not 'pending', even with a null judge status", () => {
    expect(deriveMemoryStatus({ source: "plugin", judgeStatus: null, memoryIds: [] })).toBe("not_saved");
    expect(deriveMemoryStatus({ source: "command", judgeStatus: undefined, memoryIds: [] })).toBe("not_saved");
  });

  test("a model turn with no judge status yet, no memory ids, is 'pending'", () => {
    expect(deriveMemoryStatus({ source: "model", judgeStatus: null, memoryIds: [] })).toBe("pending");
    // A live reply's metadata carries no judgeStatus field at all
    // (chatModelAdapter.ts, deliberately) - undefined reads the same.
    expect(deriveMemoryStatus({ source: "model", judgeStatus: undefined, memoryIds: [] })).toBe("pending");
  });
});

function stubConversationTurns(rowsPerCall: Array<Array<{ id: string; source: string; judgeStatus: string | null; memory_ids: string[] }>>): { restore: () => void; callCount: () => number } {
  const original = globalThis.fetch;
  let call = 0;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (!url.includes("/turns")) return Promise.reject(new Error(`unstubbed fetch: ${url}`));
    const rows = rowsPerCall[Math.min(call, rowsPerCall.length - 1)]!;
    call++;
    return Promise.resolve(new Response(JSON.stringify(rows), { status: 200 }));
  }) as unknown as typeof fetch;
  return { restore: () => (globalThis.fetch = original), callCount: () => call };
}

describe("useMemoryStatusPoll", () => {
  test("never fetches when nothing is pending", async () => {
    const env = stubConversationTurns([[]]);
    try {
      renderHook(() => {
        useMemoryState("turn-idle", { conversationId: "conv-idle", source: "plugin", judgeStatus: null, memoryIds: [] });
        useMemoryStatusPoll("conv-idle");
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(env.callCount()).toBe(0);
    } finally {
      env.restore();
    }
  });

  // BACKLOG.md CHAT-20's own acceptance: "deferred judge save updates the
  // open message" without a reload - the poll is what makes that true.
  test("a pending turn resolves to 'saved' via the poll, without a reload", async () => {
    const env = stubConversationTurns([
      [{ id: "turn-poll-1", source: "model", judgeStatus: "done", memory_ids: ["mem-judged"] }],
    ]);
    try {
      const { result } = renderHook(() => {
        const state = useMemoryState("turn-poll-1", { conversationId: "conv-poll", source: "model", judgeStatus: null, memoryIds: [] });
        useMemoryStatusPoll("conv-poll");
        return state;
      });
      expect(result.current?.status).toBe("pending");
      await waitFor(() => expect(result.current?.status).toBe("saved"), { timeout: 8000, interval: 100 });
      expect(result.current?.memoryIds).toEqual(["mem-judged"]);
    } finally {
      env.restore();
    }
  }, 10000);

  test("stops polling once every turn in the conversation has resolved", async () => {
    const env = stubConversationTurns([
      [{ id: "turn-poll-2", source: "model", judgeStatus: "done", memory_ids: [] }],
    ]);
    try {
      const { result } = renderHook(() => {
        const state = useMemoryState("turn-poll-2", { conversationId: "conv-poll-2", source: "model", judgeStatus: null, memoryIds: [] });
        useMemoryStatusPoll("conv-poll-2");
        return state;
      });
      await waitFor(() => expect(result.current?.status).toBe("not_saved"), { timeout: 8000, interval: 100 });
      const countAfterResolved = env.callCount();
      await new Promise((resolve) => setTimeout(resolve, 6500));
      expect(env.callCount()).toBe(countAfterResolved); // no further ticks once nothing is pending
    } finally {
      env.restore();
    }
  }, 15000);
});
