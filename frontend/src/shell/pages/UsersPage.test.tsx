import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UsersPage } from "@/shell/pages/UsersPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { PersonRosterEntry, Roster } from "@/lib/api";

afterEach(cleanup);

function makePerson(role: Roster["role"]): Roster {
  return {
    id: "person-abc123",
    display_name: "Nova",
    nickname: null,
    role,
    avatar_seed: "person-abc123",
    source: "hub",
    local_only: false,
    created_at: "2026-09-04T00:00:00.000Z",
    updated_at: "2026-09-04T00:00:00.000Z",
    deleted_at: null,
    enabled: true,
    guest_expires_at: null,
    controls: null,
    memorialized_at: null,
    hlc: "1788000000000:0:test",
    hasSecret: true,
  } as Roster;
}

describe("UsersPage", () => {
  test("a non-admin sees the denial and does not fetch the roster", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = mock(() => Promise.resolve(Response.json([])));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<UsersPage person={makePerson("adult")} />);
      await waitFor(() => expect(view.getByText("Only an owner or admin can manage users.")).toBeTruthy());
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("an owner sees the Users page with its one Add user button", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/people")) return Promise.resolve(Response.json([]));
      if (url.includes("/api/settings/registry")) return Promise.resolve(Response.json([]));
      if (url.includes("/api/settings?")) return Promise.resolve(Response.json([]));
      return Promise.resolve(Response.json({}));
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const view = renderWithQueryClient(<MemoryRouter><UsersPage person={makePerson("owner")} /></MemoryRouter>);
      await waitFor(() => expect(view.getByRole("button", { name: "Add user" })).toBeTruthy());
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/people"), expect.anything());
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("creating an adult sends the required secret and explains how to fix a rejected create", async () => {
    const originalFetch = globalThis.fetch;
    const createBodies: Array<Record<string, unknown>> = [];
    const fetchMock = mock((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/people") && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        createBodies.push(body);
        if (!body.secret) return Promise.resolve(Response.json({ error: "a adult profile requires a secret" }, { status: 400 }));
        return Promise.resolve(Response.json(member("person-added", String(body.displayName), "adult"), { status: 201 }));
      }
      if (url.includes("/api/people")) return Promise.resolve(Response.json([]));
      if (url.includes("/api/settings/registry")) return Promise.resolve(Response.json([]));
      if (url.includes("/api/settings?")) return Promise.resolve(Response.json([]));
      return Promise.resolve(Response.json({}));
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const view = renderUsersPage(actor("owner"));
      fireEvent.click(await view.findByRole("button", { name: "Add user" }));
      await view.findByPlaceholderText("Name");
      fireEvent.change(view.getByPlaceholderText("Name"), { target: { value: "Avery" } });
      fireEvent.submit(view.getByPlaceholderText("Name").closest("form")!);
      await view.findByText("This role requires a PIN or password. Enter one above, then try again.");
      expect(createBodies[0]).toEqual({ displayName: "Avery", role: "adult", secret: "" });

      const secret = view.getByLabelText("PIN or password");
      fireEvent.change(secret, { target: { value: "123456" } });
      fireEvent.change(view.getByLabelText("Confirm passcode"), { target: { value: "123456" } });
      fireEvent.submit(view.getByPlaceholderText("Name").closest("form")!);
      await waitFor(() => expect(createBodies[1]).toEqual({ displayName: "Avery", role: "adult", secret: "123456" }));
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// NEXT-RETIRE-02C: the removal, rename and role cases below are ported from
// the retired old-shell apps/settings/UsersPage.test.tsx. The batch removal now lives on the Users roster; one person's rename and
// removal moved to PersonMore.test.tsx (the "More" section of their own page).
function renderUsersPage(person: Roster) {
  return renderWithQueryClient(
    <MemoryRouter>
      <UsersPage person={person} />
    </MemoryRouter>,
  );
}

const OWNER_ID = "person-owner";

function actor(role: Roster["role"]): Roster {
  return {
    id: OWNER_ID,
    display_name: "Sage",
    nickname: null,
    role,
    age_band: role === "child" ? "child" : role === "teen" ? "teen" : "adult",
    avatar_seed: OWNER_ID,
    source: "hub",
    local_only: false,
    created_at: "2026-09-05T00:00:00.000Z",
    updated_at: "2026-09-05T00:00:00.000Z",
    deleted_at: null,
    enabled: true,
    guest_expires_at: null,
    controls: null,
    memorialized_at: null,
    hlc: "1788000000000:0:test",
    hasSecret: true,
  };
}

function member(id: string, name: string, role: PersonRosterEntry["role"]): PersonRosterEntry {
  return {
    id,
    display_name: name,
    nickname: null,
    role,
    age_band: role === "child" ? "child" : role === "teen" ? "teen" : "adult",
    avatar_seed: id,
    source: "hub",
    local_only: false,
    created_at: "2026-09-05T00:00:00.000Z",
    updated_at: "2026-09-05T00:00:00.000Z",
    deleted_at: null,
    enabled: true,
    guest_expires_at: null,
    controls: null,
    memorialized_at: null,
    hlc: "1788000000000:0:test",
    sessionLockRequired: false,
    sessionLockTimeoutMinutes: 5,
  };
}

const ROSTER: PersonRosterEntry[] = [
  member(OWNER_ID, "Sage", "owner"),
  member("person-bramble", "Bramble", "child"),
  member("person-clover", "Clover", "teen"),
];

const SITE_BLOCKS = {
  band: "child",
  label: "Child + 1 change",
  resetLabel: "Back to Child",
  rows: [{ id: "blp-porn", label: "Adult sites", does: "Blocks adult sites." }, { id: "blp-drugs", label: "Drug sites", does: "Blocks drug sites." }],
  defaults: ["blp-porn"],
  mine: ["blp-porn", "blp-drugs"],
  locked: ["blp-porn"],
  setBy: { "blp-drugs": "Set by Sage" },
};

const NO_FILES_PREVIEW = { files: { purged: { files: 0, bytes: 0 }, keptForHousehold: { files: 0, bytes: 0 } }, export: { allowed: true, url: null } };

function stubApi(over: { batchOutcomes?: Array<{ id: string; deleted: boolean; reason?: string }>; preview?: unknown } = {}) {
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body as string | undefined });
    if (url.includes("/batch-delete")) {
      const outcomes =
        over.batchOutcomes ??
        (JSON.parse((init?.body as string) ?? "{}").ids as string[]).map((id) => ({ id, deleted: true }));
      return Promise.resolve(new Response(JSON.stringify({ outcomes }), { status: 200 }));
    }
    if (url.includes("/deletion-preview")) {
      if (over.preview instanceof Promise) return over.preview as Promise<Response>;
      return Promise.resolve(new Response(JSON.stringify(over.preview ?? NO_FILES_PREVIEW), { status: 200 }));
    }
    if (method === "DELETE") {
      return Promise.resolve(new Response(JSON.stringify({ erased: {} }), { status: 200 }));
    }
    if (method === "PATCH") {
      return Promise.resolve(new Response(JSON.stringify(ROSTER[1]), { status: 200 }));
    }
    if (url.includes("/site-blocks")) {
      return Promise.resolve(new Response(JSON.stringify(SITE_BLOCKS), { status: 200 }));
    }
    if (url.includes("/api/people")) {
      return Promise.resolve(new Response(JSON.stringify(ROSTER), { status: 200 }));
    }
    return Promise.reject(new Error(`unstubbed fetch: ${url}`));
  }) as unknown as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}


// Moved verbatim from the retired old-shell apps/settings/UsersPage.test.tsx
// (NEXT-RETIRE-02C), which itself came from the older PeoplePage.test.tsx.
// The behavior didn't change, only where it lives.
describe("blocked sites by person", () => {
  test("shows the label, who set a row, and sends a reset for that row only", async () => {
    const { calls, restore } = stubApi();
    try {
      const { findByText, findByRole } = renderUsersPage(actor("owner"));
      expect(await findByText(/Child \+ 1 change/)).toBeInTheDocument();
      expect(await findByText("Set by Sage")).toBeInTheDocument();
      fireEvent.click(await findByRole("button", { name: "Back to Child" }));
      await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url.includes("/site-blocks/reset"))).toBe(true));
      const reset = calls.find((c) => c.url.includes("/site-blocks/reset"))!;
      expect(JSON.parse(reset.body ?? "{}")).toEqual({ id: "blp-drugs" });
    } finally {
      restore();
    }
  });
});

