import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useContext } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@maipai/ui/src/ui/tooltip";
import { createQueryClient } from "@maipai/ui/src/queryClient";
import { ToastProvider } from "@maipai/ui/src/primitives/Toast";
import { MediaHostContext, type MediaHost } from "@maipai/ui/src/schema/mediaHost";
import { WakeWordPersonContext } from "@/apps/chat/chatThreadContexts";
import { MediaHostProvider } from "@/shell/mediaHost";
import { ApiError } from "@/lib/api";

afterEach(cleanup);
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
let host: MediaHost | null = null;
function Probe() { host = useContext(MediaHostContext); return null; }
const person = { id: "p1", pinDigits: 4, hasSecret: true } as never;
function mount(fetcher: (body: Record<string, unknown>) => Promise<unknown>) {
  globalThis.fetch = mock((input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/adult-lock/confirm") return fetcher(JSON.parse(String(init?.body)) as Record<string, unknown>) as Promise<Response>;
    return Promise.resolve(Response.json({}));
  }) as unknown as typeof fetch;
  return render(<QueryClientProvider client={createQueryClient()}><TooltipProvider><ToastProvider><MemoryRouter><WakeWordPersonContext.Provider value={person}><MediaHostProvider><Probe /></MediaHostProvider></WakeWordPersonContext.Provider></MemoryRouter></ToastProvider></TooltipProvider></QueryClientProvider>);
}
const field = () => document.querySelector<HTMLInputElement>('[data-slot="adult-lock-dialog"] input')!;
async function open() {
  let result!: Promise<{ ticket: string } | null>;
  act(() => { result = host!.confirmFresh!({ id: "file-7" }, {}); });
  await waitFor(() => expect(document.querySelector('[data-slot="adult-lock-dialog"]')).not.toBeNull());
  return result;
}

describe("MediaHost.confirmFresh", () => {
  test("does not draw the dialog while idle, and opens it on request", async () => {
    const view = mount(async () => Response.json({ ticket: "ticket-7" }));
    expect(document.querySelector('[data-slot="adult-lock-dialog"]')).toBeNull();
    const pending = open();
    await waitFor(() => expect(document.querySelector('[data-slot="adult-lock-dialog"]')).not.toBeNull());
    expect(document.querySelector('[data-slot="adult-lock-dialog"]')).not.toBeNull();
    fireEvent.change(field(), { target: { value: "1234" } });
    fireEvent.submit(field().closest("form")!);
    await expect(pending).resolves.toEqual({ ticket: "ticket-7" });
    view.unmount();
  });

  test("posts the fresh secret and item, then resolves with the ticket", async () => {
    let body: Record<string, unknown> | undefined;
    mount(async (value) => { body = value; return Response.json({ ticket: "ticket-7" }); });
    const pending = open(); await waitFor(() => expect(document.querySelector('[data-slot="adult-lock-dialog"]')).not.toBeNull());
    fireEvent.change(field(), { target: { value: "2468" } });
    fireEvent.submit(field().closest("form")!);
    await expect(pending).resolves.toEqual({ ticket: "ticket-7" });
    expect(body).toEqual({ secret: "2468", action: "unmark", item: "file-7" });
  });

  test("cancel resolves null", async () => {
    const view = mount(async () => Response.json({ ticket: "unused" }));
    const pending = open(); await waitFor(() => expect(document.querySelector('[data-slot="adult-lock-dialog"]')).not.toBeNull());
    fireEvent.keyDown(document.querySelector('[role="dialog"]')!, { key: "Escape" });
    await expect(pending).resolves.toBeNull();
    view.unmount();
  });

  test("401 shows the failed state and leaves the request unresolved", async () => {
    mount(async () => { throw new ApiError("bad", 401); });
    const pending = open(); await waitFor(() => expect(document.querySelector('[data-slot="adult-lock-dialog"]')).not.toBeNull());
    let settled = false;
    void pending.then(() => { settled = true; });
    fireEvent.change(field(), { target: { value: "0000" } });
    fireEvent.submit(field().closest("form")!);
    await waitFor(() => expect(document.querySelector('[data-slot="adult-lock-error"]')?.textContent).toContain("was not right"));
    expect(settled).toBe(false);
  });

  test("429 shows the lockout state", async () => {
    mount(async () => { throw new ApiError("locked", 429, undefined, undefined, 45); });
    const pending = open(); await waitFor(() => expect(document.querySelector('[data-slot="adult-lock-dialog"]')).not.toBeNull());
    fireEvent.change(field(), { target: { value: "0000" } });
    fireEvent.submit(field().closest("form")!);
    await waitFor(() => expect(document.querySelector('[data-slot="adult-lock-error"]')?.textContent).toContain("wait for the timer"));
    void pending;
  });

  test("a second request resolves the first with null", async () => {
    const view = mount(async () => new Promise<Response>(() => {}));
    const first = open(); await waitFor(() => expect(document.querySelector('[data-slot="adult-lock-dialog"]')).not.toBeNull());
    let second!: Promise<{ ticket: string } | null>;
    act(() => { second = host!.confirmFresh!({ id: "file-8" }, {}); });
    await expect(first).resolves.toBeNull();
    fireEvent.keyDown(document.querySelector('[role="dialog"]')!, { key: "Escape" });
    await expect(second).resolves.toBeNull();
    view.unmount();
  });
});
