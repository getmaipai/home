import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError, api, type Roster } from "@/lib/api";
import { SignInSecretSection } from "@/apps/settings/SignInSecretSection";

afterEach(cleanup);
const person = (overrides: Partial<Roster> = {}) => ({ id: "person-1", display_name: "Sage", role: "owner", hasSecret: true, pinDigits: 6, ...overrides } as Roster);
function view(who = person()) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><SignInSecretSection person={who} onPersonChange={() => {}} /></QueryClientProvider>);
}

describe("SignInSecretSection", () => {
  test("shows status for PIN, password, and no-secret people", () => {
    const pinView = view();
    expect(pinView.getByText("You sign in with a 6-digit PIN.")).toBeTruthy();
    cleanup();
    const passView = view(person({ pinDigits: null }));
    expect(passView.getByText("You sign in with a password.")).toBeTruthy();
    cleanup();
    expect(view(person({ hasSecret: false, pinDigits: null })).getByText("You have no PIN or password yet.")).toBeTruthy();
  });

  test("mismatch disables Save and success sends the right values", async () => {
    const original = api.changeSecret;
    const changed = mock(async () => ({ success: true as const }));
    api.changeSecret = changed;
    try {
      const ui = view();
      fireEvent.change(ui.getByLabelText("Current PIN or password"), { target: { value: "123456" } });
      fireEvent.change(ui.getByLabelText("New PIN"), { target: { value: "654321" } });
      fireEvent.change(ui.getByLabelText("Type it again"), { target: { value: "654320" } });
      const save = ui.getByRole("button", { name: "Change PIN" }) as HTMLButtonElement;
      expect(save.disabled).toBe(true);
      fireEvent.change(ui.getByLabelText("Type it again"), { target: { value: "654321" } });
      fireEvent.click(save);
      await waitFor(() => expect(changed).toHaveBeenCalledWith("123456", "654321"));
      expect(await ui.findByText("Your PIN is changed.")).toBeTruthy();
    } finally { api.changeSecret = original; }
  });

  test("wrong current secret shows the plain error", async () => {
    const original = api.changeSecret;
    api.changeSecret = mock(async () => { throw new ApiError("bad", 401); });
    try {
      const ui = view();
      fireEvent.change(ui.getByLabelText("Current PIN or password"), { target: { value: "123456" } });
      fireEvent.change(ui.getByLabelText("New PIN"), { target: { value: "654321" } });
      fireEvent.change(ui.getByLabelText("Type it again"), { target: { value: "654321" } });
      fireEvent.click(ui.getByRole("button", { name: "Change PIN" }));
      expect(await ui.findByRole("alert")).toHaveTextContent("Your current PIN or password is not right. Try again.");
    } finally { api.changeSecret = original; }
  });
});