// docs/UI.md > Batch actions: every list a household can delete from
// offers a multi-select, one confirmation naming the count, and reports
// partial success rather than swallowing it.
describe("removing several people at once", () => {
  test("selecting people and removing them in one go", async () => {
    const { calls, restore } = stubApi();
    try {
      const { findByRole, getByRole, getByText } = renderUsersPage(actor("owner"));
      fireEvent.click(await findByRole("button", { name: "Select people" }));
      fireEvent.click(getByRole("button", { name: "Bramble, Child" }));
      fireEvent.click(getByRole("button", { name: "Clover, Teen" }));
      expect(getByText("2 selected")).toBeInTheDocument();

      fireEvent.click(getByRole("button", { name: "Remove selected" }));
      expect(getByText("Remove 2 people from your household?")).toBeInTheDocument();
      fireEvent.click(getByRole("button", { name: "Yes, remove 2" }));

      await waitFor(() => {
        const call = calls.find((c) => c.url.includes("/batch-delete"));
        expect(call).toBeDefined();
        expect(JSON.parse(call!.body!).ids).toEqual(["person-bramble", "person-clover"]);
      });
    } finally {
      restore();
    }
  });

  test("the batch confirmation names the count, and backing out sends nothing", async () => {
    const { calls, restore } = stubApi();
    try {
      const { findByRole, getByRole } = renderUsersPage(actor("owner"));
      fireEvent.click(await findByRole("button", { name: "Select people" }));
      fireEvent.click(getByRole("button", { name: "Bramble, Child" }));
      fireEvent.click(getByRole("button", { name: "Remove selected" }));
      fireEvent.click(getByRole("button", { name: "Keep them" }));

      await waitFor(() => expect(calls.some((c) => c.url.includes("/batch-delete"))).toBe(false));
    } finally {
      restore();
    }
  });

  // Partial success is reported, never swallowed.
  test("says who could not be removed and why", async () => {
    const { restore } = stubApi({
      batchOutcomes: [
        { id: "person-bramble", deleted: true },
        { id: "person-clover", deleted: false, reason: "admin cannot delete a teen profile" },
      ],
    });
    try {
      const { findByRole, getByRole, findByText } = renderUsersPage(actor("owner"));
      fireEvent.click(await findByRole("button", { name: "Select people" }));
      fireEvent.click(getByRole("button", { name: "Bramble, Child" }));
      fireEvent.click(getByRole("button", { name: "Clover, Teen" }));
      fireEvent.click(getByRole("button", { name: "Remove selected" }));
      fireEvent.click(getByRole("button", { name: "Yes, remove 2" }));

      expect(await findByText(/Clover could not be removed/)).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  test("only people this person may actually remove are selected (never yourself)", async () => {
    const { restore } = stubApi();
    try {
      const { findByRole, getByRole, getByText } = renderUsersPage(actor("owner"));
      fireEvent.click(await findByRole("button", { name: "Select people" }));
      fireEvent.click(getByRole("button", { name: "Bramble, Child" }));
      expect(getByText("1 selected")).toBeInTheDocument();
      // Yourself is never selectable: the backend refuses it outright.
      fireEvent.click(getByRole("button", { name: "Sage, you" }));
      expect(getByText("1 selected")).toBeInTheDocument();
    } finally {
      restore();
    }
  });
});
