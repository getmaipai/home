import { i18n } from "@lingui/core";
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
import { api, type DeviceInfo, type SessionInfo } from "@/lib/api";
import { errorLine } from "@/lib/hubReachability";

function whenText(iso: string): string {
  return new Date(iso).toLocaleString();
}

const deviceKindLabels = (): Record<DeviceInfo["kind"], string> => ({
  robot: i18n._({ id: "Robot", message: "Robot" }),
  pod: i18n._({ id: "Pod", message: "Pod" }),
  tv: i18n._({ id: "TV", message: "TV" }),
  phone: i18n._({ id: "Phone", message: "Phone" }),
  desktop: i18n._({ id: "Desktop", message: "Desktop" }),
  browser: i18n._({ id: "Browser", message: "Browser" }),
});

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
      setActionError(errorLine(err, i18n._({ id: "Could not revoke that.", message: "Could not revoke that." })));
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
      setActionError(i18n._({ id: "The offline permission could not be saved. Check your connection, then try again.", message: "The offline permission could not be saved. Check your connection, then try again." }));
    } finally { setBusy(false); }
  }

  return (
    <>
      {actionError ? <Alert variant="destructive"><AlertDescription>{actionError}</AlertDescription></Alert> : null}

      <Section heading={i18n._({ id: "Devices", message: "Devices" })}>
        <AsyncState
          data={devicesQuery.data}
          error={devicesQuery.isError}
          isFetching={devicesQuery.isFetching}
          onRetry={() => devicesQuery.refetch()}
          errorMessage={i18n._({ id: "Could not load your devices.", message: "Could not load your devices." })}
          loadingLabel={i18n._({ id: "Loading devices", message: "Loading devices" })}
        >
          {(allRows) => {
            const allDevices = allRows.filter((d) => matchesSearch(`${d.name} ${d.kind} ${d.area ?? ""}`));
            const devices = allDevices.filter((d) => d.kind !== "robot");
            return devices.length === 0 ? (
              <EmptyState icon="inbox" text={i18n._({ id: "No devices paired to your profile yet.", message: "No devices paired to your profile yet." })} />
            ) : (
              <div className="flex flex-col gap-4">
              <List
                items={devices}
                getKey={(d) => d.id}
                label={i18n._({ id: "Devices", message: "Devices" })}
                renderItem={(d) => {
                  const isConfirming = confirming?.kind === "device" && confirming.id === d.id;
                  if (isConfirming) {
                    return (
                      <p className="text-base font-medium">{i18n._({ id: "Remove {name}? It will need to be paired again to reconnect.", message: "Remove {name}? It will need to be paired again to reconnect.", values: { name: d.name } })}</p>
                    );
                  }
                  return (
                    <div className="flex min-w-0 flex-1 flex-col gap-1 py-1">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{deviceKindLabels()[d.kind]}</Badge>
                        <span className="truncate text-base font-medium">{d.name}</span>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {d.area ? `${d.area} · ` : ""}
                        {d.lastSeenAt ? i18n._({ id: "last seen {time}", message: "last seen {time}", values: { time: whenText(d.lastSeenAt) } }) : i18n._({ id: "never connected", message: "never connected" })}
                      </span>
                      {d.kind === "tv" || d.kind === "pod" ? null : (
                        <Label htmlFor={`offline-${d.id}`}>
                          <Switch id={`offline-${d.id}`} checked={d.offlineScope?.includes("offline.records") ?? false} disabled={busy} onCheckedChange={(checked) => void setOffline(d, checked)} />
                          {i18n._({ id: "Can keep copies on this device", message: "Can keep copies on this device" })}
                        </Label>
                      )}
                    </div>
                  );
                }}
                renderAction={(d) =>
                  confirming?.kind === "device" && confirming.id === d.id ? (
                    <div className="flex gap-2">
                      <Button variant="destructive" onClick={handleRevoke} disabled={busy}>
                        {busy ? i18n._({ id: "Working…", message: "Working…" }) : i18n._({ id: "Yes, remove it", message: "Yes, remove it" })}
                      </Button>
                      <Button variant="ghost" onClick={() => setConfirming(null)}>
                        {i18n._({ id: "Keep it", message: "Keep it" })}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      aria-label={i18n._({ id: "Remove {name}", message: "Remove {name}", values: { name: d.name } })}
                      onClick={() => setConfirming({ kind: "device", id: d.id, label: d.name })}
                    >
                      {i18n._({ id: "Remove", message: "Remove" })}
                    </Button>
                  )
                }
              />
              </div>
            );
          }}
        </AsyncState>
      </Section>

      <Section heading={i18n._({ id: "Copies in this browser", message: "Copies in this browser" })}>
        <p>{i18n._({ id: "Saved files on the hub still work when the internet is down. Copies here let this browser open kept items when it cannot reach the hub.", message: "Saved files on the hub still work when the internet is down. Copies here let this browser open kept items when it cannot reach the hub." })}</p>
        <AsyncState data={keptQuery.data} error={keptQuery.isError} isFetching={keptQuery.isFetching} onRetry={() => keptQuery.refetch()} errorMessage={i18n._({ id: "Copies could not be listed. Try again.", message: "Copies could not be listed. Try again." })} loadingLabel={i18n._({ id: "Loading copies", message: "Loading copies" })}>
          {(rows) => { const items = rows.filter((item) => matchesSearch(`${item.title} ${item.kind}`)).sort((a, b) => a.kind.localeCompare(b.kind) || a.title.localeCompare(b.title)); return items.length ? <List items={items} getKey={(item) => `${item.kind}:${item.id}`} label={i18n._({ id: "Offline copies", message: "Offline copies" })} renderItem={(item) => <span>{item.title} <Badge variant="secondary">{item.kind === "media" ? i18n._({ id: "Media", message: "Media" }) : item.kind.replaceAll("_", " ")}</Badge></span>} /> : <EmptyState icon="inbox" text={i18n._({ id: "No copies kept in this browser.", message: "No copies kept in this browser." })} />; }}
        </AsyncState>
        <Button variant="destructive" disabled={busy} onClick={async () => {
          setBusy(true);
          try { await removeAllOfflineMedia(); await keptQuery.refetch(); }
          catch { setActionError(i18n._({ id: "Offline copies could not be removed. Try again in this browser.", message: "Offline copies could not be removed. Try again in this browser." })); }
          finally { setBusy(false); }
        }}>{i18n._({ id: "Remove all offline copies", message: "Remove all offline copies" })}</Button>
      </Section>

      <Section heading={i18n._({ id: "Signed-in sessions", message: "Signed-in sessions" })}>
        <AsyncState
          data={sessionsQuery.data}
          error={sessionsQuery.isError}
          isFetching={sessionsQuery.isFetching}
          onRetry={() => sessionsQuery.refetch()}
          errorMessage={i18n._({ id: "Could not load your sessions.", message: "Could not load your sessions." })}
          loadingLabel={i18n._({ id: "Loading sessions", message: "Loading sessions" })}
        >
          {(allRows) => { const rows = allRows.filter((row) => matchesSearch(row.userAgent ?? i18n._({ id: "Unknown browser", message: "Unknown browser" }))); return (
            rows.length === 0 ? (
              <EmptyState icon="inbox" text={i18n._({ id: "No active sessions.", message: "No active sessions." })} />
            ) : (
              <List
                items={rows}
                getKey={(s) => s.id}
                label={i18n._({ id: "Sessions", message: "Sessions" })}
                renderItem={(s) => {
                  const isConfirming = confirming?.kind === "session" && confirming.id === s.id;
                  if (isConfirming) {
                    return (
                      <p className="text-base font-medium">{i18n._({ id: "Sign out {label}? It will need to sign in again.", message: "Sign out {label}? It will need to sign in again.", values: { label: confirming.label } })}</p>
                    );
                  }
                  return (
                    <div className="flex min-w-0 flex-1 flex-col gap-1 py-1">
                      <div className="flex items-center gap-2">
                        {s.isCurrent ? <Badge>{i18n._({ id: "This device", message: "This device" })}</Badge> : null}
                        <span className="truncate text-base">{s.userAgent ?? i18n._({ id: "Unknown browser", message: "Unknown browser" })}</span>
                      </div>
                      <span className="text-sm text-muted-foreground">{i18n._({ id: "Signed in {whenText} · expires {whenText2}", message: "Signed in {whenText} · expires {whenText2}", values: { whenText: whenText(s.createdAt), whenText2: whenText(s.expiresAt) } })}</span>
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
                          {busy ? i18n._({ id: "Working…", message: "Working…" }) : i18n._({ id: "Yes, sign it out", message: "Yes, sign it out" })}
                        </Button>
                        <Button variant="ghost" onClick={() => setConfirming(null)}>
                          {i18n._({ id: "Keep it", message: "Keep it" })}
                        </Button>
                      </div>
                    );
                  }
                  return (
                    <Button
                      variant="ghost"
                      aria-label={i18n._({ id: "Sign out {agent}", message: "Sign out {agent}", values: { agent: s.userAgent ?? i18n._({ id: "that session", message: "that session" }) } })}
                      onClick={() => setConfirming({ kind: "session", id: s.id, label: s.userAgent ?? i18n._({ id: "that session", message: "that session" }) })}
                    >
                      {i18n._({ id: "Sign out", message: "Sign out" })}
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
