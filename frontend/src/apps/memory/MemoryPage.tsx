import { useCallback, useEffect, useState } from "react";
import { Page } from "@/kit/primitives/Page";
import { EmptyState } from "@/kit/primitives/EmptyState";
import { Progress } from "@/kit/primitives/Progress";
import { Button } from "@/kit/components/Button";
import { getIcon } from "@/kit/icons";
import { api, ApiError, type MemoryRecord } from "@/lib/api";
import { CATEGORY_LABELS, scopeLabel } from "@/apps/memory/memoryLabels";

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
  const [memories, setMemories] = useState<MemoryRecord[] | null>(null);
  const [nameById, setNameById] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([api.memories(), api.people()])
      .then(([mems, people]) => {
        setMemories(mems);
        setNameById(new Map(people.map((p) => [p.id, p.display_name])));
      })
      .catch((e: unknown) => setError(e instanceof ApiError ? e.message : "Could not load memory."));
  }, []);

  useEffect(load, [load]);

  async function handleArchive(id: string) {
    setArchivingId(id);
    setError(null);
    try {
      await api.archiveMemory(id);
      setMemories((prev) => (prev ?? []).filter((m) => m.id !== id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not archive that memory.");
    } finally {
      setArchivingId(null);
    }
  }

  if (error && memories === null) {
    return (
      <Page title="Memory">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="text-base text-[hsl(var(--destructive))]">{error}</p>
          <Button variant="secondary" onClick={load}>
            Try again
          </Button>
        </div>
      </Page>
    );
  }

  if (memories === null) {
    return (
      <Page title="Memory">
        <div className="flex flex-1 items-center justify-center">
          <Progress mode="spinner" label="Loading memory" />
        </div>
      </Page>
    );
  }

  const ArchiveIcon = getIcon("archive");

  return (
    <Page title="Memory">
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4">
        {error ? (
          <div className="rounded-[var(--radius)] bg-[hsl(var(--muted))] px-3 py-2 text-sm text-[hsl(var(--destructive))]">
            {error}
          </div>
        ) : null}
        {memories.length === 0 ? (
          <EmptyState icon="brain" text="Nothing remembered yet." />
        ) : (
          memories.map((m) => (
            <div
              key={m.id}
              className="flex items-start justify-between gap-4 rounded-[var(--radius)] border border-[hsl(var(--border))] p-3"
            >
              <div className="flex flex-col gap-1">
                <span className="text-base">{m.text}</span>
                <span className="text-sm text-[hsl(var(--muted-foreground))]">
                  {scopeLabel(m, nameById)} · {CATEGORY_LABELS[m.category]}
                  {m.pinned ? " · Pinned" : ""}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleArchive(m.id)}
                disabled={archivingId === m.id}
                aria-label={`Archive "${m.text}"`}
              >
                <ArchiveIcon className="h-5 w-5" aria-hidden />
              </Button>
            </div>
          ))
        )}
      </div>
    </Page>
  );
}
