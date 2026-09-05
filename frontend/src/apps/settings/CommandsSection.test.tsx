import { describe, expect, test, mock, afterEach } from "bun:test";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { CommandsSection } from "@/apps/settings/CommandsSection";
import type { Roster, CommandRow } from "@/lib/api";

// `@testing-library/dom`'s global `screen` singleton is computed once at
// module-load time, before Bun's test preload finishes registering
// happy-dom's globals - it permanently falls back to a stub that throws.
// Every query here comes from render()'s own returned queries instead
// (ChatPage.test.tsx's own header comment already documents this).

afterEach(cleanup);

function makePerson(overrides: Partial<Roster> = {}): Roster {
  return {
    id: "person-jesse",
    display_name: "Jesse",
    nickname: null,
    role: "owner",
    avatar_seed: "person-jesse",
    source: "hub",
    local_only: false,
    created_at: "2026-09-04T00:00:00.000Z",
    updated_at: "2026-09-04T00:00:00.000Z",
    deleted_at: null,
    hasSecret: true,
    ...overrides,
  } as Roster;
}

const COMMANDS: CommandRow[] = [
  {
    id: "cmd-abc",
    creatorId: "person-jesse",
    trigger: "movie night",
    minRole: "child",
    action: { kind: "reply", text: "Starting movie night mode." },
    createdAt: "2026-09-04T00:00:00.000Z",
  },
];

function stubFetch(overrides: { onCreate?: (body: unknown) => void; onDelete?: (id: string) => void } = {}) {
  let commands = COMMANDS;
  return mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    if (url.endsWith("/api/commands") && method === "GET") {
      return Promise.resolve(new Response(JSON.stringify(commands), { status: 200 }));
    }
    if (url.endsWith("/api/commands") && method === "POST") {
      const body = JSON.parse(init?.body as string);
      overrides.onCreate?.(body);
      const created: CommandRow = { id: "cmd-new", creatorId: "person-jesse", createdAt: "now", ...body };
      commands = [...commands, created];
      return Promise.resolve(new Response(JSON.stringify(created), { status: 200 }));
    }
    if (method === "DELETE") {
      const id = url.match(/\/api\/commands\/([^/]+)$/)?.[1] ?? "";
      overrides.onDelete?.(id);
      commands = commands.filter((c) => c.id !== id);
      return Promise.resolve(new Response(JSON.stringify({ id }), { status: 200 }));
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  }) as unknown as typeof fetch;
}

describe("CommandsSection", () => {
  test("lists existing commands, summarizing their action", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch();
    try {
      const { findByText } = render(<CommandsSection person={makePerson()} />);
      await findByText('"movie night"');
      await findByText(/Replies: "Starting movie night mode\."/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("the create form is hidden for a role below adult", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch();
    try {
      const { findByText, queryByPlaceholderText } = render(
        <CommandsSection person={makePerson({ role: "teen" })} />,
      );
      await findByText('"movie night"');
      expect(queryByPlaceholderText(/Trigger phrase/)).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("an adult or higher can create a command", async () => {
    const originalFetch = globalThis.fetch;
    let created: unknown = null;
    globalThis.fetch = stubFetch({ onCreate: (body) => (created = body) });
    try {
      const { findByText, getByPlaceholderText } = render(<CommandsSection person={makePerson()} />);
      await findByText('"movie night"');
      fireEvent.change(getByPlaceholderText(/Trigger phrase/), { target: { value: "good morning" } });
      fireEvent.change(getByPlaceholderText("What MaiPai says back"), { target: { value: "Good morning!" } });
      fireEvent.click(await findByText("Create command"));
      await waitFor(() => expect(created).not.toBeNull());
      expect(created).toMatchObject({ trigger: "good morning", action: { kind: "reply", text: "Good morning!" } });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("only the creator or an owner/admin sees a Delete button", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch();
    try {
      const { findByText, queryByText } = render(
        <CommandsSection person={makePerson({ id: "person-other", role: "adult" })} />,
      );
      await findByText('"movie night"');
      expect(queryByText("Delete")).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("the creator can delete their own command", async () => {
    const originalFetch = globalThis.fetch;
    let deletedId: string | null = null;
    globalThis.fetch = stubFetch({ onDelete: (id) => (deletedId = id) });
    try {
      const { findByText, queryByText } = render(<CommandsSection person={makePerson()} />);
      await findByText('"movie night"');
      fireEvent.click(await findByText("Delete"));
      await waitFor(() => expect(deletedId).toBe("cmd-abc"));
      await waitFor(() => expect(queryByText('"movie night"')).toBeNull());
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
