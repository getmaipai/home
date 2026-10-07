import { useId, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getIcon } from "@maipai/ui/src/icons";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Input } from "@maipai/ui/src/dashboard/components/ui/input";
import { Label } from "@maipai/ui/src/dashboard/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/dashboard/components/ui/select";
import type { DataTableColumn, DataTableSort } from "@maipai/ui/src/elements/data-table";

const Download = getIcon("download");

function titleFor(key: string): string {
  return key.replace(/([A-Z])/g, " $1").trim().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left ?? "").localeCompare(String(right ?? ""), undefined, { numeric: true, sensitivity: "base" });
}

function csvValue(value: unknown): string {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

/** Page-owned table behavior and toolbar content for the shipped DataTable slot. */
export function useDataTableModel<Row extends Record<string, unknown>>(
  data: readonly Row[],
  columns: readonly DataTableColumn<Row>[],
  emptyMessage = "No data available.",
) {
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(5);
  const pageSizeId = useId();
  const filteredRows = useMemo(() => {
    const query = filter.trim().toLocaleLowerCase();
    if (!query) return data;
    return data.filter((row) => columns.some((column) =>
      String(column.cell ? row[column.id] ?? "" : row[column.id] ?? "").toLocaleLowerCase().includes(query),
    ));
  }, [columns, data, filter]);
  const sortedRows = useMemo(() => {
    if (!sort) return filteredRows;
    const column = columns.find((item) => item.id === sort.columnId);
    if (!column) return filteredRows;
    return [...filteredRows].sort((left, right) => {
      const result = compareValues(left[column.id], right[column.id]);
      return sort.direction === "asc" ? result : -result;
    });
  }, [columns, filteredRows, sort]);
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(pageIndex, pageCount - 1);
  const rows = sortedRows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const pageSizes = [5, 10, 20, 50].filter((size) => size <= data.length);
  const availablePageSizes = pageSizes.length > 0 ? pageSizes : [5];
  const emptyLabel: ReactNode = data.length === 0 ? emptyMessage : "No results found.";

  const downloadCsv = () => {
    if (data.length === 0) return;
    const csv = [
      columns.map((column) => csvValue(typeof column.header === "string" ? column.header : titleFor(column.id))).join(","),
      ...data.map((row) => columns.map((column) => csvValue(row[column.id])).join(",")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "table-data.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const toolbar = (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          type="search"
          aria-label="Search table rows"
          value={filter}
          onChange={(event) => { setFilter(event.target.value); setPageIndex(0); }}
          placeholder="Search rows…"
        />
        <Button type="button" variant="outline" aria-label="Download table as CSV" onClick={downloadCsv}>
          <Download aria-hidden="true" className="size-4" />
          <span>Download CSV</span>
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <Button type="button" variant="secondary" disabled={currentPage === 0} onClick={() => setPageIndex((page) => Math.max(0, page - 1))}>Previous</Button>
          <Button type="button" disabled={currentPage + 1 >= pageCount} onClick={() => setPageIndex((page) => Math.min(pageCount - 1, page + 1))}>Next</Button>
        </div>
        <p className="text-sm text-muted-foreground" aria-live="polite">Page {currentPage + 1} of {pageCount}</p>
        <div className="flex items-center gap-2">
          <Label htmlFor={pageSizeId}>Rows per page:</Label>
          <Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setPageIndex(0); }}>
            <SelectTrigger id={pageSizeId}><SelectValue /></SelectTrigger>
            <SelectContent>
              {availablePageSizes.map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );

  return {
    columns,
    rows,
    sort,
    onSortChange: (nextSort: DataTableSort | null) => { setSort(nextSort); setPageIndex(0); },
    toolbar,
    emptyLabel,
  };
}

export function tableColumns<Row>(keys: readonly (keyof Row & string)[]): DataTableColumn<Row>[] {
  return keys.map((id) => ({ id, header: titleFor(id), sortable: true }));
}
