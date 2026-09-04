import { describe, expect, test, mock, afterEach } from "bun:test";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { VoiceCatalogSection } from "@/apps/settings/VoiceCatalogSection";

// `@testing-library/dom`'s global `screen` singleton is computed once at
// module-load time, before Bun's test preload finishes registering
// happy-dom's globals - it permanently falls back to a stub that throws.
// Every query here comes from render()'s own returned queries instead
// (ChatPage.test.tsx's own header comment already documents this).

afterEach(cleanup);

const CATALOG_ENTRIES = [
  { path: "vctk/p228_023_enhanced.wav", collection: "vctk" },
  { path: "vctk/p229_023_enhanced.wav", collection: "vctk" },
  { path: "expresso/ex04-confused.wav", collection: "expresso" },
];

function stubFetch(overrides: { onSelect?: (path: string) => void } = {}) {
  return mock((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/voice/catalog") && !url.includes("select")) {
      return Promise.resolve(new Response(JSON.stringify({ entries: CATALOG_ENTRIES }), { status: 200 }));
    }
    if (url.includes("/api/settings?scope=")) {
      return Promise.resolve(new Response(JSON.stringify([]), { status: 200 }));
    }
    if (url.includes("/api/voice/catalog/select")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { path?: string };
      overrides.onSelect?.(body.path ?? "");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            key: "tts.voice_id",
            value: `hf://kyutai/tts-voices/${body.path}`,
            source: "user",
            label: "Speaking voice",
            level: "basic",
            secret: false,
          }),
          { status: 200 },
        ),
      );
    }
    return Promise.reject(new Error(`unstubbed fetch: ${url}`));
  }) as unknown as typeof fetch;
}

describe("VoiceCatalogSection", () => {
  test("stays collapsed until the browse link is clicked, never fetching the catalog eagerly", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = mock(() => {
      fetchCalled = true;
      return Promise.reject(new Error("should not fetch before expanding"));
    }) as unknown as typeof fetch;
    try {
      const { findByText } = render(<VoiceCatalogSection personId="person-1" />);
      await findByText("Browse the full community voice catalog (2,000+ voices)");
      expect(fetchCalled).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("searching filters the catalog by substring, case-insensitively", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch();
    try {
      const { findByText, findByLabelText, queryByText } = render(<VoiceCatalogSection personId="person-1" />);
      fireEvent.click(await findByText("Browse the full community voice catalog (2,000+ voices)"));
      const input = await findByLabelText("Search the voice catalog");
      fireEvent.change(input, { target: { value: "EXPRESSO" } });
      await findByText("ex04-confused.wav");
      expect(queryByText("p228_023_enhanced.wav")).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a search shorter than 2 characters shows a prompt instead of results", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch();
    try {
      const { findByText, findByLabelText } = render(<VoiceCatalogSection personId="person-1" />);
      fireEvent.click(await findByText("Browse the full community voice catalog (2,000+ voices)"));
      const input = await findByLabelText("Search the voice catalog");
      fireEvent.change(input, { target: { value: "v" } });
      await findByText("Keep typing to search.");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("picking a voice calls the dedicated select endpoint with the real path, not a mangled one", async () => {
    const originalFetch = globalThis.fetch;
    let selectedPath: string | null = null;
    globalThis.fetch = stubFetch({ onSelect: (path) => (selectedPath = path) });
    try {
      const { findByText, findByLabelText, findAllByText } = render(<VoiceCatalogSection personId="person-1" />);
      fireEvent.click(await findByText("Browse the full community voice catalog (2,000+ voices)"));
      const input = await findByLabelText("Search the voice catalog");
      fireEvent.change(input, { target: { value: "p228" } });
      await findByText("p228_023_enhanced.wav");
      const buttons = await findAllByText("Use this voice");
      fireEvent.click(buttons[0]!);
      await waitFor(() => expect(selectedPath).toBe("vctk/p228_023_enhanced.wav"));
      await findByText(/Currently using a catalog voice/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
