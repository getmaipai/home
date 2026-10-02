import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextFilesPage } from "@/next/pages/NextFilesPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { Roster, VisibleFile } from "@/lib/api";

afterEach(cleanup);

function makePerson(): Roster {
  return { id: "person-abc123", display_name: "Nova", nickname: null, role: "owner", avatar_seed: "person-abc123", source: "hub", local_only: false, created_at: "2026-09-04T00:00:00.000Z", updated_at: "2026-09-04T00:00:00.000Z", deleted_at: null, enabled: true, guest_expires_at: null, memorialized_at: null, hlc: "1788000000000:0:test", hasSecret: true } as Roster;
}

function file(id: string, owner: string, shared = false, kind: "image" | "document" = "image"): VisibleFile {
  return { owner_person_id: owner, shared, file: { id, owner_person_id: owner, origin: "made", kind, media_type: kind === "image" ? "image/png" : "application/pdf", size: 2048, sha256: "a".repeat(64), storage_path: `people/${owner}/files/${id}`, retention: "kept", provenance: {}, created_at: "2026-09-04T00:00:00.000Z", hlc: "1788000000000:0:test" } as VisibleFile["file"] as VisibleFile["file"] };
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

describe("NextFilesPage", () => {
  test("explains what the Library will hold when there are no files", async () => {
    const { restore } = mockFetch([]);
    try {
      renderWithQueryClient(<NextFilesPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Nothing here yet. Stories, pictures and documents you make in chat are kept here."));
    } finally { restore(); }
  });

  test("shows owned and shared files under their real owners and filters the list", async () => {
    const { restore } = mockFetch([file("file-abc123", "person-abc123"), file("file-sage123", "person-sage123", true, "document")]);
    try {
      renderWithQueryClient(<NextFilesPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("image/png"));
      expect(document.body.textContent).toContain("You");
      expect(document.body.textContent).toContain("Sage");
      fireEvent.change(document.querySelector("#library-search")!, { target: { value: "Sage" } });
      await waitFor(() => expect(document.body.textContent).not.toContain("image/png"));
      expect(document.body.textContent).toContain("application/pdf");
    } finally { restore(); }
  });

  test("file details preserve retention and share/unshare actions", async () => {
    const { fetchMock, restore } = mockFetch([file("file-abc123", "person-abc123")]);
    try {
      renderWithQueryClient(<NextFilesPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("image/png"));
      fireEvent.click(document.querySelector('[aria-label="More actions"]')!);
      fireEvent.click(await waitFor(() => document.querySelector('[role="menuitem"]')!));
      await waitFor(() => expect(document.body.textContent).toContain("Kept until deleted"));
      expect(document.body.textContent).toContain("Sage");
      fireEvent.click(document.querySelectorAll("button").item(Array.from(document.querySelectorAll("button")).findIndex((button) => button.textContent === "Unshare"))!);
      await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => String(input).includes("/api/shares/share-abc123") && init?.method === "DELETE")).toBe(true));
    } finally { restore(); }
  });
});
