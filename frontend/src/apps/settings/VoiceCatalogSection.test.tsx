import { describe, expect, test, mock, afterEach } from "bun:test";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { VoiceCatalogSection } from "@/apps/settings/VoiceCatalogSection";
import { readMicDevicePreference } from "@/lib/voice/micDevicePreference";

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
  // The live finding this section's own readable-name rendering exists
  // for (Jesse, 2026-09-23): a donated file with a content-hash segment.
  { path: "voice-donations/zerocool_enhanced.wav.1e68beda@240.safetensors", collection: "voice-donations" },
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
      await findByText("ex04-confused");
      expect(queryByText("p228 023 enhanced")).toBeNull();
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
      await findByText("p228 023 enhanced");
      const buttons = await findAllByText("Use this voice");
      fireEvent.click(buttons[0]!);
      await waitFor(() => expect(selectedPath).toBe("vctk/p228_023_enhanced.wav"));
      await findByText(/Currently using a catalog voice/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // The live finding (Jesse, 2026-09-23): raw file names like
  // "zerocool_enhanced.wav.1e68beda@240.safetensors" under
  // "Voice-donations" - never a hash, in the list or in the "currently
  // using" label.
  test("a donated file with a content-hash segment shows its readable name, never the raw file name", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch();
    try {
      const { findByText, findByLabelText, queryByText } = render(<VoiceCatalogSection personId="person-1" />);
      fireEvent.click(await findByText("Browse the full community voice catalog (2,000+ voices)"));
      const input = await findByLabelText("Search the voice catalog");
      fireEvent.change(input, { target: { value: "zerocool" } });
      await findByText("zerocool enhanced");
      expect(queryByText(/1e68beda|safetensors/)).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("the same picked voice shows its readable name in the currently-using line too", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch();
    try {
      const { findByText, findByLabelText } = render(<VoiceCatalogSection personId="person-1" />);
      fireEvent.click(await findByText("Browse the full community voice catalog (2,000+ voices)"));
      const input = await findByLabelText("Search the voice catalog");
      fireEvent.change(input, { target: { value: "zerocool" } });
      await findByText("zerocool enhanced");
      fireEvent.click(await findByText("Use this voice"));
      await findByText("Currently using a catalog voice: zerocool enhanced");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  // A code review (2026-09-23): the microphone picker used to be nested
  // inside the catalog's own "loaded" branch, so a household with no
  // internet (or a Hugging Face outage) could never reach it even
  // though it has nothing to do with the catalog fetch. This proves
  // it's reachable without ever expanding the catalog at all - the
  // catalog fetch here would reject if it were ever called.
  test("the microphone control is reachable without expanding the catalog, or ever fetching it", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.reject(new Error("the catalog should never be fetched for this"))) as unknown as typeof fetch;
    const originalMediaDevices = navigator.mediaDevices;
    const devices = [
      { deviceId: "mic-1", kind: "audioinput", label: "Built-in Microphone" } as MediaDeviceInfo,
      { deviceId: "mic-2", kind: "audioinput", label: "USB Headset" } as MediaDeviceInfo,
    ];
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { enumerateDevices: () => Promise.resolve(devices), addEventListener: () => {}, removeEventListener: () => {} },
    });
    try {
      const { findByText, unmount } = render(<VoiceCatalogSection personId="person-1" />);
      // Never clicks "Browse the full community voice catalog" - the
      // mic list should show up on its own.
      await findByText("Microphone");
      await findByText("Built-in Microphone");
      await findByText("USB Headset");
      unmount();
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: originalMediaDevices });
      globalThis.fetch = originalFetch;
    }
  });

  test("the microphone group is absent with fewer than two devices (RESP-04 f)", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(() => Promise.reject(new Error("the catalog should never be fetched for this"))) as unknown as typeof fetch;
    const originalMediaDevices = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { enumerateDevices: () => Promise.resolve([{ deviceId: "mic-1", kind: "audioinput", label: "Built-in Microphone" }]), addEventListener: () => {}, removeEventListener: () => {} },
    });
    try {
      const { findByText, queryByText, unmount } = render(<VoiceCatalogSection personId="person-1" />);
      await findByText("Browse the full community voice catalog (2,000+ voices)");
      await waitFor(() => expect(queryByText("Microphone")).toBeNull());
      unmount();
      // The mic-enumerating effect's own unmount cleanup
      // (navigator.mediaDevices.removeEventListener) runs as a passive
      // effect, a tick after unmount() returns - wait for it before
      // restoring navigator.mediaDevices below.
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: originalMediaDevices });
      globalThis.fetch = originalFetch;
    }
  });

  test("two microphones list both, and choosing the second writes the device preference (moved from the composer chevron, VOICE-LIVE-03b)", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch();
    const originalMediaDevices = navigator.mediaDevices;
    const devices = [
      { deviceId: "mic-1", kind: "audioinput", label: "Built-in Microphone" } as MediaDeviceInfo,
      { deviceId: "mic-2", kind: "audioinput", label: "USB Headset" } as MediaDeviceInfo,
    ];
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { enumerateDevices: () => Promise.resolve(devices), addEventListener: () => {}, removeEventListener: () => {} },
    });
    try {
      const { findByText, getByText, unmount } = render(<VoiceCatalogSection personId="person-1" />);
      fireEvent.click(await findByText("Browse the full community voice catalog (2,000+ voices)"));
      await findByText("Microphone");
      expect(getByText("Built-in Microphone")).toBeTruthy();
      const usbRow = (await findByText("USB Headset")).closest("li")!;
      fireEvent.click(usbRow.querySelector("button")!);
      await waitFor(() => expect(readMicDevicePreference()).toBe("mic-2"));
      unmount();
      await new Promise((r) => setTimeout(r, 0)); // let the mic effect's own unmount cleanup run before restoreMedia() - see the comment above
    } finally {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: originalMediaDevices });
      globalThis.fetch = originalFetch;
      localStorage.removeItem("maipai.chat.mic-device-id");
    }
  });
});
