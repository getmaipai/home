import { afterEach, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, type Roster } from "@/lib/api";
import { VoiceStage } from "@/shell/VoiceStage";
import { CompanionSpeechContext, WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";

const originalAvatar = api.companionAvatar;
const originalJobs = api.jobs;
afterEach(() => { cleanup(); api.companionAvatar = originalAvatar; api.jobs = originalJobs; });
const person = { id: "p1", role: "owner" } as Roster;
const adapter: ChatModelAdapter = { run: async function* () {} };
const state = { loop: true, urls: { h264: "/s.mp4", av1: null, still: "/s.png" } };
const response = { avatar: { id: "c1", name: "Sage", key: "#00FF00", version: 1, states: { idle: state, greeting: state } } };

function Harness({ mode }: { mode: "connecting" | "listening" | "thinking" | "speaking" }) {
  const runtime = useLocalRuntime(adapter, { initialMessages: [] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}><MemoryRouter><AssistantRuntimeProvider runtime={runtime}><WakeWordPersonContext.Provider value={person}><CompanionSpeechContext.Provider value={{ isSpeaking: mode === "speaking", liveVoiceListening: mode === "listening" }}><VoiceStage conversationId={null} mode={mode} /></CompanionSpeechContext.Provider></WakeWordPersonContext.Provider></AssistantRuntimeProvider></MemoryRouter></QueryClientProvider>;
}

test("draws the animated companion at the stage size when it has clips", async () => {
  api.companionAvatar = mock(async () => response) as never;
  api.jobs = mock(async () => []) as never;
  const view = render(<Harness mode="listening" />);
  const face = await view.findByRole("img", { name: "Sage" });
  expect(face.className).toContain("size-52");
  expect(view.getByText("Sage is listening")).toBeTruthy();
});

test("falls back to the seeded face, never a letter, when the companion has no clips", async () => {
  api.companionAvatar = mock(async () => ({ avatar: null })) as never;
  api.jobs = mock(async () => []) as never;
  const view = render(<Harness mode="speaking" />);
  expect(await view.findByText("Your companion is speaking")).toBeTruthy();
  expect(view.container.querySelector('[data-slot="avatar"]')).toBeTruthy();
  expect(view.container.querySelector("[role='img'][aria-label='Sage']")).toBeNull();
});
