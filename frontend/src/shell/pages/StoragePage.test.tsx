import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { StoragePage } from "@/shell/pages/StoragePage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { expectHomeTablesWithoutDemoOrActions } from "@/tests/expectHomeTables";
import type { Roster, StorageUsageOverview } from "@/lib/api";
import type { SettingsKey } from "@maipai/spec/gen/ts/settings-key.js";

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

const HOUSEHOLD_CAP_KEY: SettingsKey = {
  key: "storage.household.cap_bytes",
  scope: "household",
  selector: "number",
  label: "Household storage cap (bytes)",
  level: "basic",
  secret: false,
  lives_in: "household.storage",
  honoured_by: ["home"],
} as SettingsKey;

function makeOverview(overrides: Partial<StorageUsageOverview> = {}): StorageUsageOverview {
  return {
    people: [
      { personId: "person-abc123", displayName: "Nova", role: "owner", usageBytes: 1024, capBytes: 20 * 1024 ** 3, byKind: [{ kind: "image", bytes: 1024 }] },
    ],
    household: { usageBytes: 1024, capBytes: 20 * 1024 ** 3, inherited: { files: 0, bytes: 0 } },
    ...overrides,
  };
}

function mockFetch(overview: StorageUsageOverview | { status: number }, registry: SettingsKey[] = []) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/storage/usage")) {
      if ("status" in overview) return Promise.resolve(new Response(JSON.stringify({ error: "Something broke" }), { status: overview.status }));
      return Promise.resolve(Response.json(overview));
    }
    if (url.includes("/api/settings/registry")) return Promise.resolve(Response.json(registry));
    if (url.includes("/api/settings?scope=")) {
      const scope = decodeURIComponent(url.split("scope=")[1] ?? "");
      if (scope === "household") {
        return Promise.resolve(
          Response.json(registry.map((k) => ({ key: k.key, value: 20 * 1024 ** 3, source: "default", label: k.label, level: k.level, secret: false }))),
        );
      }
      return Promise.resolve(Response.json([]));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = originalFetch;
  };
}

