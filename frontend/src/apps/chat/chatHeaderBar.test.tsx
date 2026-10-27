import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { Button } from "@maipai/ui/src/ui/button";
import { MemoryRouter, useLocation } from "react-router-dom";
import { useState } from "react";
import * as avatarHookReal from "@/apps/chat/useCompanionAvatar";
const avatarHookSnapshot = { ...avatarHookReal };
// mock.module outlives this file; put the real modules back for the files that run after it.
afterAll(() => {
  mock.module("@/apps/chat/useCompanionAvatar", () => avatarHookSnapshot);
});
let requestedIds: string[] = [];
mock.module("@/apps/chat/useCompanionAvatar", () => ({ ...avatarHookSnapshot, useCompanionStills: (ids: string[]) => { requestedIds = ids; return { sprout: "/sprout.png" }; } }));
import { ChatHeaderBar } from "@/apps/chat/chatHeaderBar";
import { ChatHeaderDataProvider, useSetChatHeaderData, type ChatHeaderData } from "@/apps/chat/chatHeaderData";

afterEach(cleanup);

function TestBridge({ data }: { data: ChatHeaderData | null }) {
  useSetChatHeaderData(data);
  return null;
}

function RouteProbe() {
  return <output data-testid="route-path">{useLocation().pathname}</output>;
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

function renderBar(data: ChatHeaderData | null, phoneRow = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <MemoryRouter><ChatHeaderDataProvider>
          <TestBridge data={data} />
          <ChatHeaderBar phoneRow={phoneRow} />
        </ChatHeaderDataProvider></MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

function baseData(overrides: Partial<ChatHeaderData> = {}): ChatHeaderData {
  return {
    title: "What's 2 plus 2?",
    ttsAvailable: false,
    autoReadReplies: false,
    onAutoReadRepliesChange: () => {},
    onRename: async () => {},
    onDelete: async () => {},
    pinnable: true,
    pinned: false,
    onPinChange: async () => {},
    onArchive: async () => {},
    companionId: null,
    companions: [],
    onCompanionChange: async () => {},
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

  test("a new chat with no companion yet shows the person's default companion", async () => {
    requestedIds = [];
    const view = renderBar(baseData({ companionId: null, defaultCompanionId: "sprout", companions: [{ id: "sprout", name: "Sprout" }] }));
    expect(await view.findByText("Sprout")).toBeVisible();
    expect(requestedIds).toContain("sprout");
    expect(view.container.querySelector("video")).toBeNull();
    expect(view.container.querySelector('img[src="/sprout.png"]')).toBeNull();
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
  // RAIL-01 (owner's layout, 2026-10-06): on desktop the title is a
  // 36px control in the 52px conversation header (the spec's 32 to 36px
  // header targets) that truncates; the phone row keeps the 48px floor.
  test("the desktop title is a 36 px control that truncates its text", async () => {
    const view = renderBar(baseData({ title: "What's 2 plus 2?" }));
    const title = (await view.findByText("What's 2 plus 2?")).closest("button")!;
    const layoutClasses = title.className.split(" relative before:").at(0) ?? "";
    expect(layoutClasses.split(" ")).toContain("h-9");
    expect(layoutClasses).toContain("min-w-0");
    expect(layoutClasses).toContain("max-w-full");
    expect(layoutClasses.split(" ")).not.toContain("shrink-0");
    expect(title.querySelector("span")?.className).toContain("min-w-0");
    expect(title.querySelector("span")?.className).toContain("truncate");
    expect(title.className).not.toContain("max-w-64");
  });

  test("the phone title keeps a 48 px target while its text can truncate", async () => {
    for (const title of ["What's 2 plus 2?", ""]) {
      const view = renderBar(baseData({ title }), true);
      const button = (await view.findByText(title || "New Chat")).closest("button")!;
      const layoutClasses = button.className.split(" relative before:").at(0) ?? "";
      expect(layoutClasses).toContain("min-w-12");
      expect(layoutClasses).toContain("h-12");
      expect(layoutClasses).toContain("flex-1");
      expect(layoutClasses.split(" ")).not.toContain("shrink-0");
      expect(button.querySelector("span")?.className).toContain("min-w-0 truncate");
      view.unmount();
    }
  });

  test("the activity slot renders at the right of the header, before the conversation actions", async () => {
    const view = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <TooltipProvider><MemoryRouter>
          <ChatHeaderDataProvider>
            <TestBridge data={baseData({ title: "Plans" })} />
            <ChatHeaderBar trailing={<Button type="button">Activity</Button>} />
          </ChatHeaderDataProvider>
        </MemoryRouter></TooltipProvider>
      </QueryClientProvider>,
    );
    const activity = await view.findByRole("button", { name: "Activity" });
    const actions = view.getByRole("button", { name: "Conversation actions" });
    expect(activity.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  test("Read replies aloud is a checked menu toggle only when TTS is available", async () => {
    const onAutoReadRepliesChange = mock(() => {});
    const view = renderBar(baseData({ ttsAvailable: true, autoReadReplies: true, onAutoReadRepliesChange }));
    await openActionsMenu(view);
    const toggle = await view.findByRole("menuitemcheckbox", { name: "Read replies aloud" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    expect(onAutoReadRepliesChange).toHaveBeenCalledWith(false);
  });

  test("hides Read replies aloud when TTS is unavailable", async () => {
    const view = renderBar(baseData({ ttsAvailable: false }));
    await openActionsMenu(view);
    expect(view.queryByText("Read replies aloud")).toBeNull();
  });

  // Owner 2026-10-17: the header menu was large and different from the
  // history column's row menu. It now carries the row menu's items in the
  // row menu's order (Rename, Pin or Unpin, Archive, Delete last of the
  // shared group), compact, with the header's own item after a separator.
  const itemLabels = () =>
    Array.from(document.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]')).map((el) => el.textContent?.trim());

  test("the menu holds the row menu's items in the row menu's order, Delete last of them", async () => {
    const view = renderBar(baseData());
    await openActionsMenu(view);
    await view.findByText("Rename");
    expect(itemLabels()).toEqual(["Rename", "Pin", "Archive", "Delete"]);
    expect(view.queryByText("Start temporary chat")).toBeNull();
    expect(view.queryByText("Share")).toBeNull();
  });

  test("a pinned conversation offers Unpin, and Pin calls onPinChange", async () => {
    const onPinChange = mock(async () => {});
    const view = renderBar(baseData({ pinned: true, onPinChange }));
    await openActionsMenu(view);
    fireEvent.click(await view.findByText("Unpin"));
    await waitFor(() => expect(onPinChange).toHaveBeenCalledWith(false));
  });

  test("a temporary chat has no Pin (nothing is kept)", async () => {
    const view = renderBar(baseData({ pinnable: false }));
    await openActionsMenu(view);
    await view.findByText("Rename");
    expect(itemLabels()).toEqual(["Rename", "Archive", "Delete"]);
  });

  test("Archive calls onArchive", async () => {
    const onArchive = mock(async () => {});
    const view = renderBar(baseData({ onArchive }));
    await openActionsMenu(view);
    fireEvent.click(await view.findByText("Archive"));
    await waitFor(() => expect(onArchive).toHaveBeenCalled());
  });

  test("Read replies aloud is the header's own item, after the shared group", async () => {
    const view = renderBar(baseData({ ttsAvailable: true }));
    await openActionsMenu(view);
    await view.findByText("Rename");
    expect(itemLabels()).toEqual(["Rename", "Pin", "Archive", "Delete", "Read replies aloud"]);
  });

  test("the menu is the kit's compact density, with the destructive item styled by the kit variant and no className", async () => {
    const view = renderBar(baseData());
    await openActionsMenu(view);
    await view.findByText("Rename");
    expect(document.querySelector('[data-slot="dropdown-menu-content"]')?.getAttribute("data-density")).toBe("compact");
    expect(view.getByText("Delete").closest('[role="menuitem"]')?.getAttribute("data-variant")).toBe("destructive");
  });

  describe("with the companion preview header (DOTS-CHAT-01)", () => {
    function renderShells(data: ChatHeaderData, props: { onMenu?: () => void; onHistory?: () => void; onCall?: () => void } = {}) {
      const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      return render(
        <QueryClientProvider client={client}>
          <TooltipProvider>
          <MemoryRouter><ChatHeaderDataProvider>
              <TestBridge data={data} />
              <ChatHeaderBar shells menuExpanded={false} menuControls="next-chat-threads" {...props} />
          </ChatHeaderDataProvider></MemoryRouter>
          </TooltipProvider>
        </QueryClientProvider>,
      );
    }

    test("an unpictured companion gets a seeded face in the picker, not a letter", async () => {
      const view = renderShells(baseData({ companionId: "unpictured", companions: [
        { id: "portrait", name: "Portrait", portrait: "hc-one/v3" },
        { id: "unpictured", name: "Unpictured" },
      ] }));
      const picker = await view.findByRole("button", { name: "Change companion" });
      act(() => { fireEvent.pointerDown(picker, { button: 0, ctrlKey: false, pointerId: 1 }); fireEvent.click(picker); });
      // The menu draws in a portal and a loaded image is swapped in by the browser, so assert the seeded face (the kit's fallback) is there for a companion with no picture; the portrait choice itself is tested in companionImage.test.ts.
      expect(document.body.querySelector('[role="menuitemradio"] [data-slot="avatar"]')).toBeTruthy();
    });

    test("shows the companion's name over its character, not the conversation title row", async () => {
      const view = renderShells(baseData());
      expect(await view.findByText("MaiPai")).toBeVisible();
      expect(view.container.querySelector("video")).toBeNull();
      expect(view.container.querySelector("[data-chat-header-bar]")).toBeNull();
    });

    test("falls back to MaiPai with no animated companion", async () => {
      const view = renderShells(baseData());
      expect(await view.findByText("MaiPai")).toBeVisible();
    });

    test("the menu button calls onMenu, and Call shows only when onCall is given", async () => {
      const onMenu = mock(() => {});
      const onCall = mock(() => {});
      const view = renderShells(baseData(), { onMenu });
      fireEvent.click(await view.findByRole("button", { name: "Open menu" }));
      expect(onMenu).toHaveBeenCalledTimes(1);
      expect(view.queryByRole("button", { name: "Call MaiPai" })).toBeNull();
      view.unmount();
      const second = renderShells(baseData(), { onCall });
      fireEvent.click(await second.findByRole("button", { name: "Call MaiPai" }));
      expect(onCall).toHaveBeenCalledTimes(1);
    });

    test("onHistory puts Chat history in the actions menu and draws no second menu button", async () => {
      const onHistory = mock(() => {});
      const view = renderShells(baseData(), { onHistory });
      expect(view.queryByRole("button", { name: "Open menu" })).toBeNull();
      await openActionsMenu(view);
      fireEvent.click(await view.findByRole("menuitem", { name: "Chat history" }));
      expect(onHistory).toHaveBeenCalledTimes(1);
    });

    test("the stored chat offers companion radio choices and saves a selection", async () => {
      const onCompanionChange = mock(async (_id: string | null) => {});
      const view = renderShells(baseData({ companionId: "lively-child", companions: [{ id: "lively-child", name: "Sprout" }, { id: "lively-adult", name: "Rivet" }], onCompanionChange }));
      const picker = await view.findByRole("button", { name: "Change companion" });
      act(() => {
        fireEvent.pointerDown(picker, { button: 0, ctrlKey: false, pointerId: 1 });
        fireEvent.click(picker);
      });
      expect((await view.findByRole("menuitemradio", { name: "Sprout" })).getAttribute("aria-checked")).toBe("true");
      fireEvent.click(view.getByRole("menuitemradio", { name: "Rivet" }));
      await waitFor(() => expect(onCompanionChange).toHaveBeenCalledWith("lively-adult"));
    });

    test("includes MaiPai once, the companion tagline descriptions, intro, and search label", async () => {
      const view = renderShells(baseData({ companions: [{ id: "sprout", name: "Sprout", tagline: "A gentle guide." }, { id: "default", name: "Old Default", tagline: "No character" }, { id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }, { id: "d", name: "D" }] }));
      act(() => { fireEvent.pointerDown(view.getByRole("button", { name: "Change companion" }), { button: 0, ctrlKey: false, pointerId: 1 }); fireEvent.click(view.getByRole("button", { name: "Change companion" })); });
      expect(await view.findAllByRole("menuitemradio", { name: /MaiPai/ })).toHaveLength(1);
      expect(view.getByText("A gentle guide.")).toBeVisible();
      expect(view.getByText("Earlier messages keep their original speaker.")).toBeVisible();
      expect(view.getByRole("textbox", { name: "Search companions" })).toBeVisible();
    });

    test("keeps a stored null companion unselected instead of implying the person's current default", async () => {
      const view = renderShells(baseData({ conversationExists: true, companionId: null, defaultCompanionId: "sprout", companions: [{ id: "sprout", name: "Sprout" }] }));
      act(() => { fireEvent.pointerDown(view.getByRole("button", { name: "Change companion" }), { button: 0, ctrlKey: false, pointerId: 1 }); fireEvent.click(view.getByRole("button", { name: "Change companion" })); });
      expect(await view.findByRole("menuitemradio", { name: /MaiPai/ })).toHaveAttribute("aria-checked", "false");
      expect(view.getByRole("menuitemradio", { name: "Sprout" })).toHaveAttribute("aria-checked", "false");
    });

    test("shows a switch notice, keeps it through the existing reply, then clears on a new reply", async () => {
      const onCompanionChange = mock(async () => {});
      const data = baseData({ companionId: "lively-child", assistantReplySignal: undefined, companions: [{ id: "lively-child", name: "Sprout" }, { id: "lively-adult", name: "Rivet" }], onCompanionChange });
      const view = renderShells(data);
      act(() => { fireEvent.pointerDown(view.getByRole("button", { name: "Change companion" }), { button: 0, ctrlKey: false, pointerId: 1 }); fireEvent.click(view.getByRole("button", { name: "Change companion" })); });
      fireEvent.click(await view.findByRole("menuitemradio", { name: "Rivet" }));
      expect(await view.findByRole("status")).toHaveTextContent("Rivet will answer next.");
      view.rerender(<QueryClientProvider client={new QueryClient()}><TooltipProvider><MemoryRouter><ChatHeaderDataProvider><TestBridge data={baseData({ companionId: "lively-adult", assistantReplySignal: "reply-2", companions: [{ id: "lively-child", name: "Sprout" }, { id: "lively-adult", name: "Rivet" }], onCompanionChange })} /><ChatHeaderBar shells /></ChatHeaderDataProvider></MemoryRouter></TooltipProvider></QueryClientProvider>);
      await waitFor(() => expect(view.queryByRole("status")).toBeNull());
    });

    test("provides management and create links and preserves a composer draft across the switch callback", async () => {
      let updateSelected: (id: string) => void = () => {};
      const onCompanionChange = mock(async (id: string | null) => { if (id) updateSelected(id); });
      function Harness() {
        const [draft, setDraft] = useState("unsent note");
        const [selected, setSelected] = useState("lively-child");
        updateSelected = setSelected;
        return <><RouteProbe /><textarea aria-label="Message" value={draft} onChange={(event) => setDraft(event.currentTarget.value)} /><TestBridge data={baseData({ companionId: selected, companions: [{ id: "lively-child", name: "Sprout" }, { id: "lively-adult", name: "Rivet" }], onCompanionChange })} /><ChatHeaderBar shells /></>;
      }
      const client = new QueryClient();
      const view = render(<QueryClientProvider client={client}><TooltipProvider><MemoryRouter><ChatHeaderDataProvider><Harness /></ChatHeaderDataProvider></MemoryRouter></TooltipProvider></QueryClientProvider>);
      act(() => { fireEvent.pointerDown(view.getByRole("button", { name: "Change companion" }), { button: 0, ctrlKey: false, pointerId: 1 }); fireEvent.click(view.getByRole("button", { name: "Change companion" })); });
      expect(await view.findByText("Manage companions")).toBeVisible();
      expect(view.getByText("Create a companion")).toBeVisible();
      fireEvent.click(view.getByRole("menuitem", { name: "Manage companions" }));
      await waitFor(() => expect(view.getByTestId("route-path")).toHaveTextContent("/companions"));
      act(() => { fireEvent.pointerDown(view.getByRole("button", { name: "Change companion" }), { button: 0, ctrlKey: false, pointerId: 1 }); fireEvent.click(view.getByRole("button", { name: "Change companion" })); });
      fireEvent.click(await view.findByRole("menuitem", { name: "Create a companion" }));
      await waitFor(() => expect(view.getByTestId("route-path")).toHaveTextContent("/companions/start"));
      act(() => { fireEvent.pointerDown(view.getByRole("button", { name: "Change companion" }), { button: 0, ctrlKey: false, pointerId: 1 }); fireEvent.click(view.getByRole("button", { name: "Change companion" })); });
      fireEvent.click(await view.findByRole("menuitemradio", { name: "Rivet" }));
      await waitFor(() => expect(onCompanionChange).toHaveBeenCalled());
      expect(view.getByRole("textbox", { name: "Message" })).toHaveValue("unsent note");
    });

    test("temporary chats hide the companion choice", async () => {
      const view = renderShells(baseData({ pinnable: false, companions: [{ id: "lively-child", name: "Sprout" }] }));
      expect(view.queryByRole("button", { name: "Change companion" })).toBeNull();
      expect(view.queryByRole("menuitemradio", { name: "Sprout" })).toBeNull();
    });

    test("Rename opens a dialog that saves on Enter and closes on Escape; the other actions stay in the menu", async () => {
      const onRename = mock(async (_title: string) => {});
      const view = renderShells(baseData({ onRename, ttsAvailable: true }));
      await openActionsMenu(view);
      for (const label of ["Pin", "Archive", "Delete"]) expect(await view.findByRole("menuitem", { name: label })).toBeTruthy();
      expect(view.getByRole("menuitemcheckbox", { name: "Read replies aloud" })).toBeTruthy();
      fireEvent.click(view.getByRole("menuitem", { name: "Rename" }));
      const input = await view.findByRole("textbox", { name: "Rename conversation" });
      fireEvent.change(input, { target: { value: "Dinner ideas" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(onRename).toHaveBeenCalledWith("Dinner ideas"));
      await waitFor(() => expect(view.queryByLabelText("Rename conversation")).toBeNull());
    });
  });
});
