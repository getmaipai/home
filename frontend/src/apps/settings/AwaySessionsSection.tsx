import { i18n } from "@lingui/core";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { List } from "@maipai/ui/src/primitives/List";
import { Section } from "@maipai/ui/src/primitives/Section";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { Button } from "@maipai/ui/src/ui/button";
import { api, type SessionInfo } from "@/lib/api";
import { errorLine } from "@/lib/hubReachability";

function whenText(iso: string): string {
  return new Date(iso).toLocaleString();
}

/** The authenticated person's own sessions issued through Home's away address. */
export function AwaySessionsSection() {
  const queryClient = useQueryClient();
  const query = useQuery<SessionInfo[]>({ queryKey: ["away-sessions"], queryFn: api.awaySessions });
  const [confirming, setConfirming] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    if (!confirming) return;
    setError(null);
    try {
      await api.revokeSession(confirming.id);
      await queryClient.invalidateQueries({ queryKey: ["away-sessions"] });
      setConfirming(null);
    } catch (cause) {
      setError(errorLine(cause, "Could not sign out that device."));
    }
  }

  return (
    <Section heading={i18n._({ id: "Signed in away from home", message: "Signed in away from home" })}>
      {error ? <p className="text-base text-destructive">{error}</p> : null}
      <AsyncState data={query.data} error={query.isError} isFetching={query.isFetching} onRetry={() => query.refetch()} errorMessage="Could not load your away sessions." loadingLabel="Loading away sessions">
        {(rows) => rows.length === 0 ? <EmptyState icon="inbox" text={i18n._({ id: "No devices have signed in away from home.", message: "No devices have signed in away from home." })} /> : (
          <List items={rows} getKey={(session) => session.id} label={i18n._({ id: "Devices signed in away from home", message: "Devices signed in away from home" })} renderItem={(session) => (
            <div className="flex min-w-0 flex-1 flex-col gap-1 py-1">
              <span className="truncate text-base font-medium">{session.userAgent ?? "Unknown browser"}</span>
              <span className="text-sm text-muted-foreground">{i18n._({ id: "Last signed in {whenText}", message: "Last signed in {whenText}", values: { whenText: whenText(session.createdAt) } })}</span>
            </div>
          )} renderAction={(session) => confirming?.id === session.id ? (
            <div className="flex gap-2">
              <Button variant="destructive" onClick={() => void revoke()}>{i18n._({ id: "Sign out", message: "Sign out" })}</Button>
              <Button variant="ghost" onClick={() => setConfirming(null)}>{i18n._({ id: "Keep it", message: "Keep it" })}</Button>
            </div>
          ) : (
            <Button variant="ghost" aria-label={`Sign out ${session.userAgent ?? "that device"}`} onClick={() => setConfirming(session)}>{i18n._({ id: "Revoke", message: "Revoke" })}</Button>
          )} />
        )}
      </AsyncState>
    </Section>
  );
}
