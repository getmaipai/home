import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AsyncState } from "@maipai/ui/src/primitives/AsyncState";
import { EmptyState } from "@maipai/ui/src/primitives/EmptyState";
import { DetailPane } from "@maipai/ui/src/primitives/DetailPane";
import { DestructiveConfirm } from "@maipai/ui/src/primitives/DestructiveConfirm";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { Input } from "@maipai/ui/src/ui/input";
import { Alert, AlertDescription } from "@maipai/ui/src/ui/alert";
import { Section } from "@maipai/ui/src/primitives/Section";
import { FieldError } from "@maipai/ui/src/dashboard/components/ui/field";
import { Label } from "@maipai/ui/src/dashboard/components/ui/label";
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@maipai/ui/src/dashboard/components/ui/item";
import areasFile from "@maipai/spec/settings/areas.json";
import { SettingsRenderer } from "@/shell/pages/settings/SettingsRenderer";
import { api, ApiError, type DeviceInfo } from "@/lib/api";
import { StackChanInstallDialog } from "@/apps/settings/StackChanInstallDialog";
import { RobotSelfTests } from "@/apps/settings/RobotSelfTests";
import { RobotCompanionChoices } from "@/apps/settings/RobotCompanionChoices";
import { playableVoices, voiceFriendlyName } from "@/lib/voice/voiceBrowserRows";

const DEVICE_PARAM = "device";

function statusText(device: DeviceInfo): string {
  if (device.lastSeenAt === null && device.state == null) return "Waiting for first report";
  if (device.state && !device.state.reachable) return "Not responding";
  return "Paired";
}

/** ROBOT-ADMIN-PLACE-01: Home settings, Devices. One row per household robot; opening a row (`?device=<id>`)
 * shows that robot's own settings, name, area, Forget and Cancel install in one detail view with the lifecycle
 * button in its header, so nothing sits below the screen. Admin only; the section's area gate and the hub both
 * enforce it. */
export function HouseholdRobotsSection() {
  const [params, setParams] = useSearchParams();
  const openId = params.get(DEVICE_PARAM);
  const query = useQuery<DeviceInfo[]>({ queryKey: ["robot-devices"], queryFn: () => api.robotDevices(), refetchInterval: 5000 });
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ["robot-devices"] });
    window.addEventListener("devices-updated", refresh);
    return () => window.removeEventListener("devices-updated", refresh);
  }, [queryClient]);
  const close = () => setParams((previous) => { const next = new URLSearchParams(previous); next.delete(DEVICE_PARAM); return next; });
  return (
    <AsyncState data={query.data} error={query.isError} isFetching={query.isFetching} onRetry={() => query.refetch()} errorMessage="Could not load the household's robots." loadingLabel="Loading robots">
      {(robots: DeviceInfo[]) => {
        const open = openId ? robots.find((robot) => robot.id === openId) : undefined;
        if (open) return <RobotDetail key={open.id} device={open} onClose={close} />;
        return (
          <Section heading="Robots">
            {robots.length === 0 ? <EmptyState icon="inbox" text="No robots yet. Add one below." /> : (
              <ItemGroup variant="card" aria-label="Household robots">
                {robots.map((robot) => (
                  <Item key={robot.id} size="setting" render={<Link to={`?${DEVICE_PARAM}=${encodeURIComponent(robot.id)}`} aria-label={`${robot.name} settings`} />}>
                    <ItemContent>
                      <ItemTitle>{robot.name}</ItemTitle>
                      <ItemDescription>{[robot.area, statusText(robot)].filter(Boolean).join(" · ")}</ItemDescription>
                    </ItemContent>
                  </Item>
                ))}
              </ItemGroup>
            )}
          </Section>
        );
      }}
    </AsyncState>
  );
}

