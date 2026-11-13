// MEDIA-VIZ-01: the global mini player has one visible close control at every width, and keeps its clearance slot above the phone tab bar.
import { expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { ToastProvider } from "@maipai/ui/src/primitives/Toast";
import { createQueryClient } from "@maipai/ui/src/queryClient";
import { GlobalMiniPlayer } from "@/shell/GlobalMiniPlayer";
import { MediaDockContext } from "@/shell/mediaHost";
import type { HoistedMedia } from "@/shell/mediaHost";
import { liveStationIdOf } from "@/shell/radioLive";

const held = (appId: string, id: string) => ({ appId, id, src: "/s", kind: "audio", title: "T", el: document.createElement("audio"), started: true }) as HoistedMedia;

test("mini player keeps its clearance slot", () => {
  const current = held("audio", "m1");
  const view = render(<QueryClientProvider client={createQueryClient()}><TooltipProvider><ToastProvider><MemoryRouter><MediaDockContext.Provider value={{ current, clear: () => {}, next: async () => {} }}><GlobalMiniPlayer /></MediaDockContext.Provider></MemoryRouter></ToastProvider></TooltipProvider></QueryClientProvider>);
  expect(view.container.querySelector('[data-slot="global-mini-player"]')).not.toBeNull();
  cleanup();
});

test("the mini player shows one visible close button and clears held media", () => {
  const current = held("audio", "m1");
  const clear = () => {};
  const view = render(<QueryClientProvider client={createQueryClient()}><TooltipProvider><ToastProvider><MemoryRouter><MediaDockContext.Provider value={{ current, clear, next: async () => {} }}><GlobalMiniPlayer /></MediaDockContext.Provider></MemoryRouter></ToastProvider></TooltipProvider></QueryClientProvider>);
  const buttons = view.getAllByRole("button", { name: /^Close player/i });
  expect(buttons).toHaveLength(1);
  expect(buttons[0]?.closest(".max-sm\\:hidden")).toBeNull();
  fireEvent.click(buttons[0]!);
  cleanup();
});

test("live station and video mini players each show one close button", () => {
  for (const item of [
    { ...held("audio", "station"), src: "/api/plugins/audio/radio/stream/station" },
    { ...held("video", "v1"), kind: "video" },
  ] as HoistedMedia[]) {
    if (item.id === "station") expect(liveStationIdOf(item.src)).not.toBeNull();
    const view = render(<QueryClientProvider client={createQueryClient()}><TooltipProvider><ToastProvider><MemoryRouter><MediaDockContext.Provider value={{ current: item, clear: () => {}, next: async () => {} }}><GlobalMiniPlayer /></MediaDockContext.Provider></MemoryRouter></ToastProvider></TooltipProvider></QueryClientProvider>);
    expect(view.getAllByRole("button", { name: /^Close player/i })).toHaveLength(1);
    cleanup();
  }
});


test("the music mini player turns on swipe to skip, wired to the host's next and previous, and draws the hairline", () => {
  let nexts = 0, previouses = 0;
  const current = held("audio", "m1");
  const view = render(<QueryClientProvider client={createQueryClient()}><TooltipProvider><ToastProvider><MemoryRouter><MediaDockContext.Provider value={{ current, clear: () => {}, next: async () => { nexts++; }, previous: async () => { previouses++; } }}><GlobalMiniPlayer /></MediaDockContext.Provider></MemoryRouter></ToastProvider></TooltipProvider></QueryClientProvider>);
  const bar = view.container.querySelector("[data-slot=player]")!;
  expect(bar.getAttribute("data-swipe-skip")).toBe("true");
  expect(bar.querySelector("[data-slot=player-hairline]")).not.toBeNull();
  const drag = (x0: number, x1: number) => {
    for (const [type, x] of [["pointerdown", x0], ["pointerup", x1]] as const) {
      const event = new Event(type, { bubbles: true }) as Event & Record<string, unknown>;
      Object.assign(event, { clientX: x, clientY: 100, pointerId: 1, pointerType: "touch" });
      bar.dispatchEvent(event);
    }
  };
  drag(200, 100);
  drag(100, 200);
  expect([nexts, previouses]).toEqual([1, 1]);
  cleanup();
});
