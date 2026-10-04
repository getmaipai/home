import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { AssistantRuntimeProvider, useLocalRuntime, useRemoteThreadListRuntime, type ChatModelAdapter } from "@assistant-ui/react";
import { ThreadListRoot } from "@maipai/ui/src/elements/thread-list.aui";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { createChatThreadListAdapter } from "@/apps/chat/chatThreadListAdapter";
import { ChatListItems } from "@/apps/chat/chatListItems";

const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

const NEVER_RUNS: ChatModelAdapter = { async *run() { /* the list never starts a run */ } };

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const daysAgo = (d: number) => hoursAgo(d * 24);
function row(id: string, title: string | null, lastTurnAt: string, archived = false) {
  return { id, title, surface: "chat", created_at: lastTurnAt, last_turn_at: lastTurnAt, pinned: false, archived };
}

const useNeverRunsRuntime = () => useLocalRuntime(NEVER_RUNS);

function Harness({ search = "", contentMatchIds = null }: { search?: string; contentMatchIds?: ReadonlySet<string> | null }) {
  const runtime = useRemoteThreadListRuntime({
    runtimeHook: useNeverRunsRuntime,
    adapter: createChatThreadListAdapter("Juniper"),
  });
  return (
    <TooltipProvider>
      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadListRoot>
          <ChatListItems search={search} contentMatchIds={contentMatchIds} />
        </ThreadListRoot>
      </AssistantRuntimeProvider>
    </TooltipProvider>
  );
}

function serve(rows: ReturnType<typeof row>[], patches: Array<{ path: string; body: unknown }> = []) {
  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (init?.method === "PATCH") {
      patches.push({ path, body: JSON.parse(String(init.body)) });
      return Response.json({});
    }
    if (path.startsWith("/api/conversations")) return Response.json(rows);
    return Response.json({});
  }) as unknown as typeof fetch;
}

describe("ChatListItems", () => {
  test("groups chats by Today, Yesterday, Previous 7 days and Older, newest first, showing the model's titles", async () => {
    serve([
      row("conv-old", "Winter coat sizes", daysAgo(40)),
      row("conv-week", "Pasta night ideas", daysAgo(4)),
      row("conv-yday", "Fixing the garden gate", daysAgo(1)),
      row("conv-today", "Tomato plant care", hoursAgo(0.1)),
    ]);
    const view = render(<Harness />);
    await view.findByText("Tomato plant care");
    const labels = [...view.container.querySelectorAll('[data-slot="aui_thread-list-group-label"]')].map((el) => el.textContent);
    expect(labels).toEqual(["Today", "Yesterday", "Previous 7 days", "Older"]);
    const titles = [...view.container.querySelectorAll('[data-slot="aui_thread-list-item-title"]')].map((el) => el.textContent);
    expect(titles).toEqual(["Tomato plant care", "Fixing the garden gate", "Pasta night ideas", "Winter coat sizes"]);
  });

  test("an empty list says so and points at the way forward", async () => {
    serve([]);
    const view = render(<Harness />);
    expect(await view.findByText("No chats yet")).toBeVisible();
    expect(view.getByText("Start a new chat and it will show up here.")).toBeVisible();
  });

  test("search narrows by title; a search with no match says so", async () => {
    serve([row("conv-a", "Tomato plant care", hoursAgo(1)), row("conv-b", "Pasta night ideas", hoursAgo(2))]);
    const view = render(<Harness search="pasta" />);
    await view.findByText("Pasta night ideas");
    expect(view.queryByText("Tomato plant care")).toBeNull();
    view.rerender(<Harness search="zebra" />);
    expect(await view.findByText("No chats match “zebra”")).toBeVisible();
  });

  test("search also finds a chat by what was said in it, when the hub reports the match", async () => {
    serve([row("conv-a", "Tomato plant care", hoursAgo(1)), row("conv-b", "Weekend plans", hoursAgo(2))]);
    const view = render(<Harness search="sunscreen" contentMatchIds={new Set(["conv-b"])} />);
    await view.findByText("Weekend plans");
    expect(view.queryByText("Tomato plant care")).toBeNull();
  });

  test("archived chats leave the groups and live behind an Archived toggle, with Restore", async () => {
    const patches: Array<{ path: string; body: unknown }> = [];
    serve([row("conv-live", "Tomato plant care", hoursAgo(1)), row("conv-shelved", "Old trip notes", daysAgo(3), true)], patches);
    const view = render(<Harness />);
    await view.findByText("Tomato plant care");
    expect(view.queryByText("Old trip notes")).toBeNull();
    const toggle = view.getByRole("button", { name: /Archived \(1\)/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const shelved = (await view.findByText("Old trip notes")).closest('[data-slot="aui_thread-list-item"]') as HTMLElement;
    fireEvent.click(within(shelved).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(patches).toEqual([{ path: "/api/conversations/conv-shelved", body: { archived: false } }]));
    // Restored: it moves into the Previous 7 days group and the toggle goes away.
    await waitFor(() => expect(view.queryByRole("button", { name: /Archived/ })).toBeNull());
    expect(view.getByText("Old trip notes")).toBeVisible();
  });

  test("with nothing archived there is no Archived toggle", async () => {
    serve([row("conv-live", "Tomato plant care", hoursAgo(1))]);
    const view = render(<Harness />);
    await view.findByText("Tomato plant care");
    expect(view.queryByRole("button", { name: /Archived/ })).toBeNull();
  });
});
