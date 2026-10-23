import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { FilesPage } from "@/shell/pages/FilesPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { stubMatchMedia } from "../../../tests/stubMatchMedia";
import type { LibraryItem, LibrarySummary, Roster } from "@/lib/api";

const PHONE = "(max-width: 639.98px)";
const WIDE = "(min-width: 1024px)";
const VIEWER_WIDE = "(min-width: 960px)";
afterEach(() => { cleanup(); localStorage.clear(); });
beforeEach(() => stubMatchMedia({ [WIDE]: true, [VIEWER_WIDE]: true }));

function person(role: Roster["role"] = "owner", id = "person-me"): Roster {
  return { id, display_name: "Nova", nickname: null, role, avatar_seed: id, source: "hub", local_only: false, created_at: "2026-09-04T00:00:00.000Z", updated_at: "2026-09-04T00:00:00.000Z", deleted_at: null, enabled: true, guest_expires_at: null, memorialized_at: null, hlc: "1788000000000:0:test", hasSecret: true } as Roster;
}
function item(id: string, name: string, over: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id, kind: "image", name, media_type: "image/png", size_bytes: 2048, created_at: "2026-10-16T00:00:00.000Z", owner: { id: "person-me", display_name: "Nova" },
    shared_with: { count: 0, household: false }, retention: "kept", chat_id: null, can_edit: false, audience: null, duration_seconds: null,
    thumb_url: `/api/files/${id}/thumb?w=320`, expires_at: null, version_count: 1, ...over,
  };
}
const summary = (items: number, bytes = items * 2048, trash = 0): LibrarySummary => ({ items, bytes, per_kind: { image: { items, bytes }, video: { items: 0, bytes: 0 }, audio: { items: 0, bytes: 0 }, document: { items: 0, bytes: 0 }, story: { items: 0, bytes: 0 }, file: { items: 0, bytes: 0 } }, trash: { items: trash, bytes: 0 }, expiring: { items: 0, bytes: 0 } });

interface Server { moreStatus?: number; items?: LibraryItem[]; next?: string | null; listStatus?: number; trash?: unknown[]; usage?: unknown; music?: unknown }
function serve(server: Server = {}) {
  const original = globalThis.fetch;
  const calls: { url: string; method: string }[] = [];
  const items = server.items ?? [];
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (url.startsWith("/api/library/summary")) return Promise.resolve(Response.json(summary(items.length, items.length * 2048, server.trash?.length ?? 0)));
    if (url.startsWith("/api/library?")) {
      if (server.listStatus) return Promise.resolve(Response.json({ error: "Home could not load your Library. Check that Home is running, then try again." }, { status: server.listStatus }));
      const cursor = new URL(url, "http://x").searchParams.get("cursor");
      if (cursor && server.moreStatus) return Promise.resolve(Response.json({ error: "The page address is invalid. Open the Library again." }, { status: server.moreStatus }));
      return Promise.resolve(Response.json({ items: cursor ? [item("f-more", "Second page")] : items, next_cursor: cursor ? null : server.next ?? null }));
    }
    if (url === "/api/trash") return Promise.resolve(Response.json({ rows: server.trash ?? [] }));
    if (url.startsWith("/api/trash/file/")) return Promise.resolve(Response.json({ success: true }));
    if (url === "/api/storage/usage") return Promise.resolve(Response.json(server.usage ?? { people: [{ personId: "person-me", displayName: "Nova", role: "owner", usageBytes: 3 * 1024 * 1024, capBytes: 20 * 1024 ** 3, byKind: [{ kind: "image", bytes: 2 * 1024 * 1024 }, { kind: "video", bytes: 1024 * 1024 }] }], household: null }));
    if (url === "/api/people") return Promise.resolve(Response.json([{ id: "person-me", display_name: "Nova", avatar_seed: "a" }, { id: "person-sage", display_name: "Sage", avatar_seed: "b" }]));
    if (/^\/api\/files\/[^/]+$/.test(url) && method === "DELETE") return Promise.resolve(Response.json({ id: "x", deleted_at: "2026-10-18T00:00:00.000Z", trash_until: "2026-11-17T00:00:00.000Z" }));
    if (/^\/api\/files\/[^/]+$/.test(url) && method === "PATCH") return Promise.resolve(Response.json({ id: "x", name: null, retention: "kept" }));
    if (/^\/api\/files\/[^/]+$/.test(url)) return Promise.resolve(Response.json({ id: url.split("/").pop(), owner_person_id: "person-me", origin: "sent", kind: "audio", media_type: "audio/mp4", size: 10, sha256: "a", storage_path: "x", retention: "kept", provenance: {}, created_at: "2026-10-16T00:00:00.000Z", hlc: "h", ...(server.music ? { music: server.music } : {}) }));
    if (url.endsWith("/shares") && method === "GET") return Promise.resolve(Response.json([]));
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; }, listUrls: () => calls.filter((call) => call.url.startsWith("/api/library?")).map((call) => new URL(call.url, "http://x").searchParams) };
}
function Where() { const location = useLocation(); return <output data-testid="where">{location.search}</output>; }
function page(role: Roster["role"] = "owner", entry = "/files") {
  return renderWithQueryClient(<MemoryRouter initialEntries={[entry]}><FilesPage person={person(role)} /><Where /></MemoryRouter>);
}
const where = () => document.querySelector('[data-testid="where"]')!.textContent;
const tile = (name: string) => Array.from(document.querySelectorAll<HTMLElement>('[data-slot="file-tile-main"]')).find((el) => el.getAttribute("aria-label")?.startsWith(name));

