import { afterEach, describe, expect, test } from "bun:test";
import { cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react";

const NOOP: ChatModelAdapter = { run: async function* () { /* nothing to run */ } };
import { ChatWelcome } from "@/apps/chat/chatThreadSlots";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { api } from "@/lib/api";
import { WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";

function Harness() {
  const runtime = useLocalRuntime(NOOP);
  return <MemoryRouter><AssistantRuntimeProvider runtime={runtime}><WakeWordPersonContext.Provider value={{ id: "person-1" } as never}><ChatWelcome /></WakeWordPersonContext.Provider></AssistantRuntimeProvider></MemoryRouter>;
}

afterEach(() => cleanup());

const ART = "img[src^='/chat-art/']";

describe("chat welcome art", () => {
  test("renders the selected companion hero and a readable welcome line", async () => {
    const oldSettings = api.settingsValues;
    const oldCompanions = api.companions;
    api.settingsValues = (async () => [{ key: "persona.active_id", value: "sprout", source: "user", label: "Personality", level: "basic", secret: false }]) as unknown as typeof api.settingsValues;
    api.companions = (async () => ({ allowed: true, can_create: false, can_discover: false, default_id: "default", companions: [{ id: "sprout", name: "Sprout", is_default: false }, { id: "default", name: "Default", is_default: true }], robots: null })) as typeof api.companions;
    try {
      const view = renderWithQueryClient(<Harness />);
      const hero = await view.findByRole("region", { name: "Sprout" });
      expect(hero).toBeVisible();
      expect(view.getByText("How can I help you today?")).toBeVisible();
      expect(view.container.querySelector(ART)).toBeNull();
    } finally {
      api.settingsValues = oldSettings;
      api.companions = oldCompanions;
    }
  });
});
