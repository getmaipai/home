// SAVE-CHARACTER-01: the viewer's "Save as an element" button shows only for a picture the person owns and can open, asks for a name, posts it and offers the Characters page.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { LibraryViewer } from "@/shell/library/LibraryViewer";
import { canSaveAsCharacter } from "@/shell/library/useSaveAsCharacter";
import { WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";
import type { LibraryItem, Roster } from "@/lib/api";

afterEach(cleanup);
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
const base = {
  id: "pic-1", name: "Fox", kind: "image", media_type: "image/png", size_bytes: 128, created_at: "2026-11-01T00:00:00Z",
  owner: { id: "owner-1", display_name: "Owner" }, shared_with: { count: 0, household: false }, retention: "kept", origin: "made", chat_id: null,
  can_edit: false, audience: "all-ages", duration_seconds: null, thumb_url: "/api/files/pic-1/thumb?w=320", expires_at: null, version_count: 1,
} as unknown as LibraryItem;
const me = { id: "owner-1", role: "owner", age_band: "adult", pinDigits: 4, hasSecret: true } as unknown as Roster;
const actions = { open: () => {}, rename: () => {}, keep: () => {}, share: () => {}, trash: () => {}, recheck: () => {}, adultMark: () => {}, adultUnmark: () => {} };
function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}</p>; }
const posts: Array<{ url: string; body: unknown }> = [];

function mount(item: LibraryItem, viewer: Roster = me, reply: () => Response = () => Response.json({ subject: { id: "msub-1", name: "Juniper" }, capture: "started", job_id: null, line: "Saved. The model sheet is being made." }, { status: 201 })) {
  posts.length = 0;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/media-subjects/from-picture")) { posts.push({ url, body: JSON.parse(String(init?.body)) }); return Promise.resolve(reply()); }
    if (url.includes("/api/auth/passkeys") || url.includes("/api/people")) return Promise.resolve(Response.json([]));
    if (url.includes("/api/creations/by-file/")) return Promise.resolve(Response.json({}, { status: 404 }));
    if (url === `/api/files/${item.id}`) return Promise.resolve(Response.json(item));
    return Promise.resolve(Response.json({ items: [], next_cursor: null }));
  }) as unknown as typeof fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/library"]}><Routes><Route path="/library" element={<WakeWordPersonContext.Provider value={viewer}><LibraryViewer items={[item]} me={viewer} currentId={item.id} onCurrentIdChange={() => {}} onClose={() => {}} actions={actions} phone={false} /></WakeWordPersonContext.Provider>} /><Route path="*" element={<Where />} /></Routes></MemoryRouter></QueryClientProvider>);
}

describe("canSaveAsCharacter", () => {
  test("own pictures that are open", () => {
    expect(canSaveAsCharacter(base, me)).toBe(true);
    expect(canSaveAsCharacter({ ...base, audience: "adult-only", unlocked: true } as LibraryItem, me)).toBe(true);
  });
  test("not a locked Adult picture, someone else's picture, a video, or a guest", () => {
    expect(canSaveAsCharacter({ ...base, audience: "adult-only" } as LibraryItem, me)).toBe(false);
    expect(canSaveAsCharacter({ ...base, owner: { id: "other", display_name: "Other" } } as LibraryItem, me)).toBe(false);
    expect(canSaveAsCharacter({ ...base, kind: "video" } as LibraryItem, me)).toBe(false);
    expect(canSaveAsCharacter(base, { ...me, role: "guest" } as Roster)).toBe(false);
  });
});

describe("LibraryViewer Save as an element", () => {
  test("the button needs a name, posts the picture and name, then says it saved and links to Characters", async () => {
    const view = mount(base);
    fireEvent.click(await waitFor(() => view.getByRole("button", { name: "Save as an element" })));
    const save = await waitFor(() => view.getByRole("button", { name: "Save element" }));
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(view.getByLabelText("Name"), { target: { value: "  Juniper " } });
    fireEvent.click(view.getByRole("button", { name: "Save element" }));
    await waitFor(() => expect(view.getByText("Saved as an element")).toBeTruthy());
    expect(posts).toEqual([{ url: "/api/media-subjects/from-picture", body: { file_id: "pic-1", name: "Juniper" } }]);
    expect(view.getByText("Saved. The model sheet is being made.")).toBeTruthy();
    fireEvent.click(view.getByRole("link", { name: "Open" }));
    await waitFor(() => expect(view.getByTestId("where").textContent).toBe("/apps/elements/characters"));
  });

  test("ELEMENTS-HOME-03: choosing Place posts the kind and links to the Places page", async () => {
    const view = mount(base);
    fireEvent.click(await waitFor(() => view.getByRole("button", { name: "Save as an element" })));
    fireEvent.click(await waitFor(() => view.getByRole("radio", { name: "Place" })));
    fireEvent.change(view.getByLabelText("Name"), { target: { value: "Kitchen" } });
    fireEvent.click(view.getByRole("button", { name: "Save element" }));
    await waitFor(() => expect(view.getByText("Saved as an element")).toBeTruthy());
    expect(posts).toEqual([{ url: "/api/media-subjects/from-picture", body: { file_id: "pic-1", name: "Kitchen", kind: "place" } }]);
    fireEvent.click(view.getByRole("link", { name: "Open" }));
    await waitFor(() => expect(view.getByTestId("where").textContent).toBe("/apps/elements/places"));
  });

  test("a refusal shows the hub's plain line and keeps the name", async () => {
    const view = mount(base, me, () => Response.json({ error: "This picture is locked. Unlock your adult items, then save it as a character." }, { status: 403 }));
    fireEvent.click(await waitFor(() => view.getByRole("button", { name: "Save as an element" })));
    fireEvent.change(await waitFor(() => view.getByLabelText("Name")), { target: { value: "Juniper" } });
    fireEvent.click(view.getByRole("button", { name: "Save element" }));
    await waitFor(() => expect(view.getByText(/This picture is locked/)).toBeTruthy());
    expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe("Juniper");
  });

  test("a locked Adult picture, a video and someone else's picture have no button", async () => {
    const locked = mount({ ...base, audience: "adult-only" } as LibraryItem);
    await waitFor(() => expect(locked.queryByRole("button", { name: "Rename" })).toBeTruthy());
    expect(locked.queryByRole("button", { name: "Save as an element" })).toBeNull();
    cleanup();
    const video = mount({ ...base, id: "vid-1", kind: "video", media_type: "video/mp4" } as LibraryItem);
    await waitFor(() => expect(video.queryByRole("button", { name: "Rename" })).toBeTruthy());
    expect(video.queryByRole("button", { name: "Save as an element" })).toBeNull();
    cleanup();
    const theirs = mount({ ...base, owner: { id: "other", display_name: "Other" } } as LibraryItem);
    await waitFor(() => expect(theirs.getByText("Download")).toBeTruthy());
    expect(theirs.queryByRole("button", { name: "Save as an element" })).toBeNull();
  });
});
