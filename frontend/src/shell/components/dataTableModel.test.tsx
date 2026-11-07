import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { DataTable } from "@maipai/ui/src/elements/data-table";
import { tableColumns, useDataTableModel } from "@/shell/components/dataTableModel";

afterEach(() => { cleanup(); });

type Row = { name: string; size: number };
const rows: Row[] = Array.from({ length: 12 }, (_, index) => ({ name: `Row ${index}`, size: index }));
const columns = tableColumns<Row>(["name", "size"]);

function Probe() {
  const model = useDataTableModel(rows, columns);
  return <DataTable {...model.tableProps} caption="Rows" getRowId={(row) => row.name} />;
}

describe("useDataTableModel (AUDIT-UI-01)", () => {
  test("tableProps holds only what the DataTable takes, so the paging helpers never reach the DOM", () => {
    let seen: ReturnType<typeof useDataTableModel<Row>> | undefined;
    function Capture() { seen = useDataTableModel(rows, columns); return null; }
    render(<Capture />);
    expect(Object.keys(seen!.tableProps).sort()).toEqual(["columns", "emptyLabel", "onSortChange", "rows", "sort"]);
  });

  test("a DataTable drawn from tableProps raises no unknown-prop warning", () => {
    const errors = spyOn(console, "error").mockImplementation(() => {});
    render(<Probe />);
    const unknown = errors.mock.calls.filter(([message]) => String(message).includes("does not recognize"));
    errors.mockRestore();
    expect(unknown).toHaveLength(0);
  });
});
