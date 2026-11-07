import { toastError, spyOnToast } from "../../tests/toastSpy";
import { describe, expect, test, mock, afterEach } from "bun:test";
import { act, renderHook as renderHookBare, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createQueryClient } from "@/lib/queryClient";
import { useAppearance } from "@/shell/useAppearance";

function renderHook<T>(callback: () => T) {
  const client = createQueryClient();
  return renderHookBare(callback, { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}

spyOnToast();

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function stubFetch(byPath: Record<string, unknown>): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = mock((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const match = Object.entries(byPath).find(([path]) => url.includes(path));
    if (!match) throw new Error(`unstubbed fetch: ${url}`);
    return Promise.resolve(jsonResponse(match[1]));
  }) as unknown as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

afterEach(() => {
  document.documentElement.classList.remove("dark", "light");
});

describe("useAppearance", () => {
  test("applies the .dark class once the person's setting resolves to dark", async () => {
    const restore = stubFetch({
      "/api/settings": [{ key: "ui.appearance", value: "dark", scope: "person" }],
    });
    try {
      renderHook(() => useAppearance("person-1"));
      await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
    } finally {
      restore();
    }
  });

  test("applies the .light class for an explicit light choice", async () => {
    const restore = stubFetch({
      "/api/settings": [{ key: "ui.appearance", value: "light", scope: "person" }],
    });
    try {
      renderHook(() => useAppearance("person-1"));
      await waitFor(() => expect(document.documentElement.classList.contains("light")).toBe(true));
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    } finally {
      restore();
    }
  });

  // HOME-UI-04b: "system" always resolves to a concrete class now, not
  // neither - found live on /apps, the vendored shadcndashboard
  // template's own `dark:*` Tailwind utilities are gated by this
  // project's `@custom-variant dark (&:is(.dark *))`, which needs a
  // literal `.dark` ancestor and never matches the OS-level
  // `prefers-color-scheme` media query the kit's own CSS-variable
  // tokens already followed with no class needed. Leaving both classes
  // off under "system" - the default for every real person - left
  // every such utility dead. Both matchMedia outcomes covered, mocked
  // rather than relying on the test environment's own default.
  test("system resolves to .dark when the OS prefers dark", async () => {
    const restore = stubFetch({
      "/api/settings": [{ key: "ui.appearance", value: "system", scope: "person" }],
    });
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = mock(() => ({ matches: true, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
    try {
      renderHook(() => useAppearance("person-1"));
      await waitFor(() => expect(document.documentElement.classList.contains("dark")).toBe(true));
      expect(document.documentElement.classList.contains("light")).toBe(false);
    } finally {
      window.matchMedia = originalMatchMedia;
      restore();
    }
  });

  test("system resolves to .light when the OS prefers light", async () => {
    const restore = stubFetch({
      "/api/settings": [{ key: "ui.appearance", value: "system", scope: "person" }],
    });
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = mock(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
    try {
      renderHook(() => useAppearance("person-1"));
      await waitFor(() => expect(document.documentElement.classList.contains("light")).toBe(true));
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    } finally {
      window.matchMedia = originalMatchMedia;
      restore();
    }
  });

  test("a failed read keeps the system default rather than throwing", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.reject(new Error("offline"))) as unknown as typeof fetch;
    try {
      const { result } = renderHook(() => useAppearance("person-1"));
      await waitFor(() => expect(result.current.appearance).toBe("system"));
    } finally {
      globalThis.fetch = original;
    }
  });

  test("a late stored value never overwrites a choice the person just made", async () => {
    const original = globalThis.fetch;
    let release: (response: Response) => void = () => {};
    globalThis.fetch = mock((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") return Promise.resolve(jsonResponse({ key: "ui.appearance", value: "dark" }));
      return new Promise<Response>((resolve) => { release = resolve; });
    }) as unknown as typeof fetch;
    try {
      const { result } = renderHook(() => useAppearance("person-1"));
      act(() => result.current.setAppearance("dark"));
      await act(async () => { release(jsonResponse([{ key: "ui.appearance", value: "light", scope: "person" }])); });
      expect(result.current.appearance).toBe("dark");
    } finally { globalThis.fetch = original; }
  });

  test("a failed save keeps the choice on screen and says it did not stick", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = mock((_input: RequestInfo | URL, init?: RequestInit) => init?.method === "PUT"
      ? Promise.resolve(new Response(JSON.stringify({ error: "Home could not save your appearance." }), { status: 500 }))
      : Promise.resolve(jsonResponse([]))) as unknown as typeof fetch;
    try {
      const { result } = renderHook(() => useAppearance("person-1"));
      await act(async () => { result.current.setAppearance("dark"); });
      await waitFor(() => expect(toastError).toHaveBeenCalledWith("Home could not save your appearance. Check your connection and try again."));
      expect(result.current.appearance).toBe("dark");
    } finally { globalThis.fetch = original; }
  });
});
