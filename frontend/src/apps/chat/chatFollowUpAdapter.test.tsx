import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter, type ThreadMessage } from "@assistant-ui/react";
import { ChatThread } from "@/apps/chat/ChatThread";
import { createChatFollowUpAdapter } from "@/apps/chat/chatFollowUpAdapter";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { FakeAudioContext } from "../../../tests/fakeAudioContext";

// ELEMENTS-ADOPT-02 slice 3: assistant-ui asks for follow-ups once a reply
// has finished; the adapter asks the hub for that turn's, and the kit
// Thread draws them in its own follow-up row.
const realFetch = globalThis.fetch;
let asked: string[] = [];
let answer: () => Promise<Response> = () => Promise.resolve(Response.json({ follow_ups: ["When does it close?", "Is there parking?"] }));
beforeEach(() => {
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeAudioContext;
  asked = [];
  answer = () => Promise.resolve(Response.json({ follow_ups: ["When does it close?", "Is there parking?"] }));
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/follow-ups")) {
      asked.push(url);
      return answer();
    }
    return Promise.resolve(Response.json({}));
  }) as unknown as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

function reply(turnId: string | undefined, status: "complete" | "running" = "complete"): ThreadMessage {
  return { id: "m2", role: "assistant", content: [{ type: "text", text: "It opens at nine." }], status: status === "complete" ? { type: "complete", reason: "stop" } : { type: "running" }, metadata: { custom: turnId ? { turnId } : {} } } as unknown as ThreadMessage;
}

async function generate(adapter: ReturnType<typeof createChatFollowUpAdapter>, messages: ThreadMessage[]) {
  return await (adapter.generate({ messages, signal: new AbortController().signal } as never) as Promise<Array<{ prompt: string }>>);
}

describe("createChatFollowUpAdapter", () => {
  test("a finished reply with a turn id asks the hub and offers its questions", async () => {
    const out = await generate(createChatFollowUpAdapter(() => false), [reply("turn-follow1")]);
    expect(out).toEqual([{ prompt: "When does it close?" }, { prompt: "Is there parking?" }]);
    expect(asked[0]).toContain("/api/conversations/turns/turn-follow1/follow-ups");
  });

  test("Incognito, a reply still running, or no turn id: no request and none offered", async () => {
    expect(await generate(createChatFollowUpAdapter(() => true), [reply("turn-follow2")])).toEqual([]);
    expect(await generate(createChatFollowUpAdapter(() => false), [reply("turn-follow3", "running")])).toEqual([]);
    expect(await generate(createChatFollowUpAdapter(() => false), [reply(undefined)])).toEqual([]);
    expect(asked).toEqual([]);
  });

  test("fail-quiet: a hub error offers none", async () => {
    answer = () => Promise.resolve(new Response("down", { status: 503 }));
    expect(await generate(createChatFollowUpAdapter(() => false), [reply("turn-follow4")])).toEqual([]);
  });
});

describe("follow-ups in the thread", () => {
  test("after a reply finishes, the kit Thread draws the hub's follow-ups as chips that send", async () => {
    const MODEL: ChatModelAdapter = {
      run: async function* () {
        yield { content: [{ type: "text", text: "It opens at nine." }], metadata: { custom: { turnId: "turn-followlive" } } };
      },
    };
    let runtimeRef: ReturnType<typeof useLocalRuntime> | undefined;
    function Harness() {
      const runtime = useLocalRuntime(MODEL, { adapters: { suggestion: createChatFollowUpAdapter(() => false) } });
      runtimeRef = runtime;
      return <AssistantRuntimeProvider runtime={runtime}><ChatThread /></AssistantRuntimeProvider>;
    }
    const view = renderWithQueryClient(<MemoryRouter><Harness /></MemoryRouter>);
    act(() => runtimeRef!.thread.composer.setText("When does the library open?"));
    act(() => runtimeRef!.thread.composer.send());
    await waitFor(() => expect(view.getByRole("button", { name: "When does it close?" })).toBeTruthy());
    expect(view.getByRole("button", { name: "Is there parking?" })).toBeTruthy();
    // The reply itself stays on screen beside its follow-ups.
    await waitFor(() => expect(view.container.textContent).toContain("It opens at nine."));
  });
});
