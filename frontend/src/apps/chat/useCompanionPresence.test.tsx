import { afterEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, type Roster } from "@/lib/api";
import { CompanionAvatar } from "@maipai/ui/src/elements/companion-avatar";
import { useCompanionPresence } from "@/apps/chat/useCompanionPresence";
import { CompanionSpeechContext, WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";

function Presence() { const presence = useCompanionPresence(); return presence ? <CompanionAvatar placement="corner" {...presence} /> : null; }
const originalAvatar = api.companionAvatar;
const originalJobs = api.jobs;
afterEach(() => { cleanup(); api.companionAvatar = originalAvatar; api.jobs = originalJobs; try { localStorage.removeItem("maipai.companion.avatar.hidden"); } catch {} });
const response = { avatar: { id: "c1", name: "Mimi", key: "#00FF00", version: 1, states: { idle: { loop: true, urls: { h264: "/idle.mp4", av1: null, still: "/idle.png" } }, greeting: { loop: false, urls: { h264: "/g.mp4", av1: null, still: "/g.png" } } } } };
const person = { id: "p1", role: "owner" } as Roster;
const adapter: ChatModelAdapter = { run: async function* () {} };
function Harness() {
  const runtime = useLocalRuntime(adapter, { initialMessages: [] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}><MemoryRouter><AssistantRuntimeProvider runtime={runtime}><WakeWordPersonContext.Provider value={person}><CompanionSpeechContext.Provider value={{ isSpeaking: false, liveVoiceListening: false }}><Presence /></CompanionSpeechContext.Provider></WakeWordPersonContext.Provider></AssistantRuntimeProvider></MemoryRouter></QueryClientProvider>;
}

test("renders nothing while loading and when the person has no avatar", async () => {
  let release!: (value: typeof response) => void;
  api.companionAvatar = mock(() => new Promise((resolve) => { release = resolve; })) as never;
  api.jobs = mock(async () => []) as never;
  const loading = render(<Harness />);
  expect(loading.container.querySelector("[role='img']")).toBeNull();
  await act(async () => release({ avatar: null } as never));
  await waitFor(() => expect(loading.container.querySelector("[role='img']")).toBeNull());
  loading.unmount();
});

test("renders the kit avatar with its name and size prop", async () => {
  api.companionAvatar = mock(async () => response) as never;
  api.jobs = mock(async () => []) as never;
  const priorWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1400 });
  const view = render(<Harness />);
  expect(await view.findByRole("img", { name: "Mimi" })).toBeTruthy();
  expect(view.container.querySelector("[role='img'][aria-label='Mimi']")?.className).toContain("size-40");
  Object.defineProperty(window, "innerWidth", { configurable: true, value: priorWidth });
});

test("Hide persists for this browser and Show restores the character", async () => {
  api.companionAvatar = mock(async () => response) as never;
  api.jobs = mock(async () => []) as never;
  const view = render(<Harness />);
  await view.findByRole("img", { name: "Mimi" });
  fireEvent.click(view.getByRole("button", { name: "Hide the character" }));
  expect(localStorage.getItem("maipai.companion.avatar.hidden")).toBe("true");
  expect(view.queryByRole("img", { name: "Mimi" })).toBeNull();
  fireEvent.click(view.getByRole("button", { name: "Show the character" }));
  expect(await view.findByRole("img", { name: "Mimi" })).toBeTruthy();
});

test("an avatar failure hides the video character", async () => {
  api.companionAvatar = mock(async () => response) as never;
  api.jobs = mock(async () => []) as never;
  const priorObserver = globalThis.IntersectionObserver;
  const priorContext = HTMLCanvasElement.prototype.getContext;
  const priorPlay = HTMLMediaElement.prototype.play;
  const priorCanPlayType = HTMLMediaElement.prototype.canPlayType;
  globalThis.IntersectionObserver = class { constructor(private callback: IntersectionObserverCallback) {} observe(target: Element) { this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver); } disconnect() {} } as unknown as typeof IntersectionObserver;
  HTMLCanvasElement.prototype.getContext = (() => new Proxy({}, { get: (_target, key) => key === "getShaderParameter" || key === "getProgramParameter" ? () => true : () => ({}) })) as never;
  HTMLMediaElement.prototype.play = (() => Promise.resolve()) as never;
  HTMLMediaElement.prototype.canPlayType = (() => "maybe") as never;
  const view = render(<Harness />);
  await view.findByRole("img", { name: "Mimi" });
  const video = view.container.querySelector("video");
  expect(video).toBeTruthy();
  await waitFor(() => expect(video?.getAttribute("src")).toBe("/idle.mp4"), { timeout: 5000 });
  fireEvent.error(video!);
  await waitFor(() => expect(view.queryByRole("img", { name: "Mimi" })).toBeNull(), { timeout: 5000 });
  globalThis.IntersectionObserver = priorObserver;
  HTMLCanvasElement.prototype.getContext = priorContext;
  HTMLMediaElement.prototype.play = priorPlay;
  HTMLMediaElement.prototype.canPlayType = priorCanPlayType;
});
