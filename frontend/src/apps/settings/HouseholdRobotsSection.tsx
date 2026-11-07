import { i18n } from "@lingui/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
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
import { api, type DeviceInfo } from "@/lib/api";
import { StackChanInstallDialog } from "@/apps/settings/StackChanInstallDialog";
import { RobotSelfTests } from "@/apps/settings/RobotSelfTests";
import { RobotCompanionChoices } from "@/apps/settings/RobotCompanionChoices";
import { playableVoices, voiceFriendlyName } from "@/lib/voice/voiceBrowserRows";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { useTabItem } from "@/shell/tabIdentity";
import { errorLine } from "@/lib/hubReachability";


function statusText(device: DeviceInfo): string {
  if (device.lastSeenAt === null && device.state == null) return "Waiting for first report";
  if (device.state && !device.state.reachable) return "Not responding";
  return "Paired";
}

function robotOnline(device: DeviceInfo): boolean {
  return device.online === true;
}

function robotLastSeen(device: DeviceInfo): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(device.lastSeenAt!));
}

/** ROBOT-ADMIN-PLACE-01: Home settings, Devices. The list opens a robot's route detail. Admin only; the section's area gate and the hub enforce it. */
export function HouseholdRobotsSection({ detailId, tab }: { detailId?: string; tab?: string }) {
  const navigate = useNavigate();
  const [, setParams] = useSearchParams();
  const query = useQuery<DeviceInfo[]>({ queryKey: ["robot-devices"], queryFn: () => api.robotDevices(), refetchInterval: 5000 });
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ["robot-devices"] });
    window.addEventListener("devices-updated", refresh);
    return () => window.removeEventListener("devices-updated", refresh);
  }, [queryClient]);
  return (
    <AsyncState data={query.data} error={query.isError} isFetching={query.isFetching} onRetry={() => query.refetch()} errorMessage="Could not load the household's robots." loadingLabel="Loading robots">
      {(robots: DeviceInfo[]) => {
        const open = detailId ? robots.find((robot) => robot.id === detailId) : undefined;
        if (detailId && !open) {
          navigate("/settings/apps?tab=robot", { replace: true });
          return null;
        }
        if (open) return <RobotDetail key={open.id} device={open} tab={tab} onClose={() => {}} />;
        return (
          <Card>
            <CardHeader><CardTitle>{i18n._({ id: "Robots", message: "Robots" })}</CardTitle><CardAction><Button size="lg" onClick={() => setParams((p) => { const n = new URLSearchParams(p); n.set("addRobot", "1"); return n; })}>{i18n._({ id: "Add a robot", message: "Add a robot" })}</Button></CardAction></CardHeader>
            <CardContent>{robots.length === 0 ? <EmptyState icon="inbox" text={i18n._({ id: "No robots yet.", message: "No robots yet." })} /> : (
              <ItemGroup variant="card" aria-label={i18n._({ id: "Household robots", message: "Household robots" })}>
                {robots.map((robot) => (
                  <Item key={robot.id} size="setting" render={<Link to={`/settings/apps/${encodeURIComponent(robot.id)}?tab=overview`} aria-label={`${robot.name} settings`} />}>
                    <ItemContent>
                      <ItemTitle>{robot.name}</ItemTitle>
                      <ItemDescription>{robot.area ? `${robot.area} · ` : ""}{robot.lastSeenAt ? robotOnline(robot) ? i18n._({ id: "Online", message: "Online" }) : `Offline, last seen ${robotLastSeen(robot)}` : i18n._({ id: "Never connected", message: "Never connected" })}</ItemDescription>
                    </ItemContent>
                    <Badge variant="secondary">{robotOnline(robot) ? i18n._({ id: "Online", message: "Online" }) : statusText(robot)}</Badge>
                  </Item>
                ))}
              </ItemGroup>
            )}</CardContent>
          </Card>
        );
      }}
    </AsyncState>
  );
}

