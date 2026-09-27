import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { NextDataTable } from "./NextDataTable";

afterEach(cleanup);

describe("NextDataTable", () => {
  test("renders only the supplied columns, with no demo title or action controls", () => {
    const view = render(<NextDataTable data={[{ name: "Nova", role: "Child" }]} />);
    const table = view.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent?.trim())).toEqual([
      "Name", "Role",
    ]);
    expect(view.queryByText("Employee Data Table")).toBeNull();
    expect(view.queryByRole("columnheader", { name: /action/i })).toBeNull();
    expect(view.getByRole("searchbox", { name: "Search table rows" })).toBeTruthy();
    expect(view.getByRole("button", { name: "Download table as CSV" })).toBeTruthy();
  });

  test("search filters rows and sortable headers reorder them", () => {
    const view = render(<NextDataTable data={[{ name: "Zed", role: "Teen" }, { name: "Ada", role: "Adult" }]} />);
    fireEvent.click(view.getByRole("button", { name: /Name/ }));
    const rows = () => within(view.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows()[0]?.textContent).toContain("Ada");

    fireEvent.change(view.getByRole("searchbox", { name: "Search table rows" }), { target: { value: "teen" } });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.textContent).toContain("Zed");
  });

  test("pagination keeps a five-row page and offers the next page", () => {
    const data = Array.from({ length: 6 }, (_, index) => ({ name: `Person ${index + 1}`, role: "Adult" }));
    const view = render(<NextDataTable data={data} />);
    expect(view.getByText("Page 1 of 2")).toBeTruthy();
    expect(view.getByText("Person 1")).toBeTruthy();
    expect(view.queryByText("Person 6")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Next" }));
    expect(view.getByText("Page 2 of 2")).toBeTruthy();
    expect(view.getByText("Person 6")).toBeTruthy();
    expect(view.queryByText("Person 1")).toBeNull();
  });

  test("renders a caller-specific empty message", () => {
    const view = render(<NextDataTable data={[]} emptyMessage="No people available." />);
    expect(view.getByText("No people available.")).toBeTruthy();
    expect(view.queryByRole("table")).toBeNull();
  });

  test("row actions add an Actions header and run non-destructive actions from the menu", async () => {
    const onClick = mock(() => {});
    const view = render(<NextDataTable data={[{ name: "Nova" }]} rowActions={() => [{ label: "Open", onClick }]} />);
    expect(view.getByRole("columnheader", { name: "Actions" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "More actions" }));
    fireEvent.click(await within(document.body).findByRole("menuitem", { name: "Open" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("destructive row actions wait for confirmation", async () => {
    const onClick = mock(() => {});
    const view = render(<NextDataTable data={[{ name: "Nova" }]} rowActions={() => [{ label: "Remove", destructive: true, confirmLabel: "Remove Nova?", onClick }]} />);
    fireEvent.click(view.getByRole("button", { name: "More actions" }));
    fireEvent.click(await within(document.body).findByRole("menuitem", { name: "Remove" }));
    expect(view.getByText("Remove Nova?")).toBeTruthy();
    expect(onClick).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(onClick).toHaveBeenCalledTimes(1));
  });

  test("row actions omitted means no Actions column or action button", () => {
    const view = render(<NextDataTable data={[{ name: "Nova" }]} />);
    expect(view.queryByRole("columnheader", { name: "Actions" })).toBeNull();
    expect(view.queryByRole("button", { name: "More actions" })).toBeNull();
  });
});
