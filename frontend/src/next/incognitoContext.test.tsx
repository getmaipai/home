import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { IncognitoToggle } from "@maipai/ui/src/dashboard/layouts/full/vertical/header/Header";
import { IncognitoProvider, useIncognitoContext } from "@/next/incognitoContext";

const EXPLANATION_SEEN_KEY = "maipai.incognito-explanation-seen";

function TestToggle() {
  const { on, setOn } = useIncognitoContext();
  return <IncognitoToggle on={on} onChange={setOn} />;
}

afterEach(() => {
  cleanup();
  localStorage.removeItem(EXPLANATION_SEEN_KEY);
  sessionStorage.removeItem("maipai.incognito");
  document.documentElement.classList.remove("incognito");
});

describe("IncognitoProvider", () => {
  test("explains Incognito on first activation, then keeps the explanation dismissed across renders", async () => {
    const first = render(
      <IncognitoProvider>
        <TestToggle />
      </IncognitoProvider>,
    );

    fireEvent.click(first.getByRole("button", { name: "Incognito Off" }));
    expect(await first.findByRole("dialog", { name: "What Incognito does" })).toBeVisible();
    expect(first.getByText(/not saved to memory/i)).toBeVisible();
    await waitFor(() => expect(document.documentElement.classList.contains("incognito")).toBe(true));

    fireEvent.click(first.getByRole("button", { name: "Got it" }));
    await waitFor(() => expect(first.queryByRole("dialog")).toBeNull());
    expect(localStorage.getItem(EXPLANATION_SEEN_KEY)).toBe("true");

    first.unmount();
    sessionStorage.removeItem("maipai.incognito");
    const second = render(
      <IncognitoProvider>
        <TestToggle />
      </IncognitoProvider>,
    );
    fireEvent.click(second.getByRole("button", { name: "Incognito Off" }));
    expect(second.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(second.getByRole("button", { name: "Incognito On" })).toHaveAttribute("aria-pressed", "true"));
  });
});
