import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { LibraryViewer } from "@/shell/library/LibraryViewer";
import { WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";
import type { LibraryItem, Roster } from "@/lib/api";

afterEach(cleanup);
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const item = {
  id: "video-1", name: "Home video", kind: "video", media_type: "video/mp4", size_bytes: 128, created_at: "2026-11-01T00:00:00Z",
  owner: { id: "owner-1", display_name: "Owner" }, shared_with: { count: 0, household: false }, retention: "kept", origin: "made", chat_id: null,
  can_edit: false, audience: "adult-only", duration_seconds: 8, thumb_url: "/api/files/video-1/thumb?w=320", expires_at: null, version_count: 1,
  adult: { made_audience: "adult-only", lock: "on", can_clear: true, can_mark: false, line: "Adult only.", history: [] },
} as unknown as LibraryItem;
const adult = { id: "owner-1", role: "owner", age_band: "adult", pinDigits: 4, hasSecret: true } as unknown as Roster;
const other = { ...adult, id: "person-2" } as Roster;
const actions = { open: () => {}, rename: () => {}, keep: () => {}, share: () => {}, trash: () => {}, recheck: () => {}, adultMark: () => {}, adultUnmark: () => {} };
function mount(me: Roster, state: { can_clear: boolean; can_mark: boolean }) {
  const target = { ...item, adult: { ...item.adult!, ...state, line: "Adult only." } } as LibraryItem;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/auth/passkeys")) return Promise.resolve(Response.json([]));
    if (url === "/api/files/video-1") return Promise.resolve(Response.json({ ...item, adult: { ...state, line: "Adult only." } }));
    if (url.includes("/api/people")) return Promise.resolve(Response.json([]));
    return Promise.resolve(Response.json({ items: [], next_cursor: null }));
  }) as unknown as typeof fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><WakeWordPersonContext.Provider value={me}><LibraryViewer items={[target]} me={me} currentId={item.id} onCurrentIdChange={() => {}} onClose={() => {}} actions={actions} phone={false} /></WakeWordPersonContext.Provider></MemoryRouter></QueryClientProvider>);
}

describe("LibraryViewer adult mark actions", () => {
  test("the owner sees Remove lock when the video can be cleared", async () => {
    const view = mount(adult, { can_clear: true, can_mark: false });
    await waitFor(() => expect(view.queryByRole("button", { name: "Remove lock" })).toBeTruthy());
    expect(view.queryByRole("button", { name: "Lock" })).toBeNull();
  });

  test("another person sees neither action, and can_mark offers Lock", async () => {
    const view = mount(other, { can_clear: true, can_mark: true });
    await waitFor(() => expect(view.queryByRole("button", { name: "Remove lock" })).toBeNull());
    expect(view.queryByRole("button", { name: "Lock" })).toBeNull();
    view.unmount();
    const ownerView = mount(adult, { can_clear: false, can_mark: true });
    await waitFor(() => expect(ownerView.queryByRole("button", { name: "Lock" })).toBeTruthy());
    expect(ownerView.queryByRole("button", { name: "Remove lock" })).toBeNull();
  });
});
