import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { api, type Roster } from "@/lib/api";
import { videosApi } from "@/lib/videosApi";
import { useAddMusicDialog } from "./AddMusicDialog";

const me = { id: "p1" } as unknown as Roster;
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
afterEach(() => cleanup());

describe("add music dialog", () => {
  test("new music needs a description, then sends it with the level", async () => {
    const library = spyOn(api, "library").mockResolvedValue({ items: [], next_cursor: null } as never);
    const add = spyOn(videosApi, "addMusic").mockResolvedValue({ conversation_id: "c1", video_job_id: null, music_job_id: "m1" });
    const view = renderHook(() => useAddMusicDialog({ open: true, onOpenChange: () => {}, me, clipId: "clip-1" }), { wrapper });
    await act(async () => { await view.result.current.submit(); });
    expect(add).not.toHaveBeenCalled();
    act(() => view.result.current.setDescription("soft piano"));
    await act(async () => { await view.result.current.submit(); });
    expect(add).toHaveBeenCalledWith({ clip: "clip-1", make_music: "soft piano", level: "soft" });
    library.mockRestore(); add.mockRestore();
  });
  test("a picked song is sent as the track", async () => {
    const library = spyOn(api, "library").mockResolvedValue({ items: [], next_cursor: null } as never);
    const add = spyOn(videosApi, "addMusic").mockResolvedValue({ conversation_id: "c1", video_job_id: "v1", music_job_id: null });
    const view = renderHook(() => useAddMusicDialog({ open: true, onOpenChange: () => {}, me, clipId: "clip-1" }), { wrapper });
    act(() => view.result.current.setChoice("song-9"));
    await act(async () => { await view.result.current.submit(); });
    expect(add).toHaveBeenCalledWith({ clip: "clip-1", track: "song-9", level: "soft" });
    library.mockRestore(); add.mockRestore();
  });
});