describe("Library states", () => {
  test("loading shows a status with a plain label, then the tiles", async () => {
    const server = serve({ items: [item("f1", "Fox in the snow")] });
    try {
      page();
      expect(document.querySelector('[role="status"][aria-label="Loading your files"]')).not.toBeNull();
      await waitFor(() => expect(tile("Fox in the snow")).toBeTruthy());
      expect(document.querySelector('[aria-label="Loading your files"]')).toBeNull();
    } finally { server.restore(); }
  });
  test("an empty Library explains what lands here and offers Upload", async () => {
    const server = serve();
    try {
      page();
      await waitFor(() => expect(document.body.textContent).toContain("Nothing here yet. Pictures, videos and songs you make in chat land here"));
      expect(within(document.body).getAllByRole("button", { name: "Upload" }).length).toBeGreaterThan(0);
    } finally { server.restore(); }
  });
  test("a failed load says what to do and Try again loads again", async () => {
    const server = serve({ listStatus: 500 });
    try {
      page();
      await waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain("Check that Home is running, then try again."));
      const before = server.listUrls().length;
      fireEvent.click(within(document.body).getByRole("button", { name: "Try again" }));
      await waitFor(() => expect(server.listUrls().length).toBeGreaterThan(before));
    } finally { server.restore(); }
  });
  test("no matches offers Clear filters, which clears the search", async () => {
    const server = serve();
    try {
      page("owner", "/files?q=zebra");
      await waitFor(() => expect(document.body.textContent).toContain("No matches. Try a different word or clear a filter."));
      fireEvent.click(within(document.body).getByRole("button", { name: "Clear filters" }));
      await waitFor(() => expect(where()).toBe(""));
    } finally { server.restore(); }
  });
  test("the header reads the count and size of the section", async () => {
    const server = serve({ items: [item("f1", "A"), item("f2", "B")] });
    try {
      page();
      await waitFor(() => expect(document.body.textContent).toContain("2 items · 4 KB"));
    } finally { server.restore(); }
  });
  test("the next page loads on request and joins the first", async () => {
    const server = serve({ items: [item("f1", "First page")], next: "cursor-2" });
    try {
      page();
      await waitFor(() => expect(tile("First page")).toBeTruthy());
      fireEvent.click(within(document.body).getByRole("button", { name: "Show more files" }));
      await waitFor(() => expect(tile("Second page")).toBeTruthy());
      expect(tile("First page")).toBeTruthy();
    } finally { server.restore(); }
  });
});

describe("a later page that fails", () => {
  test("keeps the files already shown and offers Try again under them", async () => {
    const server = serve({ items: [item("f1", "First page")], next: "cursor-2", moreStatus: 400 });
    try {
      page();
      await waitFor(() => expect(tile("First page")).toBeTruthy());
      fireEvent.click(within(document.body).getByRole("button", { name: "Show more files" }));
      await waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain("Home could not load more files."));
      expect(tile("First page")).toBeTruthy();
    } finally { server.restore(); }
  });
});