describe("StoragePage", () => {
  test("an admin sees the household total, every person's row, and the cap controls", async () => {
    const restore = mockFetch(
      makeOverview({
        people: [
          { personId: "person-abc123", displayName: "Nova", role: "owner", usageBytes: 1024, capBytes: 20 * 1024 ** 3, byKind: [{ kind: "image", bytes: 1024 }] },
          { personId: "person-child1", displayName: "Poppy", role: "child", usageBytes: 2048, capBytes: 20 * 1024 ** 3, byKind: [{ kind: "video", bytes: 2048 }] },
        ],
      }),
      [HOUSEHOLD_CAP_KEY],
    );
    try {
      renderWithQueryClient(
        <MemoryRouter>
          <StoragePage person={makePerson()} />
        </MemoryRouter>,
      );
      await waitFor(() => expect(document.body.textContent).toContain("Household total"));
      expect(document.body.textContent).toContain("Nova");
      expect(document.body.textContent).toContain("Poppy");
      expect(document.body.textContent).toContain("image");
      expect(document.body.textContent).toContain("video");
      // The cap controls: the generic settings renderer's own field for
      // the household.storage group, not a hand-built form.
      await waitFor(() => expect(document.body.textContent).toContain("Household storage cap (bytes)"));
      expectHomeTablesWithoutDemoOrActions(1);
    } finally {
      restore();
    }
  });

  test("the kit usage table sorts its returned people by name", async () => {
    const restore = mockFetch(makeOverview({
      people: [
        { personId: "person-z", displayName: "Zelda", role: "admin", usageBytes: 1024, capBytes: 2048, byKind: [] },
        { personId: "person-a", displayName: "Ada", role: "admin", usageBytes: 2048, capBytes: 4096, byKind: [] },
      ],
    }));
    try {
      renderWithQueryClient(<MemoryRouter><StoragePage person={makePerson()} /></MemoryRouter>);
      const table = await waitFor(() => {
        const element = document.querySelector('[role="table"][aria-label="Storage usage by person"]');
        expect(element).not.toBeNull();
        return element!;
      });
      const sortButton = await waitFor(() => {
        const button = table.querySelector('button[aria-label="Sort by Person"]');
        expect(button).not.toBeNull();
        return button!;
      });
      fireEvent.click(sortButton);
      await waitFor(() => {
        const rows = Array.from(table.querySelectorAll('[data-slot="data-table-body"] [data-slot="data-table-row"]'));
        expect(rows[0]?.textContent).toContain("Ada");
        expect(rows[1]?.textContent).toContain("Zelda");
      });
    } finally {
      restore();
    }
  });

  test("the kit usage table keeps the existing empty-files message", async () => {
    const restore = mockFetch(makeOverview({ people: [], household: null }));
    try {
      renderWithQueryClient(<MemoryRouter><StoragePage person={makePerson()} /></MemoryRouter>);
      await waitFor(() => expect(document.body.textContent).toContain("No files yet."));
      expect(document.querySelector('[role="table"][aria-label="Storage usage by person"] [data-slot="data-table-empty"]')?.textContent).toBe("No files yet.");
    } finally {
      restore();
    }
  });

  test("files left by a deleted person are listed under the household, not under a person", async () => {
    const restore = mockFetch(
      makeOverview({ household: { usageBytes: 4096, capBytes: 20 * 1024 ** 3, inherited: { files: 1, bytes: 3072 } } }),
    );
    try {
      renderWithQueryClient(
        <MemoryRouter>
          <StoragePage person={makePerson()} />
        </MemoryRouter>,
      );
      await waitFor(() => expect(document.body.textContent).toContain("Shared by people no longer here"));
      expect(document.body.textContent).toContain("1 file");
      expect(document.body.textContent).toContain("3 KB");
    } finally {
      restore();
    }
  });

  test("a non-admin sees only their own row - no household total, no cap controls", async () => {
    const restore = mockFetch(
      makeOverview({
        people: [{ personId: "person-child1", displayName: "Poppy", role: "child", usageBytes: 512, capBytes: 20 * 1024 ** 3, byKind: [{ kind: "audio", bytes: 512 }] }],
        household: null,
      }),
    );
    try {
      renderWithQueryClient(
        <MemoryRouter>
          <StoragePage person={makePerson({ id: "person-child1", role: "child" })} />
        </MemoryRouter>,
      );
      await waitFor(() => expect(document.body.textContent).toContain("Poppy"));
      expect(document.body.textContent).not.toContain("Household total");
      expect(document.body.textContent).not.toContain("Household storage cap");
    } finally {
      restore();
    }
  });

  test("household quota banner shows remaining storage and the meter near cap, at cap and at a normal level", async () => {
    const cap = 20 * 1024 ** 3;
    for (const scenario of [
      { title: "near cap", used: 19 * 1024 ** 3, left: "1 GB left", percent: "95" },
      { title: "at cap", used: cap, left: "0 B left", percent: "100" },
      { title: "normal", used: 4 * 1024 ** 3, left: "16 GB left", percent: "20" },
    ]) {
      const restore = mockFetch(makeOverview({ household: { usageBytes: scenario.used, capBytes: cap, inherited: { files: 0, bytes: 0 } } }));
      try {
        const { getByRole, unmount } = renderWithQueryClient(
          <MemoryRouter>
            <StoragePage person={makePerson()} />
          </MemoryRouter>,
        );
        await waitFor(() => expect(document.body.textContent).toContain("Household total"));
        expect(document.body.textContent).toContain(scenario.left);
        expect(getByRole("meter", { name: "bytes used" }).getAttribute("aria-valuenow")).toBe(scenario.percent);
        unmount();
      } finally {
        restore();
      }
    }
  });

  test("a zero or negative household cap keeps the no-cap copy and hides the banner", async () => {
    for (const capBytes of [0, -1]) {
      const restore = mockFetch(makeOverview({ household: { usageBytes: 1024, capBytes, inherited: { files: 0, bytes: 0 } } }));
      try {
        const { container, unmount } = renderWithQueryClient(
          <MemoryRouter>
            <StoragePage person={makePerson()} />
          </MemoryRouter>,
        );
        await waitFor(() => expect(document.body.textContent).toContain("1 KB used, no cap set"));
        expect(container.querySelector('[data-slot="quota-banner"]')).toBeNull();
        unmount();
      } finally {
        restore();
      }
    }
  });

  test("a teen sees only the teen's returned row", async () => {
    const restore = mockFetch(makeOverview({
      people: [{ personId: "teen-1", displayName: "Robin", role: "teen", usageBytes: 2048, capBytes: 20 * 1024 ** 3, byKind: [] }],
      household: null,
    }));
    try {
      renderWithQueryClient(
        <MemoryRouter>
          <StoragePage person={makePerson({ id: "teen-1", role: "teen" })} />
        </MemoryRouter>,
      );
      await waitFor(() => expect(document.body.textContent).toContain("Robin"));
      expect(document.body.textContent).not.toContain("Nova");
      expect(document.body.textContent).not.toContain("Household total");
    } finally {
      restore();
    }
  });

  test("a failed fetch shows an error and a retry button, never a stuck loading state", async () => {
    const restore = mockFetch({ status: 500 });
    try {
      renderWithQueryClient(
        <MemoryRouter>
          <StoragePage person={makePerson()} />
        </MemoryRouter>,
      );
      await waitFor(() => expect(document.body.textContent).toContain("Something broke"));
      expect(document.body.textContent).toContain("Try again");
    } finally {
      restore();
    }
  });
});
