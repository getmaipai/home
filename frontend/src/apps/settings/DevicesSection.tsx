import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Section } from "@maipai/ui/src/primitives/Section";
import { List } from "@maipai/ui/src/primitives/List";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Switch } from "@maipai/ui/src/ui/switch";
import { Label } from "@maipai/ui/src/dashboard/components/ui/label";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { listKept, removeAllOfflineMedia } from "@/lib/offlineMedia";
import { api, ApiError, type DeviceInfo, type SessionInfo } from "@/lib/api";

function whenText(iso: string): string {
  return new Date(iso).toLocaleString();
}

const DEVICE_KIND_LABELS: Record<DeviceInfo["kind"], string> = {
  robot: "Robot",
  pod: "Pod",
  tv: "TV",
  phone: "Phone",
  desktop: "Desktop",
  browser: "Browser",
};

// Session E step 6: "sessions and devices with revoke", against F's
// real, landed GET/DELETE /api/devices and GET/DELETE /api/auth/sessions
// (step 6, merged into this branch 2026-09-06). Both scoped to the
// caller's own profile, not a household-wide admin view (devices.ts's
// own comment) - a personal Profile action, the same PERSON_TREE scope
// PIN/password change already has, not gated behind AdminGatedContent.
export function DevicesSection({ search = "" }: { search?: string }) {
  const matchesSearch = (text: string) => text.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());
  const queryClient = useQueryClient();
  const devicesQuery = useQuery<DeviceInfo[]>({ queryKey: ["devices"], queryFn: () => api.devices() });
  useEffect(() => {
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ["devices"] });
    window.addEventListener("devices-updated", refresh);
    return () => window.removeEventListener("devices-updated", refresh);
  }, [queryClient]);
  const keptQuery = useQuery({ queryKey: ["offline-media"], queryFn: listKept });
  const sessionsQuery = useQuery<SessionInfo[]>({ queryKey: ["sessions"], queryFn: () => api.sessions() });
  const [confirming, setConfirming] = useState<{ kind: "device" | "session"; id: string; label: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleRevoke() {
    if (!confirming) return;
    setBusy(true);
    setActionError(null);
    try {
      if (confirming.kind === "device") {
        await api.revokeDevice(confirming.id);
        await queryClient.invalidateQueries({ queryKey: ["devices"] });
      } else {
        await api.revokeSession(confirming.id);
        await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      }
      setConfirming(null);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not revoke that.");
    } finally {
      setBusy(false);
    }
  }

  async function setOffline(device: DeviceInfo, enabled: boolean) {
    setBusy(true);
    setActionError(null);
    try {
      const scopes: NonNullable<DeviceInfo["offlineScope"]> = enabled ? ["media.offline", "offline.records"] : [];
      await api.setDeviceOfflineScope(device.id, scopes);
      await devicesQuery.refetch();
    } catch {
      setActionError("The offline permission could not be saved. Check your connection, then try again.");
    } finally { setBusy(false); }
  }

  return (
    <>
      {actionError ? <Alert variant="destructive"><AlertDescription>{actionError}</AlertDescription></Alert> : null}

      <Section heading="Devices">
        <AsyncState
          data={devicesQuery.data}
          error={devicesQuery.isError}
          isFetching={devicesQuery.isFetching}
          onRetry={() => devicesQuery.refetch()}
          errorMessage="Could not load your devices."
          loadingLabel="Loading devices"
        >
          {(allRows) => {
            const allDevices = allRows.filter((d) => matchesSearch(`${d.name} ${d.kind} ${d.area ?? ""}`));
            const devices = allDevices.filter((d) => d.kind !== "robot");
            return devices.length === 0 ? (
              <EmptyState icon="inbox" text="No devices paired to your profile yet." />
            ) : (
              <div className="flex flex-col gap-4">
              <List
                items={devices}
                getKey={(d) => d.id}
                label="Devices"
                renderItem={(d) => {
                  const isConfirming = confirming?.kind === "device" && confirming.id === d.id;
                  if (isConfirming) {
                    return (
                      <p className="text-base font-medium">
                        Remove {d.name}? It will need to be paired again to reconnect.
                      </p>
                    );
                  }
                  return (
                    <div className="flex min-w-0 flex-1 flex-col gap-1 py-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{DEVICE_KIND_LABELS[d.kind]}</Badge>
                        <span className="truncate text-base font-medium">{d.name}</span>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {d.area ? `${d.area} · ` : ""}
                        {d.lastSeenAt ? `last seen ${whenText(d.lastSeenAt)}` : "never connected"}
                      </span>
                      {d.kind === "tv" || d.kind === "pod" ? null : (
                        <Label htmlFor={`offline-${d.id}`}>
                          <Switch id={`offline-${d.id}`} checked={d.offlineScope?.includes("offline.records") ?? false} disabled={busy} onCheckedChange={(checked) => void setOffline(d, checked)} />
                          Can keep copies on this device
                        </Label>
                      )}
                    </div>
                  );
                }}
                renderAction={(d) =>
                  confirming?.kind === "device" && confirming.id === d.id ? (
                    <div className="flex gap-2">
                      <Button variant="destructive" onClick={handleRevoke} disabled={busy}>
                        {busy ? "Working…" : "Yes, remove it"}
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirming(null)}>
                        Keep it
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      aria-label={`Remove ${d.name}`}
                      onClick={() => setConfirming({ kind: "device", id: d.id, label: d.name })}
                    >
                      Remove
                    </Button>
                  )
                }
              />
              </div>
            );
          }}
        </AsyncState>
      </Section>

      <Section heading="Copies in this browser">
        <p>Saved files on the hub still work when the internet is down. Copies here let this browser open kept items when it cannot reach the hub.</p>
        <AsyncState data={keptQuery.data} error={keptQuery.isError} isFetching={keptQuery.isFetching} onRetry={() => keptQuery.refetch()} errorMessage="Copies could not be listed. Try again." loadingLabel="Loading copies">
          {(rows) => { const items = rows.filter((item) => matchesSearch(`${item.title} ${item.kind}`)).sort((a, b) => a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title)); return items.length ? <List items={items} getKey={(item) => `${item.kind}:${item.id}`} label="Offline copies" renderItem={(item) => <span>{item.title} <Badge variant="secondary">{item.kind === "media" ? "Media" : item.kind.replaceAll("_", " ")}</Badge></span>} /> : <EmptyState icon="inbox" text="No copies kept in this browser." />; }}
        </AsyncState>
        <Button variant="destructive" disabled={busy} onClick={async () => {
          setBusy(true);
          try { await removeAllOfflineMedia(); await keptQuery.refetch(); }
          catch { setActionError("Offline copies could not be removed. Try again in this browser."); }
          finally { setBusy(false); }
        }}>Remove all offline copies</Button>
      </Section>

      <Section heading="Signed-in sessions">
        <AsyncState
          data={sessionsQuery.data}
          error={sessionsQuery.isError}
          isFetching={sessionsQuery.isFetching}
          onRetry={() => sessionsQuery.refetch()}
          errorMessage="Could not load your sessions."
          loadingLabel="Loading sessions"
        >
          {(allRows) => { const rows = allRows.filter((row) => matchesSearch(row.userAgent ?? "Unknown browser")); return (
            rows.length === 0 ? (
              <EmptyState icon="inbox" text="No active sessions." />
            ) : (
              <List
                items={rows}
                getKey={(s) => s.id}
                label="Sessions"
                renderItem={(s) => {
                  const isConfirming = confirming?.kind === "session" && confirming.id === s.id;
                  if (isConfirming) {
                    return (
                      <p className="text-base font-medium">
                        Sign out {confirming.label}? It will need to sign in again.
                      </p>
                    );
                  }
                  return (
                    <div className="flex min-w-0 flex-1 flex-col gap-1 py-1">
                      <div className="flex items-center gap-2">
                        {s.isCurrent ? <Badge>This device</Badge> : null}
                        <span className="truncate text-base">{s.userAgent ?? "Unknown browser"}</span>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        Signed in {whenText(s.createdAt)} · expires {whenText(s.expiresAt)}
                      </span>
                    </div>
                  );
                }}
                renderAction={(s) => {
                  // A person's own current session isn't offered a revoke
                  // button: they'd just be signing themselves out of the
                  // very page they're using to do it, with no clearer way
                  // to say "sign out" than the shell's own real Sign out
                  // action already does.
                  if (s.isCurrent) return null;
                  if (confirming?.kind === "session" && confirming.id === s.id) {
                    return (
                      <div className="flex gap-2">
                        <Button variant="destructive" onClick={handleRevoke} disabled={busy}>
                          {busy ? "Working…" : "Yes, sign it out"}
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirming(null)}>
                          Keep it
                        </Button>
                      </div>
                    );
                  }
                  return (
                    <Button
                      variant="ghost"
                      aria-label={`Sign out ${s.userAgent ?? "that session"}`}
                      onClick={() => setConfirming({ kind: "session", id: s.id, label: s.userAgent ?? "that session" })}
                    >
                      Sign out
                    </Button>
                  );
                }}
              />
            )
          ); }}
        </AsyncState>
      </Section>
    </>
  );
}