function RobotDetail({ device, onClose }: { device: DeviceInfo; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(device.name);
  const [area, setArea] = useState(device.area ?? "");
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [hostedInstall, setHostedInstall] = useState(false);
  const [robotVoices, setRobotVoices] = useState<Awaited<ReturnType<typeof api.stackVoices>>["voices"]>([]);
  useEffect(() => {
    let active = true;
    void api.stackVoices().then((result) => { if (active) setRobotVoices(result.voices); }).catch(() => { if (active) setRobotVoices([]); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    void api.robotInstallStatus(device.id).then(() => { if (active) setHostedInstall(true); }).catch(() => { if (active) setHostedInstall(false); });
    return () => { active = false; };
  }, [device.id, device.lastSeenAt]);
  // The section's own settings cards draw above this view; opening a robot brings its detail to the top of the screen.
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => { top.current?.scrollIntoView?.({ block: "start" }); }, []);
  const installing = hostedInstall && device.lastSeenAt === null;
  const voiceOptions = [{ value: "default", label: "Use the companion's voice" }, ...playableVoices(robotVoices).map((voice) => ({ value: voice.id, label: voiceFriendlyName(voice) }))];
  const cards = useMemo(() => ((areasFile as { device_cards?: Array<{ device_kind: string; group: string; scope: "device"; label: string; min_role?: string }> }).device_cards ?? []).filter((card) => card.device_kind === "robot" && card.scope === "device" && (!card.min_role || card.min_role === "admin" || card.min_role === "owner")), []);
  const refreshAll = () => { window.dispatchEvent(new Event("devices-updated")); void queryClient.invalidateQueries({ queryKey: ["robot-devices"] }); void queryClient.invalidateQueries({ queryKey: ["robots"] }); };

  async function saveIdentity(): Promise<void> {
    setSaveBusy(true);
    setSaveError(null);
    try { await api.updateDevice(device.id, { name, area: area.trim() || null }); refreshAll(); }
    catch (error) { setSaveError(error instanceof ApiError ? error.message : "Could not save this robot. Check the connection and try again."); }
    finally { setSaveBusy(false); }
  }
  async function endLifecycle(): Promise<void> {
    setLifecycleBusy(true);
    setLifecycleError(null);
    try {
      if (installing) await api.cancelRobotInstall(device.id);
      else await api.revokeDevice(device.id);
      refreshAll();
      onClose();
    } catch (error) {
      setConfirming(false);
      setLifecycleError(error instanceof ApiError ? error.message : `${installing ? "The install could not be cancelled" : `${device.name} could not be forgotten`}. Check the connection and try again.`);
    } finally { setLifecycleBusy(false); }
  }

  return (
    <div ref={top} className="scroll-mt-4">
    <DetailPane
      title={device.name}
      subtitle={device.area ?? "Robot"}
      onClose={onClose}
      closeLabel="Back to robots"
      actions={confirming ? null : <>{hostedInstall && !installing ? <StackChanInstallDialog updateOf={device.id} /> : null}<Button variant="destructive" onClick={() => setConfirming(true)}>{installing ? "Cancel install" : "Forget this robot"}</Button></>}
    >
      <div className="flex flex-col gap-4">
        {confirming ? (
          <DestructiveConfirm
            message={installing ? `Cancel the install and forget ${device.name}?` : `Forget ${device.name}?`}
            detail={installing ? "This revokes its enrollment code and deletes its saved firmware backup." : "It will need to be paired again. This also deletes the robot's memories and its saved firmware backup."}
            confirmLabel={installing ? "Yes, cancel install" : "Yes, forget it"}
            busyLabel="Working…"
            busy={lifecycleBusy}
            cancelLabel={installing ? "Keep installing" : "Keep it"}
            onConfirm={() => void endLifecycle()}
            onCancel={() => setConfirming(false)}
          />
        ) : null}
        {lifecycleError ? <Alert variant="destructive"><AlertDescription>{lifecycleError}</AlertDescription></Alert> : null}
        <p className="text-base"><Badge variant="secondary">{statusText(device)}</Badge>{device.ipAddress ? <> IP address {device.ipAddress}</> : null}</p>
        <RobotSelfTests device={device} />
        <RobotCompanionChoices deviceId={device.id} />
        <div className="flex flex-col gap-3">
          <Label htmlFor={`robot-name-${device.id}`}>Name</Label>
          <Input id={`robot-name-${device.id}`} value={name} maxLength={60} aria-invalid={saveError !== null} onChange={(event) => setName(event.target.value)} />
          <FieldError errors={saveError ? [{ message: saveError }] : []} />
          <Label htmlFor={`robot-area-${device.id}`}>Area</Label>
          <Input id={`robot-area-${device.id}`} value={area} maxLength={60} onChange={(event) => setArea(event.target.value)} />
          <Button disabled={saveBusy || !name.trim()} onClick={() => void saveIdentity()}>{saveBusy ? "Saving…" : "Save name and area"}</Button>
        </div>
        {cards.map((card) => <SettingsRenderer key={`${card.scope}:${card.group}`} scope="device" scopeValue={`device:${device.id}`} only={[card.group]} titleOverrides={{ [card.group]: card.label }} optionsFrom={{ "voices.tts": voiceOptions }} />)}
      </div>
    </DetailPane>
    </div>
  );
}
