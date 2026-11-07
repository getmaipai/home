import { i18n } from "@lingui/core";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { getIcon } from "@maipai/ui/src/icons";
import { DataTable } from "@maipai/ui/src/elements/data-table";
import { DataTableRowActions } from "@/shell/components/DataTableRowActions";
import { tableColumns, useDataTableModel } from "@/shell/components/dataTableModel";
import { Card, CardContent } from "@maipai/ui/src/dashboard/components/ui/card";
import { Button } from "@maipai/ui/src/dashboard/components/ui/button";
import { Button as KitButton } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/dashboard/components/ui/input";
import { Label } from "@maipai/ui/src/dashboard/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@maipai/ui/src/dashboard/components/ui/select";
import { api, isOwnerOrAdminRole, type Issue, type Roster } from "@/lib/api";
import { useTabItem } from "@/shell/tabIdentity";
import { severityLabel } from "@/shell/pages/severityLabel";
import { errorLine } from "@/lib/hubReachability";

/** /repairs: SHELL-07's own row (docs/plans/shell-on-shadcndashboard-
 * 2026-09-21.md's plan row) - `GET /api/repairs` through Home's
 * shared table: severity, title, detail and the fix's own label, the
 * same fields the retired RepairsSection showed.
 *
 * Named gap: running a fix or dismissing an issue are real actions on
 * the old page's own `Button` per row, a real
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
    status: severityLabel(issue.severity),
    detail: issue.detail,
    fix: issue.fix?.label ?? "-",
  };
  Object.defineProperty(row, "id", { value: issue.id });
  return row as Row;
}

export function RepairsPage({ person }: { person: Roster }) {
  useTabItem(i18n._({ id: "Repairs", message: "Repairs" }));
  const canManage = isOwnerOrAdminRole(person.role);
  const query = useQuery<Issue[]>({ queryKey: ["repairs"], queryFn: () => api.repairs(), enabled: canManage });
  const queryClient = useQueryClient();
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  const tableRows = (query.data ?? []).map(toRow);
  const model = useDataTableModel(tableRows, tableColumns<Row>(["title", "status", "detail", "fix"], { title: 220, status: 120, detail: 320, fix: 180 }, { title: i18n._({ id: "Title", message: "Title" }), status: i18n._({ id: "Status", message: "Status" }), detail: i18n._({ id: "Detail", message: "Detail" }), fix: i18n._({ id: "Fix", message: "Fix" }) }));

  async function runFix(id: string) {
    setPendingIds((previous) => new Set(previous).add(id));
    try {
      await api.fixIssue(id);
      await queryClient.invalidateQueries({ queryKey: ["repairs"] });
    } catch (error) {
      toast.error(errorLine(error, i18n._({ id: "Could not fix that repair.", message: "Could not fix that repair." })));
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
      toast.error(errorLine(error, i18n._({ id: "Could not dismiss that repair.", message: "Could not dismiss that repair." })));
    } finally {
      setPendingIds((previous) => {
        const next = new Set(previous);
        next.delete(id);
        return next;
      });
    }
  }

  async function checkComputersAgain() {
    try {
      await api.repairsChecks();
      await queryClient.invalidateQueries({ queryKey: ["repairs"] });
      toast.success(i18n._({ id: "Home checked your computers and updated Health.", message: "Home checked your computers and updated Health." }));
    } catch (error) {
      toast.error(errorLine(error, i18n._({ id: "Home couldn't check your computers. Check the engine connection, then try again.", message: "Home couldn't check your computers. Check the engine connection, then try again." })));
    }
  }

  return (
    <>
      {!canManage ? (
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">{i18n._({ id: "Only an owner or admin can manage repairs.", message: "Only an owner or admin can manage repairs." })}</p>
          </CardContent>
        </Card>
      ) : (
        <>
        <div className="flex flex-wrap gap-2">
          <KitButton type="button" variant="secondary" onClick={() => void checkComputersAgain()}>{i18n._({ id: "Check my computers again", message: "Check my computers again" })}</KitButton>
          <KitButton type="button" variant="secondary" onClick={() => { window.location.assign("/setup/review"); }}>{i18n._({ id: "Run setup again", message: "Run setup again" })}</KitButton>
        </div>
        <AsyncState
          data={query.data}
          error={query.isError}
          isFetching={query.isFetching}
          onRetry={() => query.refetch()}
          errorMessage={errorLine(query.error, i18n._({ id: "Could not load repairs.", message: "Could not load repairs." }))}
          loadingLabel={i18n._({ id: "Loading repairs", message: "Loading repairs" })}
        >
          {(issues: Issue[]) => (
            <DataTable
              {...model.tableProps}
              caption={i18n._({ id: "Repair issues", message: "Repair issues" })}
              getRowId={(row) => row.id}
              toolbar={model.rows.length >= 10 ? <div className="flex w-full flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Input size="row" type="search" aria-label={i18n._({ id: "Search table rows", message: "Search table rows" })} value={model.filter} onChange={(event) => { model.setFilter(event.target.value); model.setPageIndex(0); }} placeholder={i18n._({ id: "Search rows…", message: "Search rows…" })} />
                  <Button type="button" size="row" variant="outline" aria-label={i18n._({ id: "Download table as CSV", message: "Download table as CSV" })} onClick={model.downloadCsv}><Download aria-hidden="true" className="size-4" /><span>{i18n._({ id: "Download CSV", message: "Download CSV" })}</span></Button>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex gap-2"><Button type="button" size="row" variant="secondary" disabled={model.currentPage === 0} onClick={() => model.setPageIndex((page) => Math.max(0, page - 1))}>{i18n._({ id: "Previous", message: "Previous" })}</Button><Button type="button" size="row" disabled={model.currentPage + 1 >= model.pageCount} onClick={() => model.setPageIndex((page) => Math.min(model.pageCount - 1, page + 1))}>{i18n._({ id: "Next", message: "Next" })}</Button></div>
                  <p className="text-sm text-muted-foreground" aria-live="polite">{i18n._({ id: "Page {page} of {pages}", message: "Page {page} of {pages}", values: { page: model.currentPage + 1, pages: model.pageCount } })}</p>
                  <div className="flex items-center gap-2"><Label htmlFor={model.pageSizeId}>{i18n._({ id: "Rows per page:", message: "Rows per page:" })}</Label><Select value={String(model.pageSize)} onValueChange={(value) => { model.setPageSize(Number(value)); model.setPageIndex(0); }}><SelectTrigger id={model.pageSizeId} size="row"><SelectValue /></SelectTrigger><SelectContent>{model.availablePageSizes.map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectContent></Select></div>
                </div>
              </div> : undefined}
              rowActions={(row) => {
                const issue = issues.find((candidate) => candidate.id === row.id);
                if (!issue) return null;
                const isPending = pendingIds.has(issue.id);
                const actions = [
                  ...(issue.fix ? [{ label: issue.fix.label, onClick: () => runFix(issue.id), disabled: isPending }] : []),
                  {
                    label: i18n._({ id: "Dismiss", message: "Dismiss" }),
                    destructive: true,
                    confirmLabel: i18n._({ id: "Dismiss \"{title}\"?", message: "Dismiss \"{title}\"?", values: { title: issue.title } }),
                    onClick: () => dismissIssue(issue.id),
                    disabled: isPending,
                  },
                ];
                return <DataTableRowActions actions={actions} />;
              }}
            />
          )}
        </AsyncState>
        </>
      )}
    </>
  );
}
