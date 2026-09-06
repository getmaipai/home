import { describe, expect, test, mock, afterEach } from "bun:test";
import { renderHook, waitFor } from "@testing-library/react";
import { useAppearance } from "@/shell/useAppearance";

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

  test("system leaves neither class applied", async () => {
    const restore = stubFetch({
      "/api/settings": [{ key: "ui.appearance", value: "system", scope: "person" }],
    });
    try {
      renderHook(() => useAppearance("person-1"));
      await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(document.documentElement.classList.contains("light")).toBe(false);
    } finally {
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
});
