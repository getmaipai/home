import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { getIcon } from "@maipai/ui/src/icons";
import { DataTable } from "@maipai/ui/src/elements/data-table";
import { DataTableRowActions } from "@/shell/components/DataTableRowActions";
import { tableColumns, useDataTableModel } from "@/shell/components/dataTableModel";
import { Card, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Input } from "@maipai/ui/src/dashboard/components/ui/input";
import { Label } from "@maipai/ui/src/dashboard/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/dashboard/components/ui/select";
import { api, ApiError, isOwnerOrAdminRole, type Issue, type Roster } from "@/lib/api";
import { useTabItem } from "@/shell/tabIdentity";

/** /repairs: SHELL-07's own row (docs/plans/shell-on-shadcndashboard-
 * 2026-09-21.md's plan row) - `GET /api/repairs` through Home's
 * shared table: severity, title, detail and the fix's own label, the
 * same fields `RepairsSection.tsx` shows.
 *
 * Named gap: running a fix or dismissing an issue are real actions on
 * the old page (`RepairsSection.tsx`'s own `Button` per row, a real
 * `onClick`) - Home's shared table is deliberately read-only, so running fixes and
 * dismissing issues stay on the old route. Gated to owner/admin like
 * the old page and the backend both agree on here (`GET /api/repairs`
 * itself is `requireRole("owner", "admin")`, unlike Updates' looser
 * read gate). */
// Exported: CHAT-HEADER-02's own pageHeaderTitle.tsx imports this
// directly for the header's left slot rather than re-declaring the
// icon name a second time - one definition, this page's own.
export const RepairsIcon = getIcon("wrench");
const Download = getIcon("download");

interface Row extends Record<string, unknown> {
  title: string;
  status: string;
  detail: string;
  fix: string;
  id: string;
}

function toRow(issue: Issue): Row {
  const row = {
    title: issue.title,
    status: issue.severity.charAt(0).toUpperCase() + issue.severity.slice(1),
    detail: issue.detail,
    fix: issue.fix?.label ?? "-",
  };
  Object.defineProperty(row, "id", { value: issue.id });
  return row as Row;
}

export function RepairsPage({ person }: { person: Roster }) {
  useTabItem("Repairs");
  const canManage = isOwnerOrAdminRole(person.role);
  const query = useQuery<Issue[]>({ queryKey: ["repairs"], queryFn: () => api.repairs(), enabled: canManage });
  const queryClient = useQueryClient();
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const tableRows = (query.data ?? []).map(toRow);
  const model = useDataTableModel(tableRows, tableColumns<Row>(["title", "status", "detail", "fix"], { title: 220, status: 120, detail: 320, fix: 180 }));

  async function runFix(id: string) {
    setPendingIds((previous) => new Set(previous).add(id));
    try {
      await api.fixIssue(id);
      await queryClient.invalidateQueries({ queryKey: ["repairs"] });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not fix that repair.");
    } finally {
      setPendingIds((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
    }
  }

  async function dismissIssue(id: string) {
    setPendingIds((previous) => new Set(previous).add(id));
    try {
      await api.dismissIssue(id);
      await queryClient.invalidateQueries({ queryKey: ["repairs"] });
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not dismiss that repair.");
    } finally {
      setPendingIds((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <>
      <CardHeader>
        <CardTitle><span className="flex items-center gap-2">
          <RepairsIcon size={16} className="text-muted-foreground" />
          Repairs
        </span></CardTitle>
      </CardHeader>

      {!canManage ? (
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">Only an owner or admin can manage repairs.</p>
          </CardContent>
        </Card>
      ) : (
        <AsyncState
          data={query.data}
          error={query.isError}
          isFetching={query.isFetching}
          onRetry={() => query.refetch()}
          errorMessage={query.error instanceof ApiError ? query.error.message : "Could not load repairs."}
          loadingLabel="Loading repairs"
        >
          {(issues: Issue[]) => (
            <DataTable
              {...model}
              caption="Repair issues"
              getRowId={(row) => row.id}
              toolbar={<div className="flex w-full flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Input size="row" type="search" aria-label="Search table rows" value={model.filter} onChange={(event) => { model.setFilter(event.target.value); model.setPageIndex(0); }} placeholder="Search rows…" />
                  <Button type="button" size="row" variant="outline" aria-label="Download table as CSV" onClick={model.downloadCsv}><Download aria-hidden="true" className="size-4" /><span>Download CSV</span></Button>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex gap-2"><Button type="button" size="row" variant="secondary" disabled={model.currentPage === 0} onClick={() => model.setPageIndex((page) => Math.max(0, page - 1))}>Previous</Button><Button type="button" size="row" disabled={model.currentPage + 1 >= model.pageCount} onClick={() => model.setPageIndex((page) => Math.min(model.pageCount - 1, page + 1))}>Next</Button></div>
                  <p className="text-sm text-muted-foreground" aria-live="polite">Page {model.currentPage + 1} of {model.pageCount}</p>
                  <div className="flex items-center gap-2"><Label htmlFor={model.pageSizeId}>Rows per page:</Label><Select value={String(model.pageSize)} onValueChange={(value) => { model.setPageSize(Number(value)); model.setPageIndex(0); }}><SelectTrigger id={model.pageSizeId} size="row"><SelectValue /></SelectTrigger><SelectContent>{model.availablePageSizes.map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectContent></Select></div>
                </div>
              </div>}
              rowActions={(row) => {
                const issue = issues.find((candidate) => candidate.id === row.id);
                if (!issue) return null;
                const isPending = pendingIds.has(issue.id);
                const actions = [
                  ...(issue.fix ? [{ label: issue.fix.label, onClick: () => runFix(issue.id), disabled: isPending }] : []),
                  {
                    label: "Dismiss",
                    destructive: true,
                    confirmLabel: `Dismiss "${issue.title}"?`,
                    onClick: () => dismissIssue(issue.id),
                    disabled: isPending,
                  },
                ];
                return <DataTableRowActions actions={actions} />;
              }}
            />
          )}
        </AsyncState>
      )}
    </>
  );
}
