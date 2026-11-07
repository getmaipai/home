import { i18n } from "@lingui/core";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Select } from "@maipai/ui/src/primitives/Select";
import type { DataTableColumn, DataTableSort } from "@maipai/ui/src/elements/data-table";

const PAGE_SIZE_OPTIONS = [5, 10, 20, 50] as const;

function csvValue(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/** Home-owned search, sorting, CSV and pagination for a kit DataTable. */
export function useDataTableControls<Row extends Record<string, unknown>>(
  sourceRows: readonly Row[],
  columns: readonly DataTableColumn<Row>[],
  emptyMessage = i18n._({ id: "No data available.", message: "No data available." }),
  searchColumnIds?: readonly string[],
) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState<number>(5);

  const tableColumns = useMemo(
    () => columns.map((column) => ({ ...column, sortable: true })),
    [columns],
  );
  const filteredRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return [...sourceRows];
    return sourceRows.filter((row) =>
      columns.filter((column) => !searchColumnIds || searchColumnIds.includes(column.id)).some((column) =>
        String(row[column.id] ?? "").toLocaleLowerCase().includes(query),
      ),
    );
  }, [columns, search, searchColumnIds, sourceRows]);
  const sortedRows = useMemo(() => {
    if (!sort) return filteredRows;
    return [...filteredRows].sort((left, right) => {
      const a = left[sort.columnId];
      const b = right[sort.columnId];
      const comparison = typeof a === "number" && typeof b === "number"
        ? a - b
        : String(a ?? "").localeCompare(String(b ?? ""), undefined, {
            numeric: true,
            sensitivity: "base",
          });
      return sort.direction === "asc" ? comparison : -comparison;
    });
  }, [filteredRows, sort]);
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(pageIndex, pageCount - 1);
  const rows = sortedRows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const pageSizes = PAGE_SIZE_OPTIONS.filter((size) => size <= sourceRows.length);

  function changeSearch(value: string) {
    setSearch(value);
    setPageIndex(0);
  }

  function changeSort(value: DataTableSort | null) {
    setSort(value);
    setPageIndex(0);
  }

  function downloadCsv() {
    if (!sourceRows.length) return;
    const csv = [
      columns.map((column) => csvValue(column.header)).join(","),
      ...sourceRows.map((row) => columns.map((column) => csvValue(row[column.id])).join(",")),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "table-data.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const emptyLabel: ReactNode = sourceRows.length === 0
    ? emptyMessage
    : filteredRows.length === 0
      ? i18n._({ id: "No results found.", message: "No results found." })
      : undefined;
  const toolbar = sourceRows.length === 0 ? undefined : (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Input
          type="search"
          aria-label={i18n._({ id: "Search table rows", message: "Search table rows" })}
          value={search}
          onChange={(event) => changeSearch(event.target.value)}
          placeholder={i18n._({ id: "Search rows…", message: "Search rows…" })}
        />
        <Button
          type="button"
          variant="outline"
          aria-label={i18n._({ id: "Download table as CSV", message: "Download table as CSV" })}
          onClick={downloadCsv}
        >
          {i18n._({ id: "Download CSV", message: "Download CSV" })}
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={currentPage === 0}
            onClick={() => setPageIndex((page) => Math.max(0, page - 1))}
          >
            {i18n._({ id: "Previous", message: "Previous" })}
          </Button>
          <Button
            type="button"
            disabled={currentPage + 1 >= pageCount}
            onClick={() => setPageIndex((page) => Math.min(pageCount - 1, page + 1))}
          >
            {i18n._({ id: "Next", message: "Next" })}
          </Button>
        </div>
        <p aria-live="polite">{i18n._({ id: "Page {value} of {pageCount}", message: "Page {value} of {pageCount}", values: { value: currentPage + 1, pageCount } })}</p>
        <Select
          aria-label={i18n._({ id: "Rows per page", message: "Rows per page" })}
          value={String(pageSize)}
          options={(pageSizes.length ? pageSizes : [5]).map(String)}
          onValueChange={(value) => {
            setPageSize(Number(value));
            setPageIndex(0);
          }}
        />
      </div>
    </div>
  );

  return { columns: tableColumns, rows, sort, onSortChange: changeSort, toolbar, emptyLabel, search, onSearchChange: changeSearch };
}
