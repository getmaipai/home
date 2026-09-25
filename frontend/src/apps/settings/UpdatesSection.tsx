import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Page } from "@maipai/ui/src/primitives/Page";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { ThingsTable, type ThingStatus, type ThingsTableColumn } from "@maipai/ui/src/blocks/things-table/ThingsTable";
import { DetailsPane } from "@maipai/ui/src/blocks/pane/DetailsPane";
import type { StatusKind } from "@maipai/ui/src/status";
import { KeyValueList } from "@maipai/ui/src/blocks/property-panel/KeyValueList";
import { IconTile } from "@maipai/ui/src/primitives/IconTile";
import type { IconName } from "@maipai/ui/src/icons";
import { Button } from "@maipai/ui/src/ui/button";
import { useToast } from "@maipai/ui/src/primitives/Toast";
import { api, ApiError, type UpdateProjection } from "@/lib/api";

// HOME-STACK-05: Home's own release row beside the Stack's engine and
// model rows, one table, the kit's own things-table/pane style (the
// same pattern AppsPage.tsx and ModelsPage.tsx already use for "installed
// vs. available, with an action"). Models get no action here on
// purpose: the Stack's own update route only ever applies to engines
// (updates/engines/{name}/apply) - a model is a fresh pull by pin, a
// different, not-yet-built flow (docs/BACKLOG.md's own STORE-01 gap).
// Exported: SHELL-07's /next/updates reads the identical row shape and
// "does this row have a real update" rule rather than a second
// definition of either.
export interface UpdateRow {
  kind: "app" | "engine" | "model" | "reference";
  id: string;
  name: string;
  installed: string | null;
  available: string | null;
  lastChecked: string | null;
  notes: string | null;
}

export function rowsFrom(projection: UpdateProjection): UpdateRow[] {
  const rows: UpdateRow[] = [
    { kind: "app", id: "app", name: "MaiPai Home", installed: projection.installed, available: projection.latest, lastChecked: projection.checkedAt, notes: projection.error ?? projection.summary },
  ];
  if (projection.stack) {
    for (const engine of projection.stack.engines) {
      rows.push({ kind: "engine", id: `engine:${engine.name}`, name: engine.name, installed: engine.installed, available: engine.availableKnown ? engine.available : null, lastChecked: engine.lastChecked, notes: engine.notes });
    }
    for (const model of projection.stack.models.entries) {
      rows.push({ kind: "model", id: `model:${model.id}`, name: model.id, installed: model.installed, available: model.available, lastChecked: projection.stack.models.lastChecked, notes: null });
    }
  }
  if (projection.reference) {
    for (const reference of projection.reference.entries) {
      rows.push({ kind: "reference", id: `reference:${reference.id}`, name: reference.name, installed: reference.installed, available: reference.available, lastChecked: reference.lastChecked, notes: reference.notes });
    }
  }
  return rows;
}

// Matches the DetailsPane icon choice below - one definition, not two.
function rowIcon(kind: UpdateRow["kind"]): IconName {
  return kind === "app" ? "home" : kind === "engine" ? "cpu" : kind === "reference" ? "archive" : "package";
}

export function hasUpdate(row: UpdateRow): boolean {
  return row.available !== null && row.available !== row.installed;
}

function tableStatus(row: UpdateRow): ThingStatus {
  return hasUpdate(row) ? "attention" : "ready";
}

function paneStatus(row: UpdateRow): StatusKind {
  return hasUpdate(row) ? "warning" : "ready";
}

const QUERY_KEY = ["updates"];