function RobotDetail({ device, tab, onClose }: { device: DeviceInfo; tab?: string; onClose: () => void }) {
  useTabItem(device.name);
  const queryClient = useQueryClient();
  const [name, setName] = useState(device.name);
  const [area, setArea] = useState(device.area ?? "");
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [hostedInstall, setHostedInstall] = useState(false);
  const softwareQuery = useQuery({ queryKey: ["robot-software", device.id], queryFn: () => api.robotSoftware(device.id), enabled: hostedInstall });
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
  const activeTab = tab ?? "overview";
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
    catch (error) { setSaveError(errorLine(error, "Could not save this robot. Check the connection and try again.")); }
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
      setLifecycleError(errorLine(error, `${installing ? "The install could not be cancelled" : `${device.name} could not be forgotten`}. Check the connection and try again.`));
    } finally { setLifecycleBusy(false); }
  }

  return (
    <div ref={top} className="scroll-mt-4">
    <DetailPane
      title={device.name}
      subtitle={device.area ?? "Robot"}
      onClose={onClose}
      closeLabel="Back to robots"
      actions={null}
    >
      <div className="flex flex-col gap-4">
        {lifecycleError ? <Alert variant="destructive"><AlertDescription>{lifecycleError}</AlertDescription></Alert> : null}
        {activeTab === "overview" ? <>
        <p className="text-base"><Badge variant="secondary">{softwareQuery.data?.checkin?.online ? i18n._({ id: "Online", message: "Online" }) : device.lastSeenAt ? i18n._({ id: "Offline", message: "Offline" }) : statusText(device)}</Badge>{softwareQuery.data?.checkin ? <>{" "}{i18n._({ id: "Last seen {format}{value}", message: "Last seen {format}{value}", values: { format: new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(softwareQuery.data.checkin.lastSeen)), value: softwareQuery.data.checkin.ip ? ` · IP address ${softwareQuery.data.checkin.ip}` : "" } })}</> : device.lastSeenAt ? <>{" "}{i18n._({ id: "Last seen {format}", message: "Last seen {format}", values: { format: new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(device.lastSeenAt)) } })}</> : null}</p>
        <RobotSelfTests device={device} />
        {hostedInstall && softwareQuery.data ? <Section heading={i18n._({ id: "Software", message: "Software" })}>
          <ItemGroup variant="card" aria-label={i18n._({ id: "Robot software", message: "Robot software" })}>
            <Item size="setting">
              <ItemContent><ItemTitle>{i18n._({ id: "Connection", message: "Connection" })}</ItemTitle><ItemDescription>{softwareQuery.data.checkin || softwareQuery.data.lastSeenAt
                ? [softwareQuery.data.checkin?.online ? null : `Offline, last seen ${new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(softwareQuery.data.checkin?.lastSeen ?? softwareQuery.data.lastSeenAt!))}`,
                  softwareQuery.data.checkin?.signal ? `Wi-Fi ${softwareQuery.data.checkin.signal}` : null,
                  softwareQuery.data.checkin?.battery.level !== null && softwareQuery.data.checkin ? `Battery ${softwareQuery.data.checkin.battery.level}%${softwareQuery.data.checkin.battery.charging ? i18n._({ id: ", charging", message: ", charging" }) : ""}` : null,
                  softwareQuery.data.checkin?.ip ? `IP address ${softwareQuery.data.checkin.ip}` : null].filter(Boolean).join(" · ") || "No connection details reported."
                : i18n._({ id: "Waiting for the robot to check in.", message: "Waiting for the robot to check in." })}</ItemDescription></ItemContent>
              <Badge variant="secondary">{softwareQuery.data.checkin?.online ? i18n._({ id: "Online", message: "Online" }) : i18n._({ id: "Offline", message: "Offline" })}</Badge>
            </Item>
            <Item size="setting">
              <ItemContent>
                <ItemTitle>{i18n._({ id: "Robot firmware", message: "Robot firmware" })}</ItemTitle>
                <ItemDescription>{softwareQuery.data.firmware.installed
                  ? `Installed ${softwareQuery.data.firmware.installed.version}, recorded ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(softwareQuery.data.firmware.installed.at))}. Ready to install: ${softwareQuery.data.firmware.available}.`
                  : `Not recorded. Ready to install: ${softwareQuery.data.firmware.available}. Install the update from here to keep track.`}</ItemDescription>
              </ItemContent>
              <Badge variant="secondary">{softwareQuery.data.firmware.status === "up_to_date" ? i18n._({ id: "Up to date", message: "Up to date" }) : softwareQuery.data.firmware.status === "update_available" ? i18n._({ id: "Update available", message: "Update available" }) : i18n._({ id: "Unknown", message: "Unknown" })}</Badge>
            </Item>
            <Item size="setting">
              <ItemContent>
                <ItemTitle>{i18n._({ id: "Bot software on this computer", message: "Bot software on this computer" })}</ItemTitle>
                <ItemDescription>{softwareQuery.data.bot.running ? `${softwareQuery.data.bot.running}. Ready: ${softwareQuery.data.bot.available}.` : `Not running. Ready: ${softwareQuery.data.bot.available}.`}</ItemDescription>
              </ItemContent>
              <Badge variant="secondary">{softwareQuery.data.bot.status === "up_to_date" ? i18n._({ id: "Up to date", message: "Up to date" }) : softwareQuery.data.bot.status === "restart_needed" ? i18n._({ id: "Restart needed", message: "Restart needed" }) : softwareQuery.data.bot.running ? i18n._({ id: "Unknown", message: "Unknown" }) : i18n._({ id: "Not running", message: "Not running" })}</Badge>
            </Item>
          </ItemGroup>
          <StackChanInstallDialog updateOf={device.id} showButton={softwareQuery.data.firmware.status !== "up_to_date"} onInstalled={() => void queryClient.invalidateQueries({ queryKey: ["robot-software", device.id] })} />
        </Section> : null}
        </> : null}
        {activeTab === "behaviour" ? <>
        <RobotCompanionChoices deviceId={device.id} />
        {cards.map((card) => <SettingsRenderer key={`${card.scope}:${card.group}`} scope="device" scopeValue={`device:${device.id}`} only={[card.group]} titleOverrides={{ [card.group]: card.label }} optionsFrom={{ "voices.tts": voiceOptions }} />)}
        </> : null}
        {activeTab === "access" ? <>
        <Section heading={i18n._({ id: "Access", message: "Access" })}><div className="flex flex-col gap-3"><Label htmlFor={`robot-name-${device.id}`}>{i18n._({ id: "Name", message: "Name" })}</Label><Input id={`robot-name-${device.id}`} value={name} maxLength={60} aria-invalid={saveError !== null} onChange={(event) => setName(event.target.value)} /><FieldError errors={saveError ? [{ message: saveError }] : []} /><Label htmlFor={`robot-area-${device.id}`}>{i18n._({ id: "Area", message: "Area" })}</Label><Input id={`robot-area-${device.id}`} value={area} maxLength={60} onChange={(event) => setArea(event.target.value)} /><Button disabled={saveBusy || !name.trim()} onClick={() => void saveIdentity()}>{saveBusy ? i18n._({ id: "Saving…", message: "Saving…" }) : i18n._({ id: "Save name and area", message: "Save name and area" })}</Button></div></Section>
        <Section heading={i18n._({ id: "Remove", message: "Remove" })}>{confirming ? <DestructiveConfirm message={installing ? `Cancel the install and forget ${device.name}?` : `Forget ${device.name}?`} detail={installing ? "This revokes its enrollment code and deletes its saved firmware backup." : "It will need to be paired again. This also deletes the robot's memories and its saved firmware backup."} confirmLabel={installing ? "Yes, cancel install" : "Yes, forget it"} busyLabel="Working…" busy={lifecycleBusy} cancelLabel={installing ? "Keep installing" : "Keep it"} onConfirm={() => void endLifecycle()} onCancel={() => setConfirming(false)} /> : <ItemGroup variant="card"><Item size="setting"><ItemContent><ItemTitle>{installing ? i18n._({ id: "Cancel install", message: "Cancel install" }) : i18n._({ id: "Forget this robot", message: "Forget this robot" })}</ItemTitle><ItemDescription>{installing ? i18n._({ id: "Stop this robot's installation.", message: "Stop this robot's installation." }) : i18n._({ id: "Remove this robot from the household.", message: "Remove this robot from the household." })}</ItemDescription></ItemContent><Button size="lg" variant="destructive" onClick={() => setConfirming(true)}>{installing ? i18n._({ id: "Cancel install", message: "Cancel install" }) : i18n._({ id: "Forget this robot", message: "Forget this robot" })}</Button></Item></ItemGroup>}</Section>
        </> : null}
      </div>
    </DetailPane>
    </div>
  );
}
