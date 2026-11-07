import { i18n } from "@lingui/core";
import { getIcon } from "@maipai/ui/src/icons";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Input } from "@maipai/ui/src/dashboard/components/ui/input";
import { Label } from "@maipai/ui/src/dashboard/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/dashboard/components/ui/select";

const Download = getIcon("download");

export interface DataTableControlModel {
  filter: string;
  setFilter: (value: string) => void;
  currentPage: number;
  pageCount: number;
  setPageIndex: (update: number | ((previous: number) => number)) => void;
  pageSize: number;
  setPageSize: (size: number) => void;
  pageSizeId: string;
  availablePageSizes: number[];
  downloadCsv: () => void;
}

/** Home-owned controls composed only from shipped parts for DataTable.toolbar. */
export function DataTableControls({ model, compact = false }: { model: DataTableControlModel; compact?: boolean }) {
  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {!compact ? <Input size="row" type="search" aria-label={i18n._({ id: "Search table rows", message: "Search table rows" })} value={model.filter} onChange={(event) => { model.setFilter(event.target.value); model.setPageIndex(0); }} placeholder={i18n._({ id: "Search rows…", message: "Search rows…" })} /> : null}
        {!compact ? <Button type="button" size="row" variant="outline" aria-label={i18n._({ id: "Download table as CSV", message: "Download table as CSV" })} onClick={model.downloadCsv}><Download aria-hidden="true" className="size-4" /><span>{i18n._({ id: "Download CSV", message: "Download CSV" })}</span></Button> : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {model.pageCount > 1 ? <div className="flex gap-2">
          <Button type="button" size="row" variant="secondary" disabled={model.currentPage === 0} onClick={() => model.setPageIndex((page) => Math.max(0, page - 1))}>{i18n._({ id: "Previous", message: "Previous" })}</Button>
          <Button type="button" size="row" disabled={model.currentPage + 1 >= model.pageCount} onClick={() => model.setPageIndex((page) => Math.min(model.pageCount - 1, page + 1))}>{i18n._({ id: "Next", message: "Next" })}</Button>
        </div> : null}
        {model.pageCount > 1 ? <p className="text-sm text-muted-foreground" aria-live="polite">{i18n._({ id: "Page {page} of {pages}", message: "Page {page} of {pages}", values: { page: model.currentPage + 1, pages: model.pageCount } })}</p> : null}
        {model.pageCount > 1 ? <div className="flex items-center gap-2">
          <Label htmlFor={model.pageSizeId}>{i18n._({ id: "Rows per page:", message: "Rows per page:" })}</Label>
          <Select value={String(model.pageSize)} onValueChange={(value) => { model.setPageSize(Number(value)); model.setPageIndex(0); }}>
            <SelectTrigger id={model.pageSizeId} size="row"><SelectValue /></SelectTrigger>
            <SelectContent>{model.availablePageSizes.map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectContent>
          </Select>
        </div> : null}
      </div>
    </div>
  );
}
