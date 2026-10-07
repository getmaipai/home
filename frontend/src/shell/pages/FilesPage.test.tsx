import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { FilesPage } from "@/shell/pages/FilesPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { Roster, VisibleFile } from "@/lib/api";

afterEach(cleanup);

function makePerson(): Roster {
  return { id: "person-abc123", display_name: "Nova", nickname: null, role: "owner", avatar_seed: "person-abc123", source: "hub", local_only: false, created_at: "2026-09-04T00:00:00.000Z", updated_at: "2026-09-04T00:00:00.000Z", deleted_at: null, enabled: true, guest_expires_at: null, memorialized_at: null, hlc: "1788000000000:0:test", hasSecret: true } as Roster;
}

type FileKind = "image" | "video" | "audio" | "document" | "story" | "other";
const MIME_TYPES: Record<FileKind, string> = {
  image: "image/png", video: "video/mp4", audio: "audio/mpeg", document: "application/pdf", story: "text/markdown", other: "application/octet-stream",
};

function file(id: string, owner: string, shared = false, kind: FileKind = "image"): VisibleFile {
  return { owner_person_id: owner, shared, household: false, former_owner_name: null, file: { id, owner_person_id: owner, origin: "made", kind, media_type: MIME_TYPES[kind], size: 2048, sha256: "a".repeat(64), storage_path: `people/${owner}/files/${id}`, retention: "kept", provenance: {}, created_at: "2026-09-04T00:00:00.000Z", hlc: "1788000000000:0:test" } as VisibleFile["file"] as VisibleFile["file"] };
}

function mockFetch(files: VisibleFile[]) {
  const originalFetch = globalThis.fetch;
  const fetchMock = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
    if (url.includes("/api/files/") && url.includes("/shares")) return Promise.resolve(Response.json([{ id: "share-abc123", file_id: "file-abc123", from_person_id: "person-abc123", to: "person-sage123", provenance: "library", created_at: "2026-09-04T00:00:00.000Z", hlc: "1788000000000:0:test" }]));
    if (url.includes("/api/files")) return Promise.resolve(Response.json(files));
    if (url.includes("/api/people")) return Promise.resolve(Response.json([{ id: "person-abc123", display_name: "Nova" }, { id: "person-sage123", display_name: "Sage" }]));
    if (url.includes("/api/shares/") && init?.method === "DELETE") return Promise.resolve(Response.json({ deletedShareIds: ["share-abc123"] }));
    if (url.includes("/api/files/") && init?.method === "POST") return Promise.resolve(Response.json({ id: "share-new123" }));
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, restore: () => { globalThis.fetch = originalFetch; } };
}

