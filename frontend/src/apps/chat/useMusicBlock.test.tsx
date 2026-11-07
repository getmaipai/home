// AUDIT-DUP-FE-01: the joined hook gives a band, an album and a song style their props from one call, and stays inert for any other block.
import { afterEach, describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { ToastProvider } from "@maipai/ui/src/primitives/Toast";
import { useMusicBlock } from "@/apps/chat/useMusicBlock";

afterEach(cleanup);
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });
function Wrapper({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return <QueryClientProvider client={client}><ToastProvider><MemoryRouter>{children}</MemoryRouter></ToastProvider></QueryClientProvider>;
}

describe("useMusicBlock", () => {
  test("any other block is inert", () => {
    const view = renderHook(() => useMusicBlock({ kind: "paragraph", props: {} }), { wrapper: Wrapper });
    expect(view.result.current).toEqual({ props: null, onAction: null, gone: false });
  });

  test("a band card gets its handler and takes its finished portrait and logo from the band record", async () => {
    globalThis.fetch = (async () => Response.json({ id: "mband-abc123", portrait_file_id: "file-p", logo_file_id: "file-l" })) as unknown as typeof fetch;
    const block = { kind: "band", provenance: "make_band:mband-abc123:-:-", props: { name: "Riff" } };
    const view = renderHook(() => useMusicBlock(block), { wrapper: Wrapper });
    expect(typeof view.result.current.onAction).toBe("function");
    await waitFor(() => expect(view.result.current.props?.portrait).toBeTruthy());
    expect(view.result.current.props?.logo).toBeTruthy();
    expect(view.result.current.gone).toBe(false);
  });

  test("a record the hub no longer has is gone", async () => {
    globalThis.fetch = (async () => Response.json({ error: "No such album." }, { status: 404 })) as unknown as typeof fetch;
    const block = { kind: "album", provenance: "make_album:malbum-abc123:-:-", props: {} };
    const view = renderHook(() => useMusicBlock(block), { wrapper: Wrapper });
    await waitFor(() => expect(view.result.current.gone).toBe(true));
  });
});

describe("the card polls", () => {
  test("an album with no songs yet is read again until its songs and cover arrive, then stops", async () => {
    let reads = 0;
    globalThis.fetch = (async () => { reads += 1; return Response.json({ block: { props: reads < 2 ? { tracks: [] } : { cover: "c", tracks: [{ id: "t1" }] } }, cover_state: "ready" }); }) as unknown as typeof fetch;
    const block = { kind: "album", provenance: "make_album:malbum-abc123:-:-", props: {} };
    const view = renderHook(() => useMusicBlock(block), { wrapper: Wrapper });
    await waitFor(() => expect(view.result.current.props?.cover).toBe("c"), { timeout: 8000 });
    expect(reads).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 3500));
    expect(reads).toBe(2);
  }, 20_000);
});
