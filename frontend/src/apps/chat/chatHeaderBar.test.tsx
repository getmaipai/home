import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { ChatHeaderBar } from "@/apps/chat/chatHeaderBar";
import { ChatHeaderDataProvider, useSetChatHeaderData, type ChatHeaderData } from "@/apps/chat/chatHeaderData";

afterEach(cleanup);

function TestBridge({ data }: { data: ChatHeaderData | null }) {
  useSetChatHeaderData(data);
  return null;
}

// chatMemoryChip.test.tsx's own established fix: Radix's DropdownMenu
// trigger opens on pointerdown, not a plain click - happy-dom's click
// alone leaves it closed.
async function openActionsMenu(view: { findByRole: (role: string, opts: { name: string }) => Promise<HTMLElement> }): Promise<void> {
  const trigger = await view.findByRole("button", { name: "Conversation actions" });
  act(() => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1 });
    fireEvent.click(trigger);
  });
}

function renderBar(data: ChatHeaderData | null) {
  return render(
    <TooltipProvider>
      <ChatHeaderDataProvider>
        <TestBridge data={data} />
        <ChatHeaderBar />
      </ChatHeaderDataProvider>
    </TooltipProvider>,
  );
}

function baseData(overrides: Partial<ChatHeaderData> = {}): ChatHeaderData {
  return {
    title: "What's 2 plus 2?",
    onRename: async () => {},
    onDelete: async () => {},
    ...overrides,
  };
}

describe("ChatHeaderBar", () => {
  // CHAT-HEADER-01 acceptance: "the header is absent on non-chat
  // pages" - a non-chat page never mounts a bridge at all, so this is
  // the shape that absence actually takes: no data, nothing rendered.
  test("renders nothing with no data - the non-chat-page shape", () => {
    const view = renderBar(null);
    expect(view.container).toBeEmptyDOMElement();
  });

  test("renders the conversation's own title", async () => {
    const view = renderBar(baseData({ title: "What's 2 plus 2?" }));
    expect(await view.findByText("What's 2 plus 2?")).toBeVisible();
  });

  // CHAT-HEADER-03: the title used to cap at a fixed max-w-64 no matter
  // how much room the header actually had - happy-dom computes no real
  // layout, so this can only prove the classes that make the title
  // grow into the header's free space and truncate only once it must
  // are present, not the actual pixel behavior (that's the captures at
  // 1440/390 the item's own exit line asks for).
  test("the title grows to fill the header's free space (flex-1, min-w-0, truncate - no fixed max-w-64)", async () => {
    const view = renderBar(baseData({ title: "What's 2 plus 2?" }));
    const title = await view.findByText("What's 2 plus 2?");
    expect(title.className).toContain("flex-1");
    expect(title.className).toContain("min-w-0");
    expect(title.className).toContain("truncate");
    expect(title.className).not.toContain("max-w-64");
  });

  // A review (2026-09-23): the rename Input kept the old fixed
  // max-w-64 while the display-mode title grew via flex-1, so opening
  // rename on a wide header with a long title would visibly snap the
  // header's own width down to 256px and back on commit/cancel/blur.
  test("the rename input grows the same way the title does, no layout snap on entering rename", async () => {
    const view = renderBar(baseData({ title: "Old title" }));
    fireEvent.click(await view.findByText("Old title"));
    const input = await view.findByLabelText("Rename conversation");
    expect(input.className).toContain("flex-1");
    expect(input.className).toContain("min-w-0");
    expect(input.className).not.toContain("max-w-64");
  });

  // Acceptance: "an untitled conversation shows the same placeholder
  // the thread list uses, never a blank bar."
  test("an untitled conversation shows the New Chat placeholder, never a blank bar", async () => {
    const view = renderBar(baseData({ title: "" }));
    expect(await view.findByText("New Chat")).toBeVisible();
  });

  test("clicking the title renames it - Enter commits through onRename", async () => {
    const onRename = mock(async () => {});
    const view = renderBar(baseData({ title: "Old title", onRename }));
    fireEvent.click(await view.findByText("Old title"));
    const input = (await view.findByLabelText("Rename conversation")) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "New title" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onRename).toHaveBeenCalledWith("New title"));
  });

  test("Escape cancels a rename without calling onRename", async () => {
    const onRename = mock(async () => {});
    const view = renderBar(baseData({ title: "Old title", onRename }));
    fireEvent.click(await view.findByText("Old title"));
    const input = await view.findByLabelText("Rename conversation");
    fireEvent.change(input, { target: { value: "Something else" } });
    fireEvent.keyDown(input, { key: "Escape" });
    await view.findByText("Old title");
    expect(onRename).not.toHaveBeenCalled();
  });

  test("the menu's actions each work: rename and delete", async () => {
    const onDelete = mock(async () => {});
    const view = renderBar(baseData({ onDelete }));
    await openActionsMenu(view);
    fireEvent.click(await view.findByText("Rename"));
    await view.findByLabelText("Rename conversation");

    fireEvent.keyDown(await view.findByLabelText("Rename conversation"), { key: "Escape" });
    await openActionsMenu(view);
    fireEvent.click(await view.findByText("Delete"));
    await waitFor(() => expect(onDelete).toHaveBeenCalled());
  });

  // CHAT-FIND-0923-03: Jesse's own live finding - the menu held Rename,
  // Start temporary chat, Share and Delete; a conversation's own
  // actions menu holds only its own actions, the same set the thread
  // row's own three-dots menu shows (Rename/Archive/Delete - Archive
  // itself left out here too, since the row's own copy throws by
  // deliberate design today, see chatThreadListAdapter.ts; CONV-
  // ARCHIVE-01 gives both a real one from one definition once the
  // record supports it). Temporary-chat's one real home is CHAT-LIST-
  // 01's own button beside New Thread now, not a conversation action at
  // all (it starts a NEW one).
  test("the menu never shows Start temporary chat, Share, or Archive - only this conversation's own actions", async () => {
    const view = renderBar(baseData());
    await openActionsMenu(view);
    await view.findByText("Rename");
    await view.findByText("Delete");
    expect(view.queryByText("Start temporary chat")).toBeNull();
    expect(view.queryByText("Share")).toBeNull();
    expect(view.queryByText("Archive")).toBeNull();
  });
});
