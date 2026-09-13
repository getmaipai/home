import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Page } from "@/kit/primitives/Page";
import { List } from "@/kit/primitives/List";
import { AsyncState } from "@/kit/primitives/AsyncState";
import { Select } from "@/kit/primitives/Select";
import { DestructiveConfirm } from "@/kit/primitives/DestructiveConfirm";
import { BatchBar, SelectModeToggle } from "@/kit/primitives/BatchBar";
import { Checkbox } from "@/kit/ui/checkbox";
import { Button } from "@/kit/ui/button";
import { getIcon } from "@/kit/icons";
import { api, ApiError, isOwnerOrAdminRole, type MemoryRecord, type PersonRosterEntry, type Roster } from "@/lib/api";
import { cn, FOCUS_RING } from "@/kit/utils";

const ArchiveIcon = getIcon("archive");

interface MemoryPageProps {
  person: Roster;
}

const ME = "me";

function downloadJson(filenameStem: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filenameStem}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function subtitleFor(m: MemoryRecord): string {
  return `${m.category} · ${m.scope}${m.pinned ? " · Pinned" : ""}`;
}

/** The row list both memory views share: a memory's text/subtitle, an
 * optional select-mode checkbox, and (outside select mode) a per-row
 * "Archive" quick action. Select mode, the batch bar, and the confirm
 * panel are each view's own (the copy - "your own"/a named child's -
 * and what "clear all" means for each differ), the same "kit owns the
 * bar, the page owns the wording" split BatchBar.tsx documents. */
