import { describe, expect, test, mock, afterEach } from "bun:test";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { renderWithQueryClient } from "../../../tests/renderWithQueryClient";
import { NodeRenderer } from "@/kit/schema/NodeRenderer";
import type { ListNode, SectionNode } from "@/kit/schema/types";

afterEach(cleanup);

function renderNode(node: Parameters<typeof NodeRenderer>[0]["node"], state?: Record<string, unknown>) {
  return renderWithQueryClient(
    <MemoryRouter>
      <NodeRenderer node={node} state={state} />
    </MemoryRouter>,
  );
}

function stubFetch(items: { id: string; name: string; category: string }[]): { restore: () => void; archiveCalls: string[] } {
  const archiveCalls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const archiveMatch = url.match(/\/api\/test-items\/([^/]+)\/archive$/);
    if (archiveMatch) {
      archiveCalls.push(archiveMatch[1]!);
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    }
    if (url.includes("/api/test-items")) {
      return Promise.resolve(new Response(JSON.stringify(items), { status: 200 }));
    }
    throw new Error(`unstubbed fetch: ${url}`);
  }) as unknown as typeof fetch;
  return { restore: () => (globalThis.fetch = original), archiveCalls };
}

const listNode: ListNode = {
  type: "list",
  bind: { source: "route", path: "/api/test-items", stream: false },
  item_key_field: "id",
  item_label_field: "name",
  item_subtitle_field: "{category}",
  row_action: { icon: "archive", label: 'Archive "{name}"', action: { call: { target: "/api/test-items/{id}/archive" } } },
  batch: {
    select_label: "Select",
    actions: [
      {
        label: "Archive selected",
        scope: "selected",
        variant: "destructive",
        action: { confirm: { prompt: "Archive {count}?", on_confirm: { call: { target: "/api/test-items/{id}/archive" } } } },
      },
      {
        label: "Clear all",
        scope: "all",
        variant: "destructive",
        action: { confirm: { prompt: "Clear all {count}?", on_confirm: { call: { target: "/api/test-items/{id}/archive" } } } },
      },
    ],
  },
  empty_state: { type: "empty_state", icon: "inbox", text: "Nothing here." },
};

describe("NodeRenderer > list", () => {
  test("renders each bound item's label and subtitle", async () => {
    const env = stubFetch([{ id: "a", name: "First", category: "fact" }]);
    try {
      const { findByText } = renderNode(listNode);
      await findByText("First");
      await findByText("fact");
    } finally {
      env.restore();
    }
  });

  test("shows the declared empty state for an empty bound list", async () => {
    const env = stubFetch([]);
    try {
      const { findByText } = renderNode(listNode);
      await findByText("Nothing here.");
    } finally {
      env.restore();
    }
  });

  test("row_action calls the templated route with that row's own field", async () => {
    const env = stubFetch([{ id: "a", name: "First", category: "fact" }]);
    try {
      const { findByRole } = renderNode(listNode);
      fireEvent.click(await findByRole("button", { name: 'Archive "First"' }));
      await waitFor(() => expect(env.archiveCalls).toEqual(["a"]));
    } finally {
      env.restore();
    }
  });

  test("a batch action over selected items confirms once, then loops the call over each selected id", async () => {
    const env = stubFetch([
      { id: "a", name: "First", category: "fact" },
      { id: "b", name: "Second", category: "fact" },
      { id: "c", name: "Third", category: "fact" },
    ]);
    try {
      const { findByRole, findByText } = renderNode(listNode);
      fireEvent.click(await findByRole("button", { name: "Select" }));
      fireEvent.click(await findByRole("checkbox", { name: "Select First" }));
      fireEvent.click(await findByRole("checkbox", { name: "Select Second" }));
      fireEvent.click(await findByRole("button", { name: "Archive selected" }));
      await findByText("Archive 2?");
      fireEvent.click(await findByRole("button", { name: "Confirm" }));
      await waitFor(() => expect(env.archiveCalls.sort()).toEqual(["a", "b"]));
    } finally {
      env.restore();
    }
  });

  test("a batch action with scope 'all' loops over every loaded item, not just selected ones", async () => {
    const env = stubFetch([
      { id: "a", name: "First", category: "fact" },
      { id: "b", name: "Second", category: "fact" },
    ]);
    try {
      const { findByRole, findByText } = renderNode(listNode);
      fireEvent.click(await findByRole("button", { name: "Select" }));
      fireEvent.click(await findByRole("button", { name: "Clear all" }));
      await findByText("Clear all 2?");
      fireEvent.click(await findByRole("button", { name: "Confirm" }));
      await waitFor(() => expect(env.archiveCalls.sort()).toEqual(["a", "b"]));
    } finally {
      env.restore();
    }
  });

  test("cancelling the confirm dialog runs nothing", async () => {
    const env = stubFetch([{ id: "a", name: "First", category: "fact" }]);
    try {
      const { findByRole, findByText, queryByText } = renderNode(listNode);
      fireEvent.click(await findByRole("button", { name: "Select" }));
      fireEvent.click(await findByRole("button", { name: "Clear all" }));
      await findByText("Clear all 1?");
      fireEvent.click(await findByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(queryByText("Clear all 1?")).toBeNull());
      expect(env.archiveCalls).toEqual([]);
    } finally {
      env.restore();
    }
  });
});

describe("NodeRenderer > section", () => {
  const sectionNode: SectionNode = {
    type: "section",
    heading: "Gated",
    condition: "canManage",
    children: [{ type: "empty_state", icon: "inbox", text: "Visible content" }],
  };

  test("renders its children when the condition is true", () => {
    const { getByText } = renderNode(sectionNode, { canManage: true });
    expect(getByText("Visible content")).toBeTruthy();
  });

  test("renders nothing when the condition is false", () => {
    const { queryByText } = renderNode(sectionNode, { canManage: false });
    expect(queryByText("Visible content")).toBeNull();
  });
});
