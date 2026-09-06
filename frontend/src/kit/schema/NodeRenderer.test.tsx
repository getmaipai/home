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

  // A code review (2026-09-05) found `lastError` (the banner a failed
  // non-confirm dispatch, like this row_action, leaves under the list)
  // was never cleared by any later confirm-based action - success or
  // failure - so it would sit there indefinitely once set.
  test("a stale row_action error clears as soon as a new confirm dialog opens", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.match(/\/api\/test-items\/[^/]+\/archive$/)) {
        return Promise.resolve(new Response("", { status: 500, statusText: "Row Action Failed" }));
      }
      if (url.includes("/api/test-items")) {
        return Promise.resolve(new Response(JSON.stringify([{ id: "a", name: "First", category: "fact" }]), { status: 200 }));
      }
      throw new Error(`unstubbed fetch: ${url}`);
    }) as unknown as typeof fetch;
    try {
      const { findByRole, findByText, queryByText } = renderNode(listNode);
      fireEvent.click(await findByRole("button", { name: 'Archive "First"' }));
      await findByText("Row Action Failed");
      fireEvent.click(await findByRole("button", { name: "Select" }));
      fireEvent.click(await findByRole("checkbox", { name: "Select First" }));
      fireEvent.click(await findByRole("button", { name: "Archive selected" }));
      await findByText("Archive 1?");
      await waitFor(() => expect(queryByText("Row Action Failed")).toBeNull());
    } finally {
      globalThis.fetch = original;
    }
  });

  // A code review (2026-09-05) found Radix's default Escape-to-dismiss
  // wasn't gated on `busy` the way the visible Cancel/Confirm buttons
  // already were: pressing Escape mid-confirm hid the dialog via
  // `cancel()` while the request it started kept running, and once that
  // request resolved its own onSettled callback (here, exitSelectMode)
  // still fired - a side effect landing after the household member
  // believed they'd backed out.
  test("Escape does not dismiss the confirm dialog, or run its onSettled, while the action is still in flight", async () => {
    const resolveArchive: { current: (() => void) | null } = { current: null };
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.match(/\/api\/test-items\/[^/]+\/archive$/)) {
        return new Promise<Response>((resolve) => {
          resolveArchive.current = () => resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        });
      }
      if (url.includes("/api/test-items")) {
        return Promise.resolve(
          new Response(
            JSON.stringify([
              { id: "a", name: "First", category: "fact" },
              { id: "b", name: "Second", category: "fact" },
            ]),
            { status: 200 },
          ),
        );
      }
      throw new Error(`unstubbed fetch: ${url}`);
    }) as unknown as typeof fetch;
    try {
      const { findByRole, findByText, queryByRole } = renderNode(listNode);
      fireEvent.click(await findByRole("button", { name: "Select" }));
      fireEvent.click(await findByRole("checkbox", { name: "Select First" }));
      fireEvent.click(await findByRole("button", { name: "Archive selected" }));
      await findByText("Archive 1?");
      fireEvent.click(await findByRole("button", { name: "Confirm" }));
      await findByText("Working…");
      fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
      // Still mid-flight: the dialog stays open (its "Working…" state is
      // untouched by Escape - a closed dialog would have unmounted it).
      // The list underneath is legitimately `aria-hidden` while modal, so
      // it isn't queried here; the real proof is select mode still being
      // intact once the dialog actually does close, below.
      await findByText("Working…");
      resolveArchive.current?.();
      await waitFor(() => expect(queryByRole("checkbox", { name: "Select Second" })).toBeNull());
    } finally {
      globalThis.fetch = original;
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

  // A code review (2026-09-05) found fillTemplate ran BEFORE fillCount
  // resolved `{count}`, so a bound item with its own field literally named
  // `count` won the race: fillTemplate would substitute that field's value
  // into `{count}` first, and fillCount's later pass found nothing left to
  // replace. This item's own `count: 999` must never appear in the prompt -
  // only the true selection size (1) may.
  test("a bound item with its own 'count' field doesn't hijack the confirm prompt's {count}", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/test-items")) {
        return Promise.resolve(
          new Response(JSON.stringify([{ id: "a", name: "First", category: "fact", count: 999 }]), { status: 200 }),
        );
      }
      throw new Error(`unstubbed fetch: ${url}`);
    }) as unknown as typeof fetch;
    try {
      const { findByRole, findByText, queryByText } = renderNode(listNode);
      fireEvent.click(await findByRole("button", { name: "Select" }));
      fireEvent.click(await findByRole("checkbox", { name: "Select First" }));
      fireEvent.click(await findByRole("button", { name: "Archive selected" }));
      await findByText("Archive 1?");
      expect(queryByText("Archive 999?")).toBeNull();
    } finally {
      globalThis.fetch = original;
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

  // A code review (2026-09-05) found select mode - and the selection
  // with it - was cleared the instant a batch action was clicked, before
  // the confirm dialog it opened had even been answered: cancelling then
  // lost the selection for nothing, and the dialog appeared to be asking
  // about a list that had already silently left select mode underneath it.
  test("cancelling a scope:'selected' batch action's confirm keeps the selection and select mode intact", async () => {
    const env = stubFetch([
      { id: "a", name: "First", category: "fact" },
      { id: "b", name: "Second", category: "fact" },
    ]);
    try {
      const { findByRole, findByText, queryByText } = renderNode(listNode);
      fireEvent.click(await findByRole("button", { name: "Select" }));
      fireEvent.click(await findByRole("checkbox", { name: "Select First" }));
      fireEvent.click(await findByRole("button", { name: "Archive selected" }));
      await findByText("Archive 1?");
      fireEvent.click(await findByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(queryByText("Archive 1?")).toBeNull());
      // Still in select mode, First still checked - not reset to a plain list.
      expect(await findByRole("checkbox", { name: "Select First" })).toBeChecked();
      expect(env.archiveCalls).toEqual([]);
    } finally {
      env.restore();
    }
  });

  test("select mode exits only once a scope:'selected' batch action actually confirms and runs", async () => {
    const env = stubFetch([
      { id: "a", name: "First", category: "fact" },
      { id: "b", name: "Second", category: "fact" },
    ]);
    try {
      const { findByRole, findByText, queryByRole } = renderNode(listNode);
      fireEvent.click(await findByRole("button", { name: "Select" }));
      fireEvent.click(await findByRole("checkbox", { name: "Select First" }));
      fireEvent.click(await findByRole("button", { name: "Archive selected" }));
      await findByText("Archive 1?");
      fireEvent.click(await findByRole("button", { name: "Confirm" }));
      await waitFor(() => expect(env.archiveCalls).toEqual(["a"]));
      // Back to the plain list: no more checkboxes, no batch bar.
      await waitFor(() => expect(queryByRole("checkbox", { name: "Select Second" })).toBeNull());
    } finally {
      env.restore();
    }
  });

  test("the select toggle and batch bar are hidden once the bound list is empty", async () => {
    const env = stubFetch([]);
    try {
      const { findByText, queryByRole } = renderNode(listNode);
      await findByText("Nothing here.");
      expect(queryByRole("button", { name: "Select" })).toBeNull();
    } finally {
      env.restore();
    }
  });

  // A code review (2026-09-05) found a partial batch failure (item 2 of
  // 3 rejects) left an unhandled promise rejection with no user-visible
  // error, and never invalidated the query - so the one item that DID
  // archive stayed showing in the stale list too.
  test("a partial batch failure surfaces an error and still refreshes what did succeed", async () => {
    const archiveCalls: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = mock((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      const archiveMatch = url.match(/\/api\/test-items\/([^/]+)\/archive$/);
      if (archiveMatch) {
        const id = archiveMatch[1]!;
        archiveCalls.push(id);
        if (id === "b") return Promise.resolve(new Response("", { status: 500, statusText: "Server Error" }));
        return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }
      if (url.includes("/api/test-items")) {
        // "a" archived (no longer returned) once at least one archive call
        // landed - proves invalidation happened despite the later failure.
        const stillThere = archiveCalls.includes("a")
          ? [{ id: "b", name: "Second", category: "fact" }]
          : [
              { id: "a", name: "First", category: "fact" },
              { id: "b", name: "Second", category: "fact" },
            ];
        return Promise.resolve(new Response(JSON.stringify(stillThere), { status: 200 }));
      }
      throw new Error(`unstubbed fetch: ${url}`);
    }) as unknown as typeof fetch;
    try {
      const { findByRole, findByText } = renderNode(listNode);
      fireEvent.click(await findByRole("button", { name: "Select" }));
      fireEvent.click(await findByRole("checkbox", { name: "Select First" }));
      fireEvent.click(await findByRole("checkbox", { name: "Select Second" }));
      fireEvent.click(await findByRole("button", { name: "Archive selected" }));
      await findByText("Archive 2?");
      fireEvent.click(await findByRole("button", { name: "Confirm" }));
      await waitFor(() => expect(archiveCalls).toEqual(["a", "b"]));
      // "a" succeeded and is gone from the refreshed list; "b" failed and
      // is still there; the failure itself is visible, not swallowed.
      await findByText("Server Error");
    } finally {
      globalThis.fetch = original;
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
