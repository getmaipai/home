import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Section } from "@maipai/ui/src/primitives/Section";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Select } from "@maipai/ui/src/primitives/Select";
import { OptionMatrix } from "@maipai/ui/src/settings/OptionMatrix";
import { api, ApiError, type PersonRosterEntry, type SiteBlocksView } from "@/lib/api";

interface SiteBlocksSectionProps {
  /** The people the signed-in owner or admin may open (already filtered by the caller). */
  roster: readonly PersonRosterEntry[];
}

/** Blocked-site categories per person: the household's defaults on the left (read-only here), the person's
 * own overrides on the right. The label reads "Teen + 3 changes"; each changed row has "Back to Teen". */
export function SiteBlocksSection({ roster }: SiteBlocksSectionProps) {
  const queryClient = useQueryClient();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const chosen = roster.find((p) => p.id === pickedId) ?? roster[0];
  const query = useQuery({
    queryKey: ["site-blocks", chosen?.id],
    queryFn: () => api.siteBlocks(chosen!.id),
    enabled: Boolean(chosen),
  });
  if (!chosen) return null;

  async function run(action: () => Promise<SiteBlocksView>) {
    setBusy(true);
    setError(null);
    try {
      queryClient.setQueryData(["site-blocks", chosen!.id], await action());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save that change. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section heading="Blocked sites by person">
      <Select
        value={chosen.id}
        onValueChange={(v) => setPickedId(v)}
        options={roster.map((p) => p.id)}
        getLabel={(v) => roster.find((p) => p.id === v)?.display_name ?? v}
        aria-label="Person"
      />
      {error ? <p className="text-base text-destructive">{error}</p> : null}
      <AsyncState
        data={query.data}
        error={query.isError}
        isFetching={query.isFetching}
        onRetry={() => query.refetch()}
        errorMessage="Could not load this person's blocked sites. Check your connection and try again."
        loadingLabel="Loading blocked sites"
      >
        {(view) => (
          <>
            <p className="text-base text-muted-foreground">{chosen.display_name}: {view.label}</p>
            <OptionMatrix
              rowsLabel="Blocked sites"
              rows={view.rows.map((r) => ({
                id: r.id,
                label: r.label,
                does: r.does,
                note: view.setBy[r.id],
                resetLabel: r.id in view.setBy ? view.resetLabel : undefined,
              }))}
              columns={[
                { key: "defaults", label: "Global defaults", value: view.defaults, locked: view.defaults },
                { key: "mine", label: `${chosen.display_name}'s changes`, value: view.mine, locked: view.locked },
              ]}
              lockedNote="Ticked boxes you cannot change are the age group's setting, or a block that always stays on to keep children and teens safe."
              disabled={busy}
              onToggle={(column, rowId, checked) => {
                if (column === "mine") void run(() => api.setSiteBlock(chosen.id, rowId, checked));
              }}
              onReset={(rowId) => void run(() => api.resetSiteBlocks(chosen.id, rowId))}
            />
          </>
        )}
      </AsyncState>
    </Section>
  );
}
