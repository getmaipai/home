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
});
