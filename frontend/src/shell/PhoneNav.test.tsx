import { describe, expect, test, afterEach } from "bun:test";
import { render, cleanup } from "@testing-library/react";
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

describe("PhoneNav", () => {
  test("renders one link per registered nav entry, data-driven", () => {
    const { getByRole } = renderAt("/");
    for (const entry of NAV_ENTRIES) {
      expect(getByRole("link", { name: entry.label })).toBeTruthy();
    }
  });

  test("only shows the current page, plus five entries, never more", () => {
    const { getAllByRole } = renderAt("/");
    expect(getAllByRole("link")).toHaveLength(NAV_ENTRIES.length);
  });

  test("marks the active entry for the current route", () => {
    const { getByRole } = renderAt("/people");
    expect(getByRole("link", { name: "People" })).toHaveAttribute("aria-current", "page");
    expect(getByRole("link", { name: "Chat" })).not.toHaveAttribute("aria-current");
  });

  test("the root route is only active at exactly /", () => {
    const { getByRole } = renderAt("/settings");
    expect(getByRole("link", { name: "Chat" })).not.toHaveAttribute("aria-current");
    expect(getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
  });

  test("stays hidden on tablet and desktop, via the kit's own breakpoint", () => {
    const { getByRole } = renderAt("/");
    expect(getByRole("navigation").className).toContain("sm:hidden");
  });
});
