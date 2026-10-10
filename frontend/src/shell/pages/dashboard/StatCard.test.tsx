import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getIcon } from "@maipai/ui/src/icons";
import { NumberTicker } from "@maipai/ui/src/elements/number-ticker";
import { StatBody, StatLink, StatText } from "@/shell/pages/dashboard/StatCard";

afterEach(cleanup);

const UsersIcon = getIcon("users");

describe("StatBody", () => {
  test("renders numeric values with the shipped NumberTicker and one visible label", () => {
    const view = render(
      <MemoryRouter>
        <StatBody icon={UsersIcon}><NumberTicker value={1234} label="People" /></StatBody>
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
        <StatBody icon={UsersIcon}><StatText label="Updates" value="Up to date" /></StatBody>
      </MemoryRouter>,
    );

    expect(view.container.querySelector('[data-slot="number-ticker"]')).toBeNull();
    expect(within(view.container).getByText("Updates")).toBeTruthy();
    expect(within(view.container).getByText("Up to date")).toBeTruthy();
  });

  test("preserves the tile's title and destination link", () => {
    const view = render(
      <MemoryRouter>
        <StatLink to="/people"><StatBody icon={UsersIcon}><NumberTicker value={1234} label="People" /></StatBody></StatLink>
      </MemoryRouter>,
    );

    const link = within(view.container).getByRole("link", { name: /People/ });
    expect(link.getAttribute("href")).toBe("/people");
    expect(link.textContent).toContain("People");
  });
});