describe("sections, search, filters and sort", () => {
  test("a section click sets the address and asks the hub for that type; counts show", async () => {
    const server = serve({ items: [item("f1", "Fox")] });
    try {
      page();
      await waitFor(() => expect(tile("Fox")).toBeTruthy());
      const nav = document.querySelector("#library-sidebar")!;
      await waitFor(() => expect(nav.textContent).toContain("Pictures1"));
      fireEvent.click(within(nav as HTMLElement).getByRole("link", { name: /^Pictures/ }));
      await waitFor(() => expect(where()).toBe("?section=pictures"));
      await waitFor(() => expect(server.listUrls().some((query) => query.get("type") === "image")).toBe(true));
    } finally { server.restore(); }
  });
  test("Only me and Shared with me are sections with their own filter", async () => {
    const server = serve({ items: [item("f1", "Fox")] });
    try {
      page("owner", "/files?section=only-me");
      await waitFor(() => expect(server.listUrls().some((query) => query.get("shared") === "none")).toBe(true));
      cleanup();
      page("owner", "/files?section=shared-with-me");
      await waitFor(() => expect(server.listUrls().some((query) => query.get("shared") === "with-me")).toBe(true));
      expect(within(document.body).queryByText("Mine")).toBeNull();
    } finally { server.restore(); }
  });
  test("search is debounced into the address and the request; Mine adds owner=me", async () => {
    const server = serve({ items: [item("f1", "Fox")] });
    try {
      page();
      await waitFor(() => expect(tile("Fox")).toBeTruthy());
      fireEvent.click(document.querySelector<HTMLButtonElement>('[data-slot="section-sidebar-search"][aria-label="Search your Library"]')!);
      const field = document.querySelector<HTMLInputElement>('input[aria-label="Search your Library"]')!;
      fireEvent.change(field, { target: { value: "fox" } });
      await waitFor(() => expect(where()).toBe("?q=fox"), { timeout: 2000 });
      await waitFor(() => expect(server.listUrls().some((query) => query.get("search") === "fox")).toBe(true));
      fireEvent.click(within(document.body).getByText("Mine"));
      await waitFor(() => expect(where()).toBe("?filter=mine&q=fox"));
      await waitFor(() => expect(server.listUrls().some((query) => query.get("owner") === "me" && query.get("search") === "fox")).toBe(true));
    } finally { server.restore(); }
  });
  test("sort and list view live in the address", async () => {
    const server = serve({ items: [item("f1", "Fox")] });
    try {
      page("owner", "/files?sort=size&view=list");
      await waitFor(() => expect(document.querySelector('[data-slot="data-table"]')).not.toBeNull());
      await waitFor(() => expect(server.listUrls().some((query) => query.get("sort") === "size")).toBe(true));
      fireEvent.click(within(document.body).getByRole("button", { name: "Grid view" }));
      await waitFor(() => expect(where()).toBe("?sort=size"));
      expect(document.querySelector('[data-slot="file-grid"]')).not.toBeNull();
    } finally { server.restore(); }
  });
  test("the table's Name header sorts through the hub, not in the browser", async () => {
    const server = serve({ items: [item("f1", "Fox")] });
    try {
      page("owner", "/files?view=list");
      await waitFor(() => expect(document.querySelector('[data-slot="data-table"]')).not.toBeNull());
      fireEvent.click(within(document.body).getAllByRole("button", { name: /Sort by Name/ })[0]!);
      await waitFor(() => expect(where()).toContain("sort=name"));
    } finally { server.restore(); }
  });
});

describe("layout by screen", () => {
  test("wide: the section column with Settings at its foot, and no chip row", async () => {
    stubMatchMedia({ [WIDE]: true, [VIEWER_WIDE]: true });
    const server = serve({ items: [item("f1", "Fox")] });
    try {
      page();
      await waitFor(() => expect(tile("Fox")).toBeTruthy());
      const column = document.querySelector("#library-sidebar")!;
      expect(column.textContent).toContain("Settings");
      expect(["All files", "Pictures", "Videos", "Songs", "Documents", "Shared with me", "Shared by me", "Only me", "Trash"].every((label) => column.textContent!.includes(label))).toBe(true);
      expect(document.querySelector('[aria-label="Library sections"]')).toBeNull();
    } finally { server.restore(); }
  });
  test("phone: a chip row of the same sections and a search box in the page", async () => {
    stubMatchMedia({ [PHONE]: true });
    const server = serve({ items: [item("f1", "Fox")] });
    try {
      page();
      await waitFor(() => expect(tile("Fox")).toBeTruthy());
      const chips = document.querySelector('[aria-label="Library sections"]') as HTMLElement;
      expect(chips).not.toBeNull();
      expect(within(chips).getByText("Only me")).toBeTruthy();
      fireEvent.click(within(chips).getByText("Videos"));
      await waitFor(() => expect(where()).toBe("?section=videos"));
    } finally { server.restore(); }
  });
  test("the column can be hidden and the choice is remembered for this person", async () => {
    const server = serve({ items: [item("f1", "Fox")] });
    try {
      page();
      await waitFor(() => expect(tile("Fox")).toBeTruthy());
      fireEvent.click(within(document.body).getByRole("button", { name: "Hide sidebar" }));
      expect(localStorage.getItem("maipai.library.sidebar-collapsed.person-me")).toBe("1");
      await waitFor(() => expect(within(document.body).getByRole("button", { name: "Show sidebar" })).toBeTruthy());
      cleanup();
      page();
      await waitFor(() => expect(within(document.body).getByRole("button", { name: "Show sidebar" })).toBeTruthy());
    } finally { server.restore(); }
  });
});

