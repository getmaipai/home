import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { AssistantRuntimeProvider, useAuiState, useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react";
import { MemoryRouter } from "react-router-dom";
import { AskHandoff, ASK_HANDOFF_MAX, askFromSearch } from "@/apps/chat/AskHandoff";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";

const NOOP: ChatModelAdapter = { run: async function* () {} };

function ComposerText() {
  const text = useAuiState((s) => s.composer.text);
  const count = useAuiState((s) => s.thread.messages.length);
  return <p data-testid="composer" data-messages={count}>{text}</p>;
}

function Harness() {
  const runtime = useLocalRuntime(NOOP);
  return <AssistantRuntimeProvider runtime={runtime}><AskHandoff /><ComposerText /></AssistantRuntimeProvider>;
}

afterEach(() => cleanup());

describe("ask hand-off from Home", () => {
  test("reads the words from ?ask= and trims them", () => {
    expect(askFromSearch("?ask=Help%20me%20plan%20dinner")).toBe("Help me plan dinner");
    expect(askFromSearch("?ask=%20%20")).toBeNull();
    expect(askFromSearch("?conversation=abc")).toBeNull();
    expect(askFromSearch(`?ask=${"a".repeat(ASK_HANDOFF_MAX + 50)}`)?.length).toBe(ASK_HANDOFF_MAX);
  });

  test("the words arrive in the composer and nothing is sent", async () => {
    const view = renderWithQueryClient(<MemoryRouter initialEntries={["/chat?ask=Explain%20rainbows"]}><Harness /></MemoryRouter>);
    await waitFor(() => expect(view.getByTestId("composer").textContent).toBe("Explain rainbows"));
    expect(view.getByTestId("composer").getAttribute("data-messages")).toBe("0");
  });

  test("with no ?ask= the composer stays empty", async () => {
    const view = renderWithQueryClient(<MemoryRouter initialEntries={["/chat"]}><Harness /></MemoryRouter>);
    await Promise.resolve();
    expect(view.getByTestId("composer").textContent).toBe("");
  });
});
