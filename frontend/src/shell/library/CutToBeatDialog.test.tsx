import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { api, type LibraryItem, type Roster } from "@/lib/api";
import { videosApi } from "@/lib/videosApi";
import { useCutToBeatDialog } from "./CutToBeatDialog";

const me = { id: "p1" } as unknown as Roster;
const clip = (id: string): LibraryItem => ({ id, name: `Clip ${id}`, kind: "video", origin: "made", chat_id: "c1", owner: { id: "p1" } } as unknown as LibraryItem);
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
afterEach(() => cleanup());

describe("cut to the beat dialog", () => {
  test("a song seed lists the person's own finished videos and sends the picked ones in order", async () => {
    const library = spyOn(api, "library").mockImplementation((async (query: { type?: string }) => ({ items: query.type === "video" ? [clip("a"), clip("b"), clip("c")] : [], next_cursor: null })) as never);
    const cut = spyOn(videosApi, "cutToBeat").mockResolvedValue({ conversation_id: "c1" } as never);
    const view = renderHook(() => useCutToBeatDialog({ open: true, onOpenChange: () => {}, me, seed: { trackId: "song-1" } }), { wrapper });
    await waitFor(() => expect(view.result.current.clips.length).toBe(3));
    act(() => { view.result.current.toggle("c", true); view.result.current.toggle("a", true); });
    await act(async () => { await view.result.current.submit(); });
    expect(cut).toHaveBeenCalledWith({ clips: ["c", "a"], track: "song-1", beats_per_cut: 4, length_s: 30 });
    library.mockRestore(); cut.mockRestore();
  });
  test("nothing is sent until a video and a song are chosen", async () => {
    const library = spyOn(api, "library").mockResolvedValue({ items: [], next_cursor: null } as never);
    const cut = spyOn(videosApi, "cutToBeat").mockResolvedValue({ conversation_id: "c1" } as never);
    const view = renderHook(() => useCutToBeatDialog({ open: true, onOpenChange: () => {}, me, seed: { trackId: "song-1" } }), { wrapper });
    await act(async () => { await view.result.current.submit(); });
    expect(cut).not.toHaveBeenCalled();
    library.mockRestore(); cut.mockRestore();
  });
  test("no more than six videos can be picked", async () => {
    const library = spyOn(api, "library").mockResolvedValue({ items: [], next_cursor: null } as never);
    const view = renderHook(() => useCutToBeatDialog({ open: true, onOpenChange: () => {}, me, seed: { trackId: "s" } }), { wrapper });
    act(() => { for (const id of ["1", "2", "3", "4", "5", "6", "7"]) view.result.current.toggle(id, true); });
    expect(view.result.current.picked).toEqual(["1", "2", "3", "4", "5", "6"]);
    library.mockRestore();
  });
});
