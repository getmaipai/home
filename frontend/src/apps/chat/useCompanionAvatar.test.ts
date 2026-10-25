import { afterEach, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { api, type Roster } from "@/lib/api";
import { WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";
import { mapCompanionClips, useCompanionAvatar } from "@/apps/chat/useCompanionAvatar";

afterEach(cleanup);
const states = { idle: { loop: true, urls: { h264: "/idle.mp4", av1: null, still: "/idle.png" } } };
function Probe({ companionId }: { companionId?: string }) { const value = useCompanionAvatar(companionId); return createElement("output", null, JSON.stringify(value)); }
function setup(person: Roster | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(createElement(QueryClientProvider, { client }, createElement(WakeWordPersonContext.Provider, { value: person }, createElement(Probe))));
}

test("null avatar is returned as no clips", async () => {
  const old = api.companionAvatar;
  api.companionAvatar = mock(async () => ({ avatar: null }));
  const view = setup({ id: "p1" } as Roster);
  await waitFor(() => expect(view.getByText('{"avatar":null,"clips":null,"loading":false}')).toBeTruthy());
  api.companionAvatar = old;
});

test("maps states and turns a null AV1 URL into undefined", () => {
  const clips = mapCompanionClips(states);
  expect(clips.idle).toEqual({ h264: "/idle.mp4", av1: undefined, still: "/idle.png", loop: true });
});

test("no signed-in person does not request an avatar", () => {
  const old = api.companionAvatar;
  api.companionAvatar = mock(async () => ({ avatar: null }));
  setup(null);
  expect(api.companionAvatar).not.toHaveBeenCalled();
  api.companionAvatar = old;
});