describe("selection, batch actions and Trash", () => {
  test("Select shows the batch bar; Delete asks first, then moves to Trash with the per-item result", async () => {
    const server = serve({ items: [item("f1", "Fox"), item("f2", "Garden", { owner: { id: "person-other", display_name: "Sage" } })] });
    try {
      page();
      await waitFor(() => expect(tile("Fox")).toBeTruthy());
      fireEvent.click(within(document.body).getByRole("button", { name: "Select" }));
      fireEvent.click(tile("Fox")!);
      fireEvent.click(tile("Garden")!);
      await waitFor(() => expect(document.querySelector('[role="toolbar"][aria-label="Batch actions"]')?.textContent).toContain("2 selected"));
      fireEvent.click(within(document.querySelector('[role="toolbar"]') as HTMLElement).getByRole("button", { name: "Delete" }));
      expect(document.body.textContent).toContain("Move 2 files to Trash?");
      expect(server.calls.some((call) => call.method === "DELETE")).toBe(false);
      fireEvent.click(within(document.body).getByRole("button", { name: "Move to Trash" }));
      await waitFor(() => expect(server.calls.filter((call) => call.method === "DELETE" && call.url === "/api/files/f1").length).toBe(1));
      // The file that is not theirs is never sent to the hub.
      expect(server.calls.some((call) => call.url === "/api/files/f2" && call.method === "DELETE")).toBe(false);
    } finally { server.restore(); }
  });
  test("Keep pins the selected files", async () => {
    const server = serve({ items: [item("f1", "Fox", { retention: "conversation" })] });
    try {
      page();
      await waitFor(() => expect(tile("Fox")).toBeTruthy());
      fireEvent.click(within(document.body).getByRole("button", { name: "Select" }));
      fireEvent.click(tile("Fox")!);
      fireEvent.click(within(document.querySelector('[role="toolbar"]') as HTMLElement).getByRole("button", { name: "Keep" }));
      await waitFor(() => expect(server.calls.some((call) => call.url === "/api/files/f1" && call.method === "PATCH")).toBe(true));
    } finally { server.restore(); }
  });
  test("the S key turns selection on and the slash key focuses search", async () => {
    const server = serve({ items: [item("f1", "Fox")] });
    try {
      page();
      await waitFor(() => expect(tile("Fox")).toBeTruthy());
      fireEvent.keyDown(document, { key: "s" });
      await waitFor(() => expect(document.querySelector('[role="toolbar"][aria-label="Batch actions"]')).not.toBeNull());
      fireEvent.keyDown(document, { key: "s" });
      await waitFor(() => expect(document.querySelector('[role="toolbar"][aria-label="Batch actions"]')).toBeNull());
      fireEvent.keyDown(document, { key: "/" });
      await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("Search your Library"));
    } finally { server.restore(); }
  });
  test("the Trash section lists deleted files with days left and Restore", async () => {
    const server = serve({ trash: [{ kind: "file", id: "f9", title: "Old picture", deleted_at: "2026-10-17T00:00:00.000Z", trash_until: new Date(Date.now() + 5 * 86_400_000 + 3_600_000).toISOString(), can_restore: true, can_purge: true }, { kind: "media_item", id: "m1", title: "A saved video", deleted_at: "2026-10-17T00:00:00.000Z", trash_until: null, can_restore: true, can_purge: true }] });
    try {
      page("owner", "/files?section=trash");
      await waitFor(() => expect(document.querySelector('[data-testid="library-trash"]')?.textContent).toContain("Old picture"));
      const trash = document.querySelector('[data-testid="library-trash"]') as HTMLElement;
      expect(trash.textContent).toContain("6 days left");
      expect(trash.textContent).not.toContain("A saved video");
      fireEvent.click(within(trash).getByRole("button", { name: "Restore Old picture" }));
      await waitFor(() => expect(server.calls.some((call) => call.url === "/api/trash/file/f9/restore" && call.method === "POST")).toBe(true));
    } finally { server.restore(); }
  });
  test("Delete forever and Empty Trash ask first", async () => {
    const server = serve({ trash: [{ kind: "file", id: "f9", title: "Old picture", deleted_at: "2026-10-17T00:00:00.000Z", trash_until: null, can_restore: true, can_purge: true }] });
    try {
      page("owner", "/files?section=trash");
      await waitFor(() => expect(document.querySelector('[data-testid="library-trash"]')).not.toBeNull());
      fireEvent.click(within(document.body).getByRole("button", { name: "Empty Trash" }));
      expect(document.body.textContent).toContain("Delete 1 file forever?");
      expect(server.calls.some((call) => call.method === "DELETE")).toBe(false);
      fireEvent.click(within(document.body).getByRole("button", { name: "Delete forever" }));
      await waitFor(() => expect(server.calls.some((call) => call.url === "/api/trash/file/f9" && call.method === "DELETE")).toBe(true));
    } finally { server.restore(); }
  });
});

