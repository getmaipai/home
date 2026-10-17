import { describe, expect, test, mock, afterEach } from "bun:test";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MicrophoneSection } from "@/apps/settings/MicrophoneSection";
import { readMicDevicePreference } from "@/lib/voice/micDevicePreference";
import { waitForGone } from "../../../tests/waitForGone";

afterEach(() => { cleanup(); mock.restore(); });

function withDevices(devices: MediaDeviceInfo[]) {
  const original = navigator.mediaDevices;
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { enumerateDevices: () => Promise.resolve(devices), addEventListener: () => {}, removeEventListener: () => {} } });
  return () => Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: original });
}
const mic = (deviceId: string, label: string) => ({ deviceId, kind: "audioinput", label }) as MediaDeviceInfo;

describe("MicrophoneSection", () => {
  test("two microphones list both", async () => {
    const restore = withDevices([mic("mic-1", "Built-in Microphone"), mic("mic-2", "USB Headset")]);
    try {
      const { findByText, unmount } = render(<MicrophoneSection />);
      await findByText("Microphone"); await findByText("Built-in Microphone"); await findByText("USB Headset");
      unmount(); await new Promise((r) => setTimeout(r, 0));
    } finally { restore(); }
  });

  test("the microphone group is absent with fewer than two devices (RESP-04 f)", async () => {
    const restore = withDevices([mic("mic-1", "Built-in Microphone")]);
    try {
      const { queryByText, unmount } = render(<MicrophoneSection />);
      await waitForGone(() => queryByText("Microphone"));
      unmount(); await new Promise((r) => setTimeout(r, 0));
    } finally { restore(); }
  });

  test("choosing the second microphone writes the device preference", async () => {
    const restore = withDevices([mic("mic-1", "Built-in Microphone"), mic("mic-2", "USB Headset")]);
    try {
      const { findByText, unmount } = render(<MicrophoneSection />);
      const usbRow = (await findByText("USB Headset")).closest("li")!;
      fireEvent.click(usbRow.querySelector("button")!);
      await waitFor(() => expect(readMicDevicePreference()).toBe("mic-2"));
      unmount(); await new Promise((r) => setTimeout(r, 0));
    } finally { restore(); localStorage.removeItem("maipai.chat.mic-device-id"); }
  });
});
