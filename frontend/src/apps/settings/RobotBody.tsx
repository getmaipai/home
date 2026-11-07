import { i18n } from "@lingui/core";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@maipai/ui/src/ui/badge";
import { Button } from "@maipai/ui/src/ui/button";
import { CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@maipai/ui/src/dashboard/components/ui/card";
import { Progress } from "@maipai/ui/src/dashboard/components/ui/progress";
import { Image } from "@maipai/ui/src/elements/image";
import { ErrorState } from "@maipai/ui/src/elements/error-state";
import { type DeviceInfo, type RobotDeviceState } from "@/lib/api";
import { NO_VENDOR_LOGIN, robotCapabilityLabel } from "@/apps/settings/capabilityLabels";
import { isOwnerOrAdminRole } from "@/lib/api";
import type { Role } from "@maipai/ui/src/settings/settingsAudience";
import { errorLine } from "@/lib/hubReachability";

const ACTIVITY_LABELS: Record<RobotDeviceState["activity"], string> = {
  starting: "Starting up",
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  reconnecting: "Reconnecting",
  sleeping: "Sleeping",
};

function whenText(iso: string): string {
  return new Date(iso).toLocaleString();
}

function batteryText(state: RobotDeviceState): string {
  if (state.battery_level !== null && state.battery_level !== undefined) {
    return `${Math.round(state.battery_level * 100)}%`;
  }
  if (state.on_battery === true) return "On battery, level unknown";
  if (state.on_battery === false) return "Plugged in";
  return "Level unknown";
}

/** Plain-words body health (spec-v0.1.147): null when the robot reports nothing wrong or nothing at all. */
export function bodyHealthText(state: RobotDeviceState): string | null {
  const parts: string[] = [];
  const latched = state.motors_latched ?? [];
  if (latched.length > 0) parts.push(`${latched.join(", ")} switched off after a failed recovery`);
  else if (state.motors_stuck === true) parts.push("Working on a stuck motor");
  switch (state.thermal?.level) {
    case "vision_slowed": parts.push("Warm: watching less often"); break;
    case "gestures_suspended": parts.push("Hot: gestures paused"); break;
    case "idle_still": parts.push("Very hot: resting until it cools"); break;
    default: break;
  }
  return parts.length > 0 ? parts.join(". ") : null;
}

export function didPutDownCountIncrease(previous: number | undefined, next: number | undefined): boolean {
  return previous !== undefined && next !== undefined && next > previous;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-base">{children}</dd>
    </div>
  );
}

/** ROBOT-CARD-01: the body of one paired robot card's live state, from the `state` the hub
 * derives on `GET /api/devices` (`null` until the robot's first report).
 * The caller renders the Card around it (data-testid="robot-card"); this
 * holds the shipped header, content and footer parts. */
