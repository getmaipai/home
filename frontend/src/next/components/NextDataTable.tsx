import { useId, useMemo, useState } from "react";
import { getIcon } from "@maipai/ui/src/icons";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Card, CardContent } from "@maipai/ui/src/dashboard/components/ui/card";
import { Input } from "@maipai/ui/src/dashboard/components/ui/input";
import { Label } from "@maipai/ui/src/dashboard/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/dashboard/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@maipai/ui/src/dashboard/components/ui/table";

const ArrowDown = getIcon("arrow-down");
const ArrowUp = getIcon("arrow-up");
const Download = getIcon("download");

function titleFor(key: string): string {
  return key.replace(/([A-Z])/g, " $1").trim().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function csvValue(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/** Home's read-only table for row data that needs no row actions. */
export function NextDataTable<T extends Record<string, unknown>>({
  data,
  emptyMessage = "No data available.",
}: {
  data: readonly T[];
  emptyMessage?: string;
}) {
  const [globalFilter, setGlobalFilter] = useState("");
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" } | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(5);
  const pageSizeId = useId();
  const columns = useMemo(() => data[0] ? Object.keys(data[0]) : [], [data]);
  const filteredData = useMemo(() => {
    const query = globalFilter.trim().toLocaleLowerCase();
    return query
      ? data.filter((row) => columns.some((key) => String(row[key] ?? "").toLocaleLowerCase().includes(query)))
      : data;
  }, [columns, data, globalFilter]);
  const sortedData = useMemo(() => {
    if (!sort) return filteredData;
    return [...filteredData].sort((left, right) => {
      const a = left[sort.key];
      const b = right[sort.key];
      const comparison = typeof a === "number" && typeof b === "number"
        ? a - b
        : String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" });
      return sort.direction === "asc" ? comparison : -comparison;
    });
  }, [filteredData, sort]);
  const pageCount = Math.max(1, Math.ceil(sortedData.length / pageSize));
  const currentPage = Math.min(pageIndex, pageCount - 1);
  const rows = sortedData.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const pageSizes = useMemo(() => {
    const available = [5, 10, 20, 50].filter((size) => size <= data.length);
    return available.length > 0 ? available : [5];
  }, [data.length]);
  const downloadCsv = () => {
    if (!data.length) return;
    const csv = [
      columns.map((key) => csvValue(titleFor(key))).join(","),
      ...data.map((row) => columns.map((key) => csvValue(row[key])).join(",")),
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

  if (data.length === 0) {
    return (
      <Card className="flex flex-col gap-0!">
        <CardContent className="px-0!">
          <p className="py-8 text-center text-sm text-muted-foreground">{emptyMessage}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-0!">
      <CardContent className="px-0! pt-0">
        <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-4">
        <Input
          type="search"
          aria-label="Search table rows"
          className="min-w-0 sm:max-w-96"
          value={globalFilter}
          onChange={(event) => { setGlobalFilter(event.target.value); setPageIndex(0); }}
          placeholder="Search rows…"
        />
        <Button type="button" variant="outline" aria-label="Download table as CSV" onClick={downloadCsv}>
          <Download aria-hidden="true" className="size-4" />
          <span>Download CSV</span>
        </Button>
      </div>
      <div className="overflow-x-auto px-4">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
                {columns.map((key) => {
                  const direction = sort?.key === key ? sort.direction : null;
                  return (
                    <TableHead key={key} aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-auto px-2 font-medium text-muted-foreground"
                        onClick={() => {
                          setSort({ key, direction: direction === "asc" ? "desc" : "asc" });
                          setPageIndex(0);
                        }}
                      >
                        {titleFor(key)}
                        {direction === "asc" ? <ArrowUp aria-hidden="true" className="size-3" /> : direction === "desc" ? <ArrowDown aria-hidden="true" className="size-3" /> : null}
                      </Button>
                    </TableHead>
                  );
                })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length > 0 ? rows.map((row, index) => (
              <TableRow key={index} className="border-border hover:bg-muted/30">
                {columns.map((key) => (
                  <TableCell key={key} className="text-sm text-foreground">
                    {row[key] === null || row[key] === undefined ? "-" : String(row[key])}
                  </TableCell>
                ))}
              </TableRow>
            )) : (
              <TableRow>
                <TableCell colSpan={Math.max(columns.length, 1)} className="py-6 text-center text-sm text-muted-foreground">
                  No results found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-col items-center justify-between gap-4 px-4 pb-4 sm:flex-row">
        <div className="flex gap-2">
          <Button type="button" variant="secondary" disabled={currentPage === 0} onClick={() => setPageIndex((page) => Math.max(0, page - 1))}>Previous</Button>
          <Button type="button" disabled={currentPage + 1 >= pageCount} onClick={() => setPageIndex((page) => Math.min(pageCount - 1, page + 1))}>Next</Button>
        </div>
        <p className="text-sm text-muted-foreground" aria-live="polite">Page {currentPage + 1} of {pageCount}</p>
        <div className="flex items-center gap-2">
          <Label htmlFor={pageSizeId} className="whitespace-nowrap text-sm">Rows per page:</Label>
          <Select value={String(pageSize)} onValueChange={(value) => { setPageSize(Number(value)); setPageIndex(0); }}>
            <SelectTrigger id={pageSizeId} className="w-20"><SelectValue /></SelectTrigger>
            <SelectContent>
              {pageSizes.map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
        </div>
      </CardContent>
    </Card>
  );
}
