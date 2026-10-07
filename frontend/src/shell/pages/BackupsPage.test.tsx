import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { BackupsPage } from "@/shell/pages/BackupsPage";
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
  test("a non-admin sees the denied message, never a fetch", async () => {
    const { restore } = mockBackupsFetch([]);
    try {
      renderWithQueryClient(<BackupsPage person={makePerson({ role: "adult" })} />);
      await waitFor(() => expect(document.body.textContent).toContain("Only an owner or admin can manage backups."));
    } finally {
      restore();
    }
  });

  test("real backup history: date and size, not demo data", async () => {
    const { restore } = mockBackupsFetch([{ filename: "backup-2026-09-21.tar.gz", createdAt: "2026-09-21T03:00:00.000Z", bytes: 52_428_800 }]);
    try {
      renderWithQueryClient(<BackupsPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("50 MB"));
      expect(document.body.textContent).not.toContain("No data available.");
      expectHomeTablesWithoutDemoOrActions();
    } finally {
      restore();
    }
  });

  test("no backups yet: the shared table's empty message", async () => {
    const { restore } = mockBackupsFetch([]);
    try {
      renderWithQueryClient(<BackupsPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("No data available."));
    } finally {
      restore();
    }
  });

  test("a staged restore shows the real 'Ready to restore' banner", async () => {
    const { restore } = mockBackupsFetch(
      [{ filename: "backup-2026-09-20.tar.gz", createdAt: "2026-09-20T03:00:00.000Z", bytes: 1024 }],
      { filename: "backup-2026-09-20.tar.gz", stagedAt: "2026-09-21T10:00:00.000Z", stagedByPersonId: "person-abc123" },
    );
    try {
      renderWithQueryClient(<BackupsPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Ready to restore"));
      expect(document.body.textContent).toContain("will replace everything in MaiPai Home");
      expect(document.body.textContent).toContain(new Date("2026-09-20T03:00:00.000Z").toLocaleString());
      expect(document.body.textContent).not.toContain(new Date("2026-09-21T10:00:00.000Z").toLocaleString());
    } finally {
      restore();
    }
  });

  test("a failed fetch shows an error and a retry button, never a stuck loading state", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({ error: "Something broke" }), { status: 500 }))) as unknown as typeof fetch;
    try {
      renderWithQueryClient(<BackupsPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Something broke"));
      expect(document.body.textContent).toContain("Try again");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("Back up now runs a backup", async () => {
    const { fetchMock, restore } = mockBackupsFetch([]);
    try {
      renderWithQueryClient(<BackupsPage person={makePerson()} />);
      await waitFor(() => expect(Array.from(document.querySelectorAll("button")).some((candidate) => candidate.textContent === "Back up now")).toBe(true));
      const button = Array.from(document.querySelectorAll("button")).find((candidate) => candidate.textContent === "Back up now")!;
      fireEvent.click(button);
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/backups/run"), expect.objectContaining({ method: "POST" })));
    } finally {
      restore();
    }
  });

  test("Restore names the backup, requires confirmation, then stages its filename", async () => {
    const { fetchMock, restore } = mockBackupsFetch([{ filename: "backup-2026-09-20.tar.gz", createdAt: "2026-09-20T03:00:00.000Z", bytes: 1024 }]);
    try {
      renderWithQueryClient(<BackupsPage person={makePerson()} />);
      const backupDate = new Date("2026-09-20T03:00:00.000Z").toLocaleString();
      await waitFor(() => expect(document.body.textContent).toContain(backupDate));
      const row = Array.from(document.querySelectorAll('[data-slot="table-row"]')).find((item) => item.textContent?.includes(backupDate))!;
      fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "More actions" }));
      fireEvent.click(await within(document.body).findByRole("menuitem", { name: "Restore" }));
      expect(document.body.textContent).toContain("Restore the backup from");
      expect(document.body.textContent).toContain("Everyone in your household, everything MaiPai remembers, and every conversation will go back to how they were then. Anything added since will be gone. This takes effect the next time MaiPai Home starts.");
      expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/api/backups/backup-2026-09-20.tar.gz/restore"), expect.anything());
      fireEvent.click(within(document.body).getByRole("button", { name: "Confirm" }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/backups/backup-2026-09-20.tar.gz/restore"), expect.objectContaining({ method: "POST" })));
      await waitFor(() => expect(document.body.textContent).toContain("Ready to restore"));
      const restoredRow = Array.from(document.querySelectorAll('[data-slot="table-row"]')).find((item) => item.textContent?.includes(backupDate))!;
      expect(within(restoredRow as HTMLElement).queryByRole("button", { name: "More actions" })).toBeNull();
    } finally {
      restore();
    }
  });

  test("Cancel restore clears the pending restore", async () => {
    const { fetchMock, restore } = mockBackupsFetch(
      [{ filename: "backup-2026-09-20.tar.gz", createdAt: "2026-09-20T03:00:00.000Z", bytes: 1024 }],
      { filename: "backup-2026-09-20.tar.gz", stagedAt: "2026-09-21T10:00:00.000Z", stagedByPersonId: "person-abc123" },
    );
    try {
      renderWithQueryClient(<BackupsPage person={makePerson()} />);
      await waitFor(() => expect(document.body.textContent).toContain("Ready to restore"));
      fireEvent.click(within(document.body).getByRole("button", { name: "Cancel restore" }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/backups/restore/cancel"), expect.objectContaining({ method: "POST" })));
      await waitFor(() => expect(document.body.textContent).not.toContain("Ready to restore"));
    } finally {
      restore();
    }
  });

  test("an admin sees pending restore state without restore or cancel actions", async () => {
    const { restore } = mockBackupsFetch(
      [{ filename: "backup-2026-09-20.tar.gz", createdAt: "2026-09-20T03:00:00.000Z", bytes: 1024 }],
      { filename: "backup-2026-09-20.tar.gz", stagedAt: "2026-09-21T10:00:00.000Z", stagedByPersonId: "person-abc123" },
    );
    try {
      renderWithQueryClient(<BackupsPage person={makePerson({ role: "admin" })} />);
      await waitFor(() => expect(document.body.textContent).toContain("Ready to restore"));
      expect(within(document.body).queryByRole("button", { name: "Cancel restore" })).toBeNull();
      const backupDate = new Date("2026-09-20T03:00:00.000Z").toLocaleString();
      const row = Array.from(document.querySelectorAll('[data-slot="table-row"]')).find((item) => item.textContent?.includes(backupDate))!;
      expect(within(row as HTMLElement).queryByRole("button", { name: "More actions" })).toBeNull();
    } finally {
      restore();
    }
  });
});
