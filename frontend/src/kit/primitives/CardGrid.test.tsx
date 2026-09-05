import { describe, expect, test, mock, afterEach } from "bun:test";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { CardGrid } from "@/kit/primitives/CardGrid";

afterEach(cleanup);

// Every query comes from render()'s own bound queries, never the global
// `screen` singleton - see the note in kit/settings/SettingField.test.tsx
// for why that singleton is unusable under bun's preload.

interface Thing {
  id: string;
  name: string;
}

const things: Thing[] = [
  { id: "a", name: "Bramble" },
  { id: "b", name: "Clover" },
  { id: "c", name: "Juniper" },
];

function renderGrid(props: Partial<Parameters<typeof CardGrid<Thing>>[0]> = {}) {
  return render(
    <CardGrid
      items={things}
      getKey={(t) => t.id}
      renderItem={(t) => <span>{t.name}</span>}
      label="Things"
      {...props}
    />,
  );
}

describe("CardGrid", () => {
  test("renders one cell per item, in order", () => {
    const { getByLabelText } = renderGrid();
    const cells = getByLabelText("Things").querySelectorAll("li");
    expect(cells).toHaveLength(3);
    expect(Array.from(cells).map((c) => c.textContent)).toEqual(["Bramble", "Clover", "Juniper"]);
  });

  test("cards are not buttons unless something happens when you press them", () => {
    const { queryAllByRole } = renderGrid();
    expect(queryAllByRole("button")).toHaveLength(0);
  });

  test("selecting a card reports the item it was drawn from, not its index", () => {
    const onSelect = mock((_t: Thing) => {});
    const { getByRole } = renderGrid({ onSelect });
    fireEvent.click(getByRole("button", { name: "Clover" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toEqual({ id: "b", name: "Clover" });
  });

  test("getLabel names a card whose content has no readable text", () => {
    const { getByRole } = render(
      <CardGrid
        items={things}
        getKey={(t) => t.id}
        renderItem={() => <img src="/x.png" alt="" />}
        getLabel={(t) => t.name}
        onSelect={() => {}}
      />,
    );
    expect(getByRole("button", { name: "Juniper" })).toBeInTheDocument();
  });

  // A code review (2026-09-05) found Card dropping `label` entirely on
  // its non-interactive branch: a read-only grid of alt="" artwork with
  // getLabel supplied produced cells with no accessible text at all,
  // while the caller believed they were named.
  test("getLabel names a card even when the card is not a button", () => {
    const { getByRole } = render(
      <CardGrid
        items={things}
        getKey={(t) => t.id}
        renderItem={() => <img src="/x.png" alt="" />}
        getLabel={(t) => t.name}
      />,
    );
    expect(getByRole("group", { name: "Bramble" })).toBeInTheDocument();
  });

  test("the selected card is marked for assistive tech, not just colored", () => {
    const { getByRole } = renderGrid({ onSelect: () => {}, isSelected: (t) => t.id === "b" });
    expect(getByRole("button", { name: "Clover" })).toHaveAttribute("aria-current", "true");
    expect(getByRole("button", { name: "Bramble" })).not.toHaveAttribute("aria-current");
  });

  test("shows the empty state instead of an empty grid", () => {
    const { getByText, queryByLabelText } = renderGrid({
      items: [],
      emptyState: { icon: "users", text: "Nothing here yet" },
    });
    expect(getByText("Nothing here yet")).toBeInTheDocument();
    expect(queryByLabelText("Things")).toBeNull();
  });

  test("an empty grid with no empty state still renders nothing broken", () => {
    const { getByLabelText } = renderGrid({ items: [] });
    expect(getByLabelText("Things").querySelectorAll("li")).toHaveLength(0);
  });

  test("the column count comes from the kit's density budget, one per surface", () => {
    const { getByLabelText, rerender } = renderGrid();
    // docs/UI.md: one column on phone, two on tablet, three on desktop.
    expect(getByLabelText("Things").className).toContain("grid-cols-1");
    expect(getByLabelText("Things").className).toContain("sm:grid-cols-2");
    expect(getByLabelText("Things").className).toContain("lg:grid-cols-3");

    rerender(
      <CardGrid
        items={things}
        getKey={(t) => t.id}
        renderItem={(t) => <span>{t.name}</span>}
        label="Things"
        density="compact"
      />,
    );
    // `toContain("grid-cols-2")` would pass for the default density too,
    // whose className holds "sm:grid-cols-2" as a substring - the whole
    // budget has to be asserted or the test passes with `density`
    // ignored entirely (code review, 2026-09-05).
    const compact = getByLabelText("Things").className;
    expect(compact).toContain("grid-cols-2");
    expect(compact).toContain("sm:grid-cols-3");
    expect(compact).toContain("lg:grid-cols-5");
    expect(compact).not.toContain("grid-cols-1");
  });
});
