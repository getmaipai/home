import { describe, expect, test, mock, afterEach } from "bun:test";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { List } from "@/kit/primitives/List";

afterEach(cleanup);

interface Person {
  id: string;
  name: string;
}

const people: Person[] = [
  { id: "p1", name: "Marlow" },
  { id: "p2", name: "Nadia" },
  { id: "p3", name: "Quill" },
];

describe("List", () => {
  test("renders one row per item, in order", () => {
    const { getByLabelText } = render(
      <List items={people} getKey={(p) => p.id} renderItem={(p) => <span>{p.name}</span>} label="People" />,
    );
    const rows = getByLabelText("People").querySelectorAll("li");
    expect(Array.from(rows).map((r) => r.textContent)).toEqual(["Marlow", "Nadia", "Quill"]);
  });

  test("rows are not buttons unless something happens when you press them", () => {
    const { queryAllByRole } = render(
      <List items={people} getKey={(p) => p.id} renderItem={(p) => <span>{p.name}</span>} label="People" />,
    );
    expect(queryAllByRole("button")).toHaveLength(0);
  });

  test("selecting a row reports its item", () => {
    const onSelect = mock((_p: Person) => {});
    const { getByRole } = render(
      <List items={people} getKey={(p) => p.id} renderItem={(p) => <span>{p.name}</span>} onSelect={onSelect} />,
    );
    fireEvent.click(getByRole("button", { name: "Nadia" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toEqual({ id: "p2", name: "Nadia" });
  });

  // A control nested inside a row button is unreachable by keyboard and
  // is invalid HTML, so the trailing action has to be the button's
  // sibling. This test is what stops that regressing.
  test("a trailing action is its own control, not nested inside the row button", () => {
    const onSelect = mock((_p: Person) => {});
    const onRemove = mock(() => {});
    const { getAllByRole } = render(
      <List
        items={people}
        getKey={(p) => p.id}
        renderItem={(p) => <span>{p.name}</span>}
        onSelect={onSelect}
        renderAction={() => (
          <button type="button" onClick={onRemove}>
            Remove
          </button>
        )}
      />,
    );
    const removes = getAllByRole("button", { name: "Remove" });
    expect(removes).toHaveLength(people.length);
    const remove = removes[0]!;
    // `closest` starts at the element itself, so asking a button for its
    // closest button always answers itself - the real assertion is that
    // no button ENCLOSES it (code review, 2026-09-05).
    expect(remove.parentElement?.closest("button")).toBeNull();
    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  test("the selected row is marked for assistive tech, not just colored", () => {
    const { getByRole } = render(
      <List
        items={people}
        getKey={(p) => p.id}
        renderItem={(p) => <span>{p.name}</span>}
        onSelect={() => {}}
        isSelected={(p) => p.id === "p3"}
      />,
    );
    expect(getByRole("button", { name: "Quill" })).toHaveAttribute("aria-current", "true");
    expect(getByRole("button", { name: "Marlow" })).not.toHaveAttribute("aria-current");
  });

  test("getLabel names a row whose content has no readable text", () => {
    const { getByRole } = render(
      <List
        items={people}
        getKey={(p) => p.id}
        renderItem={() => <img src="/avatar.png" alt="" />}
        getLabel={(p) => p.name}
        onSelect={() => {}}
      />,
    );
    expect(getByRole("button", { name: "Marlow" })).toBeInTheDocument();
  });

  test("every row clears the kit's 48px touch-target floor", () => {
    const { getByLabelText } = render(
      <List items={people} getKey={(p) => p.id} renderItem={(p) => <span>{p.name}</span>} label="People" />,
    );
    for (const row of getByLabelText("People").querySelectorAll("li > div")) {
      expect(row.className).toContain("min-h-12");
    }
  });

  test("shows the empty state instead of an empty list", () => {
    const { getByText, queryByLabelText } = render(
      <List
        items={[]}
        getKey={(p: Person) => p.id}
        renderItem={(p: Person) => <span>{p.name}</span>}
        label="People"
        emptyState={{ icon: "users", text: "No one here yet" }}
      />,
    );
    expect(getByText("No one here yet")).toBeInTheDocument();
    expect(queryByLabelText("People")).toBeNull();
  });

  test("dividers can be turned off", () => {
    const { getByLabelText, rerender } = render(
      <List items={people} getKey={(p) => p.id} renderItem={(p) => <span>{p.name}</span>} label="People" />,
    );
    expect(getByLabelText("People").className).toContain("divide-y");

    rerender(
      <List
        items={people}
        getKey={(p) => p.id}
        renderItem={(p) => <span>{p.name}</span>}
        label="People"
        dividers={false}
      />,
    );
    expect(getByLabelText("People").className).not.toContain("divide-y");
  });
});