export function UpdatesSection() {
  const query = useQuery<UpdateProjection>({ queryKey: QUERY_KEY, queryFn: () => api.updates() });
  const queryClient = useQueryClient();
  const { push } = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  // The tag to offer "Go back" to, per engine, remembered only for this
  // session from the apply that just ran - the Stack's own updates
  // state carries no history to read this back from later (a scripted
  // failed swap's own recovery goes through Repairs instead, via the
  // health item the Stack itself raises with a rollback_update fix -
  // stackHealthSync.ts's own sync, no separate UI needed for that path).
  const [rollbackTargets, setRollbackTargets] = useState<Record<string, string>>({});

  async function withBusy(id: string, run: () => Promise<void>) {
    setBusyIds((prev) => new Set(prev).add(id));
    try {
      await run();
    } catch (e) {
      push(e instanceof ApiError ? e.message : "That didn't work.");
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function applyEngine(name: string) {
    await withBusy(`engine:${name}`, async () => {
      const result = await api.applyStackEngineUpdate(name);
      if (result.applied && result.tag && result.previous) {
        setRollbackTargets((prev) => ({ ...prev, [name]: result.previous! }));
      }
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    });
  }

  async function rollbackEngineTo(name: string, tag: string) {
    await withBusy(`engine:${name}`, async () => {
      await api.rollbackStackEngine(name, tag);
      setRollbackTargets((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    });
  }

  const columns: ThingsTableColumn<UpdateRow>[] = [
    {
      key: "name",
      header: "Name",
      render: (row) => (
        <div className="flex min-w-0 items-center gap-2">
          <IconTile icon={rowIcon(row.kind)} hue="--hue-blue" size="sm" glow={false} />
          <span className="truncate">{row.name}</span>
        </div>
      ),
    },
    { key: "installed", header: "Installed", render: (row) => row.installed ?? "—" },
    { key: "available", header: "Available", render: (row) => (row.available ? row.available : row.kind === "engine" ? "Unknown" : "—") },
    { key: "lastChecked", header: "Last checked", render: (row) => (row.lastChecked ? new Date(row.lastChecked).toLocaleString() : "Never") },
    { key: "notes", header: "Notes", render: (row) => row.notes ?? "" },
  ];

  const rows = query.data ? rowsFrom(query.data) : [];
  const selected = rows.find((row) => row.id === selectedId) ?? null;

  return (
    <Page title="Updates" hideTitle>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <AsyncState
          data={query.data}
          error={query.isError}
          isFetching={query.isFetching}
          onRetry={() => query.refetch()}
          errorMessage={query.error instanceof ApiError ? query.error.message : "Could not load updates."}
          loadingLabel="Loading updates"
        >
          {() => (
            <ThingsTable
              columns={columns}
              rows={rows}
              getStatus={tableStatus}
              getKey={(row) => row.id}
              onRowClick={(row) => setSelectedId(row.id)}
              selectedKey={selectedId ?? undefined}
              empty="Nothing to show."
              rowActions={(row) =>
                row.kind !== "engine"
                  ? []
                  : [
                      ...(hasUpdate(row)
                        ? [{ label: "Apply", onClick: () => applyEngine(row.name), disabled: busyIds.has(row.id) }]
                        : []),
                      ...(rollbackTargets[row.name]
                        ? [{ label: "Go back", onClick: () => rollbackEngineTo(row.name, rollbackTargets[row.name]!), disabled: busyIds.has(row.id) }]
                        : []),
                    ]
              }
            />
          )}
        </AsyncState>
      </div>
      {selected && (
        <DetailsPane
          open
          onClose={() => setSelectedId(null)}
          icon={rowIcon(selected.kind)}
          hue="--hue-blue"
          name={selected.name}
          identifier={selected.id}
          status={paneStatus(selected)}
          tabs={[
            {
              id: "overview",
              label: "Overview",
              content: (
                <KeyValueList
                  items={[
                    { label: "Installed", value: selected.installed ?? "Unknown" },
                    { label: "Available", value: selected.available ?? "Unknown" },
                    { label: "Last checked", value: selected.lastChecked ? new Date(selected.lastChecked).toLocaleString() : "Never" },
                    { label: "Notes", value: selected.notes ?? "None" },
                  ]}
                />
              ),
            },
          ]}
          actions={
            selected.kind !== "engine"
              ? []
              : [
                  ...(hasUpdate(selected)
                    ? [{ label: "Apply", onClick: () => applyEngine(selected.name), confirmLabel: `Apply the available ${selected.name} build? It restarts to pick up the update.` }]
                    : []),
                  ...(rollbackTargets[selected.name]
                    ? [{ label: "Go back", destructive: true, confirmLabel: `Go back to ${rollbackTargets[selected.name]}?`, onClick: () => rollbackEngineTo(selected.name, rollbackTargets[selected.name]!) }]
                    : []),
                ]
          }
        />
      )}
      {query.data?.stack && (
        <div className="flex shrink-0 items-center gap-2 border-t p-4">
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              withBusy("stack-check", async () => {
                await api.checkStackUpdates();
                await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
              })
            }
            disabled={busyIds.has("stack-check")}
          >
            Check for updates
          </Button>
        </div>
      )}
      {query.data?.stackError && (
        <p className="shrink-0 border-t p-4 text-base text-[var(--destructive)]">
          Couldn't reach the Stack for engine and model updates: {query.data.stackError}
        </p>
      )}
      {query.data?.referenceError && (
        <p className="shrink-0 border-t p-4 text-base text-[var(--destructive)]">
          Couldn't read installed reference sets for updates: {query.data.referenceError}
        </p>
      )}
    </Page>
  );
}