function MemoryRows({
  records,
  selectMode,
  selected,
  onToggle,
  onArchive,
  archivingId,
  subtitle = subtitleFor,
}: {
  records: MemoryRecord[];
  selectMode: boolean;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onArchive: (id: string) => void;
  archivingId: string | null;
  /** Defaults to the own-list's "{category} · {scope} · Pinned" line.
   * `OtherPersonMemories` passes its own, unchanged-from-before-this-
   * component-was-shared `{category}`-only subtitle: scope is always
   * "person" there (a child's own memories), so it would be a redundant
   * word on every row, not new information. */
  subtitle?: (m: MemoryRecord) => string;
}) {
  return (
    <List
      items={records}
      getKey={(m) => m.id}
      label="Memories"
      renderItem={(m) => (
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {selectMode ? (
            <Checkbox
              checked={selected.has(m.id)}
              onCheckedChange={() => onToggle(m.id)}
              aria-label={`Select ${m.text}`}
              className="shrink-0"
            />
          ) : null}
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-base">{m.text}</span>
            <span className="text-sm text-muted-foreground">{subtitle(m)}</span>
          </div>
        </div>
      )}
      renderAction={
        selectMode
          ? undefined
          : (m) => (
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Archive "${m.text}"`}
                disabled={archivingId === m.id}
                onClick={() => onArchive(m.id)}
              >
                <ArchiveIcon className="h-5 w-5" aria-hidden />
              </Button>
            )
      }
    />
  );
}

// The per-person view an adult can open for a child (session E step 5),
// alongside forget/export - both real routes (backend/src/routes/
// memory.ts's own /export, /forget) with no frontend caller anywhere
// until now. Not the schema page below for this half: the schema's
// `bind.path` is a fixed string ("/api/memory"), so it has no way to
// carry a `?person=` that changes per view, and forget/export are
// person-level actions the generic list-node interpreter has no concept
// of at all (the same "stays hand-written" call this session's Repairs
// and Conversations pages already made for a structurally identical
// reason - a real capability the generic interpreter doesn't have).
function OtherPersonMemories({ personId, personName }: { personId: string; personName: string }) {
  const query = useQuery<MemoryRecord[]>({
    queryKey: ["memory-list", personId],
    queryFn: () => api.memories(personId),
  });
  const [confirmingForget, setConfirmingForget] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  async function handleExport() {
    setBusy(true);
    setActionError(null);
    try {
      const records = await api.exportPersonMemories(personId);
      downloadJson(`${personName}-memories`, records);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not export those memories.");
    } finally {
      setBusy(false);
    }
  }

  async function handleForget() {
    setBusy(true);
    setActionError(null);
    try {
      await api.forgetPersonMemories(personId);
      setConfirmingForget(false);
      await query.refetch();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not forget those memories.");
    } finally {
      setBusy(false);
    }
  }

  async function handleArchive(id: string) {
    setArchivingId(id);
    setActionError(null);
    try {
      await api.archiveMemory(id);
      await query.refetch();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not archive that memory.");
    } finally {
      setArchivingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {actionError ? <p className="text-base text-destructive">{actionError}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={handleExport} disabled={busy}>
          Export {personName}'s memories
        </Button>
        <Button variant="ghost" onClick={() => setConfirmingForget(true)} disabled={busy}>
          Forget everything about {personName}
        </Button>
      </div>

      {confirmingForget ? (
        <DestructiveConfirm
          message={`Forget everything MaiPai remembers about ${personName}?`}
          detail="This cannot be undone."
          confirmLabel="Yes, forget everything"
          busyLabel="Forgetting…"
          busy={busy}
          onConfirm={handleForget}
          onCancel={() => setConfirmingForget(false)}
        />
      ) : null}

      <AsyncState
        data={query.data}
        error={query.isError}
        isFetching={query.isFetching}
        onRetry={() => query.refetch()}
        errorMessage="Could not load those memories."
        isEmpty={(rows) => rows.length === 0}
        emptyIcon="brain"
        emptyText={`Nothing remembered about ${personName} yet.`}
        loadingLabel="Loading memories"
      >
        {(records) => (
          <MemoryRows
            records={records}
            selectMode={false}
            selected={new Set()}
            onToggle={() => {}}
            onArchive={handleArchive}
            archivingId={archivingId}
            subtitle={(m) => m.category}
          />
        )}
      </AsyncState>
    </div>
  );
}

// Session B step 5 first converted this to a real schema page (spec/ui/
// pages/memory.json, the generic kit/schema/ interpreter) - the same
// move People, Conversations and Users made before reverting for the
// same reason: the generic interpreter's own batch mechanism only knows
// how to loop one call per selected item (kit/schema/actions.ts's
// runAction), never a single request carrying every id. Lane 3 item 4
// (2026-09-13) needed exactly that - a real "forget selected"/"clear
// all" that costs one round trip regardless of how many memories are
// selected, per Jesse's standing batch-actions rule - so this view moved
// back to hand-written, alongside the others, and now calls the new
// `POST /api/memory/batch-forget` (backend/src/lib/memory.ts's
// `forgetByIds`) directly. `spec/ui/pages/memory.json` stays as the
// platform's own schema description of this page for a client that
// renders schema pages natively (MaiPai Go, not built yet) - the same
// divergence `chat.json` already has from assistant-ui's hand-rolled
// chat, not a leftover to clean up.
//
// One real behavior change from the schema-page version this replaces:
// a memory's scope line no longer resolves a person id to their display
// name (that needed a second bound list - the people roster - joined
// against this one by id, which the interpreter had no join mechanism
// for; inventing one for a single page is exactly the kind of ahead-of-
// need primitive docs/plans/session-b-ui.md step 5 says not to build).
// The subtitle shows the raw scope value instead.
function OwnMemories({ filterIds }: { filterIds: Set<string> | null }) {
  const queryClient = useQueryClient();
  const query = useQuery<MemoryRecord[]>({
    queryKey: ["memory-list", ME],
    queryFn: () => api.memories(),
  });
  const all = query.data ?? [];
  const records = filterIds ? all.filter((m) => filterIds.has(m.id)) : all;

  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmingForget, setConfirmingForget] = useState<"batch" | "clear" | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  function leaveSelectMode() {
    setSelectMode(false);
    setSelected(new Set());
    setConfirmingForget(null);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function forgetIds(ids: string[]) {
    setBusy(true);
    setActionError(null);
    try {
      const { outcomes } = await api.batchForgetMemories(ids);
      // Partial success is reported, never swallowed (docs/UI.md > Batch
      // actions): one refused (a pinned or entity record, say) has to
      // say so, or a parent is left thinking everything selected is gone.
      const refused = outcomes.filter((o) => !o.deleted);
      if (refused.length > 0) {
        setActionError(`${refused.length} of ${ids.length} could not be forgotten: ${refused[0]?.reason ?? "not allowed"}`);
      }
      leaveSelectMode();
      await queryClient.invalidateQueries({ queryKey: ["memory-list", ME] });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not forget those memories.");
    } finally {
      setBusy(false);
    }
  }

  async function handleArchive(id: string) {
    setArchivingId(id);
    setActionError(null);
    try {
      await api.archiveMemory(id);
      await queryClient.invalidateQueries({ queryKey: ["memory-list", ME] });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not archive that memory.");
    } finally {
      setArchivingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {actionError ? <p className="text-base text-destructive">{actionError}</p> : null}

      {!filterIds ? (
        <div className="flex flex-wrap items-center gap-2">
          {selectMode ? (
            <BatchBar count={selected.size} onExit={leaveSelectMode}>
              <Button variant="destructive" disabled={selected.size === 0} onClick={() => setConfirmingForget("batch")}>
                Forget selected
              </Button>
            </BatchBar>
          ) : (
            <SelectModeToggle label="Select memories" onClick={() => setSelectMode(true)} />
          )}
          {!selectMode ? (
            <Button variant="ghost" disabled={all.length === 0} onClick={() => setConfirmingForget("clear")}>
              Clear all
            </Button>
          ) : null}
        </div>
      ) : null}

      {confirmingForget === "batch" ? (
        <DestructiveConfirm
          message={`Forget ${selected.size} ${selected.size === 1 ? "memory" : "memories"}? This cannot be undone.`}
          confirmLabel={`Yes, forget ${selected.size}`}
          busyLabel="Forgetting…"
          busy={busy}
          onConfirm={() => forgetIds([...selected])}
          onCancel={() => setConfirmingForget(null)}
          cancelLabel="Keep them"
        />
      ) : null}

      {confirmingForget === "clear" ? (
        <DestructiveConfirm
          message={`Forget every one of your ${all.length} ${all.length === 1 ? "memory" : "memories"}? This cannot be undone.`}
          confirmLabel="Yes, forget all"
          busyLabel="Forgetting…"
          busy={busy}
          onConfirm={() => forgetIds(all.map((m) => m.id))}
          onCancel={() => setConfirmingForget(null)}
          cancelLabel="Keep them"
        />
      ) : null}

      <AsyncState
        data={query.data}
        error={query.isError}
        isFetching={query.isFetching}
        onRetry={() => query.refetch()}
        errorMessage="Could not load your memories."
        isEmpty={() => records.length === 0}
        emptyIcon="brain"
        emptyText="Nothing remembered yet."
        loadingLabel="Loading memories"
      >
        {() => (
          <MemoryRows
            records={records}
            selectMode={selectMode}
            selected={selected}
            onToggle={toggle}
            onArchive={handleArchive}
            archivingId={archivingId}
          />
        )}
      </AsyncState>
    </div>
  );
}

export function MemoryPage({ person }: MemoryPageProps) {
  // Chat's "memory updated" chip (chatMemoryChip.tsx, step 4) deep-links
  // here with ?ids=<memory ids>: a client-side filter over the same list
  // `OwnMemories` already fetches, not a second fetch. Select mode and
  // clear-all are hidden while this filter is active - it's a narrow,
  // temporary view of what chat just changed, not the place to batch-act
  // on the whole list.
  const [searchParams] = useSearchParams();
  const idsParam = searchParams.get("ids");
  const filterIds = idsParam ? new Set(idsParam.split(",")) : null;

  const canViewOthers = isOwnerOrAdminRole(person.role);
  const [viewing, setViewing] = useState<string>(ME);
  const viewingSelf = viewing === ME;
  const peopleQuery = useQuery<PersonRosterEntry[]>({
    queryKey: ["people"],
    queryFn: () => api.people(),
    enabled: canViewOthers,
  });
  const viewingPerson = !viewingSelf ? peopleQuery.data?.find((p) => p.id === viewing) : undefined;

  const memoriesQuery = useQuery<MemoryRecord[]>({
    queryKey: ["memory-list", ME],
    queryFn: () => api.memories(),
    enabled: viewingSelf,
  });
  const visibleCount = filterIds
    ? (memoriesQuery.data?.filter((m) => filterIds.has(m.id)).length ?? 0)
    : undefined;

  const personPicker =
    canViewOthers && peopleQuery.data && peopleQuery.data.length > 1 ? (
      <Select
        value={viewing}
        onValueChange={setViewing}
        options={[ME, ...peopleQuery.data.filter((p) => p.id !== person.id).map((p) => p.id)]}
        getLabel={(v) => (v === ME ? "Me" : (peopleQuery.data?.find((p) => p.id === v)?.display_name ?? v))}
        aria-label="Viewing whose memories"
      />
    ) : null;

  return (
    <Page title="Memory">
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a keyboard-scrollable region, not a widget (DetailPane.tsx's own precedent). */}
      <div tabIndex={0} className={cn("flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4", FOCUS_RING)}>
        {personPicker}
        {viewingPerson ? (
          <OtherPersonMemories personId={viewingPerson.id} personName={viewingPerson.display_name} />
        ) : (
          <>
            {filterIds ? (
              <div className="flex items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
                <span>
                  Showing {visibleCount ?? 0} memory update{visibleCount === 1 ? "" : "s"}
                </span>
                <Link to="/memory" className="text-primary underline">
                  Show all
                </Link>
              </div>
            ) : null}
            <OwnMemories filterIds={filterIds} />
          </>
        )}
      </div>
    </Page>
  );
}