export function RobotBody({
  device,
  busy = false,
  onSetMuted,
  onStartLiveView,
  onStopLiveView,
  onAnswerMotorReboot,
  viewerRole = "adult",
  viewerId,
}: {
  device: DeviceInfo;
  viewerRole?: Role;
  /** Who is looking: only the robot's owner or an admin may unmute it; a child or guest controls nothing. */
  viewerId?: string;
  busy?: boolean;
  onSetMuted: (muted: boolean) => Promise<void>;
  onStartLiveView: () => Promise<{ view_id: string; stream: string }>;
  onStopLiveView: (viewId: string) => Promise<void>;
  onAnswerMotorReboot: (answer: "yes" | "no") => Promise<void>;
}) {
  const state = device.state ?? null;
  // no_vendor_login describes the pairing gate (ROBOT-PAIR-02), not a feature, so it gets no badge.
  const featureCapabilities = device.capabilities.filter((capability) => capability !== NO_VENDOR_LOGIN);
  const admin = isOwnerOrAdminRole(viewerRole);
  const mayControl = viewerRole !== "child" && viewerRole !== "guest";
  const mayUnmute = admin || viewerId === undefined || device.ownerId === undefined || device.ownerId === viewerId;
  const lastPutDownCount = useRef<number | undefined>(state?.put_down_count);
  const [putDownChanged, setPutDownChanged] = useState(false);
  const [askedMuted, setAskedMuted] = useState<boolean | null>(null);
  const [muteError, setMuteError] = useState(false);
  useEffect(() => {
    const nextCount = state?.put_down_count;
    if (didPutDownCountIncrease(lastPutDownCount.current, nextCount)) {
      setPutDownChanged(true);
    }
    if (nextCount !== undefined) lastPutDownCount.current = nextCount;
  }, [state?.put_down_count]);
  useEffect(() => {
    if (askedMuted === null || state?.muted === askedMuted) {
      if (askedMuted !== null && state?.muted === askedMuted) setAskedMuted(null);
      return;
    }
    const timer = setTimeout(() => setAskedMuted(null), 15_000);
    return () => clearTimeout(timer);
  }, [askedMuted, state?.muted]);
  async function askMute(muted: boolean): Promise<void> {
    setMuteError(false);
    setAskedMuted(muted);
    try {
      await onSetMuted(muted);
    } catch {
      setAskedMuted(null);
      setMuteError(true);
    }
  }
  // LIVE-VIEW-01: the hub refuses (live view off, not an adult, not on the list) with a plain
  // message, shown as it came. The hub stops a view at 10 minutes; so does this card.
  const [liveView, setLiveView] = useState<{ viewId: string; stream: string } | null>(null);
  const [liveStarting, setLiveStarting] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const liveViewId = liveView?.viewId ?? null;
  const stopRef = useRef(onStopLiveView);
  stopRef.current = onStopLiveView;
  async function startLive(): Promise<void> {
    setLiveError(null);
    setLiveStarting(true);
    try {
      const started = await onStartLiveView();
      setLiveView({ viewId: started.view_id, stream: started.stream });
    } catch (err) {
      setLiveView(null);
      setLiveError(errorLine(err, `Could not open the live view of ${device.name}. Check that it is switched on, then try again.`));
    } finally {
      setLiveStarting(false);
    }
  }
  function stopLive(): void {
    const id = liveViewId;
    setLiveView(null);
    if (id) void stopRef.current(id).catch(() => undefined);
  }
  useEffect(() => {
    if (!liveViewId) return;
    const timer = setTimeout(() => {
      setLiveView(null);
      void stopRef.current(liveViewId).catch(() => undefined);
    }, 10 * 60_000);
    return () => clearTimeout(timer);
  }, [liveViewId]);
  const openViewRef = useRef<string | null>(null);
  openViewRef.current = liveViewId;
  useEffect(() => () => { if (openViewRef.current) void stopRef.current(openViewRef.current).catch(() => undefined); }, []);
  // MOTOR-REBOOT-CARD: the robot offers to restart a latched motor; nothing is sent until someone answers yes.
  const [rebootBusy, setRebootBusy] = useState(false);
  const [rebootError, setRebootError] = useState<string | null>(null);
  async function answerReboot(answer: "yes" | "no"): Promise<void> {
    setRebootError(null);
    setRebootBusy(true);
    try {
      await onAnswerMotorReboot(answer);
    } catch (err) {
      setRebootError(errorLine(err, `Could not send that to ${device.name}. Check that it is switched on, then try again.`));
    } finally {
      setRebootBusy(false);
    }
  }
  const unreachable = state !== null && !state.reachable;
  const rebootOffer = state !== null && !unreachable ? state.motors_reboot_offer ?? [] : [];
  const showMuted = state !== null && !unreachable && state.muted && (state.activity === "idle" || state.activity === "listening");
  const status = state === null ? "Waiting for first report" : unreachable ? "Not responding" : showMuted ? "Muted" : ACTIVITY_LABELS[state.activity];
  const motion = state?.motion ?? null;
  const battery = state?.battery_level;
  return (
    <>
      <CardHeader>
        <CardTitle className="truncate">{device.name}</CardTitle>
        <CardDescription>{[device.area ?? "Robot", device.ownerName ? `Belongs to ${device.ownerName}` : null].filter(Boolean).join(" · ")}</CardDescription>
        <CardAction>
          <Badge variant={unreachable ? "destructive" : "secondary"}>{status}</Badge>
          <Badge variant="secondary">{i18n._({ id: "Paired", message: "Paired" })}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        {featureCapabilities.length > 0 ? (
          <div className="mb-4 flex flex-wrap gap-2" aria-label={i18n._({ id: "Robot capabilities", message: "Robot capabilities" })}>
            {featureCapabilities.map((capability) => (
              <Badge key={capability} variant="outline">
                {robotCapabilityLabel(capability)}
              </Badge>
            ))}
          </div>
        ) : null}
        {state === null ? (
          <p className="text-base text-muted-foreground">{i18n._({ id: "{name} has not reported in yet. It shows up here once it is switched on and connected.", message: "{name} has not reported in yet. It shows up here once it is switched on and connected.", values: { name: device.name } })}</p>
        ) : (
          <dl className="flex flex-col gap-3">
            {unreachable ? (
              <Row label={i18n._({ id: "Last heard from", message: "Last heard from" })}>{state.unreachableSince ? whenText(state.unreachableSince) : i18n._({ id: "Unknown", message: "Unknown" })}</Row>
            ) : null}
            {admin && device.ipAddress ? <Row label={i18n._({ id: "IP address", message: "IP address" })}>{device.ipAddress}</Row> : null}
            <Row label={i18n._({ id: "Microphone", message: "Microphone" })}>{state.muted ? i18n._({ id: "Muted", message: "Muted" }) : i18n._({ id: "On", message: "On" })}</Row>
            <Row label={i18n._({ id: "Tracking", message: "Tracking" })}>{state.tracking ? i18n._({ id: "On", message: "On" }) : i18n._({ id: "Off", message: "Off" })}</Row>
            {motion === "held" ? <p className="text-sm font-medium">{i18n._({ id: "Being carried", message: "Being carried" })}</p> : null}
            {putDownChanged ? (
              <p className="text-sm text-muted-foreground">
                {device.area ? `${device.name} was moved: is it still in ${device.area}?` : `${device.name} was moved.`}
              </p>
            ) : null}
            <Row label={i18n._({ id: "Battery", message: "Battery" })}>{batteryText(state)}</Row>
            {battery !== null && battery !== undefined ? (
              <Progress value={Math.round(battery * 100)} aria-label={i18n._({ id: "Battery level", message: "Battery level" })} />
            ) : null}
            {bodyHealthText(state) ? <Row label={i18n._({ id: "Body health", message: "Body health" })}>{bodyHealthText(state)}</Row> : null}
            <Row label={i18n._({ id: "MaiPai version", message: "MaiPai version" })}>{state.app_version ?? "Unknown"}</Row>
            <Row label={i18n._({ id: "Body software", message: "Body software" })}>{state.daemon_version ?? "Unknown"}</Row>
          </dl>
        )}
        {rebootOffer.length > 0 ? (
          <div className="mt-4 flex flex-col gap-2" data-testid="motor-reboot-offer">
            <p className="text-base font-medium">{i18n._({ id: "Restart {name}'s {join} {value}?", message: "Restart {name}'s {join} {value}?", values: { name: device.name, join: rebootOffer.join(", "), value: rebootOffer.length === 1 ? i18n._({ id: "motor", message: "motor" }) : i18n._({ id: "motors", message: "motors" }) } })}</p>
            <p className="text-sm text-muted-foreground">{i18n._({ id: "{value} stopped working and the robot could not recover on its own. Restarting moves {value2}, so keep hands clear of the head first.", message: "{value} stopped working and the robot could not recover on its own. Restarting moves {value2}, so keep hands clear of the head first.", values: { value: rebootOffer.length === 1 ? i18n._({ id: "That motor", message: "That motor" }) : i18n._({ id: "Those motors", message: "Those motors" }), value2: rebootOffer.length === 1 ? i18n._({ id: "it", message: "it" }) : i18n._({ id: "them", message: "them" }) } })}</p>
            <div className="flex flex-wrap gap-2">
              <Button disabled={rebootBusy} onClick={() => void answerReboot("yes")}>
                {i18n._({ id: "Yes, restart it", message: "Yes, restart it" })}
              </Button>
              <Button variant="ghost" disabled={rebootBusy} onClick={() => void answerReboot("no")}>
                {i18n._({ id: "No, leave it", message: "No, leave it" })}
              </Button>
            </div>
            {rebootError ? <p role="alert" className="text-base text-destructive">{rebootError}</p> : null}
          </div>
        ) : null}
        {liveView && liveView.stream ? (
          <div className="mt-4" data-testid="robot-live-view">
            <Image.Root size="full">
              <Image.Preview src={liveView.stream} alt={`Live view from ${device.name}'s camera`} />
            </Image.Root>
            <p className="mt-2 text-sm text-muted-foreground">{i18n._({ id: "Live view stops by itself after 10 minutes. Nothing is recorded.", message: "Live view stops by itself after 10 minutes. Nothing is recorded." })}</p>
          </div>
        ) : null}
        {liveError ? <p role="alert" className="mt-4 text-base text-destructive">{liveError}</p> : null}
        {muteError && state !== null ? (
          <ErrorState
            layout="inline"
            retrying={false}
            title={`Could not send that to ${device.name}.`}
            onRetry={() => void askMute(!state.muted)}
          />
        ) : null}
      </CardContent>
      <CardFooter>
        <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {state !== null && mayControl ? (
            <>
              {askedMuted !== null && !muteError ? (
                <p className="mr-auto text-sm text-muted-foreground">{i18n._({ id: "Asked {name} to {value}, waiting for it.", message: "Asked {name} to {value}, waiting for it.", values: { name: device.name, value: askedMuted ? i18n._({ id: "mute", message: "mute" }) : i18n._({ id: "unmute", message: "unmute" }) } })}</p>
              ) : null}
              {liveView ? (
                <Button variant="outline" onClick={stopLive}>
                  {i18n._({ id: "Stop live view", message: "Stop live view" })}
                </Button>
              ) : (
                <Button variant="outline" disabled={busy || unreachable || liveStarting} onClick={() => void startLive()}>
                  {liveStarting ? i18n._({ id: "Opening…", message: "Opening…" }) : i18n._({ id: "Live view", message: "Live view" })}
                </Button>
              )}
              <Button
                variant="outline"
                disabled={busy || unreachable || askedMuted !== null || (state.muted && !mayUnmute)}
                onClick={() => void askMute(!state.muted)}
              >
                {state.muted ? i18n._({ id: "Unmute microphone", message: "Unmute microphone" }) : i18n._({ id: "Mute microphone", message: "Mute microphone" })}
              </Button>
            </>
          ) : null}
        </div>
      </CardFooter>
    </>
  );
}
