import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup } from "@testing-library/react";
import { BackupsPage } from "@/shell/pages/BackupsPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { BackupInfo, PendingRestore, Roster } from "@/lib/api";

afterEach(() => {
  cleanup();
});

function makePerson(overrides: Partial<Roster> = {}): Roster {
  return {
    id: "person-abc123",
    display_name: "Nova",
    nickname: null,
    role: "owner",
    avatar_seed: "person-abc123",
    source: "hub",
    local_only: false,
    created_at: "2026-09-04T00:00:00.000Z",
    updated_at: "2026-09-04T00:00:00.000Z",
    deleted_at: null,
    enabled: true,
    guest_expires_at: null,
    memorialized_at: null,
    hlc: "1788000000000:0:test",
    hasSecret: true,
    ...overrides,
  } as Roster;
}

function mockBackupsFetch(backups: BackupInfo[], initialPending: PendingRestore | null = null) {
  const originalFetch = globalThis.fetch;
  let pending = initialPending;
  const fetchMock = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
    if (url.includes("/api/backups/restore/pending")) return Promise.resolve(Response.json({ pending }));
    if (url.endsWith("/api/backups/run")) return Promise.resolve(Response.json({ filename: "backup-new.tar.gz", createdAt: "2026-09-22T03:00:00.000Z", bytes: 1024 }));
    const stageMatch = url.match(/\/api\/backups\/([^/]+)\/restore$/);
    if (stageMatch) {
      pending = { filename: decodeURIComponent(stageMatch[1]!), stagedAt: "2026-09-21T10:00:00.000Z", stagedByPersonId: "person-abc123" };
      return Promise.resolve(Response.json({ pending }));
    }
    if (url.endsWith("/api/backups/restore/cancel")) {
      pending = null;
      return Promise.resolve(Response.json({ cancelled: true }));
    }
    if (url.includes("/api/backups")) return Promise.resolve(Response.json(backups));
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return {
    fetchMock,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

describe("BackupsPage", () => {
  test("renders the shared backups section under the page header", () => {
    const { restore } = mockBackupsFetch([]);
    try {
      renderWithQueryClient(<BackupsPage person={makePerson()} />);
      expect(document.body.textContent).toContain("Save your backup key");
      expect(document.body.textContent).toContain("Back up now");
    } finally {
      restore();
    }
  });

});
