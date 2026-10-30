import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { afterEach, describe, expect, test } from "bun:test";
import { useState } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react";
import { ChatThread } from "@/apps/chat/ChatThread";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import HeaderSearch from "@maipai/ui/src/dashboard/layouts/full/vertical/header/HeaderSearch";

const NOOP: ChatModelAdapter = { run: async function* () { /* nothing */ } };

let setKey: (key: string) => void = () => {};
function Harness({ children }: { children?: React.ReactNode }) {
  const [focusKey, setFocusKey] = useState("a");
  setKey = setFocusKey;
  const runtime = useLocalRuntime(NOOP, { initialMessages: [] });
  return (
    <MemoryRouter><AssistantRuntimeProvider runtime={runtime}>
      <Button type="button" data-testid="rail-chat">Chat</Button>
      <Input data-testid="rename" />
      {children}
      <ChatThread focusKey={focusKey} />
    </AssistantRuntimeProvider></MemoryRouter>
  );
}

const composer = (container: HTMLElement) => container.querySelector("textarea.aui-composer-input") as HTMLTextAreaElement;

afterEach(cleanup);

describe("CHAT-FOCUS-01 composer focus", () => {
  test("the composer has focus on arrival", async () => {
    const view = renderWithQueryClient(<Harness />);
    await waitFor(() => expect(document.activeElement).toBe(composer(view.container)));
  });

  test("clicking Chat again (a new entry key) moves focus from the rail back to the composer", async () => {
    const view = renderWithQueryClient(<Harness />);
    await waitFor(() => expect(document.activeElement).toBe(composer(view.container)));
    (view.getByTestId("rail-chat") as HTMLButtonElement).focus();
    expect(document.activeElement).toBe(view.getByTestId("rail-chat"));
    act(() => setKey("b"));
    await waitFor(() => expect(document.activeElement).toBe(composer(view.container)));
  });

  test("it does not take focus from another field the person is typing in", async () => {
    const view = renderWithQueryClient(<Harness />);
    await waitFor(() => expect(document.activeElement).toBe(composer(view.container)));
    (view.getByTestId("rename") as HTMLInputElement).focus();
    act(() => setKey("b"));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(document.activeElement).toBe(view.getByTestId("rename"));
  });

  test("closing a menu opened from the composer returns focus to the composer", async () => {
    const view = renderWithQueryClient(<Harness />);
    await waitFor(() => expect(document.activeElement).toBe(composer(view.container)));
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.appendChild(menu);
    (view.getByTestId("rail-chat") as HTMLButtonElement).focus();
    document.body.focus();
    (document.activeElement as HTMLElement | null)?.blur();
    await act(async () => { menu.remove(); await new Promise((resolve) => setTimeout(resolve, 150)); });
    expect(document.activeElement).toBe(composer(view.container));
  });
});

describe("header search focus", () => {
  const input = () => document.querySelector("input[role=\"combobox\"]") as HTMLInputElement | null;
  const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 150)); });

  test("the box has focus on open, on reopen, and from Ctrl+K", async () => {
    const view = render(<MemoryRouter><HeaderSearch /></MemoryRouter>);
    fireEvent.click(view.getByLabelText("Search"));
    await settle();
    expect(document.activeElement).toBe(input());
    fireEvent.change(input()!, { target: { value: "old" } });
    fireEvent.keyDown(input()!, { key: "Escape" });
    await settle();
    expect(input()).toBeNull();
    fireEvent.click(view.getByLabelText("Search"));
    await settle();
    expect(document.activeElement).toBe(input());
    expect(input()!.value).toBe("");
    fireEvent.keyDown(input()!, { key: "Escape" });
    await settle();
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    await settle();
    expect(document.activeElement).toBe(input());
  });
});
