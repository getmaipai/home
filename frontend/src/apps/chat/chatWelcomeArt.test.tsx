import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react";

const NOOP: ChatModelAdapter = { run: async function* () { /* nothing to run */ } };
import { ChatWelcome } from "@/apps/chat/chatThreadSlots";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { api } from "@/lib/api";
import { WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";

function Harness() {
  const runtime = useLocalRuntime(NOOP);
  return <MemoryRouter><AssistantRuntimeProvider runtime={runtime}><WakeWordPersonContext.Provider value={{ id: "person-1", display_name: "Sage Rivera" } as never}><ChatWelcome /></WakeWordPersonContext.Provider></AssistantRuntimeProvider></MemoryRouter>;
}

afterEach(() => cleanup());

const ART = "img[src^='/chat-art/']";

describe("chat welcome art", () => {
  test("shows the companion's picture and a line for the person by first name, with no companion name and no assistant line", async () => {
    const oldSettings = api.settingsValues;
    const oldCompanions = api.companions;
    api.settingsValues = (async () => [{ key: "persona.active_id", value: "sprout", source: "user", label: "Personality", level: "basic", secret: false }]) as unknown as typeof api.settingsValues;
    api.companions = (async () => ({ allowed: true, can_create: false, can_discover: false, default_id: "tessa", companions: [{ id: "sprout", name: "Sprout", is_default: false }, { id: "tessa", name: "Tessa", is_default: true }], discover: [], robots: null })) as unknown as typeof api.companions;
    try {
      const view = renderWithQueryClient(<Harness />);
      await waitFor(() => expect(view.container.querySelector('[data-slot="empty-state-greeting"]')).not.toBeNull());
      const greeting = view.container.querySelector('[data-slot="empty-state-greeting"]')!;
      expect(greeting.textContent).toContain("Sage");
      expect(greeting.textContent).not.toContain("Rivera");
      expect(view.queryByText("Sprout")).toBeNull();
      expect(view.queryByText("How can I help you today?")).toBeNull();
      expect(view.container.querySelector(ART)).toBeNull();
    } finally {
      api.settingsValues = oldSettings;
      api.companions = oldCompanions;
    }
  });
});
