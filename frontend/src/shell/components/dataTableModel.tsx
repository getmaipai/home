import { useId, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { DataTableColumn, DataTableSort } from "@maipai/ui/src/elements/data-table";

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

/** Page-owned row, sort, filter, and paging state for the shipped DataTable. */
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
      String(row[column.id] ?? "").toLocaleLowerCase().includes(query),
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

  return {
    columns,
    rows,
    sort,
    onSortChange: (nextSort: DataTableSort | null) => { setSort(nextSort); setPageIndex(0); },
    emptyLabel,
    filter,
    setFilter,
    currentPage,
    pageCount,
    setPageIndex,
    pageSize,
    setPageSize,
    pageSizeId,
    availablePageSizes,
    downloadCsv,
  };
}

export function tableColumns<Row>(keys: readonly (keyof Row & string)[], widths: Partial<Record<keyof Row & string, number>> = {}): DataTableColumn<Row>[] {
  return keys.map((id) => ({ id, header: titleFor(id), sortable: true, minWidth: widths[id] }));
}
