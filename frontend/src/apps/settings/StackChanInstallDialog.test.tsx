import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { StackChanInstallDialog } from "./StackChanInstallDialog";

const originalSerial = (navigator as Navigator & { serial?: unknown }).serial;
const hadSerial = "serial" in navigator;
const originalSecure = window.isSecureContext;
afterEach(() => {
  cleanup();
  if (hadSerial) Object.defineProperty(navigator, "serial", { configurable: true, value: originalSerial });
  else Reflect.deleteProperty(navigator, "serial");
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: originalSecure });
});

describe("StackChan install browser check", () => {
  test("shows the browser requirement when Web Serial is missing", async () => {
    Reflect.deleteProperty(navigator, "serial");
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    const view = render(<StackChanInstallDialog />);
    fireEvent.click(view.getByRole("button", { name: "Add a StackChan" }));
    await waitFor(() => expect(view.getByText("Installing needs Chrome or Edge on a computer, with Home opened at its https address. Open Home there and try again.")).toBeTruthy());
  });

  test("shows the browser requirement on an insecure page", async () => {
    Object.defineProperty(navigator, "serial", { configurable: true, value: {} });
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    const view = render(<StackChanInstallDialog />);
    fireEvent.click(view.getByRole("button", { name: "Add a StackChan" }));
    await waitFor(() => expect(view.getByText("Installing needs Chrome or Edge on a computer, with Home opened at its https address. Open Home there and try again.")).toBeTruthy());
  });
  test("offers install with and without a backup, showing how long each takes, before asking for a USB port", async () => {
    let asked = 0;
    Object.defineProperty(navigator, "serial", { configurable: true, value: { requestPort: () => { asked++; return new Promise(() => {}); } } });
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    const view = render(<StackChanInstallDialog />);
    fireEvent.click(view.getByRole("button", { name: "Add a StackChan" }));
    await waitFor(() => expect(view.getByText(/About 6 minutes longer/)).toBeTruthy());
    expect(view.getByText(/about 1 to 2 minutes/)).toBeTruthy();
    expect(view.getByText(/Chrome or Edge on a computer/)).toBeTruthy();
    expect(view.getByText(/USB JTAG\/serial debug unit/)).toBeTruthy();
    expect(asked).toBe(0);
    fireEvent.click(view.getByRole("button", { name: "Install without a backup" }));
    await waitFor(() => expect(asked).toBe(1));
  });

  test("the browser requirement hides the install choices", async () => {
    Reflect.deleteProperty(navigator, "serial");
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    const view = render(<StackChanInstallDialog />);
    fireEvent.click(view.getByRole("button", { name: "Add a StackChan" }));
    await waitFor(() => expect(view.getByText(/Installing needs Chrome or Edge/)).toBeTruthy());
    expect(view.queryByRole("button", { name: "Install without a backup" })).toBeNull();
  });

  test("the dialog caps its height at the screen and scrolls, so its buttons are always reachable", async () => {
    Object.defineProperty(navigator, "serial", { configurable: true, value: { requestPort: () => new Promise(() => {}) } });
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    const view = render(<StackChanInstallDialog />);
    fireEvent.click(view.getByRole("button", { name: "Add a StackChan" }));
    await waitFor(() => expect(view.getByRole("dialog")).toBeTruthy());
    expect(view.getByRole("dialog").className).toContain("overflow-y-auto");
  });

  test("an update offers one Update firmware choice, says the robot keeps its Wi-Fi, and asks for the USB port only after it", async () => {
    let asked = 0;
    Object.defineProperty(navigator, "serial", { configurable: true, value: { requestPort: () => { asked++; return new Promise(() => {}); } } });
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    const view = render(<StackChanInstallDialog updateOf="device-known" />);
    fireEvent.click(view.getByRole("button", { name: "Update firmware" }));
    await waitFor(() => expect(view.getByText(/keeps its name, Wi-Fi and pairing/)).toBeTruthy());
    expect(view.queryByRole("button", { name: "Install without a backup" })).toBeNull();
    expect(view.queryByRole("button", { name: "Back up first, then install" })).toBeNull();
    expect(asked).toBe(0);
    const buttons = view.getAllByRole("button", { name: "Update firmware" });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(asked).toBe(1));
  });

  test("records firmware only after a successful flash", async () => {
    Object.defineProperty(navigator, "serial", { configurable: true, value: { requestPort: async () => ({}) } });
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    const recorded: string[] = [];
    const view = render(<StackChanInstallDialog updateOf="device-known" install={async () => ({ deviceId: "device-known" })} recordInstalled={async (id) => { recorded.push(id); }} />);
    fireEvent.click(view.getByRole("button", { name: "Update firmware" }));
    const buttons = view.getAllByRole("button", { name: "Update firmware" });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(recorded).toEqual(["device-known"]));
  });

  test("does not record firmware when flashing fails", async () => {
    Object.defineProperty(navigator, "serial", { configurable: true, value: { requestPort: async () => ({}) } });
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    const recorded: string[] = [];
    const view = render(<StackChanInstallDialog updateOf="device-known" install={async () => { throw new Error("flash failed"); }} recordInstalled={async (id) => { recorded.push(id); }} />);
    fireEvent.click(view.getByRole("button", { name: "Update firmware" }));
    const buttons = view.getAllByRole("button", { name: "Update firmware" });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(view.getByText(/flash failed/)).toBeTruthy());
    expect(recorded).toEqual([]);
  });
});
