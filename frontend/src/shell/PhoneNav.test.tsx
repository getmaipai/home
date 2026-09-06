import { describe, expect, test, afterEach } from "bun:test";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PhoneNav } from "@/shell/PhoneNav";
import { NAV_ENTRIES } from "@/shell/nav";

afterEach(cleanup);

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PhoneNav />
    </MemoryRouter>,
  );
}

const BOTTOM_BAR_MAX = 5;

describe("PhoneNav", () => {
  // Step 6 added a sixth entry (Home) - the overflow mechanism this file
  // was "built ahead of the day a sixth page registers" (its own header
  // comment) now actually runs, for the first time: the first four
  // entries render as direct links, the rest live behind "More".
  test("renders a direct link for every entry that fits the bottom bar", () => {
    const { getByRole } = renderAt("/");
    for (const entry of NAV_ENTRIES.slice(0, BOTTOM_BAR_MAX - 1)) {
      expect(getByRole("link", { name: entry.label })).toBeTruthy();
    }
  });

  test("the rest of the entries only appear once More is opened", () => {
    const { getByRole, queryByRole } = renderAt("/");
    const overflowEntries = NAV_ENTRIES.slice(BOTTOM_BAR_MAX - 1);
    for (const entry of overflowEntries) {
      expect(queryByRole("link", { name: entry.label })).toBeNull();
    }
    fireEvent.click(getByRole("button", { name: "More" }));
    for (const entry of overflowEntries) {
      expect(getByRole("link", { name: entry.label })).toBeTruthy();
    }
  });

  test("shows exactly five top-level items: four links plus More", () => {
    const { getAllByRole, getByRole } = renderAt("/");
    expect(getAllByRole("link")).toHaveLength(BOTTOM_BAR_MAX - 1);
    expect(getByRole("button", { name: "More" })).toBeTruthy();
  });

  test("marks the active entry for the current route", () => {
    const { getByRole } = renderAt("/people");
    expect(getByRole("link", { name: "People" })).toHaveAttribute("aria-current", "page");
    expect(getByRole("link", { name: "Chat" })).not.toHaveAttribute("aria-current");
  });

  test("the root route is only active at exactly /", () => {
    const { getByRole } = renderAt("/chat");
    expect(getByRole("link", { name: "Home" })).not.toHaveAttribute("aria-current");
    expect(getByRole("link", { name: "Chat" })).toHaveAttribute("aria-current", "page");
  });

  test("stays hidden on tablet and desktop, via the kit's own breakpoint", () => {
    const { getByRole } = renderAt("/");
    expect(getByRole("navigation").className).toContain("sm:hidden");
  });
});
