import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { SchemaPage } from "@/kit/schema/SchemaPage";
import { Page } from "@/kit/primitives/Page";
import { RowFilterContext } from "@/kit/schema/NodeRenderer";
import { List } from "@/kit/primitives/List";
import { AsyncState } from "@/kit/primitives/AsyncState";
import { Select } from "@/kit/primitives/Select";
import { DestructiveConfirm } from "@/kit/primitives/DestructiveConfirm";
import { Button } from "@/kit/ui/button";
import { api, ApiError, isOwnerOrAdminRole, type MemoryRecord, type PersonRosterEntry, type Roster } from "@/lib/api";
import { cn, FOCUS_RING } from "@/kit/utils";
import memoryPage from "../../../../spec/ui/pages/memory.json";

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
          <List
            items={records}
            getKey={(m) => m.id}
            label={`${personName}'s memories`}
            renderItem={(m) => (
              <div className="flex min-w-0 flex-col py-1">
                <span className="truncate text-base">{m.text}</span>
                <span className="text-sm text-muted-foreground">{m.category}</span>
              </div>
            )}
          />
        )}
      </AsyncState>
    </div>
  );
}

// 4.4's real memory store (backend/src/lib/memory.ts: entity-first
// recall, decay, tiers) has had no way for a family to see what's
// actually remembered. Session B step 5 converts this to a real schema
// page (spec/ui/pages/memory.json, the interpreter in kit/schema/) - the
// first page this session's generic UiNode renderer actually executes
// at runtime, not just validates. docs/dev.md's A2UI entry records why
// People, Privacy and Settings stayed hand-written React instead.
//
// One real behavior change from the hand-rolled version this replaces:
// a memory's scope line no longer resolves a person id to their display
// name (that needed a second bound list - the people roster - joined
// against this one by id, which the interpreter has no join mechanism
// for; inventing one for a single page is exactly the kind of ahead-of-
// need primitive docs/plans/session-b-ui.md step 5 says not to build).
// The subtitle shows the raw scope value instead.
export function MemoryPage({ person }: MemoryPageProps) {
  // Chat's "memory updated" chip (chatMemoryChip.tsx, step 4) deep-links
  // here with ?ids=<memory ids>: a client-side filter over the same list
  // the schema page's own binding already fetches (kit/schema/binding.ts's
  // shared `["schema-binding", path]` query key), not a second fetch.
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

  // `enabled: viewingSelf`, not fetched unconditionally on every render -
  // a code review, 2026-09-06, found this firing (and its result
  // discarded) even while viewing someone else, an extra request and DB
  // read for data the early return below never uses.
  const memoriesQuery = useQuery<MemoryRecord[]>({
    queryKey: ["schema-binding", "/api/memory"],
    queryFn: () => api.memories(),
    enabled: viewingSelf,
  });
  const visibleCount = filterIds
    ? (memoriesQuery.data?.filter((m) => filterIds.has(m.id)).length ?? 0)
    : undefined;

  // `SchemaPage` has no escape hatch for "replace the body" (only
  // `beforeBody`, a banner ABOVE it, since Memory's own bound list is
  // otherwise the whole point) - the person picker itself still lives in
  // that shared banner slot (it belongs above either body), but once an
  // adult picks someone else the whole page becomes the hand-written
  // `OtherPersonMemories` view instead of also rendering the schema
  // page's own always-actor's-own-memories list underneath it.
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

  if (viewingPerson) {
    return (
      <Page title="Memory">
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a keyboard-scrollable region, not a widget (DetailPane.tsx's own precedent). */}
        <div tabIndex={0} className={cn("flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4", FOCUS_RING)}>
          {personPicker}
          <OtherPersonMemories personId={viewingPerson.id} personName={viewingPerson.display_name} />
        </div>
      </Page>
    );
  }

  return (
    <RowFilterContext.Provider value={filterIds ? (row) => filterIds.has(String(row.id)) : () => true}>
      <SchemaPage
        page={memoryPage}
        beforeBody={
          <>
            {personPicker}
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
          </>
        }
      />
    </RowFilterContext.Provider>
  );
}
