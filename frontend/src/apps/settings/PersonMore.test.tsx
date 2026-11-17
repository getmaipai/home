// The "More" section of one person's page (PersonMore): rename, PIN lock and removal moved here from the Users list's row icons.
// Ported from UsersPage.test.tsx (NEXT-RETIRE-02C ancestry); each case keeps guarding the same behavior.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { PersonMore } from "@/apps/settings/PersonMore";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { PersonRosterEntry, Roster } from "@/lib/api";

afterEach(cleanup);

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



function renderMore(viewer: Roster, targetId: string) {
  const target = ROSTER.find((entry) => entry.id === targetId)!;
  return renderWithQueryClient(<PersonMore viewer={viewer} target={target} onRemoved={() => {}} />);
}

describe("removing a person", () => {
  // Deleting a person erases their memories, conversations, settings and
  // recordings. It is the most destructive action in the product, so
  // pressing Remove must not remove anything.
  test("Remove asks first, naming them and what goes", async () => {
    const { calls, restore } = stubApi();
    try {
      const { findByRole, getByText } = renderMore(actor("owner"), "person-bramble");
      fireEvent.click(await findByRole("button", { name: "Remove Bramble" }));

      expect(getByText("Remove Bramble from your household?")).toBeInTheDocument();
      expect(getByText(/every conversation they had/)).toBeInTheDocument();
      expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    } finally {
      restore();
    }
  });

  // STORE-DELETE-01, decision 5: an export is offered before a removed
  // person's files are purged.
  test("a parent removing a child is offered their files to download first", async () => {
    const { calls, restore } = stubApi({
      preview: {
        files: { purged: { files: 2, bytes: 4096 }, keptForHousehold: { files: 1, bytes: 2048 } },
        export: { allowed: true, url: "/api/people/person-bramble/files/export" },
      },
    });
    try {
      const { findByRole, findByText } = renderMore(actor("owner"), "person-bramble");
      fireEvent.click(await findByRole("button", { name: "Remove Bramble" }));

      expect(await findByText(/2 files only Bramble could see will be deleted too/)).toBeInTheDocument();
      expect(await findByText(/1 file other people can still see will stay, kept by the household/)).toBeInTheDocument();
      const download = await findByRole("link", { name: "Download Bramble's files" });
      expect(download.getAttribute("href")).toBe("/api/people/person-bramble/files/export");
      expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    } finally {
      restore();
    }
  });

  test("the delete waits while the file preview is still loading", async () => {
    const { calls, restore } = stubApi({ preview: new Promise(() => {}) });
    try {
      const { findByRole, getByRole } = renderMore(actor("owner"), "person-bramble");
      fireEvent.click(await findByRole("button", { name: "Remove Bramble" }));
      expect(getByRole("button", { name: "Yes, remove" })).toBeDisabled();
      fireEvent.click(getByRole("button", { name: "Yes, remove" }));
      expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    } finally {
      restore();
    }
  });

  test("a teen's private files are never offered to the parent removing them", async () => {
    const { restore } = stubApi({
      preview: { files: { purged: { files: 3, bytes: 4096 }, keptForHousehold: { files: 0, bytes: 0 } }, export: { allowed: false, url: null } },
    });
    try {
      const { findByRole, findByText, queryByRole } = renderMore(actor("owner"), "person-clover");
      fireEvent.click(await findByRole("button", { name: "Remove Clover" }));

      expect(await findByText(/Only Clover can download their own files/)).toBeInTheDocument();
      expect(queryByRole("link", { name: /Download/ })).toBeNull();
    } finally {
      restore();
    }
  });

  test("backing out removes nobody", async () => {
    const { calls, restore } = stubApi();
    try {
      const { findByRole, getByRole } = renderMore(actor("owner"), "person-bramble");
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
      const { findByRole, getByRole, getByText } = renderMore(actor("owner"), "person-bramble");
      fireEvent.click(await findByRole("button", { name: "Remove Bramble" }));
      // STORE-DELETE-01: the delete waits for the preview that offers the
      // export, then goes through. The wait throws a plain Error while the
      // button is disabled, never a jest-dom matcher: a failed
      // not.toBeDisabled() dumps the whole happy-dom element into its
      // message, which blocks the event loop for over a second on its first
      // failure and made waitFor time out (FLAKY-USERSPAGE-01).
      await waitFor(() => {
        if ((getByText("Yes, remove") as HTMLButtonElement).disabled) throw new Error("the Yes, remove button is still disabled");
      });
      expect(getByRole("button", { name: "Yes, remove" })).not.toBeDisabled();
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
  test("nobody is offered Remove for themselves, and an admin gets no More section on the owner", async () => {
    const { restore } = stubApi();
    try {
      // Sage is the viewer and the target: you can rename yourself, but the hub refuses removing yourself, so no button is offered.
      const { findByRole, queryByRole } = renderMore(actor("owner"), OWNER_ID);
      await findByRole("button", { name: "Edit name and PIN lock" });
      expect(queryByRole("button", { name: "Remove Sage" })).toBeNull();
    } finally {
      restore();
    }
  });

  test("an admin is not offered Remove for the owner", async () => {
    const { restore } = stubApi();
    try {
      const admin = { ...actor("admin"), id: "person-admin" };
      // An admin opening the owner's page gets no More section at all (nothing to remove, nothing to rename).
      const { container } = renderMore(admin, OWNER_ID);
      expect(container.textContent).toBe("");
    } finally {
      restore();
    }
  });
});


describe("editing a person", () => {
  test("renaming someone sends just the new name", async () => {
    const { calls, restore } = stubApi();
    try {
      const { findByRole, getByRole, getByLabelText } = renderMore(actor("owner"), "person-bramble");
      fireEvent.click(await findByRole("button", { name: "Edit name and PIN lock" }));
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
      const { findByRole, getByRole, getByLabelText } = renderMore(admin, "person-bramble");
      fireEvent.click(await findByRole("button", { name: "Edit name and PIN lock" }));
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
      const { findByRole, queryByLabelText } = renderMore(admin, "person-bramble");
      fireEvent.click(await findByRole("button", { name: "Edit name and PIN lock" }));
      expect(queryByLabelText("Role for Bramble")).toBeNull();
    } finally {
      restore();
    }
  });
});
