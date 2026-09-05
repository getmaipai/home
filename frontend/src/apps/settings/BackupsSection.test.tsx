import { describe, expect, test, mock, afterEach } from "bun:test";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { BackupsSection } from "@/apps/settings/BackupsSection";
import type { BackupInfo, PendingRestore, Roster } from "@/lib/api";

afterEach(cleanup);

// Every query comes from render()'s own returned queries, never the
// global `screen` singleton (see ChatPage.test.tsx's header comment).

function makePerson(role: Roster["role"]): Roster {
  return {
    id: "person-owner",
    display_name: "Sage",
    nickname: null,
    role,
    avatar_seed: "person-owner",
    source: "hub",
    local_only: false,
    created_at: "2026-09-05T00:00:00.000Z",
    updated_at: "2026-09-05T00:00:00.000Z",
    deleted_at: null,
    hasSecret: true,
  };
}

const BACKUPS: BackupInfo[] = [
  { filename: "backup-2026-09-05.db.enc", createdAt: "2026-09-05T10:00:00.000Z", bytes: 4096 },
];

interface Stub {
  pending?: PendingRestore | null;
  stageStatus?: number;
  stageError?: string;
}

function stubApi({ pending = null, stageStatus = 200, stageError }: Stub = {}) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.includes("/restore/pending")) {
      return Promise.resolve(new Response(JSON.stringify({ pending }), { status: 200 }));
    }
    if (url.includes("/restore/cancel")) {
      return Promise.resolve(new Response(JSON.stringify({ cancelled: true }), { status: 200 }));
    }
    if (url.includes("/restore")) {
      if (stageStatus !== 200) {
        return Promise.resolve(new Response(JSON.stringify({ error: stageError }), { status: stageStatus }));
      }
      const staged: PendingRestore = {
        filename: BACKUPS[0]!.filename,
        stagedAt: "2026-09-05T12:00:00.000Z",
        stagedByPersonId: "person-owner",
      };
      return Promise.resolve(new Response(JSON.stringify({ pending: staged }), { status: 200 }));
    }
    if (url.includes("/api/backups")) {
      return Promise.resolve(new Response(JSON.stringify(BACKUPS), { status: 200 }));
    }
    return Promise.reject(new Error(`unstubbed fetch: ${url}`));
  }) as unknown as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

