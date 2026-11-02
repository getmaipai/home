// VIDEO-CREATE-02 (U3): the host's `pickMedia`. The Make page's Picture slot asks the host for a Library picture; the host lists the signed-in
// person's own pictures and resolves with the chosen file id, or null when the dialog is closed. Without a person the host offers no picker
// (the kit then leaves the slot disabled).
import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useContext, type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { createQueryClient } from "@maipai/ui/src/queryClient";
import { ToastProvider } from "@maipai/ui/src/primitives/Toast";
import { MediaHostContext, type MediaHost } from "@maipai/ui/src/schema/mediaHost";
import { MediaHostProvider } from "@/shell/mediaHost";

afterEach(cleanup);

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function item(id: string, owner: string, mediaType = "image/png") {
  return { id, kind: "image", name: `${id}.png`, media_type: mediaType, size_bytes: 10, created_at: "2026-11-01T00:00:00Z", owner: { id: owner, display_name: owner }, shared_with: { count: 0, household: false }, retention: "kept", origin: "made", chat_id: null, can_edit: false, audience: null, duration_seconds: null, thumb_url: `/api/files/${id}/thumb?w=320`, expires_at: null, version_count: 1 };
}
function stubLibrary(items: unknown[]) {
  globalThis.fetch = (async () => new Response(JSON.stringify({ items, next_cursor: null }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
}

let host: MediaHost | null = null;
function Probe() { host = useContext(MediaHostContext); return null; }
function mount(personId: string | undefined, children: ReactNode = <Probe />) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <TooltipProvider>
        <ToastProvider>
          <MemoryRouter>
            <MediaHostProvider personId={personId}>{children}</MediaHostProvider>
          </MemoryRouter>
        </ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe("MediaHost.pickMedia", () => {
  test("is offered only when the host knows the person", () => {
    mount(undefined);
    expect(host?.pickMedia).toBeUndefined();
    cleanup();
    mount("person-1");
    expect(typeof host?.pickMedia).toBe("function");
  });

  test("lists only the person's own pictures and resolves with the chosen file id and its thumbnail", async () => {
    stubLibrary([item("mine-1", "person-1"), item("theirs-1", "person-2"), item("mine-doc", "person-1", "application/pdf")]);
    const view = mount("person-1");
    let picked!: Promise<unknown>;
    act(() => { picked = host!.pickMedia!("picture"); });
    await waitFor(() => expect(view.getAllByRole("button", { name: /^Use / })).toHaveLength(1));
    expect(view.queryByRole("button", { name: "Use theirs-1.png" })).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Use mine-1.png" }));
    expect(await picked).toEqual({ id: "mine-1", thumb: "/api/files/mine-1/thumb?w=320" });
    await waitFor(() => expect(view.queryByRole("dialog")).toBeNull());
  });

  test("asks the Library for the person's own pictures, so other people's items cannot crowd the page", async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => { urls.push(String(input)); return new Response(JSON.stringify({ items: [], next_cursor: null }), { status: 200, headers: { "content-type": "application/json" } }); }) as unknown as typeof fetch;
    const view = mount("person-1");
    act(() => { void host!.pickMedia!("picture"); });
    await waitFor(() => expect(view.getByText("You have no pictures in your Library yet. Add one above.")).toBeTruthy());
    const asked = new URL(urls.find((u) => u.includes("/api/library"))!, "http://x");
    expect(asked.searchParams.get("owner")).toBe("me");
    expect(asked.searchParams.get("type")).toBe("image");
  });

  test("closing the dialog resolves with null", async () => {
    stubLibrary([]);
    const view = mount("person-1");
    let picked!: Promise<unknown>;
    act(() => { picked = host!.pickMedia!("picture"); });
    await waitFor(() => expect(view.getByText("You have no pictures in your Library yet. Add one above.")).toBeTruthy());
    fireEvent.keyDown(view.getByRole("dialog"), { key: "Escape" });
    expect(await picked).toBeNull();
  });
});
