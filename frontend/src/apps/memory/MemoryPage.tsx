import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Page } from "@/kit/primitives/Page";
import { AsyncState } from "@/kit/primitives/AsyncState";
import { Button } from "@/kit/ui/button";
import { getIcon } from "@/kit/icons";
import { api, ApiError, type MemoryRecord, type PersonRosterEntry } from "@/lib/api";
import { CATEGORY_LABELS, scopeLabel } from "@/apps/memory/memoryLabels";

interface MemoryData {
  memories: MemoryRecord[];
  nameById: Map<string, string>;
}

// 4.4's real memory store (backend/src/lib/memory.ts: entity-first
// recall, decay, tiers) has had no way for a family to see what's
// actually remembered. This is the read half plus the one safe write:
// list what the signed-in person can see (list()'s own canRead rule
// already scopes this correctly - household, their own person-scope
// records, and self-scope only for whoever admin can read those), and
// Archive (a status change, not a delete). "Forget everything about a
// person" (lib/memory.ts's forget(), a real permanent bulk DELETE) is
// deliberately not wired up here: a destructive action like that needs a
// real confirm dialog, and chapter 6's dialog pattern doesn't exist yet -
// building it with a bare browser confirm() would also be untestable
// through this session's own browser automation, which is barred from
// triggering native dialogs.
export function MemoryPage() {
  const queryClient = useQueryClient();

  const memoriesQuery = useQuery<MemoryRecord[]>({
    queryKey: ["memories"],
    queryFn: () => api.memories(),
  });
  // The same `["people"]` key `PeoplePage.tsx` uses, not a bundled fetch
  // of its own - a code review (2026-09-05) found the two pages fetching
  // and caching the same roster independently, and archiving a memory
  // (which only ever invalidates `["memories"]`) was still re-fetching
  // this via the old bundled query key regardless.
  const peopleQuery = useQuery<PersonRosterEntry[]>({
    queryKey: ["people"],
    queryFn: () => api.people(),
  });

  const error = memoriesQuery.isError || peopleQuery.isError;
  const isFetching = memoriesQuery.isFetching || peopleQuery.isFetching;
  const data: MemoryData | undefined =
    memoriesQuery.data && peopleQuery.data
      ? { memories: memoriesQuery.data, nameById: new Map(peopleQuery.data.map((p) => [p.id, p.display_name])) }
      : undefined;

  const archiveMutation = useMutation({
    mutationFn: (id: string) => api.archiveMemory(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["memories"] }),
  });
  const archivingId = archiveMutation.isPending ? archiveMutation.variables : null;

  const ArchiveIcon = getIcon("archive");

  return (
    <Page title="Memory">
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {archiveMutation.isError ? (
          <div className="rounded-lg bg-muted px-3 py-2 text-sm text-destructive">
            {archiveMutation.error instanceof ApiError ? archiveMutation.error.message : "Could not archive that memory."}
          </div>
        ) : null}
        <AsyncState
          data={data}
          error={error}
          isFetching={isFetching}
          onRetry={() => {
            if (memoriesQuery.isError) memoriesQuery.refetch();
            if (peopleQuery.isError) peopleQuery.refetch();
          }}
          errorMessage={
            (memoriesQuery.error ?? peopleQuery.error) instanceof ApiError
              ? ((memoriesQuery.error ?? peopleQuery.error) as ApiError).message
              : "Could not load memory."
          }
          isEmpty={(d) => d.memories.length === 0}
          emptyIcon="brain"
          emptyText="Nothing remembered yet."
          loadingLabel="Loading memory"
        >
          {(d) => (
            <>
              {d.memories.map((m) => (
                <div
                  key={m.id}
                  className="flex items-start justify-between gap-4 rounded-lg border border-border p-3"
                >
                  <div className="flex flex-col gap-1">
                    <span className="text-base">{m.text}</span>
                    <span className="text-sm text-muted-foreground">
                      {scopeLabel(m, d.nameById)} · {CATEGORY_LABELS[m.category]}
                      {m.pinned ? " · Pinned" : ""}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => archiveMutation.mutate(m.id)}
                    disabled={archivingId === m.id}
                    aria-label={`Archive "${m.text}"`}
                  >
                    <ArchiveIcon className="h-5 w-5" aria-hidden />
                  </Button>
                </div>
              ))}
            </>
          )}
        </AsyncState>
      </div>
    </Page>
  );
}
