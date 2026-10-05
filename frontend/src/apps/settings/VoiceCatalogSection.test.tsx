import { describe, expect, test, mock, afterEach, spyOn } from "bun:test";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { VoiceCatalogSection } from "@/apps/settings/VoiceCatalogSection";
import { api } from "@/lib/api";
import { readMicDevicePreference } from "@/lib/voice/micDevicePreference";
import { waitForGone } from "../../../tests/waitForGone";

// `@testing-library/dom`'s global `screen` singleton is computed once at
// module-load time, before Bun's test preload finishes registering
// happy-dom's globals - it permanently falls back to a stub that throws.
// Every query here comes from render()'s own returned queries instead
// (ChatPage.test.tsx's own header comment already documents this).

afterEach(() => {
  cleanup();
  mock.restore();
});

const CATALOG_ENTRIES = [
  { path: "vctk/p228_023_enhanced.wav", collection: "vctk" },
  { path: "vctk/p229_023_enhanced.wav", collection: "vctk" },
  { path: "expresso/ex04-confused.wav", collection: "expresso" },
  // The live finding this section's own readable-name rendering exists
  // for (Jesse, 2026-09-23): a donated file with a content-hash segment.
  { path: "voice-donations/zerocool_enhanced.wav.1e68beda@240.safetensors", collection: "voice-donations" },
];

function stubApi(overrides: { onSelect?: (path: string) => void } = {}) {
  const catalog = spyOn(api, "voiceCatalog").mockResolvedValue({ entries: CATALOG_ENTRIES });
  const settings = spyOn(api, "settingsValues").mockResolvedValue([]);
  const select = spyOn(api, "selectVoiceFromCatalog").mockImplementation(async (path) => {
    overrides.onSelect?.(path);
    return {
      key: "tts.voice_id",
      value: `hf://kyutai/tts-voices/${path}`,
      source: "user",
      label: "Speaking voice",
      level: "basic",
      secret: false,
    } as never;
  });
  return { catalog, settings, select };
}

describe("VoiceCatalogSection", () => {
  test("stays collapsed until the browse link is clicked, never fetching the catalog eagerly", async () => {
    const catalog = spyOn(api, "voiceCatalog").mockRejectedValue(new Error("should not fetch before expanding"));
    const { findByText } = render(<VoiceCatalogSection personId="person-1" />);
    await findByText("Browse the full community voice catalog (2,000+ voices)");
    expect(catalog).not.toHaveBeenCalled();
  });

  test("searching filters the catalog by substring, case-insensitively", async () => {
    stubApi();
    const { findByText, findByLabelText, queryByText } = render(<VoiceCatalogSection personId="person-1" />);
    fireEvent.click(await findByText("Browse the full community voice catalog (2,000+ voices)"));
    const input = await findByLabelText("Search the voice catalog");
    fireEvent.change(input, { target: { value: "EXPRESSO" } });
    await findByText("ex04-confused");
    expect(queryByText("p228 023 enhanced")).toBeNull();
  });

  test("a search shorter than 2 characters shows a prompt instead of results", async () => {
    stubApi();
    const { findByText, findByLabelText } = render(<VoiceCatalogSection personId="person-1" />);
    fireEvent.click(await findByText("Browse the full community voice catalog (2,000+ voices)"));
    const input = await findByLabelText("Search the voice catalog");
    fireEvent.change(input, { target: { value: "v" } });
    await findByText("Keep typing to search.");
  });

  test("picking a voice calls the dedicated select endpoint with the real path, not a mangled one", async () => {
    let selectedPath: string | null = null;
    stubApi({ onSelect: (path) => (selectedPath = path) });
      const { findByText, findByLabelText, findAllByText } = render(<VoiceCatalogSection personId="person-1" />);
      fireEvent.click(await findByText("Browse the full community voice catalog (2,000+ voices)"));
      const input = await findByLabelText("Search the voice catalog");
      fireEvent.change(input, { target: { value: "p228" } });
      await findByText("p228 023 enhanced");
      const buttons = await findAllByText("Use this voice");
      fireEvent.click(buttons[0]!);
      await waitFor(() => expect(selectedPath).toBe("vctk/p228_023_enhanced.wav"));
      await findByText(/Currently using a catalog voice/);
  });

  // The live finding (Jesse, 2026-09-23): raw file names like
  // "zerocool_enhanced.wav.1e68beda@240.safetensors" under
  // "Voice-donations" - never a hash, in the list or in the "currently
  // using" label.
  test("a donated file with a content-hash segment shows its readable name, never the raw file name", async () => {
    stubApi();
      const { findByText, findByLabelText, queryByText } = render(<VoiceCatalogSection personId="person-1" />);
      fireEvent.click(await findByText("Browse the full community voice catalog (2,000+ voices)"));
      const input = await findByLabelText("Search the voice catalog");
      fireEvent.change(input, { target: { value: "zerocool" } });
      await findByText("zerocool enhanced");
      expect(queryByText(/1e68beda|safetensors/)).toBeNull();
  });

  test("the same picked voice shows its readable name in the currently-using line too", async () => {
    stubApi();
      const { findByText, findByLabelText } = render(<VoiceCatalogSection personId="person-1" />);
      fireEvent.click(await findByText("Browse the full community voice catalog (2,000+ voices)"));
      const input = await findByLabelText("Search the voice catalog");
      fireEvent.change(input, { target: { value: "zerocool" } });
      await findByText("zerocool enhanced");
      fireEvent.click(await findByText("Use this voice"));
      await findByText("Currently using a catalog voice: zerocool enhanced");
  });

  // A code review (2026-09-23): the microphone picker used to be nested
  // inside the catalog's own "loaded" branch, so a household with no
  // internet (or a Hugging Face outage) could never reach it even
  // though it has nothing to do with the catalog fetch. This proves
  // it's reachable without ever expanding the catalog at all - the
  // catalog fetch here would reject if it were ever called.
  test("the microphone control is reachable without expanding the catalog, or ever fetching it", async () => {
    const catalog = spyOn(api, "voiceCatalog").mockRejectedValue(new Error("the catalog should never be fetched for this"));
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
      expect(catalog).not.toHaveBeenCalled();
    }
  });

  test("the microphone group is absent with fewer than two devices (RESP-04 f)", async () => {
    const catalog = spyOn(api, "voiceCatalog").mockRejectedValue(new Error("the catalog should never be fetched for this"));
    const originalMediaDevices = navigator.mediaDevices;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { enumerateDevices: () => Promise.resolve([{ deviceId: "mic-1", kind: "audioinput", label: "Built-in Microphone" }]), addEventListener: () => {}, removeEventListener: () => {} },
    });
    try {
      const { findByText, queryByText, unmount } = render(<VoiceCatalogSection personId="person-1" />);
      await findByText("Browse the full community voice catalog (2,000+ voices)");
      await waitForGone(() => queryByText("Microphone"));
      unmount();
      // The mic-enumerating effect's own unmount cleanup
      // (navigator.mediaDevices.removeEventListener) runs as a passive
      // effect, a tick after unmount() returns - wait for it before
      // restoring navigator.mediaDevices below.
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: originalMediaDevices });
      expect(catalog).not.toHaveBeenCalled();
    }
  });

  test("two microphones list both, and choosing the second writes the device preference (moved from the composer chevron, VOICE-LIVE-03b)", async () => {
    stubApi();
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
      localStorage.removeItem("maipai.chat.mic-device-id");
    }
  });
});