describe("FilesPage", () => {
  test("explains what the Library will hold when there are no files", async () => {
    const { restore } = mockFetch([]);
    try {
      renderWithQueryClient(<FilesPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Nothing here yet. Stories, pictures and documents you make in chat are kept here."));
    } finally { restore(); }
  });

  test("the kit table sorts its returned Library rows by owner", async () => {
    const { restore } = mockFetch([file("file-owned123", "person-abc123"), file("file-shared123", "person-sage123", true, "document")]);
    try {
      renderWithQueryClient(<FilesPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("image/png"));
      const header = document.querySelector('[data-slot="data-table-header-row"] button[aria-label="Sort by Owner"]')!;
      fireEvent.click(header);
      await waitFor(() => {
        const rows = Array.from(document.querySelectorAll('[data-slot="data-table-body"] [data-slot="data-table-row"]'));
        expect(rows[0]?.textContent).toContain("Sage");
        expect(rows[1]?.textContent).toContain("You");
      });
    } finally { restore(); }
  });

  test("shows owned and shared files under their real owners and filters the list", async () => {
    const { restore } = mockFetch([file("file-abc123", "person-abc123"), file("file-sage123", "person-sage123", true, "document")]);
    try {
      renderWithQueryClient(<FilesPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("image/png"));
      expect(document.body.textContent).toContain("You");
      expect(document.body.textContent).toContain("Sage");
      fireEvent.change(document.querySelector<HTMLInputElement>("#library-search")!, { target: { value: "Sage" } });
      await waitFor(() => expect(document.body.textContent).not.toContain("image/png"));
      expect(document.body.textContent).toContain("application/pdf");
    } finally { restore(); }
  });

  test("a file shared by someone no longer here is listed under the household, with who shared it", async () => {
    const left = { ...file("file-left123", "person-gone123", true), household: true, former_owner_name: "Bramble" };
    const { restore } = mockFetch([left]);
    try {
      renderWithQueryClient(<FilesPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Household, shared by Bramble"));
      expect(document.body.textContent).not.toContain("person-gone123");
    } finally { restore(); }
  });

  test("file details preserve retention and share/unshare actions", async () => {
    const { fetchMock, restore } = mockFetch([file("file-abc123", "person-abc123")]);
    try {
      renderWithQueryClient(<FilesPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("image/png"));
      fireEvent.click(document.querySelector('[aria-label="More actions"]')!);
      fireEvent.click(await waitFor(() => document.querySelector('[role="menuitem"]')!));
      await waitFor(() => expect(document.body.textContent).toContain("Kept until deleted"));
      expect(document.body.textContent).toContain("Sage");
      fireEvent.click(document.querySelectorAll("button").item(Array.from(document.querySelectorAll("button")).findIndex((button) => button.textContent === "Unshare"))!);
      await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => String(input).includes("/api/shares/share-abc123") && init?.method === "DELETE")).toBe(true));
    } finally { restore(); }
  });

  test("kit row actions stay attached to the selected file row", async () => {
    const { restore } = mockFetch([
      file("file-first123", "person-abc123"),
      file("file-second123", "person-abc123", false, "document"),
    ]);
    try {
      renderWithQueryClient(<FilesPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("application/pdf"));
      const row = Array.from(document.querySelectorAll('[data-slot="data-table-body"] [data-slot="data-table-row"]'))
        .find((candidate) => candidate.textContent?.includes("application/pdf")) as HTMLElement;
      fireEvent.click(row.querySelector('[aria-label="More actions"]')!);
      fireEvent.click(await waitFor(() => document.querySelector('[role="menuitem"]')!));
      await waitFor(() => expect(document.body.textContent).toContain("file-second123"));
      expect(document.body.textContent).not.toContain("file-first123");
    } finally { restore(); }
  });

  test("File parts show name, size and the Library download route for every file kind", async () => {
    const kinds: FileKind[] = ["image", "video", "audio", "document", "story", "other"];
    for (const kind of kinds) {
      const id = `file-${kind}123`;
      const { restore } = mockFetch([file(id, "person-abc123", false, kind)]);
      try {
        const { container } = renderWithQueryClient(<FilesPage person={makePerson()} />);
        await waitFor(() => expect(document.body.textContent).toContain(MIME_TYPES[kind]));
        fireEvent.click(document.querySelector('[aria-label="More actions"]')!);
        fireEvent.click(await waitFor(() => document.querySelector('[role="menuitem"]')!));
        const name = await waitFor(() => container.querySelector('[data-slot="file-name"]'));
        expect(name?.textContent).toBe(id);
        expect(container.querySelector('[data-slot="file-size"]')?.textContent).toBe("2.0 KB");
        const download = container.querySelector<HTMLAnchorElement>('[data-slot="file-download"]');
        expect(download?.href).toBe(`http://localhost/api/files/${id}/content`);
        expect(download?.download).toBe(id);
      } finally { restore(); cleanup(); }
    }
  });

  test("kit search and source and kind filters continue to filter the returned file rows", async () => {
    const { restore } = mockFetch([
      file("file-owned123", "person-abc123", false, "image"),
      file("file-shared123", "person-sage123", true, "document"),
      file("file-audio123", "person-abc123", false, "audio"),
    ]);
    try {
      renderWithQueryClient(<FilesPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("image/png"));
      const source = document.querySelector('[aria-label="Whose"]')!;
      fireEvent.click(source);
      fireEvent.click(await waitFor(() => document.querySelector('[role="option"]:nth-child(2)')!));
      await waitFor(() => expect(document.body.textContent).not.toContain("application/pdf"));
      expect(document.body.textContent).toContain("image/png");
      expect(document.body.textContent).toContain("audio/mpeg");
      const kind = document.querySelector('[aria-label="Kind"]')!;
      fireEvent.click(kind);
      fireEvent.click(await waitFor(() => Array.from(document.querySelectorAll('[role="option"]')).find((option) => option.textContent === "Image")!));
      await waitFor(() => expect(document.body.textContent).toContain("image/png"));
      expect(document.body.textContent).not.toContain("audio/mpeg");
      fireEvent.change(document.querySelector<HTMLInputElement>("#library-search")!, { target: { value: "no match" } });
      await waitFor(() => expect(document.body.textContent).toContain("Nothing here yet."));
    } finally { restore(); }
  });

  test("a child only sees the files returned by the visibility-filtered Library route", async () => {
    const child = { ...makePerson(), id: "person-child123", role: "child" } as Roster;
    const { fetchMock, restore } = mockFetch([file("file-visible123", child.id, false, "image")]);
    try {
      renderWithQueryClient(<FilesPage person={child} />);
      await waitFor(() => expect(document.body.textContent).toContain("image/png"));
      expect(document.body.textContent).not.toContain("file-private123");
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/files"))).toBe(true);
    } finally { restore(); }
  });
});
