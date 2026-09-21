import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "@/lib/queryClient";
import { useShellNext } from "@/next/useShellNext";

afterEach(() => {
  cleanup();
});

function stubFetch(handler: () => Response) {
  const original = globalThis.fetch;
  globalThis.fetch = mock(() => Promise.resolve(handler())) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function renderShellNext() {
  const queryClient = createQueryClient();
  return renderHook(() => useShellNext(), {
    wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  });
}

describe("useShellNext", () => {
  test("resolves to on when the household flag is true", async () => {
    const restore = stubFetch(() => Response.json([{ scope: "household", key: "ui.shell.next", value: true }]));
    try {
      const { result } = renderShellNext();
      expect(result.current).toBe("loading");
      await waitFor(() => expect(result.current).toBe("on"));
    } finally {
      restore();
    }
  });

  test("resolves to off when the household flag is false or absent", async () => {
    const restore = stubFetch(() => Response.json([]));
    try {
      const { result } = renderShellNext();
      await waitFor(() => expect(result.current).toBe("off"));
    } finally {
      restore();
    }
  });

  // SHELL-08 (found live, debugging its own sign-in capture): a real
  // race during the in-session sign-out this row's acceptance exercises
  // can turn this query's `data` from present to a genuine 401
  // `isError` - checked explicitly now so a real failure reads as
  // `"off"` (bounce home) instead of spinning `RouteSkeleton` forever.
  test("resolves to off, not a stuck loading state, when the settings fetch fails", async () => {
    const restore = stubFetch(() => Response.json({ error: "Unauthorized" }, { status: 401 }));
    try {
      const { result } = renderShellNext();
      await waitFor(() => expect(result.current).toBe("off"));
    } finally {
      restore();
    }
  });
});
