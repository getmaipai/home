import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getIcon } from "@maipai/ui/src/icons";
import { StatCard } from "@/next/pages/dashboard/StatCard";

afterEach(cleanup);

const UsersIcon = getIcon("users");

describe("StatCard", () => {
  test("renders numeric values with the shipped NumberTicker and one visible label", () => {
    const view = render(
      <MemoryRouter>
        <StatCard label="People" value={1234} icon={UsersIcon} />
      </MemoryRouter>,
    );

    const ticker = view.container.querySelector('[data-slot="number-ticker"]');
    expect(ticker).not.toBeNull();
    expect(within(ticker as HTMLElement).getByLabelText("1,234")).toBeTruthy();
    expect(ticker?.textContent).toContain("People");
    expect(within(view.container).getAllByText("People")).toHaveLength(1);
    expect(ticker?.querySelector(".motion-reduce\\:transition-none")).not.toBeNull();
  });

  test("keeps non-numeric value text unchanged", () => {
    const view = render(
      <MemoryRouter>
        <StatCard label="Updates" value="Up to date" icon={UsersIcon} />
      </MemoryRouter>,
    );

    expect(view.container.querySelector('[data-slot="number-ticker"]')).toBeNull();
    expect(within(view.container).getByText("Updates")).toBeTruthy();
    expect(within(view.container).getByText("Up to date")).toBeTruthy();
  });

  test("preserves the card's title and destination link", () => {
    const view = render(
      <MemoryRouter>
        <StatCard label="People" value={1234} icon={UsersIcon} to="/people" />
      </MemoryRouter>,
    );

    const link = within(view.container).getByRole("link", { name: /People/ });
    expect(link.getAttribute("href")).toBe("/people");
    expect(link.textContent).toContain("People");
  });
});
