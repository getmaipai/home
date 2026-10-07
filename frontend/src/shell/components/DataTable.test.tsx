import { afterEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { DataTable } from "./DataTable";

afterEach(cleanup);

describe("DataTable", () => {
  test("renders only the supplied columns, with no demo title or action controls", () => {
    const view = render(<DataTable data={[{ name: "Nova", role: "Child" }]} />);
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
    const view = render(<DataTable data={[{ name: "Zed", role: "Teen" }, { name: "Ada", role: "Adult" }]} />);
    fireEvent.click(view.getByRole("button", { name: /Name/ }));
    const rows = () => within(view.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows()[0]?.textContent).toContain("Ada");

    fireEvent.change(view.getByRole("searchbox", { name: "Search table rows" }), { target: { value: "teen" } });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.textContent).toContain("Zed");
  });

  test("pagination keeps a five-row page and offers the next page", () => {
    const data = Array.from({ length: 6 }, (_, index) => ({ name: `Person ${index + 1}`, role: "Adult" }));
    const view = render(<DataTable data={data} />);
    expect(view.getByText("Page 1 of 2")).toBeTruthy();
    expect(view.getByText("Person 1")).toBeTruthy();
    expect(view.queryByText("Person 6")).toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Next" }));
    expect(view.getByText("Page 2 of 2")).toBeTruthy();
    expect(view.getByText("Person 6")).toBeTruthy();
    expect(view.queryByText("Person 1")).toBeNull();
  });

  test("renders a caller-specific empty message", () => {
    const view = render(<DataTable data={[]} emptyMessage="No people available." />);
    expect(view.getByText("No people available.")).toBeTruthy();
    expect(view.queryByRole("table")).toBeNull();
  });

  test("row actions add an Actions header and run non-destructive actions from the menu", async () => {
    const onClick = mock(() => {});
    const view = render(<DataTable data={[{ name: "Nova" }]} rowActions={() => [{ label: "Open", onClick }]} />);
    expect(view.getByRole("columnheader", { name: "Actions" })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "More actions" }));
    fireEvent.click(await within(document.body).findByRole("menuitem", { name: "Open" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("destructive row actions wait for confirmation", async () => {
    const onClick = mock(() => {});
    const view = render(<DataTable data={[{ name: "Nova" }]} rowActions={() => [{ label: "Remove", destructive: true, confirmLabel: "Remove Nova?", onClick }]} />);
    fireEvent.click(view.getByRole("button", { name: "More actions" }));
    fireEvent.click(await within(document.body).findByRole("menuitem", { name: "Remove" }));
    expect(view.getByText("Remove Nova?")).toBeTruthy();
    expect(onClick).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(onClick).toHaveBeenCalledTimes(1));
  });

  test("destructive confirmation is a dialog outside the menu and Cancel clears it", async () => {
    const onClick = mock(() => {});
    const view = render(<DataTable data={[{ id: "nova", name: "Nova" }]} rowKey={(row) => String(row.id)} rowActions={() => [{ label: "Remove", destructive: true, onClick }]} />);
    fireEvent.click(view.getByRole("button", { name: "More actions" }));
    fireEvent.click(await within(document.body).findByRole("menuitem", { name: "Remove" }));

    const dialog = await within(document.body).findByRole("alertdialog");
    expect(dialog.closest('[role="menu"]')).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Confirm" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    fireEvent.click(view.getByRole("button", { name: "More actions" }));
    expect(await within(document.body).findByRole("menuitem", { name: "Remove" })).toBeTruthy();
    expect(view.queryByRole("alertdialog")).toBeNull();
    expect(onClick).not.toHaveBeenCalled();
  });

  test("a stable rowKey keeps the pending action through replacement row objects", async () => {
    const onClick = mock(() => {});
    const rowActions = () => [{ label: "Remove", destructive: true, onClick }];
    const view = render(<DataTable data={[{ id: "nova", name: "Nova" }]} rowKey={(row) => String(row.id)} rowActions={rowActions} />);
    fireEvent.click(view.getByRole("button", { name: "More actions" }));
    fireEvent.click(await within(document.body).findByRole("menuitem", { name: "Remove" }));
    expect(await within(document.body).findByRole("alertdialog")).toBeTruthy();

    view.rerender(<DataTable data={[{ id: "nova", name: "Nova" }]} rowKey={(row) => String(row.id)} rowActions={rowActions} />);
    expect(view.getByRole("alertdialog")).toBeTruthy();
  });

  test("separates each transition between regular and destructive actions", async () => {
    const actions = [
      { label: "Open", onClick: () => {} },
      { label: "Remove", destructive: true, onClick: () => {} },
      { label: "Archive", destructive: true, onClick: () => {} },
      { label: "Details", onClick: () => {} },
    ];
    const view = render(<DataTable data={[{ name: "Nova" }]} rowActions={() => actions} />);
    fireEvent.click(view.getByRole("button", { name: "More actions" }));
    await within(document.body).findByRole("menuitem", { name: "Details" });
    expect(document.querySelectorAll('[data-slot="dropdown-menu-separator"]')).toHaveLength(2);
  });

  test("row actions omitted means no Actions column or action button", () => {
    const view = render(<DataTable data={[{ name: "Nova" }]} />);
    expect(view.queryByRole("columnheader", { name: "Actions" })).toBeNull();
    expect(view.queryByRole("button", { name: "More actions" })).toBeNull();
  });

  test("an empty row action list keeps the Actions column aligned without an empty menu trigger", () => {
    const view = render(<DataTable data={[{ name: "Home" }, { name: "Engine" }]} rowActions={(row) => row.name === "Engine" ? [{ label: "Apply", onClick: () => {} }] : []} />);
    const rows = within(view.getByRole("table")).getAllByRole("row").slice(1);
    expect(within(rows[0]!).queryByRole("button", { name: "More actions" })).toBeNull();
    expect(rows[0]!.querySelectorAll('[data-slot="table-cell"]')).toHaveLength(2);
    expect(within(rows[1]!).getByRole("button", { name: "More actions" })).toBeTruthy();
  });
});
