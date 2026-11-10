import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, renderHook } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Roster } from "@/lib/api";

// The kit player is mocked so the test sees which props the pane passes; the real player is checked in WebKit.
mock.module("@maipai/ui/src/elements/companion-pack", () => ({
  CompanionPackPlayer: (props: { baseUrl: string; state: string; tier?: string }) => <div data-testid="pack-player" data-base={props.baseUrl} data-state={props.state} data-tier={props.tier} />,
}));
const { useAmbientCompanionPane } = await import("@/shell/AmbientCompanionPane");
const { useSideChat } = await import("@/shell/useSideChat");
const { packStateFor } = await import("@/shell/companionPack");
type PaneState = import("@/shell/AmbientCompanionPane").AmbientPaneState;

const person = { id: "person-1", display_name: "Sage", role: "adult", age_band: "adult" } as Roster;
function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}
function pane(pack: { url: string; manifest: Record<string, unknown> } | null) {
  return renderHook(() => {
    const side = useSideChat(person, "companion-1", false);
    const [state, setState] = useState<PaneState>({ open: false, pinned: false });
    return useAmbientCompanionPane({ person, companionName: "Pack fox", companionId: "companion-1", avatar: null, pack, still: "/still.png", incognito: false, state, onStateChange: setState, onContinue: () => {}, onRing: () => {}, side } as never);
  }, { wrapper });
}

afterEach(() => { cleanup(); });

describe("ambient companion pane with a pack", () => {
  test("renders the pack player with baseUrl, idle state and auto tier when the avatar has a pack", () => {
    const { result } = pane({ url: "/api/companions/c1/pack/", manifest: { id: "man", rest: "rest.webp", states: {} } });
    const view = render(<>{result.current.companionTab.content}</>, { wrapper });
    const player = view.getByTestId("pack-player");
    expect(player.getAttribute("data-base")).toBe("/api/companions/c1/pack/");
    expect(player.getAttribute("data-state")).toBe("idle");
    expect(player.getAttribute("data-tier")).toBe("auto");
  });

  test("keeps the still path and no pack player when the pack is null", () => {
    const { result } = pane(null);
    const view = render(<>{result.current.companionTab.content}</>, { wrapper });
    expect(view.queryByTestId("pack-player")).toBeNull();
    expect(view.container.querySelector('img[src="/still.png"]')).toBeTruthy();
  });

  test("stage modes map to pack states", () => {
    expect([packStateFor("idle"), packStateFor("listening"), packStateFor("thinking"), packStateFor("working"), packStateFor("speaking")]).toEqual(["idle", "listen", "think", "think", "speak"]);
  });
});
