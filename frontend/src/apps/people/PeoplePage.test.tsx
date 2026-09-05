import { describe, expect, test, mock, afterEach } from "bun:test";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { PeoplePage } from "@/apps/people/PeoplePage";
import type { PersonRosterEntry, Roster } from "@/lib/api";

afterEach(cleanup);

// Every query comes from render()'s own returned queries, never the
// global `screen` singleton (see ChatPage.test.tsx's header comment).

const OWNER_ID = "person-owner";

function actor(role: Roster["role"]): Roster {
  return {
    id: OWNER_ID,
    display_name: "Sage",
    nickname: null,
    role,
    avatar_seed: OWNER_ID,
    source: "hub",
    local_only: false,
    created_at: "2026-09-05T00:00:00.000Z",
    updated_at: "2026-09-05T00:00:00.000Z",
    deleted_at: null,
    hasSecret: true,
  };
}

function member(id: string, name: string, role: PersonRosterEntry["role"]): PersonRosterEntry {
  return {
    id,
    display_name: name,
    nickname: null,
    role,
    avatar_seed: id,
    source: "hub",
    local_only: false,
    created_at: "2026-09-05T00:00:00.000Z",
    updated_at: "2026-09-05T00:00:00.000Z",
    deleted_at: null,
  };
}

const ROSTER: PersonRosterEntry[] = [
  member(OWNER_ID, "Sage", "owner"),
  member("person-bramble", "Bramble", "child"),
  member("person-clover", "Clover", "teen"),
];

function stubApi(over: { batchOutcomes?: Array<{ id: string; deleted: boolean; reason?: string }> } = {}) {
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
    if (method === "DELETE") {
      return Promise.resolve(new Response(JSON.stringify({ erased: {} }), { status: 200 }));
    }
    if (method === "PATCH") {
      return Promise.resolve(new Response(JSON.stringify(ROSTER[1]), { status: 200 }));
    }
    if (url.includes("/api/people")) {
      return Promise.resolve(new Response(JSON.stringify(ROSTER), { status: 200 }));
    }
    return Promise.reject(new Error(`unstubbed fetch: ${url}`));
  }) as unknown as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