describe("viewer, menu, sharing and roles", () => {
  test("a Home song uses the lyrics player in the viewer, and Edit is owner-only", async () => {
    const music = { id: "song-job", title: "River song", description: "folk", lyrics: "[Verse]\nMorning light", timed_lyrics: [{ t: 1, line: "Morning light", section: null }], cover_url: "/api/files/f-song/thumb?w=640", versions: [{ id: "f-song", label: "Version 1", url: "/api/files/f-song/content" }], current_id: "f-song", owner: true };
    const server = serve({ items: [item("f-song", "River song", { kind: "audio", media_type: "audio/mp4", duration_seconds: 42 })], music });
    try {
      page("owner", "/files?file=f-song");
      const dialog = await waitFor(() => { const el = document.querySelector('[role="dialog"]'); expect(el).not.toBeNull(); return el as HTMLElement; });
      await waitFor(() => expect(dialog.querySelector("audio")).not.toBeNull());
      fireEvent.click(within(dialog).getByRole("button", { name: "Lyrics" }));
      await waitFor(() => expect(dialog.textContent).toContain("Morning light"));
      expect(within(dialog).getByRole("button", { name: "Edit" })).toBeTruthy();
    } finally { server.restore(); }
    const shared = serve({ items: [item("f-song", "River song", { kind: "audio", media_type: "audio/mp4", owner: { id: "person-other", display_name: "Sage" } })], music: { ...music, owner: false } });
    try {
      page("adult", "/files?file=f-song");
      await waitFor(() => expect(document.querySelector('[role="dialog"] audio')).not.toBeNull());
      expect(document.querySelector('[role="dialog"]')?.querySelector('[aria-label="Edit"]')).toBeNull();
      expect(document.body.textContent).toContain("Lyrics");
    } finally { shared.restore(); }
  });

  test("a link with ?file= opens the viewer on that file with its details; closing removes it from the address", async () => {
    const server = serve({ items: [item("f1", "Fox in the snow"), item("f2", "Garden at dawn", { shared_with: { count: 1, household: true } })] });
    try {
      page("owner", "/files?file=f2");
      const dialog = await waitFor(() => { const el = document.querySelector('[role="dialog"]'); expect(el).not.toBeNull(); return el as HTMLElement; });
      await waitFor(() => expect(dialog.textContent).toContain("Garden at dawn"));
      await waitFor(() => expect(dialog.textContent).toContain("Everyone in the home can see this."));
      expect(dialog.textContent).toContain("Kept until you delete it.");
      fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
      await waitFor(() => expect(where()).toBe(""));
    } finally { server.restore(); }
  });

  test("the Origin detail links a chat file to its exact turn", async () => {
    const server = serve({ items: [item("f-chat-origin", "Lake picture", { origin: "made", chat_id: "conv-origin", turn_id: "turn-origin", chat_title: "Weekend plans" })] });
    try {
      page("owner", "/files?file=f-chat-origin");
      const link = await within(document.body).findByRole("link", { name: "Made in chat: Weekend plans" });
      expect(link.getAttribute("href")).toBe("/chat?conversation=conv-origin&turn=turn-origin");
      expect(document.body.textContent).toContain("Origin");
    } finally { server.restore(); }
  });

  test("deleted and fetched items show plain Origin text", async () => {
    const server = serve({ items: [item("f-deleted-origin", "Old picture", { origin: "made", chat_deleted: true })] });
    try {
      page("owner", "/files?file=f-deleted-origin");
      await waitFor(() => expect(document.body.textContent).toContain("The chat was deleted"));
      expect(document.querySelector('a[href^="/chat?"]')).toBeNull();
    } finally { server.restore(); }
  });
  test("a tile opens the viewer and puts the file in the address", async () => {
    const server = serve({ items: [item("f1", "Fox in the snow")] });
    try {
      page();
      await waitFor(() => expect(tile("Fox in the snow")).toBeTruthy());
      fireEvent.click(tile("Fox in the snow")!);
      await waitFor(() => expect(where()).toBe("?file=f1"));
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    } finally { server.restore(); }
  });
  test("the tile menu offers Share, Rename, Keep and Delete for your own file, and only Open and Download for another's", async () => {
    const server = serve({ items: [item("f1", "Mine", { retention: "conversation" }), item("f2", "Theirs", { owner: { id: "person-other", display_name: "Sage" } })] });
    try {
      page();
      await waitFor(() => expect(tile("Mine")).toBeTruthy());
      const open = async (name: string) => {
        const trigger = document.querySelector<HTMLElement>(`[aria-label="Actions for ${name}"]`)!;
        fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
        return await waitFor(() => { const menu = document.querySelector('[role="menu"]'); expect(menu).not.toBeNull(); return menu as HTMLElement; });
      };
      const mine = await open("Mine");
      expect(Array.from(mine.querySelectorAll('[role="menuitem"]')).map((el) => el.textContent)).toEqual(["Open", "Download", "Share", "Rename", "Keep", "Delete"]);
      fireEvent.keyDown(mine, { key: "Escape" });
      await waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
      const theirs = await open("Theirs");
      expect(Array.from(theirs.querySelectorAll('[role="menuitem"]')).map((el) => el.textContent)).toEqual(["Open", "Download"]);
    } finally { server.restore(); }
  });
  test("Share opens the dialog over the existing share route; turning on a person adds a share", async () => {
    const server = serve({ items: [item("f1", "Fox")] });
    try {
      page();
      await waitFor(() => expect(tile("Fox")).toBeTruthy());
      const trigger = document.querySelector<HTMLElement>('[aria-label="Actions for Fox"]')!;
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
      fireEvent.click(await waitFor(() => within(document.body).getByRole("menuitem", { name: "Share" })));
      const dialog = await waitFor(() => { const el = document.querySelector('[role="dialog"]'); expect(el?.textContent).toContain("Share Fox"); return el as HTMLElement; });
      await waitFor(() => expect(dialog.textContent).toContain("Sage"));
      const sage = within(dialog).getAllByRole("switch").find((el) => el.getAttribute("aria-label")?.includes("Sage"))!;
      fireEvent.click(sage);
      await waitFor(() => expect(server.calls.some((call) => call.url === "/api/files/f1/shares" && call.method === "POST")).toBe(true));
    } finally { server.restore(); }
  });
  test("a child has no Share, no Shared by me and asks a grown-up to add a file", async () => {
    const server = serve({ items: [item("f1", "Fox")] });
    try {
      page("child");
      await waitFor(() => expect(tile("Fox")).toBeTruthy());
      const column = document.querySelector("#library-sidebar")!;
      expect(column.textContent).not.toContain("Shared by me");
      expect(within(document.body).queryByRole("button", { name: "Upload" })).toBeNull();
      expect(within(document.body).getByRole("button", { name: "Ask to add a file" })).toBeTruthy();
      const trigger = document.querySelector<HTMLElement>('[aria-label="Actions for Fox"]')!;
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
      await waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
      expect(within(document.querySelector('[role="menu"]') as HTMLElement).queryByRole("menuitem", { name: "Share" })).toBeNull();
    } finally { server.restore(); }
  });
  test("Mark all-ages shows only for an adult owner on an adults-only picture", async () => {
    const adultOnly = item("f1", "After hours", { audience: "adult-only", retention: "conversation" });
    for (const [role, expected] of [["adult", true], ["teen", false]] as const) {
      const server = serve({ items: [adultOnly] });
      try {
        page(role);
        await waitFor(() => expect(tile("After hours")).toBeTruthy());
        const trigger = document.querySelector<HTMLElement>('[aria-label="Actions for After hours"]')!;
        fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
        await waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
        expect(within(document.querySelector('[role="menu"]') as HTMLElement).queryByRole("menuitem", { name: "Mark all-ages" }) !== null).toBe(expected);
      } finally { server.restore(); cleanup(); }
    }
  });
  test("the storage meter shows the person's own bytes and Identical files count once", async () => {
    const server = serve({ items: [item("f1", "Fox")] });
    try {
      page();
      await waitFor(() => expect(document.querySelector('[data-testid="library-storage"]')?.textContent).toContain("3 MB of 20 GB used"));
      const bar = document.querySelector('[data-slot="storage-bar"]')!;
      expect(bar.getAttribute("aria-label")).toContain("Pictures 2 MB");
      expect(document.querySelector('[data-testid="library-storage"]')?.textContent).toContain("Identical files count once.");
    } finally { server.restore(); }
  });
});

