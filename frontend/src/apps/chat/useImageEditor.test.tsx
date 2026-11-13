// EDITOR-07: the chat canvas's picture editor offers "Open in Studio" only for a picture that is also a Library file of the person's own.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { createQueryClient } from "@/lib/queryClient";
import { useImageEditor } from "@/apps/chat/useImageEditor";

const realFetch = globalThis.fetch;
afterEach(() => { cleanup(); globalThis.fetch = realFetch; });

function view(libraryStatus: number) {
  const calls: string[] = [];
  globalThis.fetch = mock((url: string | URL | Request) => {
    const path = String(url);
    calls.push(path);
    if (path.includes("/api/media-ops/files/")) return Promise.resolve(libraryStatus === 200 ? Response.json({ versions: [] }) : Response.json({ error: "That picture isn't in your Library any more." }, { status: libraryStatus }));
    if (path.includes("/api/image-edit/status")) return Promise.resolve(Response.json({ state: "ready", note: null, tools: {}, limits: {} }));
    return Promise.resolve(Response.json({ versions: [] }));
  }) as unknown as typeof fetch;
  const client = createQueryClient();
  const hook = renderHook(() => useImageEditor({ canShare: false, onShare: () => {} }), { wrapper: ({ children }) => <MemoryRouter><QueryClientProvider client={client}>{children}</QueryClientProvider></MemoryRouter> });
  act(() => hook.result.current.editFromSrc({ id: "att-1", name: "Beach.png", src: "/api/attachments/att-1/content?conversation_id=c1" }));
  return { hook, calls };
}

describe("useImageEditor: Open in Studio", () => {
  test("a picture that is a Library file gets the action", async () => {
    const { hook, calls } = view(200);
    await waitFor(() => expect(hook.result.current.props?.onOpenInStudio).toBeTypeOf("function"));
    expect(calls.some((url) => url.includes("/api/media-ops/files/att-1/versions"))).toBe(true);
  });

  test("a picture that is not (a temporary chat's, or locked) gets none", async () => {
    const { hook, calls } = view(404);
    await waitFor(() => expect(calls.some((url) => url.includes("/api/media-ops/files/att-1/versions"))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(hook.result.current.props).not.toBeNull();
    expect(hook.result.current.props?.onOpenInStudio).toBeUndefined();
  });
});
