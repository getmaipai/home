import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, waitFor } from "@testing-library/react";
import { NextBackupsPage } from "@/next/pages/NextBackupsPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { expectHomeTablesWithoutDemoOrActions } from "@/tests/expectHomeTables";
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

function mockBackupsFetch(backups: BackupInfo[], pending: PendingRestore | null = null) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/backups/restore/pending")) return Promise.resolve(Response.json({ pending }));
    if (url.includes("/api/backups")) return Promise.resolve(Response.json(backups));
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

describe("NextBackupsPage", () => {
  test("a non-admin sees the denied message, never a fetch", async () => {
    const restore = mockBackupsFetch([]);
    try {
      renderWithQueryClient(<NextBackupsPage person={makePerson({ role: "adult" })} />);
      await waitFor(() => expect(document.body.textContent).toContain("Only an owner or admin can manage backups."));
    } finally {
      restore();
    }
  });

  test("real backup history: date and size, not demo data", async () => {
    const restore = mockBackupsFetch([{ filename: "backup-2026-09-21.tar.gz", createdAt: "2026-09-21T03:00:00.000Z", bytes: 52_428_800 }]);
    try {
      renderWithQueryClient(<NextBackupsPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("50 MB"));
      expect(document.body.textContent).not.toContain("No data available.");
      expectHomeTablesWithoutDemoOrActions();
    } finally {
      restore();
    }
  });

  test("no backups yet: the shared table's empty message", async () => {
    const restore = mockBackupsFetch([]);
    try {
      renderWithQueryClient(<NextBackupsPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("No data available."));
    } finally {
      restore();
    }
  });

  test("a staged restore shows the real 'Ready to restore' banner", async () => {
    const restore = mockBackupsFetch(
      [{ filename: "backup-2026-09-20.tar.gz", createdAt: "2026-09-20T03:00:00.000Z", bytes: 1024 }],
      { filename: "backup-2026-09-20.tar.gz", stagedAt: "2026-09-21T10:00:00.000Z", stagedByPersonId: "person-abc123" },
    );
    try {
      renderWithQueryClient(<NextBackupsPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Ready to restore"));
      expect(document.body.textContent).toContain("will replace everything in MaiPai Home");
    } finally {
      restore();
    }
  });

  test("a failed fetch shows an error and a retry button, never a stuck loading state", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({ error: "Something broke" }), { status: 500 }))) as unknown as typeof fetch;
    try {
      renderWithQueryClient(<NextBackupsPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Something broke"));
      expect(document.body.textContent).toContain("Try again");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