describe("uploads", () => {
  class FakeXhr {
    static last: FakeXhr | null = null;
    static outcome: { status: number; body: string } = { status: 201, body: "{}" };
    upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number }) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null; onerror: (() => void) | null = null; onabort: (() => void) | null = null;
    status = 0; responseText = ""; withCredentials = false; method = ""; url = "";
    open(method: string, url: string) { this.method = method; this.url = url; FakeXhr.last = this; }
    addEventListener() {}
    send() { setTimeout(() => { this.upload.onprogress?.({ lengthComputable: true, loaded: 1 }); this.status = FakeXhr.outcome.status; this.responseText = FakeXhr.outcome.body; this.onload?.(); }, 0); }
    abort() { this.onabort?.(); }
  }
  const original = globalThis.XMLHttpRequest;
  beforeEach(() => { (globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr; FakeXhr.last = null; });
  afterEach(() => { globalThis.XMLHttpRequest = original; });
  const choose = (name = "notes.txt") => {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { value: [new File(["hello"], name, { type: "text/plain" })], configurable: true });
    fireEvent.change(input);
  };

  test("a chosen file goes up as one request with a progress card and the Library refreshes", async () => {
    FakeXhr.outcome = { status: 201, body: JSON.stringify({ id: "f9", name: "notes.txt", kind: "document", media_type: "text/plain", size_bytes: 5, duplicate: false }) };
    const server = serve({ items: [item("f1", "Fox")] });
    try {
      page();
      await waitFor(() => expect(tile("Fox")).toBeTruthy());
      const before = server.listUrls().length;
      choose();
      await waitFor(() => expect(document.querySelector('[data-slot="job-progress"]')?.textContent).toContain("notes.txt"));
      expect(FakeXhr.last).toMatchObject({ method: "POST", url: "/api/library/upload", withCredentials: true });
      await waitFor(() => expect(document.querySelector('[data-slot="job-progress"]')?.textContent).toContain("Added"));
      await waitFor(() => expect(server.listUrls().length).toBeGreaterThan(before));
    } finally { server.restore(); }
  });
  test("a refused file shows the hub's plain sentence and Try again", async () => {
    FakeXhr.outcome = { status: 403, body: JSON.stringify({ error: "Your storage is full. Delete some files, or ask a grown-up for more room." }) };
    const server = serve({ items: [item("f1", "Fox")] });
    try {
      page();
      await waitFor(() => expect(tile("Fox")).toBeTruthy());
      choose("big.mov");
      await waitFor(() => expect(document.querySelector('[data-testid="library-page"]')?.textContent).toContain("Your storage is full. Delete some files, or ask a grown-up for more room."));
      expect(within(document.body).getByRole("button", { name: "Try again" })).toBeTruthy();
    } finally { server.restore(); }
  });
  test("a child's Upload asks a grown-up and sends nothing", async () => {
    const server = serve({ items: [item("f1", "Fox")] });
    try {
      page("child");
      await waitFor(() => expect(tile("Fox")).toBeTruthy());
      choose();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(FakeXhr.last).toBeNull();
      expect(document.querySelector('[data-slot="job-progress"]')).toBeNull();
    } finally { server.restore(); }
  });
});
