// IMG-STUDIO-02: a picture in the Library viewer opens the Studio (EDITOR-07) and starts a video draft with the picture as its first frame; a video gets neither.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { LibraryViewer } from "@/shell/library/LibraryViewer";
import { WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";
import type { LibraryItem, Roster } from "@/lib/api";

afterEach(cleanup);
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const base = {
  id: "pic-1", name: "Boat", kind: "image", media_type: "image/png", size_bytes: 128, created_at: "2026-11-01T00:00:00Z",
  owner: { id: "owner-1", display_name: "Owner" }, shared_with: { count: 0, household: false }, retention: "kept", origin: "made", chat_id: null,
  can_edit: false, audience: "all-ages", duration_seconds: null, thumb_url: "/api/files/pic-1/thumb?w=320", expires_at: null, version_count: 1,
} as unknown as LibraryItem;
const me = { id: "owner-1", role: "owner", age_band: "adult", pinDigits: 4, hasSecret: true } as unknown as Roster;
const actions = { open: () => {}, rename: () => {}, keep: () => {}, share: () => {}, trash: () => {}, recheck: () => {}, adultMark: () => {}, adultUnmark: () => {} };

function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}|{JSON.stringify((l.state as { pageState?: unknown } | null)?.pageState ?? null)}</p>; }
function mount(item: LibraryItem) {
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/auth/passkeys") || url.includes("/api/people")) return Promise.resolve(Response.json([]));
    if (url === `/api/files/${item.id}`) return Promise.resolve(Response.json(item));
    return Promise.resolve(Response.json({ items: [], next_cursor: null }));
  }) as unknown as typeof fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/library"]}><Routes><Route path="/library" element={<WakeWordPersonContext.Provider value={me}><LibraryViewer items={[item]} me={me} currentId={item.id} onCurrentIdChange={() => {}} onClose={() => {}} actions={actions} phone={false} /></WakeWordPersonContext.Provider>} /><Route path="*" element={<Where />} /></Routes></MemoryRouter></QueryClientProvider>);
}

describe("LibraryViewer picture actions", () => {
  test("Edit opens the Studio with the picture", async () => {
    const view = mount(base);
    const edit = await waitFor(() => view.getByRole("button", { name: "Edit" }));
    fireEvent.click(edit);
    await waitFor(() => expect(view.getByTestId("where").textContent).toBe('/apps/image/studio|{"file":"pic-1"}'));
  });

  test("Make a video from this opens Create with the picture as the first frame", async () => {
    const view = mount(base);
    fireEvent.click(await waitFor(() => view.getByRole("button", { name: "Make a video from this" })));
    await waitFor(() => expect(view.getByTestId("where").textContent).toBe('/apps/video/create|{"start_frame":"pic-1"}'));
  });

  test("a video has neither button", async () => {
    const view = mount({ ...base, id: "vid-1", kind: "video", media_type: "video/mp4", name: "Clip" } as LibraryItem);
    await waitFor(() => expect(view.queryByRole("button", { name: "Rename" })).toBeTruthy());
    expect(view.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(view.queryByRole("button", { name: "Make a video from this" })).toBeNull();
  });
});
