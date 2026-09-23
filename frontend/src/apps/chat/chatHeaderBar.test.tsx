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
    onStartTemporary: () => {},
    temporaryAllowed: true,
    shareAllowed: false,
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

  test("the menu's actions each work: rename, temporary chat (allowed), and delete", async () => {
    const onDelete = mock(async () => {});
    const onStartTemporary = mock(() => {});
    const view = renderBar(baseData({ onDelete, onStartTemporary, temporaryAllowed: true }));
    await openActionsMenu(view);
    await view.findByText("Rename");
    expect(await view.findByText("Start temporary chat")).toBeVisible();
    fireEvent.click(await view.findByText("Start temporary chat"));
    expect(onStartTemporary).toHaveBeenCalled();

    await openActionsMenu(view);
    fireEvent.click(await view.findByText("Delete"));
    await waitFor(() => expect(onDelete).toHaveBeenCalled());
  });

  test("Start temporary chat is absent when the actor is a minor", async () => {
    const view = renderBar(baseData({ temporaryAllowed: false }));
    await openActionsMenu(view);
    await view.findByText("Rename");
    expect(view.queryByText("Start temporary chat")).toBeNull();
  });

  // Share behind the flag (SHARE-CONV-01: no share-creation route
  // exists yet) - present but disabled, never a real handler.
  test("Share is absent unless shareAllowed, and disabled even then", async () => {
    const withoutShare = renderBar(baseData({ shareAllowed: false }));
    await openActionsMenu(withoutShare);
    await withoutShare.findByText("Rename");
    expect(withoutShare.queryByText("Share")).toBeNull();
    withoutShare.unmount();

    const withShare = renderBar(baseData({ shareAllowed: true }));
    await openActionsMenu(withShare);
    const shareItem = await withShare.findByText("Share");
    expect(shareItem.closest('[data-slot="dropdown-menu-item"]')).toHaveAttribute("data-disabled");
  });
});