describe("restoring a backup", () => {
  // The whole point of the confirmation step: pressing Restore must not
  // restore anything. It is the one action in the product a family
  // cannot undo from the UI.
  test("the Restore button asks first and stages nothing on its own", async () => {
    const { calls, restore } = stubApi();
    try {
      const { findByRole, getByText } = render(<BackupsSection person={makePerson("owner")} />);
      fireEvent.click(await findByRole("button", { name: /Restore the backup from/ }));

      expect(getByText(/Everyone in your household/)).toBeInTheDocument();
      expect(calls.some((c) => c.startsWith("POST") && c.includes("/restore"))).toBe(false);
    } finally {
      restore();
    }
  });

  test("backing out of the confirmation changes nothing", async () => {
    const { calls, restore } = stubApi();
    try {
      const { findByRole, getByRole, queryByText } = render(<BackupsSection person={makePerson("owner")} />);
      fireEvent.click(await findByRole("button", { name: /Restore the backup from/ }));
      fireEvent.click(getByRole("button", { name: "Keep things as they are" }));

      await waitFor(() => expect(queryByText(/Everyone in your household/)).toBeNull());
      expect(calls.some((c) => c.startsWith("POST") && c.includes("/restore"))).toBe(false);
    } finally {
      restore();
    }
  });

  // Confirming stages the restore and then says what actually happens.
  // "Restoring…" would be a lie: nothing changes until the hub restarts.
  test("confirming stages it and says a restart is what finishes the job", async () => {
    const { calls, restore } = stubApi();
    try {
      const { findByRole, getByRole, findByText } = render(<BackupsSection person={makePerson("owner")} />);
      fireEvent.click(await findByRole("button", { name: /Restore the backup from/ }));
      fireEvent.click(getByRole("button", { name: "Yes, restore this backup" }));

      expect(await findByText(/Restart MaiPai Home to finish/)).toBeInTheDocument();
      await waitFor(() =>
        expect(calls.some((c) => c.startsWith("POST") && c.includes("/restore"))).toBe(true),
      );
    } finally {
      restore();
    }
  });

  // The banner has to name the point in time the family is going back
  // to, which is the backup's own date - not the minute someone pressed
  // the button. Caught by looking at the real banner in a browser.
  test("the staged banner names the backup's date, not when it was staged", async () => {
    const pending: PendingRestore = {
      filename: BACKUPS[0]!.filename,
      stagedAt: "2026-09-06T23:30:00.000Z",
      stagedByPersonId: "person-owner",
    };
    const { restore } = stubApi({ pending });
    try {
      const { findByText } = render(<BackupsSection person={makePerson("owner")} />);
      const banner = await findByText(/will replace everything in MaiPai Home/);
      expect(banner.textContent).toContain(new Date(BACKUPS[0]!.createdAt).toLocaleString());
      expect(banner.textContent).not.toContain(new Date(pending.stagedAt).toLocaleString());
    } finally {
      restore();
    }
  });

  test("a staged restore can be cancelled before the restart", async () => {
    const pending: PendingRestore = {
      filename: BACKUPS[0]!.filename,
      stagedAt: "2026-09-05T12:00:00.000Z",
      stagedByPersonId: "person-owner",
    };
    const { restore } = stubApi({ pending });
    try {
      const { findByRole, queryByText } = render(<BackupsSection person={makePerson("owner")} />);
      fireEvent.click(await findByRole("button", { name: "Cancel restore" }));
      await waitFor(() => expect(queryByText("Ready to restore")).toBeNull());
    } finally {
      restore();
    }
  });

  // The backend's refusals name a cause a parent can act on. Replacing
  // them with "could not restore" would throw away the only useful part.
  test("shows the backend's own reason when a backup is refused", async () => {
    const { restore } = stubApi({
      stageStatus: 400,
      stageError: "that backup was made by a newer version of MaiPai Home. Update MaiPai Home first, then restore it.",
    });
    try {
      const { findByRole, getByRole, findByText } = render(<BackupsSection person={makePerson("owner")} />);
      fireEvent.click(await findByRole("button", { name: /Restore the backup from/ }));
      fireEvent.click(getByRole("button", { name: "Yes, restore this backup" }));
      expect(await findByText(/newer version of MaiPai Home/)).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  // Staging a restore is owner-only on the backend, so an admin gets no
  // Restore button rather than one that 403s. They do still get told
  // when a restore is waiting; see "who sees what" below.
  test("an admin sees backups but no restore button", async () => {
    const { restore } = stubApi();
    try {
      const { findByText, queryByRole } = render(<BackupsSection person={makePerson("admin")} />);
      await findByText(/4(\.0)? KB|4096/);
      expect(queryByRole("button", { name: /Restore the backup from/ })).toBeNull();
    } finally {
      restore();
    }
  });
});

// Both from the 2026-09-05 code review.
describe("who sees what", () => {
  test("an admin is told a restore is waiting, but cannot cancel it", async () => {
    const pending: PendingRestore = {
      filename: BACKUPS[0]!.filename,
      stagedAt: "2026-09-05T12:00:00.000Z",
      stagedByPersonId: "person-owner",
    };
    const { restore } = stubApi({ pending });
    try {
      const { findByText, queryByRole } = render(<BackupsSection person={makePerson("admin")} />);
      // The household database is about to be replaced; someone who can
      // restart the hub should not be the last to know.
      await findByText("Ready to restore");
      expect(queryByRole("button", { name: "Cancel restore" })).toBeNull();
    } finally {
      restore();
    }
  });

  // docs/UI.md's 48px floor. Button.tsx's own note says `sm` is
  // desktop/mouse-only and never the only way to reach an action, and
  // Restore is the only way to reach restore.
  test("the Restore control clears the kit's touch-target floor", async () => {
    const { restore } = stubApi();
    try {
      const { findByRole } = render(<BackupsSection person={makePerson("owner")} />);
      const button = await findByRole("button", { name: /Restore the backup from/ });
      expect(button.className).toContain("h-12");
    } finally {
      restore();
    }
  });
});
