import { describe, expect, test, mock, afterEach } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ConversationsPage } from "@/apps/conversations/ConversationsPage";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import type { ConversationSummary, PersonRosterEntry, Roster } from "@/lib/api";

afterEach(cleanup);

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
    enabled: true,
    guest_expires_at: null,
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
    avatar_seed: id,
    source: "hub",
    local_only: false,
    created_at: "2026-09-05T00:00:00.000Z",
    updated_at: "2026-09-05T00:00:00.000Z",
    deleted_at: null,
    enabled: true,
    guest_expires_at: null,
    memorialized_at: null,
    hlc: "1788000000000:0:test",
  };
}

function conversation(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: "conv-abc123",
    surface: "chat",
    companion_id: null,
    title: "Weekend plans",
    turn_count: 3,
    last_turn_at: "2026-09-05T12:00:00.000Z",
    created_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderPage(person: Roster) {
  return renderWithQueryClient(<ConversationsPage person={person} />);
}

function stubApi(options: {
  conversations?: ConversationSummary[];
  people?: PersonRosterEntry[];
  onAction?: (method: string, url: string, body: unknown) => void;
} = {}): () => void {
  const conversations = options.conversations ?? [conversation()];
  const people = options.people ?? [member(OWNER_ID, "Sage", "owner")];
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    options.onAction?.(method, url, body);
    if (url.endsWith("/api/people")) return Promise.resolve(new Response(JSON.stringify(people), { status: 200 }));
    if (url.includes("/api/conversations/batch-delete") || url.includes("/api/conversations/clear")) {
      return Promise.resolve(new Response(JSON.stringify({ deleted: 1 }), { status: 200 }));
    }
    if (/\/api\/conversations\/[^/]+$/.test(url) && (method === "PATCH" || method === "DELETE")) {
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    }
    if (url.includes("/api/conversations")) {
      return Promise.resolve(new Response(JSON.stringify(conversations), { status: 200 }));
    }
    throw new Error(`unstubbed fetch: ${url} (${method})`);
  }) as unknown as typeof fetch;
  return () => (globalThis.fetch = original);
}

describe("ConversationsPage", () => {
  test("lists title, message count and last-activity time", async () => {
    const restore = stubApi({ conversations: [conversation({ title: "Weekend plans", turn_count: 3 })] });
    try {
      const { findByText } = renderPage(actor("owner"));
      await findByText("Weekend plans");
      await findByText("3 messages · " + new Date("2026-09-05T12:00:00.000Z").toLocaleString());
    } finally {
      restore();
    }
  });

  test("an empty list says so, not a blank page", async () => {
    const restore = stubApi({ conversations: [] });
    try {
      const { findByText } = renderPage(actor("owner"));
      await findByText("No conversations yet.");
    } finally {
      restore();
    }
  });

  test("renaming a conversation sends the new title and refetches", async () => {
    const calls: Array<{ method: string; body: unknown }> = [];
    const restore = stubApi({
      conversations: [conversation({ id: "conv-1", title: "Old title" })],
      onAction: (method, url, body) => {
        if (url.endsWith("/api/conversations/conv-1")) calls.push({ method, body });
      },
    });
    try {
      const { findByRole } = renderPage(actor("owner"));
      fireEvent.click(await findByRole("button", { name: "Rename Old title" }));
      const input = await findByRole("textbox", { name: "Conversation title" });
      fireEvent.change(input, { target: { value: "New title" } });
      fireEvent.click(await findByRole("button", { name: "Save" }));
      await waitFor(() => expect(calls).toEqual([{ method: "PATCH", body: { title: "New title" } }]));
    } finally {
      restore();
    }
  });

  test("deleting a conversation asks first, then calls DELETE", async () => {
    const calls: string[] = [];
    const restore = stubApi({
      conversations: [conversation({ id: "conv-1", title: "To delete" })],
      onAction: (method, url) => {
        if (method === "DELETE") calls.push(url);
      },
    });
    try {
      const { findByRole, findByText } = renderPage(actor("owner"));
      fireEvent.click(await findByRole("button", { name: "Delete To delete" }));
      await findByText("Delete this conversation? This cannot be undone.");
      fireEvent.click(await findByRole("button", { name: "Yes, delete" }));
      await waitFor(() => expect(calls.some((u) => u.endsWith("/api/conversations/conv-1"))).toBe(true));
    } finally {
      restore();
    }
  });

  test("batch delete sends every selected id", async () => {
    let batchBody: unknown;
    const restore = stubApi({
      conversations: [conversation({ id: "conv-1", title: "First" }), conversation({ id: "conv-2", title: "Second" })],
      onAction: (_method, url, body) => {
        if (url.endsWith("/api/conversations/batch-delete")) batchBody = body;
      },
    });
    try {
      const { findByRole, findAllByRole } = renderPage(actor("owner"));
      fireEvent.click(await findByRole("button", { name: "Select conversations" }));
      const checkboxes = await findAllByRole("checkbox");
      fireEvent.click(checkboxes[0]!);
      fireEvent.click(checkboxes[1]!);
      fireEvent.click(await findByRole("button", { name: "Delete selected" }));
      fireEvent.click(await findByRole("button", { name: /Yes, delete 2/ }));
      await waitFor(() => expect(batchBody).toEqual({ ids: ["conv-1", "conv-2"] }));
    } finally {
      restore();
    }
  });

  test("clear all asks first, then calls the clear route", async () => {
    let cleared = false;
    const restore = stubApi({
      onAction: (_method, url) => {
        if (url.endsWith("/api/conversations/clear")) cleared = true;
      },
    });
    try {
      const { findByRole, findByText } = renderPage(actor("owner"));
      fireEvent.click(await findByRole("button", { name: "Clear all" }));
      await findByText("Delete every one of your conversations? This cannot be undone.");
      fireEvent.click(await findByRole("button", { name: "Yes, clear all" }));
      await waitFor(() => expect(cleared).toBe(true));
    } finally {
      restore();
    }
  });

  test("an owner sees a person picker; viewing someone else hides rename/delete", async () => {
    const restore = stubApi({
      people: [member(OWNER_ID, "Sage", "owner"), member("person-bramble", "Bramble", "child")],
      conversations: [conversation({ title: "A child's chat" })],
    });
    try {
      const { findByRole, queryByRole } = renderPage(actor("owner"));
      const picker = await findByRole("combobox", { name: "Viewing whose conversations" });
      fireEvent.click(picker);
      fireEvent.click(await findByRole("option", { name: "Bramble" }));
      await waitFor(async () => expect(queryByRole("button", { name: /Rename/ })).toBeNull());
    } finally {
      restore();
    }
  });

  test("a non-admin person never sees the picker at all", async () => {
    const restore = stubApi();
    try {
      const { queryByRole, findByText } = renderPage(actor("adult"));
      await findByText("Weekend plans");
      expect(queryByRole("combobox")).toBeNull();
    } finally {
      restore();
    }
  });
});
