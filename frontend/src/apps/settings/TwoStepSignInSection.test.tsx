import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { api, type Roster } from "@/lib/api";
import { TwoStepSignInSection } from "@/apps/settings/TwoStepSignInSection";

afterEach(cleanup);
const person = { id: "p1", display_name: "Sage", role: "owner" } as Roster;
describe("TwoStepSignInSection", () => {
  test("walks Off -> Setting up -> On -> Off", async () => {
    const originals = { status: api.totpStatus, enroll: api.totpEnroll, verify: api.totpVerify, disable: api.totpDisable };
    api.totpStatus = mock(async () => ({ enabled: false }));
    api.totpEnroll = mock(async () => ({ uri: "otpauth://totp/MaiPai%20Home:Sage?secret=ABC" }));
    api.totpVerify = mock(async () => ({ success: true as const }));
    api.totpDisable = mock(async () => ({ success: true as const }));
    try {
      const ui = render(<TwoStepSignInSection person={person} />);
      fireEvent.click(await ui.findByRole("button", { name: "Turn on" }));
      expect(await ui.findByRole("img", { name: "Authenticator setup QR code" })).toBeTruthy();
      fireEvent.change(ui.getByLabelText("6-digit code"), { target: { value: "123456" } });
      fireEvent.click(ui.getByRole("button", { name: "Confirm" }));
      expect(await ui.findByText("Two-step sign-in is on.")).toBeTruthy();
      fireEvent.change(ui.getByLabelText("Enter a code to turn it off"), { target: { value: "234567" } });
      fireEvent.click(ui.getByRole("button", { name: "Turn off" }));
      await waitFor(() => expect(ui.getByRole("button", { name: "Turn on" })).toBeTruthy());
    } finally { api.totpStatus = originals.status; api.totpEnroll = originals.enroll; api.totpVerify = originals.verify; api.totpDisable = originals.disable; }
  });
});
