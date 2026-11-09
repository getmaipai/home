import { i18n } from "@lingui/core";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Section } from "@maipai/ui/src/primitives/Section";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { Select } from "@maipai/ui/src/primitives/Select";
import { OptionMatrix } from "@maipai/ui/src/settings/OptionMatrix";
import { api, type PersonRosterEntry, type SiteBlocksView } from "@/lib/api";
import { errorLine } from "@/lib/hubReachability";
import { StatusCard } from "@maipai/ui/src/elements/status-card";

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
      setError(errorLine(err, i18n._({ id: "Could not save that change. Check your connection and try again.", message: "Could not save that change. Check your connection and try again." })));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section heading={i18n._({ id: "Blocked sites by person", message: "Blocked sites by person" })}>
      <Select
        value={chosen.id}
        onValueChange={(v) => setPickedId(v)}
        options={roster.map((p) => p.id)}
        getLabel={(v) => roster.find((p) => p.id === v)?.display_name ?? v}
        aria-label={i18n._({ id: "Person", message: "Person" })}
      />
      {error ? <StatusCard kind="problem" title={i18n._({ id: "That did not work", message: "That did not work" })} line={error} /> : null}
      <AsyncState
        data={query.data}
        error={query.isError}
        isFetching={query.isFetching}
        onRetry={() => query.refetch()}
        errorMessage={i18n._({ id: "Could not load this person's blocked sites. Check your connection and try again.", message: "Could not load this person's blocked sites. Check your connection and try again." })}
        loadingLabel={i18n._({ id: "Loading blocked sites", message: "Loading blocked sites" })}
      >
        {(view) => (
          <>
            <p className="text-base text-muted-foreground">{chosen.display_name}: {view.label}</p>
            <OptionMatrix
              rowsLabel={i18n._({ id: "Blocked sites", message: "Blocked sites" })}
              rows={view.rows.map((r) => ({
                id: r.id,
                label: r.label,
                does: r.does,
                note: view.setBy[r.id],
                resetLabel: r.id in view.setBy ? view.resetLabel : undefined,
              }))}
              columns={[
                { key: "defaults", label: i18n._({ id: "Global defaults", message: "Global defaults" }), value: view.defaults, locked: view.defaults },
                { key: "mine", label: i18n._({ id: "{name}'s changes", message: "{name}'s changes", values: { name: chosen.display_name } }), value: view.mine, locked: view.locked },
              ]}
              lockedNote={i18n._({ id: "Ticked boxes you cannot change are the age group's setting, or a block that always stays on to keep children and teens safe.", message: "Ticked boxes you cannot change are the age group's setting, or a block that always stays on to keep children and teens safe." })}
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