describe("removing a person", () => {
  // Deleting a person erases their memories, conversations, settings and
  // recordings. It is the most destructive action in the product, so
  // pressing Remove must not remove anything.
  test("Remove asks first, naming them and what goes", async () => {
    const { calls, restore } = stubApi();
    try {
      const { findByRole, getByText } = render(<PeoplePage person={actor("owner")} />);
      fireEvent.click(await findByRole("button", { name: "Remove Bramble" }));

      expect(getByText("Remove Bramble from your household?")).toBeInTheDocument();
      expect(getByText(/every conversation they had/)).toBeInTheDocument();
      expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    } finally {
      restore();
    }
  });

  test("backing out removes nobody", async () => {
    const { calls, restore } = stubApi();
    try {
      const { findByRole, getByRole } = render(<PeoplePage person={actor("owner")} />);
      fireEvent.click(await findByRole("button", { name: "Remove Bramble" }));
      fireEvent.click(getByRole("button", { name: "Keep them" }));

      await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(false));
    } finally {
      restore();
    }
  });

  test("confirming removes them", async () => {
    const { calls, restore } = stubApi();
    try {
      const { findByRole, getByRole } = render(<PeoplePage person={actor("owner")} />);
      fireEvent.click(await findByRole("button", { name: "Remove Bramble" }));
      fireEvent.click(getByRole("button", { name: "Yes, remove" }));

      await waitFor(() =>
        expect(calls.some((c) => c.method === "DELETE" && c.url.includes("person-bramble"))).toBe(true),
      );
    } finally {
      restore();
    }
  });

  // The backend refuses "you cannot delete your own profile", so a
  // button that only ever errors is worse than no button.
  test("nobody is offered a Remove button for themselves", async () => {
    const { restore } = stubApi();
    try {
      const { findByRole, queryByRole } = render(<PeoplePage person={actor("owner")} />);
      await findByRole("button", { name: "Remove Bramble" });
      expect(queryByRole("button", { name: "Remove Sage" })).toBeNull();
    } finally {
      restore();
    }
  });

  test("an admin is not offered Remove for the owner", async () => {
    const { restore } = stubApi();
    try {
      const admin = { ...actor("admin"), id: "person-admin" };
      const { findByRole, queryByRole } = render(<PeoplePage person={admin} />);
      await findByRole("button", { name: "Remove Bramble" });
      expect(queryByRole("button", { name: "Remove Sage" })).toBeNull();
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
      const { findByRole, getByRole, getByLabelText, getByText } = render(<PeoplePage person={actor("owner")} />);
      fireEvent.click(await findByRole("button", { name: "Select people" }));
      fireEvent.click(getByLabelText("Select Bramble"));
      fireEvent.click(getByLabelText("Select Clover"));
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
      const { findByRole, getByRole, getByLabelText } = render(<PeoplePage person={actor("owner")} />);
      fireEvent.click(await findByRole("button", { name: "Select people" }));
      fireEvent.click(getByLabelText("Select Bramble"));
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
      const { findByRole, getByRole, getByLabelText, findByText } = render(<PeoplePage person={actor("owner")} />);
      fireEvent.click(await findByRole("button", { name: "Select people" }));
      fireEvent.click(getByLabelText("Select Bramble"));
      fireEvent.click(getByLabelText("Select Clover"));
      fireEvent.click(getByRole("button", { name: "Remove selected" }));
      fireEvent.click(getByRole("button", { name: "Yes, remove 2" }));

      expect(await findByText(/Clover could not be removed/)).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  test("only people this person may actually remove are selectable", async () => {
    const { restore } = stubApi();
    try {
      const { findByRole, queryByLabelText } = render(<PeoplePage person={actor("owner")} />);
      fireEvent.click(await findByRole("button", { name: "Select people" }));
      expect(queryByLabelText("Select Bramble")).not.toBeNull();
      // Yourself is never selectable: the backend refuses it outright.
      expect(queryByLabelText("Select Sage")).toBeNull();
    } finally {
      restore();
    }
  });
});

describe("editing a person", () => {
  test("renaming someone sends just the new name", async () => {
    const { calls, restore } = stubApi();
    try {
      const { findByRole, getByRole, getByLabelText } = render(<PeoplePage person={actor("owner")} />);
      fireEvent.click(await findByRole("button", { name: "Edit Bramble" }));
      fireEvent.change(getByLabelText("Name for Bramble"), { target: { value: "Bram" } });
      fireEvent.click(getByRole("button", { name: "Save" }));

      await waitFor(() => {
        const call = calls.find((c) => c.method === "PATCH");
        expect(call).toBeDefined();
        expect(JSON.parse(call!.body!).displayName).toBe("Bram");
      });
    } finally {
      restore();
    }
  });

  // An admin may rename someone but may not change roles. Sending an
  // unchanged role anyway would turn every rename by an admin into a 403.
  test("an unchanged role is not sent, so an admin can still rename", async () => {
    const { calls, restore } = stubApi();
    try {
      const admin = { ...actor("admin"), id: "person-admin" };
      const { findByRole, getByRole, getByLabelText } = render(<PeoplePage person={admin} />);
      fireEvent.click(await findByRole("button", { name: "Edit Bramble" }));
      fireEvent.change(getByLabelText("Name for Bramble"), { target: { value: "Bram" } });
      fireEvent.click(getByRole("button", { name: "Save" }));

      await waitFor(() => {
        const call = calls.find((c) => c.method === "PATCH");
        expect(JSON.parse(call!.body!).role).toBeUndefined();
      });
    } finally {
      restore();
    }
  });

  test("only the owner is offered a role picker", async () => {
    const { restore } = stubApi();
    try {
      const admin = { ...actor("admin"), id: "person-admin" };
      const { findByRole, queryByLabelText } = render(<PeoplePage person={admin} />);
      fireEvent.click(await findByRole("button", { name: "Edit Bramble" }));
      expect(queryByLabelText("Role for Bramble")).toBeNull();
    } finally {
      restore();
    }
  });
});
