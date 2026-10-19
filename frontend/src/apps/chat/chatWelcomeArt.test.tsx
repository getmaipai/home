import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react";

const NOOP: ChatModelAdapter = { run: async function* () { /* nothing to run */ } };
import { ChatWelcome } from "@/apps/chat/chatThreadSlots";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

function Harness() {
  const runtime = useLocalRuntime(NOOP);
  return <MemoryRouter><AssistantRuntimeProvider runtime={runtime}><ChatWelcome /></AssistantRuntimeProvider></MemoryRouter>;
}

afterEach(() => cleanup());

const ART = "img[src^='/chat-art/']";

describe("chat welcome art", () => {
  test("shows the picture while it loads", () => {
    const view = renderWithQueryClient(<Harness />);
    expect(view.container.querySelector(ART)).not.toBeNull();
    expect(view.container.querySelector("[data-slot='safe-image-fallback']")).toBeNull();
  });
  test("a picture that fails to load is replaced by the placeholder tile", () => {
    const view = renderWithQueryClient(<Harness />);
    const img = view.container.querySelector(ART)!;
    const alt = img.getAttribute("alt");
    fireEvent.error(img);
    expect(view.container.querySelector(ART)).toBeNull();
    const tile = view.container.querySelector("[data-slot='safe-image-fallback'][data-kind='picture']");
    expect(tile).not.toBeNull();
    expect(tile!.getAttribute("aria-label")).toBe(alt);
  });
});
