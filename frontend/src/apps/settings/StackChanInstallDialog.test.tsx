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
});
